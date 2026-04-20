use crate::error::TraceLearningError;
use crate::model::{
    FileEvidenceKind, FileOperationKind, NormalizedFileEvent, NormalizedPrompt, NormalizedSession,
    NormalizedToolCall, PromptRole, ProviderKey, SessionSourceRef, ToolCallStatus,
};
use crate::provider::SessionAdapter;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::OnceLock;

pub struct CodexSessionAdapter;

impl CodexSessionAdapter {
    fn extract_text_from_content(content: &Value) -> Option<String> {
        let parts = content.as_array()?;
        let mut text_parts = Vec::new();
        for part in parts {
            if part.get("type").and_then(Value::as_str) == Some("input_text") {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    text_parts.push(text.to_string());
                }
            }
        }
        let text = text_parts.join("\n").trim().to_string();
        (!text.is_empty()).then_some(text)
    }

    fn normalize_file_path(candidate: &str) -> Option<String> {
        let path = candidate.trim().trim_matches('"').trim_matches('\'');
        if looks_like_repo_path(path) {
            Some(path.to_string())
        } else {
            None
        }
    }

    fn file_event(
        timestamp: Option<String>,
        turn_id: Option<String>,
        path: String,
        operation: FileOperationKind,
        evidence: FileEvidenceKind,
    ) -> NormalizedFileEvent {
        NormalizedFileEvent {
            timestamp,
            turn_id,
            path,
            operation,
            evidence,
            metadata: BTreeMap::new(),
        }
    }

    fn tool_call(
        timestamp: Option<String>,
        turn_id: Option<String>,
        tool_name: String,
        command_text: Option<String>,
        raw_arguments: Option<Value>,
        status: ToolCallStatus,
    ) -> NormalizedToolCall {
        NormalizedToolCall {
            timestamp,
            turn_id,
            tool_name,
            command_text,
            raw_arguments,
            status,
            metadata: BTreeMap::new(),
        }
    }
}

