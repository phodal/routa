use crate::db::Db;
use crate::ipc;
use crate::models::{
    AttributionConfidence, FileEventRecord, GitEvent, HookClient, HookEvent, RuntimeMessage,
    SessionRecord,
};
use crate::repo::{resolve, resolve_runtime, RepoContext};
use anyhow::{Context, Result};
use chrono::Utc;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::Read;

pub fn parse_stdin_payload() -> Result<String> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    Ok(input)
}

pub fn handle_hook(
    client_name: &str,
    event_name: &str,
    repo_hint: Option<&str>,
    db_hint: Option<&str>,
    payload_raw: &str,
) -> Result<()> {
    if try_forward_hook_to_runtime(client_name, event_name, repo_hint, db_hint, payload_raw)? {
        return Ok(());
    }

    let payload: Value = if payload_raw.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(payload_raw).context("parse hook payload")?
    };

    let cwd = extract_field(&payload, &["cwd", "workingDir", "working_directory"])
        .or_else(|| repo_hint.map(|r| r.to_string()))
        .unwrap_or_else(|| ".".to_string());
    let ctx = resolve_runtime(Some(&cwd))?;
    let db = Db::open(&ctx.db_path)?;
    let repo_root = ctx.repo_root.to_string_lossy().to_string();
    let now_ms = Utc::now().timestamp_millis();
    let client = HookClient::from_str(client_name);

    let session_id = extract_field(&payload, &["session_id", "sessionId", "thread_id"])
        .unwrap_or_else(|| "unknown".to_string());
    let turn_id = extract_field(&payload, &["turn_id", "turnId"]);
    let model = extract_field(&payload, &["model"]).filter(|value| !value.is_empty());
    let hook_event_name = extract_field(
        &payload,
        &[
            "hook_event_name",
            "event_name",
            "hookEventName",
            "eventName",
        ],
    )
    .unwrap_or_else(|| normalize_event_name(client_name, event_name));
    let tool_name = extract_field(&payload, &["tool_name", "toolName"])
        .or_else(|| extract_field_from_cmd_path(&payload));

    let payload_json = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
    let tmux_session = extract_field(&payload, &["tmux_session", "tmuxSession"])
        .or_else(|| std::env::var("TMUX_SESSION").ok());
    let tmux_window = extract_field(&payload, &["tmux_window", "tmuxWindow"])
        .or_else(|| std::env::var("TMUX_WINDOW").ok());
    let tmux_pane = extract_field(&payload, &["tmux_pane", "tmuxPane"]).or_else(|| {
        std::env::var("TMUX_PANE")
            .ok()
            .map(|value| format!("${value}"))
    });

    let metadata_json = json!({
        "client_event": event_name,
        "session_started_from": client.as_str(),
    })
    .to_string();

    db.upsert_session(&SessionRecord {
        session_id: session_id.clone(),
        repo_root: repo_root.clone(),
        client: client.as_str().to_string(),
        cwd: cwd.clone(),
        model: model.clone(),
        started_at_ms: now_ms,
        last_seen_at_ms: now_ms,
        ended_at_ms: if normalized_is_stop(&hook_event_name) {
            Some(now_ms)
        } else {
            None
        },
        status: if normalized_is_stop(&hook_event_name) {
            "ended".to_string()
        } else {
            "active".to_string()
        },
        tmux_session,
        tmux_window,
        tmux_pane,
        metadata_json,
    })?;

    db.record_turn(
        &session_id,
        &repo_root,
        turn_id.as_deref(),
        client.as_str(),
        &hook_event_name,
        tool_name.as_deref(),
        extract_tool_command(&payload).as_deref(),
        now_ms,
        &payload_json,
    )?;

    if event_is_file_mutating(&hook_event_name, &client, tool_name.as_deref()) {
        let tool_input = payload
            .get("tool_input")
            .cloned()
            .unwrap_or_else(|| payload.clone());
        let candidate_paths = extract_file_paths(&tool_input, &ctx);
        for rel_path in candidate_paths {
            let _ = db.insert_file_event(&FileEventRecord {
                id: None,
                repo_root: repo_root.clone(),
                rel_path,
                event_kind: "hook-file".to_string(),
                observed_at_ms: now_ms,
                session_id: Some(session_id.clone()),
                turn_id: turn_id.clone(),
                confidence: AttributionConfidence::Exact,
                source: client.as_str().to_string(),
                metadata_json: json!({ "raw_event": hook_event_name }).to_string(),
            })?;
        }
    }

    Ok(())
}

