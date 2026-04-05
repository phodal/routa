use std::fs::OpenOptions;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use routa_core::acp::{get_preset_by_id_with_registry, AcpPreset};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderRuntimeDiagnostic {
    pub(crate) failure_stage_override: Option<&'static str>,
    pub(crate) hint: Option<String>,
}

pub(crate) struct RuntimeFailureContext<'a> {
    pub(crate) provider: &'a str,
    pub(crate) run_started_at: SystemTime,
    pub(crate) prompt_status: Option<&'a str>,
    pub(crate) history_entry_count: usize,
    pub(crate) output_chars: usize,
    pub(crate) last_process_output: Option<&'a str>,
    pub(crate) provider_output: Option<&'a str>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CodexProcessOutputEvent {
    AgentMessage(String),
    AgentMessageChunk(String),
    Ignore,
}

pub(crate) async fn verify_provider_readiness(
    provider: &str,
    emit_warnings: bool,
) -> Result<(), String> {
    let normalized_provider = provider.trim().to_lowercase();
    if normalized_provider.is_empty() {
        return Err("Provider is empty".to_string());
    }

    let preset = get_preset_by_id_with_registry(&normalized_provider)
        .await
        .map_err(|err| format!("Unsupported provider '{}': {}", normalized_provider, err))?;
    let command = resolve_preset_command(&preset);

    if !command_exists(&command) {
        return Err(format!(
            "Provider '{}' requires '{}' but command not found. Is it installed and in PATH?",
            normalized_provider, command
        ));
    }

    if normalized_provider == "opencode" {
        verify_opencode_config_directory()?;
        verify_opencode_data_directory()?;
    }

    if emit_warnings
        && normalized_provider == "claude"
        && std::env::var("ANTHROPIC_AUTH_TOKEN").is_err()
        && std::env::var("ANTHROPIC_API_KEY").is_err()
    {
        println!(
            "⚠️  Claude may require authentication (no ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY)."
        );
    }

    Ok(())
}

pub(crate) fn normalize_ui_journey_update(
    provider: &str,
    update: &serde_json::Value,
) -> Option<serde_json::Value> {
    if !provider.trim().eq_ignore_ascii_case("codex") {
        return Some(update.clone());
    }

    let inner = update.get("params")?.get("update")?;
    let kind = inner
        .get("sessionUpdate")
        .and_then(|value| value.as_str())
        .unwrap_or("");

    match kind {
        "process_output" => {
            let data = inner
                .get("data")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            match classify_codex_process_output(data) {
                CodexProcessOutputEvent::AgentMessage(text) => {
                    Some(synthetic_agent_update(update, "agent_message", text))
                }
                CodexProcessOutputEvent::AgentMessageChunk(text) => {
                    Some(synthetic_agent_update(update, "agent_message_chunk", text))
                }
                CodexProcessOutputEvent::Ignore => None,
            }
        }
        "agent_thought" | "agent_thought_chunk" => None,
        _ => Some(update.clone()),
    }
}

pub(crate) fn extract_provider_output_from_process_output(
    provider: &str,
    history: &[serde_json::Value],
) -> String {
    if !provider.trim().eq_ignore_ascii_case("codex") {
        return String::new();
    }

    let mut delta_output = String::new();
    for entry in history {
        let Some(update) = entry
            .get("params")
            .and_then(|params| params.get("update"))
            .and_then(|value| value.as_object())
        else {
            continue;
        };

        let session_update = update
            .get("sessionUpdate")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if session_update != "process_output" {
            continue;
        }

        let Some(data) = update.get("data").and_then(|value| value.as_str()) else {
            continue;
        };

        match classify_codex_process_output(data) {
            CodexProcessOutputEvent::AgentMessage(text) => return text,
            CodexProcessOutputEvent::AgentMessageChunk(text) => delta_output.push_str(&text),
            CodexProcessOutputEvent::Ignore => {}
        }
    }

    delta_output
}

pub(crate) fn augment_runtime_failure_message(
    failure_message: &str,
    context: &RuntimeFailureContext<'_>,
) -> String {
    let Some(diagnostic) = diagnose_runtime_failure(
        context.provider,
        context.run_started_at,
        context.prompt_status,
        context.history_entry_count,
        context.output_chars,
        context.last_process_output,
        context.provider_output,
    ) else {
        return failure_message.to_string();
    };

    let Some(hint) = diagnostic.hint else {
        return failure_message.to_string();
    };
    format!("{}; hint: {}", failure_message, hint)
}