impl SessionAdapter for CodexSessionAdapter {
    fn provider_name(&self) -> &'static str {
        "codex"
    }

    fn can_parse(&self, source: &SessionSourceRef, lines: &[String]) -> bool {
        if source
            .path
            .as_ref()
            .and_then(|path| path.file_name())
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
            .unwrap_or(false)
        {
            return true;
        }

        lines
            .iter()
            .take(5)
            .any(|line| line.contains("\"session_meta\""))
    }

    fn parse_lines(
        &self,
        source: &SessionSourceRef,
        lines: &[String],
    ) -> Result<NormalizedSession, TraceLearningError> {
        let mut session = None::<NormalizedSession>;

        for line in lines {
            let entry: Value = serde_json::from_str(line)?;
            let timestamp = entry
                .get("timestamp")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            let top_level_type = entry.get("type").and_then(Value::as_str);

            match top_level_type {
                Some("session_meta") => {
                    let payload = entry.get("payload").cloned().unwrap_or(Value::Null);
                    let session_id = payload
                        .get("id")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                        .or_else(|| {
                            source.path.as_ref().and_then(|path| {
                                path.file_stem()
                                    .and_then(|stem| stem.to_str())
                                    .map(ToOwned::to_owned)
                            })
                        })
                        .ok_or(TraceLearningError::MissingMetadata("session_id"))?;

                    let mut normalized = NormalizedSession::new(session_id, ProviderKey::Codex);
                    normalized.started_at = payload
                        .get("timestamp")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                        .or(timestamp.clone());
                    normalized.cwd = payload
                        .get("cwd")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned);
                    normalized.source = payload
                        .get("source")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned);
                    normalized.model = payload
                        .get("model")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                        .or_else(|| {
                            payload
                                .get("model_provider")
                                .and_then(Value::as_str)
                                .map(ToOwned::to_owned)
                        });
                    normalized.metadata.insert(
                        "cli_version".to_string(),
                        payload.get("cli_version").cloned().unwrap_or(Value::Null),
                    );
                    normalized.metadata.insert(
                        "originator".to_string(),
                        payload.get("originator").cloned().unwrap_or(Value::Null),
                    );
                    session = Some(normalized);
                }
                Some("event_msg") => {
                    let payload = entry.get("payload").cloned().unwrap_or(Value::Null);
                    match payload.get("type").and_then(Value::as_str) {
                        Some("user_message") => {
                            if let Some(text) = payload
                                .get("message")
                                .and_then(Value::as_str)
                                .map(str::trim)
                            {
                                if !text.is_empty() {
                                    if let Some(session) = session.as_mut() {
                                        session.prompts.push(NormalizedPrompt {
                                            timestamp,
                                            turn_id: None,
                                            role: PromptRole::User,
                                            text: text.to_string(),
                                        });
                                    }
                                }
                            }
                        }
                        Some("exec_command_end") => {
                            let turn_id = payload
                                .get("turn_id")
                                .and_then(Value::as_str)
                                .map(ToOwned::to_owned);
                            let command =
                                payload
                                    .get("command")
                                    .and_then(Value::as_array)
                                    .map(|parts| {
                                        parts
                                            .iter()
                                            .filter_map(Value::as_str)
                                            .collect::<Vec<_>>()
                                            .join(" ")
                                    });
                            let output = payload
                                .get("aggregated_output")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            let status = match payload.get("exit_code").and_then(Value::as_i64) {
                                Some(0) => ToolCallStatus::Succeeded,
                                Some(_) => ToolCallStatus::Failed,
                                None => ToolCallStatus::Unknown,
                            };

                            if let Some(session) = session.as_mut() {
                                session.tool_calls.push(Self::tool_call(
                                    timestamp.clone(),
                                    turn_id.clone(),
                                    "exec_command".to_string(),
                                    command.clone(),
                                    None,
                                    status,
                                ));

                                if let Some(command) = command.as_deref() {
                                    for (path, operation) in
                                        extract_file_events_from_command_output(command, output)
                                    {
                                        session.file_events.push(Self::file_event(
                                            timestamp.clone(),
                                            turn_id.clone(),
                                            path,
                                            operation.0,
                                            operation.1,
                                        ));
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
                Some("response_item") => {
                    let payload = entry.get("payload").cloned().unwrap_or(Value::Null);
                    match payload.get("type").and_then(Value::as_str) {
                        Some("message")
                            if payload.get("role").and_then(Value::as_str) == Some("user") =>
                        {
                            if let Some(text) = Self::extract_text_from_content(
                                payload.get("content").unwrap_or(&Value::Null),
                            ) {
                                if let Some(session) = session.as_mut() {
                                    session.prompts.push(NormalizedPrompt {
                                        timestamp,
                                        turn_id: None,
                                        role: PromptRole::User,
                                        text,
                                    });
                                }
                            }
                        }
                        Some("function_call") => {
                            let tool_name = payload
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or("unknown")
                                .to_string();
                            let raw_arguments_text = payload
                                .get("arguments")
                                .and_then(Value::as_str)
                                .map(ToOwned::to_owned);
                            let raw_arguments = raw_arguments_text
                                .as_ref()
                                .and_then(|text| serde_json::from_str::<Value>(text).ok())
                                .or_else(|| raw_arguments_text.as_ref().map(|text| json!(text)));
                            let command_text = if tool_name == "exec_command" {
                                raw_arguments
                                    .as_ref()
                                    .and_then(|value| value.get("cmd"))
                                    .and_then(Value::as_str)
                                    .map(ToOwned::to_owned)
                            } else {
                                None
                            };

                            if let Some(session) = session.as_mut() {
                                session.tool_calls.push(Self::tool_call(
                                    timestamp.clone(),
                                    None,
                                    tool_name.clone(),
                                    command_text.clone(),
                                    raw_arguments.clone(),
                                    ToolCallStatus::Requested,
                                ));

                                match tool_name.as_str() {
                                    "apply_patch" => {
                                        if let Some(arguments) = raw_arguments_text.as_deref() {
                                            for (path, operation) in
                                                extract_apply_patch_files(arguments)
                                            {
                                                session.file_events.push(Self::file_event(
                                                    timestamp.clone(),
                                                    None,
                                                    path,
                                                    operation,
                                                    FileEvidenceKind::ApplyPatch,
                                                ));
                                            }
                                        }
                                    }
                                    "exec_command" => {
                                        if let Some(command) = command_text.as_deref() {
                                            for path in extract_git_add_paths(command) {
                                                session.file_events.push(Self::file_event(
                                                    timestamp.clone(),
                                                    None,
                                                    path,
                                                    FileOperationKind::Modified,
                                                    FileEvidenceKind::GitAdd,
                                                ));
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }

        session.ok_or(TraceLearningError::MissingMetadata("session_meta"))
    }
}

fn looks_like_repo_path(candidate: &str) -> bool {
    matches!(
        candidate,
        s if s.starts_with("src/")
            || s.starts_with("crates/")
            || s.starts_with("apps/")
            || s.starts_with("docs/")
            || s.starts_with("scripts/")
            || s.starts_with("resources/")
            || s.starts_with("tests/")
            || matches!(
                s,
                "package.json"
                    | "Cargo.toml"
                    | "Cargo.lock"
                    | "pnpm-lock.yaml"
                    | "api-contract.yaml"
                    | "README.md"
                    | "AGENTS.md"
            )
    )
}

fn apply_patch_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?m)^\*\*\* (Update|Add|Delete) File: (.+)$").unwrap())
}

fn diff_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?m)^diff --git a/(.+?) b/(.+)$").unwrap())
}

fn status_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?m)^(?:\s?[MADRCU?!]{1,2})\s+(.+)$").unwrap())
}

fn token_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r#""([^"]+)"|'([^']+)'|(\S+)"#).unwrap())
}

fn extract_apply_patch_files(arguments: &str) -> Vec<(String, FileOperationKind)> {
    let mut files = Vec::new();
    for captures in apply_patch_regex().captures_iter(arguments) {
        let operation = match captures.get(1).map(|m| m.as_str()) {
            Some("Add") => FileOperationKind::Added,
            Some("Delete") => FileOperationKind::Deleted,
            Some("Update") => FileOperationKind::Modified,
            _ => FileOperationKind::Unknown,
        };
        if let Some(path) = captures
            .get(2)
            .and_then(|m| CodexSessionAdapter::normalize_file_path(m.as_str()))
        {
            files.push((path, operation));
        }
    }
    files
}

fn extract_git_add_paths(command: &str) -> Vec<String> {
    if !command.contains("git add") {
        return Vec::new();
    }

    let tokens = token_regex()
        .captures_iter(command)
        .filter_map(|captures| {
            captures
                .get(1)
                .or_else(|| captures.get(2))
                .or_else(|| captures.get(3))
                .map(|m| m.as_str().to_string())
        })
        .collect::<Vec<_>>();

    let Some(start) = tokens
        .windows(2)
        .position(|window| window[0] == "git" && window[1] == "add")
    else {
        return Vec::new();
    };

    let mut files = Vec::new();
    for token in &tokens[(start + 2)..] {
        if token == "--" || token.starts_with('-') {
            continue;
        }
        if token == "&&" || token == "||" || token == ";" {
            break;
        }
        if let Some(path) = CodexSessionAdapter::normalize_file_path(token) {
            files.push(path);
        }
    }
    files
}

fn extract_file_events_from_command_output(
    command: &str,
    output: &str,
) -> Vec<(String, (FileOperationKind, FileEvidenceKind))> {
    let mut files = Vec::new();

    if command.contains("git status --short") || command.contains("git diff --name-only") {
        for captures in status_regex().captures_iter(output) {
            let raw = captures.get(1).map(|m| m.as_str()).unwrap_or_default();
            let path_candidate = raw.split(" -> ").last().unwrap_or(raw);
            if let Some(path) = CodexSessionAdapter::normalize_file_path(path_candidate) {
                let operation = if raw.contains(" -> ") {
                    FileOperationKind::Renamed
                } else if raw.trim_start().starts_with('D') {
                    FileOperationKind::Deleted
                } else if raw.trim_start().starts_with('A') {
                    FileOperationKind::Added
                } else {
                    FileOperationKind::Modified
                };
                files.push((path, (operation, FileEvidenceKind::GitStatus)));
            }
        }
    }

    if command.contains("git diff") || command.contains("git show") {
        for captures in diff_regex().captures_iter(output) {
            if let Some(path) = captures
                .get(2)
                .and_then(|m| CodexSessionAdapter::normalize_file_path(m.as_str()))
            {
                files.push((
                    path,
                    (FileOperationKind::Modified, FileEvidenceKind::GitDiff),
                ));
            }
        }
    }

    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyzer::SessionAnalyzer;
    use crate::catalog::FeatureSurfaceCatalog;
    use crate::provider::AdapterRegistry;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn parses_codex_transcript_into_normalized_session() {
        let transcript = vec![
            r#"{"timestamp":"2026-04-17T01:51:41.963Z","type":"session_meta","payload":{"id":"sess-1","timestamp":"2026-04-17T01:50:56.919Z","cwd":"/Users/phodal/ai/routa-js","source":"cli","model_provider":"openai"}}"#.to_string(),
            r#"{"timestamp":"2026-04-17T02:29:14.084Z","type":"event_msg","payload":{"type":"user_message","message":"fix session mapping","turn_id":"turn-1"}}"#.to_string(),
            r#"{"timestamp":"2026-04-17T02:30:54.595Z","type":"response_item","payload":{"type":"function_call","name":"apply_patch","arguments":"*** Begin Patch\n*** Update File: src/app/api/sessions/[sessionId]/route.ts\n*** End Patch\n"}}"#.to_string(),
            r#"{"timestamp":"2026-04-17T02:31:00.000Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"git add -- \\\"src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx\\\" src/app/api/sessions/[sessionId]/route.ts\"}"}}"#.to_string(),
            r#"{"timestamp":"2026-04-17T02:31:10.000Z","type":"event_msg","payload":{"type":"exec_command_end","turn_id":"turn-1","command":["/bin/zsh","-lc","git status --short"],"aggregated_output":" M src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx\n M src/app/api/sessions/[sessionId]/route.ts\n","exit_code":0}}"#.to_string(),
        ];

        let adapter = CodexSessionAdapter;
        let session = adapter
            .parse_lines(
                &SessionSourceRef {
                    path: None,
                    provider_hint: None,
                },
                &transcript,
            )
            .unwrap();

        assert_eq!(session.session_id, "sess-1");
        assert_eq!(session.prompts.len(), 1);
        assert_eq!(session.tool_calls.len(), 3);

        let changed_files = session
            .file_events
            .iter()
            .map(|event| event.path.as_str())
            .collect::<Vec<_>>();
        assert!(changed_files.contains(&"src/app/api/sessions/[sessionId]/route.ts"));
        assert!(changed_files.contains(
            &"src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx"
        ));
    }

    #[test]
    fn registry_parses_file_and_analyzes_surface_links() {
        let repo = tempdir().unwrap();
        fs::create_dir_all(
            repo.path()
                .join("src/app/workspace/[workspaceId]/sessions/[sessionId]"),
        )
        .unwrap();
        fs::create_dir_all(repo.path().join("src/app/api/sessions/[sessionId]")).unwrap();
        fs::write(
            repo.path()
                .join("src/app/workspace/[workspaceId]/sessions/[sessionId]/page.tsx"),
            "",
        )
        .unwrap();
        fs::write(
            repo.path()
                .join("src/app/api/sessions/[sessionId]/route.ts"),
            "",
        )
        .unwrap();

        let transcript_path = repo.path().join("rollout-test.jsonl");
        fs::write(
            &transcript_path,
            concat!(
                "{\"timestamp\":\"2026-04-17T01:51:41.963Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"sess-2\",\"cwd\":\"/Users/phodal/ai/routa-js\"}}\n",
                "{\"timestamp\":\"2026-04-17T02:31:00.000Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"function_call\",\"name\":\"apply_patch\",\"arguments\":\"*** Begin Patch\\n*** Update File: src/app/api/sessions/[sessionId]/route.ts\\n*** Update File: src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx\\n*** End Patch\\n\"}}\n"
            ),
        )
        .unwrap();

        let registry = AdapterRegistry::new().with_adapter(CodexSessionAdapter);
        let session = registry.parse_path(&transcript_path).unwrap();
        let catalog = FeatureSurfaceCatalog::from_repo_root(repo.path()).unwrap();
        let analysis = SessionAnalyzer::with_catalog(&catalog).analyze(&session);

        assert_eq!(analysis.session_id, "sess-2");
        assert_eq!(analysis.changed_files.len(), 2);
        assert!(analysis
            .surface_links
            .iter()
            .any(|link| link.route == "/api/sessions/{sessionId}"));
        assert!(analysis
            .surface_links
            .iter()
            .any(|link| link.route == "/workspace/:workspaceId/sessions/:sessionId"));
    }
}