pub fn try_forward_hook_to_runtime(
    client_name: &str,
    event_name: &str,
    repo_hint: Option<&str>,
    db_hint: Option<&str>,
    payload_raw: &str,
) -> Result<bool> {
    let (ctx, message) =
        build_hook_runtime_message(client_name, event_name, repo_hint, db_hint, payload_raw)?;
    match ipc::send_message(&ctx.runtime_event_path, &message) {
        Ok(_) => Ok(true),
        Err(err) => {
            eprintln!(
                "agentwatch warning: runtime socket unavailable, fallback to local store: {err}"
            );
            Ok(false)
        }
    }
}

pub fn build_hook_runtime_message(
    client_name: &str,
    event_name: &str,
    repo_hint: Option<&str>,
    db_hint: Option<&str>,
    payload_raw: &str,
) -> Result<(RepoContext, RuntimeMessage)> {
    let payload: Value = if payload_raw.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(payload_raw).context("parse hook payload")?
    };

    let cwd = extract_field(&payload, &["cwd", "workingDir", "working_directory"])
        .or_else(|| repo_hint.map(|r| r.to_string()))
        .unwrap_or_else(|| ".".to_string());
    let ctx = resolve(Some(&cwd), db_hint)?;
    let now_ms = Utc::now().timestamp_millis();
    let client = HookClient::from_str(client_name);
    let session_id = extract_field(&payload, &["session_id", "sessionId", "thread_id"])
        .unwrap_or_else(|| "unknown".to_string());
    let turn_id = extract_field(&payload, &["turn_id", "turnId"]);
    let model = extract_field(&payload, &["model"]).filter(|value| !value.is_empty());
    let hook_event_name = extract_field(
        &payload,
        &[
            "hook_event_name",
            "event_name",
            "hookEventName",
            "eventName",
        ],
    )
    .unwrap_or_else(|| normalize_event_name(client_name, event_name));
    let tool_name = extract_field(&payload, &["tool_name", "toolName"])
        .or_else(|| extract_field_from_cmd_path(&payload));
    let tool_command = extract_tool_command(&payload);
    let tmux_session = extract_field(&payload, &["tmux_session", "tmuxSession"])
        .or_else(|| std::env::var("TMUX_SESSION").ok());
    let tmux_window = extract_field(&payload, &["tmux_window", "tmuxWindow"])
        .or_else(|| std::env::var("TMUX_WINDOW").ok());
    let tmux_pane = extract_field(&payload, &["tmux_pane", "tmuxPane"]).or_else(|| {
        std::env::var("TMUX_PANE")
            .ok()
            .map(|value| format!("${value}"))
    });
    let tool_input = payload
        .get("tool_input")
        .cloned()
        .unwrap_or_else(|| payload.clone());
    let file_paths = if event_is_file_mutating(&hook_event_name, &client, tool_name.as_deref()) {
        extract_file_paths(&tool_input, &ctx)
    } else {
        Vec::new()
    };

    let repo_root = ctx.repo_root.to_string_lossy().to_string();

    Ok((
        ctx,
        RuntimeMessage::Hook(HookEvent {
            repo_root,
            observed_at_ms: now_ms,
            client: client.as_str().to_string(),
            session_id,
            turn_id,
            cwd,
            model,
            event_name: hook_event_name,
            tool_name,
            tool_command,
            file_paths,
            tmux_session,
            tmux_window,
            tmux_pane,
        }),
    ))
}