pub(crate) fn diagnose_runtime_failure(
    provider: &str,
    run_started_at: SystemTime,
    prompt_status: Option<&str>,
    history_entry_count: usize,
    output_chars: usize,
    last_process_output: Option<&str>,
    provider_output: Option<&str>,
) -> Option<ProviderRuntimeDiagnostic> {
    let normalized_process_output = last_process_output
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let normalized_provider_output = provider_output
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut hints = Vec::new();
    if let Some(output) = normalized_process_output {
        hints.push(format!("last process output: {}", truncate(output, 240)));
    }

    let mut failure_stage_override = None;
    if let Some(output_diagnostic) = diagnose_provider_output(provider, normalized_provider_output)
    {
        if let Some(stage) = output_diagnostic.failure_stage_override {
            failure_stage_override = Some(stage);
        }
        if let Some(hint) = output_diagnostic.hint {
            hints.push(hint);
        }
    }

    if provider.trim().eq_ignore_ascii_case("opencode")
        && output_chars == 0
        && history_entry_count <= 1
        && normalized_process_output.is_none()
        && matches!(prompt_status, Some("pending" | "rpc_timeout" | "error"))
    {
        if let Some(opencode_diagnostic) = latest_opencode_failure_hint(run_started_at) {
            if let Some(stage) = opencode_diagnostic.failure_stage_override {
                failure_stage_override = Some(stage);
            }
            if let Some(hint) = opencode_diagnostic.hint {
                hints.push(hint);
            }
        }
    }

    if hints.is_empty() && failure_stage_override.is_none() {
        return None;
    }

    Some(ProviderRuntimeDiagnostic {
        failure_stage_override,
        hint: (!hints.is_empty()).then(|| hints.join(" | ")),
    })
}

fn diagnose_provider_output(
    provider: &str,
    provider_output: Option<&str>,
) -> Option<ProviderRuntimeDiagnostic> {
    let output = provider_output?;
    let output_lower = output.to_ascii_lowercase();

    if provider.trim().eq_ignore_ascii_case("claude")
        && (output_lower.contains("exceeded_current_quota_error")
            || output_lower.contains("insufficient balance")
            || output_lower.contains("suspended due to insufficient balance")
            || (output_lower.contains("api error: 429") && output_lower.contains("quota")))
    {
        return Some(ProviderRuntimeDiagnostic {
            failure_stage_override: Some("provider_rate_limited"),
            hint: Some(format!(
                "Claude provider output reports quota/billing failure: {}",
                truncate(output, 240)
            )),
        });
    }

    if provider.trim().eq_ignore_ascii_case("qoder")
        || provider.trim().eq_ignore_ascii_case("qodercli")
    {
        let denied_permission = output_lower.contains("permission denied by user");
        let mentions_tooling = output_lower.contains("bash")
            || output_lower.contains("playwright")
            || output_lower.contains("agent-browser")
            || output_lower.contains("skill");
        if denied_permission && mentions_tooling {
            return Some(ProviderRuntimeDiagnostic {
                failure_stage_override: Some("provider_runtime"),
                hint: Some(format!(
                    "Qoder ACP denied tool execution despite permission bypass flags: {}",
                    truncate(output, 240)
                )),
            });
        }
    }

    None
}

fn classify_codex_process_output(data: &str) -> CodexProcessOutputEvent {
    if data.trim().is_empty() {
        return CodexProcessOutputEvent::Ignore;
    }

    if data.contains("Agent message (non-delta) received: \"") {
        return extract_quoted_log_text(data)
            .map(CodexProcessOutputEvent::AgentMessage)
            .unwrap_or(CodexProcessOutputEvent::Ignore);
    }

    if data.contains("Agent message content delta received:") {
        return extract_delta_log_text(data)
            .map(CodexProcessOutputEvent::AgentMessageChunk)
            .unwrap_or(CodexProcessOutputEvent::Ignore);
    }

    CodexProcessOutputEvent::Ignore
}

fn synthetic_agent_update(
    original_update: &serde_json::Value,
    session_update: &str,
    text: String,
) -> serde_json::Value {
    let session_id = original_update
        .get("params")
        .and_then(|params| params.get("sessionId"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    serde_json::json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": session_update,
                "content": {
                    "text": text,
                }
            }
        }
    })
}

fn decode_log_escaped_text(raw: &str) -> String {
    let quoted = format!("\"{}\"", raw);
    serde_json::from_str::<String>(&quoted).unwrap_or_else(|_| {
        raw.replace("\\n", "\n")
            .replace("\\r", "\r")
            .replace("\\t", "\t")
            .replace("\\\"", "\"")
    })
}

fn extract_quoted_log_text(data: &str) -> Option<String> {
    let marker = "Agent message (non-delta) received: \"";
    let start = data.find(marker)?;
    let tail = &data[start + marker.len()..];
    let end = tail.rfind('"')?;
    Some(decode_log_escaped_text(&tail[..end]))
}

fn extract_delta_log_text(data: &str) -> Option<String> {
    let marker = "delta: \"";
    let start = data.find(marker)?;
    let tail = &data[start + marker.len()..];
    let end = tail.rfind('"')?;
    Some(decode_log_escaped_text(&tail[..end]))
}

fn resolve_preset_command(preset: &AcpPreset) -> String {
    if let Some(env_var) = &preset.env_bin_override {
        if let Ok(custom_command) = std::env::var(env_var) {
            let trimmed = custom_command.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }

    preset.command.clone()
}

fn command_exists(command: &str) -> bool {
    if command.trim().is_empty() {
        return false;
    }

    if Path::new(command).is_file() || command.contains(std::path::MAIN_SEPARATOR) {
        Path::new(command).is_file()
    } else {
        routa_core::shell_env::which(command).is_some()
    }
}

fn verify_opencode_config_directory() -> Result<(), String> {
    let config_base = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".config")))
        .ok_or_else(|| "Failed to resolve config directory".to_string())?;
    let config_dir = config_base.join("opencode");
    verify_directory_writable(&config_dir, "config")
}