pub fn handle_git_event(ctx: &RepoContext, event_name: &str, args: &[String]) -> Result<()> {
    if try_forward_git_event(ctx, event_name, args)? {
        return Ok(());
    }

    let db = Db::open(&ctx.db_path)?;
    let now_ms = Utc::now().timestamp_millis();
    let head = current_head(&ctx.repo_root)?;
    let branch = current_branch(&ctx.repo_root)?;
    let metadata_json = json!({ "args": args }).to_string();

    db.insert_git_event(
        &ctx.repo_root.to_string_lossy(),
        event_name,
        Some(head.as_str()),
        Some(branch.as_str()),
        now_ms,
        &metadata_json,
    )?;

    let _ = crate::observe::poll_repo(
        ctx,
        &db,
        "git-hook",
        crate::models::DEFAULT_INFERENCE_WINDOW_MS,
    )?;
    db.clear_inconsistent_state(&ctx.repo_root.to_string_lossy())?;
    Ok(())
}

pub fn try_forward_git_event(ctx: &RepoContext, event_name: &str, args: &[String]) -> Result<bool> {
    let message = RuntimeMessage::Git(GitEvent {
        repo_root: ctx.repo_root.to_string_lossy().to_string(),
        observed_at_ms: Utc::now().timestamp_millis(),
        event_name: event_name.to_string(),
        args: args.to_vec(),
        head_commit: Some(current_head(&ctx.repo_root)?),
        branch: Some(current_branch(&ctx.repo_root)?),
    });
    match ipc::send_message(&ctx.runtime_event_path, &message) {
        Ok(_) => Ok(true),
        Err(err) => {
            eprintln!(
                "agentwatch warning: runtime socket unavailable, fallback to local store: {err}"
            );
            Ok(false)
        }
    }
}

fn extract_tool_command(payload: &Value) -> Option<String> {
    payload
        .get("tool_input")
        .and_then(|it| it.get("command"))
        .and_then(|it| it.as_str())
        .map(ToString::to_string)
}

fn extract_field(payload: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = payload.get(key).and_then(Value::as_str) {
            return Some(value.to_string());
        }
        if let Some(inner) = payload
            .get("tool_input")
            .and_then(|v| v.get(key))
            .and_then(Value::as_str)
        {
            return Some(inner.to_string());
        }
    }
    None
}

fn extract_field_from_cmd_path(payload: &Value) -> Option<String> {
    payload
        .get("command")
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn event_is_file_mutating(event: &str, client: &HookClient, tool_name: Option<&str>) -> bool {
    if matches!(event, "Edit" | "edit" | "Write" | "write") {
        return true;
    }

    if matches!(
        event,
        "PostToolUse" | "post-tool-use" | "PreToolUse" | "pre-tool-use"
    ) {
        return if matches!(client, HookClient::Claude) {
            is_edit_like_tool(tool_name)
        } else {
            true
        };
    }

    false
}

fn is_edit_like_tool(tool_name: Option<&str>) -> bool {
    tool_name
        .is_some_and(|name| name.eq_ignore_ascii_case("edit") || name.eq_ignore_ascii_case("write"))
}

fn normalized_is_stop(event: &str) -> bool {
    matches!(
        event,
        "Stop" | "stop" | "SessionStop" | "session-stop" | "exit" | "quit"
    )
}

fn normalize_event_name(_client: &str, event: &str) -> String {
    let normalized = event
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-")
        .replace(' ', "-");

    match normalized.as_str() {
        "session-start" | "sessionstart" => "SessionStart".to_string(),
        "pre-tool-use" | "pretooluse" => "PreToolUse".to_string(),
        "post-tool-use" | "posttooluse" => "PostToolUse".to_string(),
        "user-prompt-submit" | "prompt-submit" | "promptsubmit" => "UserPromptSubmit".to_string(),
        "stop" => "Stop".to_string(),
        "edit" => "Edit".to_string(),
        "write" => "Write".to_string(),
        _ => event.to_string(),
    }
}

fn extract_file_paths(tool_input: &Value, ctx: &RepoContext) -> Vec<String> {
    let mut candidates = HashSet::new();
    collect_file_values(tool_input, &mut candidates);
    if let Some(command) = tool_input.get("command").and_then(Value::as_str) {
        for path in parse_patch_block(command) {
            candidates.insert(path);
        }
    }
    candidates
        .into_iter()
        .filter_map(|value| normalize_repo_relative(&ctx.repo_root, &value))
        .collect()
}

fn collect_file_values(value: &Value, out: &mut HashSet<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let key_lower = key.to_lowercase();
                let is_path_key = matches!(
                    key_lower.as_str(),
                    "path"
                        | "paths"
                        | "file"
                        | "filepath"
                        | "file_path"
                        | "filename"
                        | "target"
                        | "source"
                        | "target_file"
                        | "source_file"
                        | "absolute_path"
                        | "relative_path"
                );
                if is_path_key {
                    match child {
                        Value::String(path) => {
                            out.insert(path.to_string());
                        }
                        Value::Array(values) => {
                            for item in values {
                                if let Some(path) = item.as_str() {
                                    out.insert(path.to_string());
                                }
                            }
                        }
                        _ => {}
                    }
                }

                collect_file_values(child, out);
            }
        }
        Value::Array(values) => {
            for item in values {
                collect_file_values(item, out);
            }
        }
        Value::String(text) => {
            for value in parse_patch_block(text) {
                out.insert(value);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

fn parse_patch_block(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("*** Update File:") {
            out.push(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("*** Add File:") {
            out.push(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("*** Delete File:") {
            out.push(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("*** Move to:") {
            out.push(rest.trim().to_string());
        }
    }
    out
}

fn normalize_repo_relative(repo_root: &std::path::Path, value: &str) -> Option<String> {
    let clean = value.trim().trim_matches('"').replace('\\', "/");
    if clean.is_empty() || clean == "/dev/null" {
        return None;
    }

    let path = if std::path::Path::new(&clean).is_absolute() {
        std::path::PathBuf::from(clean)
    } else {
        repo_root.join(clean)
    };

    path.strip_prefix(repo_root)
        .ok()
        .map(|v| v.to_string_lossy().replace('\\', "/"))
}

fn current_head(repo_root: &std::path::Path) -> Result<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("rev-parse")
        .arg("HEAD")
        .output()?;
    if !output.status.success() {
        return Ok("unknown".to_string());
    }
    Ok(String::from_utf8(output.stdout)
        .unwrap_or_else(|_| "unknown".to_string())
        .trim()
        .to_string())
}

fn current_branch(repo_root: &std::path::Path) -> Result<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output()?;
    if !output.status.success() {
        return Ok("unknown".to_string());
    }
    Ok(String::from_utf8(output.stdout)
        .unwrap_or_else(|_| "unknown".to_string())
        .trim()
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalize_event_name_handles_edit_write_and_tool_events() {
        assert_eq!(
            normalize_event_name("codex", "session-start"),
            "SessionStart"
        );
        assert_eq!(normalize_event_name("codex", "pre_tool_use"), "PreToolUse");
        assert_eq!(normalize_event_name("codex", "posttooluse"), "PostToolUse");
        assert_eq!(normalize_event_name("codex", "edit"), "Edit");
        assert_eq!(normalize_event_name("codex", "Write"), "Write");
    }

    #[test]
    fn file_mutating_events_detect_tool_intent_for_claude() {
        assert!(event_is_file_mutating(
            "PreToolUse",
            &HookClient::Claude,
            Some("Edit")
        ));
        assert!(event_is_file_mutating(
            "PostToolUse",
            &HookClient::Claude,
            Some("Write")
        ));
        assert!(!event_is_file_mutating(
            "PreToolUse",
            &HookClient::Claude,
            Some("Bash")
        ));
        assert!(!event_is_file_mutating(
            "PostToolUse",
            &HookClient::Claude,
            Some("Read")
        ));
    }

    #[test]
    fn collect_file_values_supports_file_path_aliases() {
        let mut candidate = HashSet::new();
        let payload = json!({
            "tool_input": {
                "file_path": "src/main.rs",
                "filepath": "src/lib.rs",
                "target_file": "src/target.rs",
            }
        });

        collect_file_values(&payload, &mut candidate);

        assert!(candidate.contains("src/main.rs"));
        assert!(candidate.contains("src/lib.rs"));
        assert!(candidate.contains("src/target.rs"));
    }
}