fn verify_opencode_data_directory() -> Result<(), String> {
    let data_base = std::env::var("XDG_DATA_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".local/share")))
        .ok_or_else(|| "Failed to resolve OpenCode data directory".to_string())?;
    let data_dir = data_base.join("opencode");
    verify_directory_writable(&data_dir, "data")?;

    let database_path = data_dir.join("opencode.db");
    if database_path.exists() {
        OpenOptions::new()
            .read(true)
            .write(true)
            .open(&database_path)
            .map_err(|err| {
                format!(
                    "OpenCode database is not writable at {}: {}",
                    database_path.display(),
                    err
                )
            })?;
    }

    Ok(())
}

fn verify_directory_writable(dir: &Path, label: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|err| {
        format!(
            "Failed to ensure OpenCode {} dir {}: {}",
            label,
            dir.display(),
            err
        )
    })?;

    let check_file = dir.join(format!(".routa-acp-{}-check", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&check_file)
        .map_err(|err| format!("Failed to write {}: {}", check_file.display(), err))?;
    file.write_all(b"routa cli provider health check")
        .map_err(|err| format!("Failed to write {}: {}", check_file.display(), err))?;
    std::fs::remove_file(&check_file)
        .map_err(|err| format!("Failed to clean {}: {}", check_file.display(), err))?;
    Ok(())
}

fn latest_opencode_failure_hint(run_started_at: SystemTime) -> Option<ProviderRuntimeDiagnostic> {
    let log_dir = resolve_opencode_log_dir()?;
    let threshold = run_started_at
        .checked_sub(Duration::from_secs(120))
        .unwrap_or(run_started_at);
    let mut candidates = std::fs::read_dir(&log_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let modified = metadata.modified().ok()?;
            if modified < threshold {
                return None;
            }
            Some((modified, path))
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.0.cmp(&left.0));

    candidates
        .into_iter()
        .take(5)
        .find_map(|(_, path)| extract_opencode_failure_hint(&path))
}

fn resolve_opencode_log_dir() -> Option<PathBuf> {
    let data_base = std::env::var("XDG_DATA_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".local/share")))?;
    Some(data_base.join("opencode").join("log"))
}

fn extract_opencode_failure_hint(path: &Path) -> Option<ProviderRuntimeDiagnostic> {
    let contents = std::fs::read_to_string(path).ok()?;
    let file_name = path.file_name()?.to_string_lossy();

    if contents.contains("FreeUsageLimitError") || contents.contains("Rate limit exceeded") {
        return Some(ProviderRuntimeDiagnostic {
            failure_stage_override: Some("provider_rate_limited"),
            hint: Some(format!(
                "latest OpenCode log {} reports rate limiting from opencode.ai/zen (FreeUsageLimitError)",
                file_name
            )),
        });
    }

    if contents.contains("attempt to write a readonly database") {
        return Some(ProviderRuntimeDiagnostic {
            failure_stage_override: Some("provider_storage"),
            hint: Some(format!(
                "latest OpenCode log {} reports a readonly database in the OpenCode data directory",
                file_name
            )),
        });
    }

    if contents.contains("service=llm providerID=opencode") {
        return Some(ProviderRuntimeDiagnostic {
            failure_stage_override: Some("provider_runtime"),
            hint: Some(format!(
                "latest OpenCode log {} started an LLM stream but produced no assistant output before shutdown",
                file_name
            )),
        });
    }

    contents
        .lines()
        .rev()
        .find(|line| line.contains("service=session.processor error="))
        .map(|line| ProviderRuntimeDiagnostic {
            failure_stage_override: Some("provider_runtime"),
            hint: Some(format!(
                "latest OpenCode log {} reports {}",
                file_name,
                truncate(line, 240)
            )),
        })
}

fn truncate(value: &str, max_chars: usize) -> String {
    let truncated = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        format!("{}...", truncated)
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::{
        augment_runtime_failure_message, classify_codex_process_output, diagnose_runtime_failure,
        extract_opencode_failure_hint, extract_provider_output_from_process_output,
        normalize_ui_journey_update, truncate, CodexProcessOutputEvent, RuntimeFailureContext,
    };
    use std::fs;
    use std::time::SystemTime;
    use tempfile::tempdir;

    #[test]
    fn extracts_rate_limit_hint_from_opencode_log() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("2026-03-25T072419.log");
        fs::write(&path, "ERROR service=session.processor error=Rate limit exceeded. Please try again later.\nFreeUsageLimitError").unwrap();

        let diagnostic = extract_opencode_failure_hint(&path).unwrap();
        assert_eq!(
            diagnostic.failure_stage_override,
            Some("provider_rate_limited")
        );
        assert!(diagnostic.hint.unwrap().contains("2026-03-25T072419.log"));
    }

    #[test]
    fn extracts_readonly_database_hint_from_opencode_log() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("2026-03-25T065843.log");
        fs::write(
            &path,
            "Error: Unexpected error\nattempt to write a readonly database",
        )
        .unwrap();

        let diagnostic = extract_opencode_failure_hint(&path).unwrap();
        assert_eq!(diagnostic.failure_stage_override, Some("provider_storage"));
        assert!(diagnostic.hint.unwrap().contains("readonly database"));
    }

    #[test]
    fn augments_runtime_failure_with_process_output() {
        let context = RuntimeFailureContext {
            provider: "opencode",
            run_started_at: SystemTime::now(),
            prompt_status: Some("pending"),
            history_entry_count: 1,
            output_chars: 0,
            last_process_output: Some("provider stderr line"),
            provider_output: None,
        };
        let message = augment_runtime_failure_message(
            "UI journey exceeded the maximum runtime budget",
            &context,
        );

        assert!(message.contains("last process output"));
        assert!(message.contains("provider stderr line"));
    }

    #[test]
    fn extracts_runtime_stall_hint_from_opencode_log() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("2026-03-25T074517.log");
        fs::write(
            &path,
            "INFO service=session.processor process\nINFO service=llm providerID=opencode modelID=big-pickle stream",
        )
        .unwrap();

        let diagnostic = extract_opencode_failure_hint(&path).unwrap();
        assert_eq!(diagnostic.failure_stage_override, Some("provider_runtime"));
        assert!(diagnostic
            .hint
            .unwrap()
            .contains("produced no assistant output"));
    }

    #[test]
    fn diagnoses_runtime_failure_for_non_empty_process_output() {
        let diagnostic = diagnose_runtime_failure(
            "opencode",
            SystemTime::now(),
            Some("pending"),
            1,
            0,
            Some("provider stderr line"),
            None,
        )
        .unwrap();

        assert_eq!(diagnostic.failure_stage_override, None);
        assert!(diagnostic
            .hint
            .unwrap()
            .contains("last process output: provider stderr line"));
    }

    #[test]
    fn classifies_codex_agent_message_delta_logs() {
        let event = classify_codex_process_output(
            "INFO codex_acp::thread: Agent message content delta received: thread_id: x, delta: \"payload\"",
        );
        assert_eq!(
            event,
            CodexProcessOutputEvent::AgentMessageChunk("payload".to_string())
        );
    }

    #[test]
    fn ignores_codex_reasoning_logs() {
        let event = classify_codex_process_output(
            "INFO codex_acp::thread: Agent reasoning content delta received: thread_id: x, delta: \"noise\"",
        );
        assert_eq!(event, CodexProcessOutputEvent::Ignore);
    }

    #[test]
    fn normalizes_codex_process_output_into_agent_message_update() {
        let update = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "abc",
                "update": {
                    "sessionUpdate": "process_output",
                    "data": "INFO codex_acp::thread: Agent message (non-delta) received: \"final payload\""
                }
            }
        });

        let normalized = normalize_ui_journey_update("codex", &update).unwrap();
        assert_eq!(
            normalized["params"]["update"]["sessionUpdate"],
            "agent_message"
        );
        assert_eq!(
            normalized["params"]["update"]["content"]["text"],
            "final payload"
        );
    }

    #[test]
    fn extracts_only_codex_agent_text_from_process_output_history() {
        let history = vec![
            serde_json::json!({
                "params": {
                    "update": {
                        "sessionUpdate": "process_output",
                        "data": "INFO codex_acp::thread: Agent reasoning content delta received: thread_id: x, delta: \"noise\""
                    }
                }
            }),
            serde_json::json!({
                "params": {
                    "update": {
                        "sessionUpdate": "process_output",
                        "data": "INFO codex_acp::thread: Agent message content delta received: thread_id: x, delta: \"<ui-journey-artifact>\""
                    }
                }
            }),
            serde_json::json!({
                "params": {
                    "update": {
                        "sessionUpdate": "process_output",
                        "data": "INFO codex_acp::thread: Agent message content delta received: thread_id: x, delta: \"done\""
                    }
                }
            }),
        ];

        let output = extract_provider_output_from_process_output("codex", &history);
        assert_eq!(output, "<ui-journey-artifact>done");
    }

    #[test]
    fn classifies_claude_quota_errors_from_provider_output() {
        let diagnostic = diagnose_runtime_failure(
            "claude",
            SystemTime::now(),
            Some("acknowledged"),
            1,
            262,
            None,
            Some(
                "API Error: 429 {\"error\":{\"message\":\"Your account is suspended due to insufficient balance\",\"type\":\"exceeded_current_quota_error\"}}",
            ),
        )
        .unwrap();

        assert_eq!(
            diagnostic.failure_stage_override,
            Some("provider_rate_limited")
        );
        assert!(diagnostic
            .hint
            .unwrap()
            .contains("Claude provider output reports quota/billing failure"));
    }

    #[test]
    fn classifies_qoder_permission_denials_from_provider_output() {
        let diagnostic = diagnose_runtime_failure(
            "qodercli",
            SystemTime::now(),
            Some("pending"),
            18,
            512,
            None,
            Some(
                "permission denied by user while invoking Bash and agent-browser Skill for Playwright screenshot capture",
            ),
        )
        .unwrap();

        assert_eq!(diagnostic.failure_stage_override, Some("provider_runtime"));
        assert!(diagnostic
            .hint
            .unwrap()
            .contains("Qoder ACP denied tool execution"));
    }

    #[test]
    fn truncate_appends_ellipsis_for_long_strings() {
        assert_eq!(truncate("abcdef", 4), "abcd...");
        assert_eq!(truncate("abc", 4), "abc");
    }
}
