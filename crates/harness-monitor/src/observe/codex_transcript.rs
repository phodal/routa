use crate::observe::hooks::{
    build_git_runtime_event, extract_file_paths_for_repo, infer_git_refresh_event,
};
use crate::observe::repo::detect_repo_root;
use crate::shared::models::{GitEvent, HookEvent, RuntimeMessage};
use anyhow::Result;
use chrono::Datelike;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::path::Path;

struct TranscriptSessionBackfill {
    session_id: String,
    cwd: String,
    model: Option<String>,
    transcript_path: String,
    source: Option<String>,
    last_seen_at_ms: i64,
    status: String,
    turn_id: Option<String>,
    prompt: Option<String>,
    turn_started_at_ms: i64,
    recovered_events: Vec<RuntimeMessage>,
}

#[derive(Clone, Default)]
struct TranscriptTurnBackfill {
    turn_id: Option<String>,
    prompt: Option<String>,
    completed: bool,
    started_at_ms: i64,
    events: Vec<RuntimeMessage>,
}

pub fn bootstrap_codex_transcript_messages(
    repo_root: &std::path::Path,
) -> Result<Vec<RuntimeMessage>> {
    const BACKFILL_WINDOW_MS: i64 = 24 * 60 * 60 * 1000;
    const ACTIVE_WINDOW_MS: i64 = 30 * 60 * 1000;
    const MAX_TRANSCRIPTS: usize = 48;

    let sessions_root = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .map(|home| home.join(".codex").join("sessions"));
    let Some(sessions_root) = sessions_root.filter(|path| path.exists()) else {
        return Ok(Vec::new());
    };

    let now_ms = chrono::Utc::now().timestamp_millis();
    let mut transcripts = collect_recent_transcripts(&sessions_root)?;
    transcripts.retain(|(_, modified_ms)| now_ms.saturating_sub(*modified_ms) <= BACKFILL_WINDOW_MS);
    transcripts.sort_by(|a, b| b.1.cmp(&a.1));
    transcripts.truncate(MAX_TRANSCRIPTS);

    let repo_root_text = repo_root.to_string_lossy().to_string();
    let mut messages = Vec::new();
    for (path, modified_ms) in transcripts {
        let Some(summary) = parse_transcript_backfill(&path, modified_ms, repo_root) else {
            continue;
        };
        if summary.cwd != repo_root_text {
            continue;
        }
        if summary.status != "active" && now_ms.saturating_sub(summary.last_seen_at_ms) > ACTIVE_WINDOW_MS
        {
            continue;
        }

        let task_identity = summary.prompt.as_deref().and_then(|prompt| {
            task_identity_from_prompt(&summary.session_id, summary.turn_id.as_deref(), prompt)
        });
        let session_display_name = transcript_display_name(&summary.transcript_path);
        messages.push(RuntimeMessage::Hook(HookEvent {
            repo_root: repo_root_text.clone(),
            observed_at_ms: summary.turn_started_at_ms,
            status: Some(summary.status),
            client: "codex".to_string(),
            session_id: summary.session_id,
            session_display_name,
            turn_id: summary.turn_id,
            cwd: summary.cwd,
            model: summary.model,
            transcript_path: Some(summary.transcript_path),
            session_source: summary.source,
            event_name: "TranscriptRecover".to_string(),
            tool_name: None,
            tool_command: None,
            file_paths: Vec::new(),
            task_id: task_identity.as_ref().map(|(task_id, _, _)| task_id.clone()),
            task_title: task_identity.as_ref().map(|(_, title, _)| title.clone()),
            prompt_preview: task_identity
                .as_ref()
                .map(|(_, _, preview)| preview.clone()),
            recovered_from_transcript: true,
            tmux_session: None,
            tmux_window: None,
            tmux_pane: None,
        }));
        messages.extend(summary.recovered_events);
    }

    messages.sort_by_key(RuntimeMessage::observed_at_ms);
    Ok(messages)
}

pub(crate) fn transcript_display_name(path: &str) -> Option<String> {
    let file_name = Path::new(path).file_stem()?.to_string_lossy().to_string();
    let normalized = file_name
        .trim()
        .trim_end_matches(".json")
        .trim_end_matches(".jsonl")
        .trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

pub(crate) fn derive_task_identity(
    hook_event_name: &str,
    session_id: &str,
    turn_id: Option<&str>,
    prompt: Option<&str>,
) -> Option<(String, String, String)> {
    if hook_event_name != "UserPromptSubmit" {
        return None;
    }
    task_identity_from_prompt(session_id, turn_id, prompt?)
}

pub(crate) fn task_identity_from_prompt(
    session_id: &str,
    turn_id: Option<&str>,
    prompt: &str,
) -> Option<(String, String, String)> {
    let turn_id = turn_id?.trim();
    if turn_id.is_empty() {
        return None;
    }
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return None;
    }
    let task_id = format!("task:{session_id}:{turn_id}");
    let title = summarize_prompt_title(prompt);
    let prompt_preview = summarize_prompt_preview(prompt);
    Some((task_id, title, prompt_preview))
}

pub(crate) fn recover_prompt_from_transcript(
    turn_id: Option<&str>,
    transcript_path: Option<&str>,
) -> Option<String> {
    let turn_id = turn_id?.trim();
    let transcript_path = transcript_path?.trim();
    if turn_id.is_empty() || transcript_path.is_empty() {
        return None;
    }

    let file = std::fs::File::open(transcript_path).ok()?;
    let reader = BufReader::new(file);
    let mut matched_turn = false;
    let mut latest_user_prompt = None;

    for line in reader.lines() {
        let line = line.ok()?;
        let entry: Value = serde_json::from_str(&line).ok()?;
        let entry_type = entry.get("type").and_then(Value::as_str);

        if entry_type == Some("event_msg") {
            match entry.pointer("/payload/type").and_then(Value::as_str) {
                Some("task_started") => {
                    matched_turn =
                        entry.pointer("/payload/turn_id").and_then(Value::as_str) == Some(turn_id);
                    continue;
                }
                Some("user_message") if matched_turn => {
                    if let Some(message) = entry.pointer("/payload/message").and_then(Value::as_str)
                    {
                        let message = message.trim();
                        if !message.is_empty() {
                            latest_user_prompt = Some(message.to_string());
                        }
                    }
                }
                Some("task_complete") if matched_turn => break,
                _ => {}
            }
        }

        if matched_turn
            && entry_type == Some("response_item")
            && entry.pointer("/payload/type").and_then(Value::as_str) == Some("message")
            && entry.pointer("/payload/role").and_then(Value::as_str) == Some("user")
        {
            if let Some(message) = extract_user_prompt_from_response_item(&entry) {
                latest_user_prompt = Some(message);
            }
        }
    }

    latest_user_prompt
}

fn extract_user_prompt_from_response_item(entry: &Value) -> Option<String> {
    let items = entry.pointer("/payload/content")?.as_array()?;
    let mut parts = Vec::new();
    for item in items {
        if item.get("type").and_then(Value::as_str) != Some("input_text") {
            continue;
        }
        let Some(text) = item.get("text").and_then(Value::as_str) else {
            continue;
        };
        let text = text.trim();
        if !text.is_empty() {
            parts.push(text.to_string());
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn summarize_prompt_title(prompt: &str) -> String {
    let first_non_empty = prompt
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(prompt)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    truncate_text(&first_non_empty, 72)
}

fn summarize_prompt_preview(prompt: &str) -> String {
    let normalized = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_text(&normalized, 180)
}

fn truncate_text(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (index, ch) in text.chars().enumerate() {
        if index >= max_chars {
            out.push_str("...");
            break;
        }
        out.push(ch);
    }
    out
}

fn collect_recent_transcripts(root: &std::path::Path) -> Result<Vec<(std::path::PathBuf, i64)>> {
    let mut stack = recent_transcript_dirs(root);
    let mut files = Vec::new();
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if !file_type.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }
            let modified_ms = entry
                .metadata()
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|dur| dur.as_millis() as i64)
                .unwrap_or_default();
            files.push((path, modified_ms));
        }
    }
    Ok(files)
}

fn recent_transcript_dirs(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let today = chrono::Local::now().date_naive();
    let yesterday = today.pred_opt();
    [Some(today), yesterday]
        .into_iter()
        .flatten()
        .map(|date| {
            root.join(format!("{:04}", date.year()))
                .join(format!("{:02}", date.month()))
                .join(format!("{:02}", date.day()))
        })
        .filter(|path| path.exists())
        .collect()
}

fn parse_transcript_backfill(
    transcript_path: &std::path::Path,
    modified_ms: i64,
    repo_root: &std::path::Path,
) -> Option<TranscriptSessionBackfill> {
    let file = std::fs::File::open(transcript_path).ok()?;
    let reader = BufReader::new(file);
    let mut session_id = None;
    let mut cwd = None;
    let mut model = None;
    let mut source = None;
    let mut last_seen_at_ms = modified_ms;
    let mut current_turn = TranscriptTurnBackfill::default();
    let mut latest_turn = TranscriptTurnBackfill::default();

    for line in reader.lines() {
        let line = line.ok()?;
        let entry: Value = serde_json::from_str(&line).ok()?;
        let observed_at_ms = entry
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_rfc3339_ms)
            .unwrap_or(last_seen_at_ms);
        last_seen_at_ms = observed_at_ms;

        match entry.get("type").and_then(Value::as_str) {
            Some("session_meta") => {
                session_id = entry.pointer("/payload/id").and_then(Value::as_str).map(str::to_string);
                cwd = entry.pointer("/payload/cwd").and_then(Value::as_str).map(str::to_string);
                model = entry
                    .pointer("/payload/model")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| {
                        entry.pointer("/payload/model_provider").and_then(Value::as_str).map(str::to_string)
                    });
                source = entry.pointer("/payload/source").and_then(Value::as_str).map(str::to_string);
            }
            Some("event_msg") => match entry.pointer("/payload/type").and_then(Value::as_str) {
                Some("task_started") => {
                    if current_turn.turn_id.is_some() {
                        latest_turn = std::mem::take(&mut current_turn);
                    }
                    current_turn.turn_id =
                        entry.pointer("/payload/turn_id").and_then(Value::as_str).map(str::to_string);
                    current_turn.prompt = None;
                    current_turn.completed = false;
                    current_turn.started_at_ms = observed_at_ms;
                }
                Some("user_message") if current_turn.turn_id.is_some() => {
                    current_turn.prompt =
                        entry.pointer("/payload/message").and_then(Value::as_str).map(str::to_string);
                }
                Some("task_complete") => {
                    if entry.pointer("/payload/turn_id").and_then(Value::as_str)
                        == current_turn.turn_id.as_deref()
                    {
                        current_turn.completed = true;
                    }
                }
                _ => {}
            },
            Some("response_item")
                if entry.pointer("/payload/type").and_then(Value::as_str) == Some("message")
                    && entry.pointer("/payload/role").and_then(Value::as_str) == Some("user")
                    && current_turn.turn_id.is_some() =>
            {
                if let Some(message) = extract_user_prompt_from_response_item(&entry) {
                    current_turn.prompt = Some(message);
                }
            }
            Some("response_item")
                if entry.pointer("/payload/type").and_then(Value::as_str) == Some("function_call")
                    && current_turn.turn_id.is_some() =>
            {
                if let Some(runtime_messages) = recover_runtime_messages_from_transcript_tool_call(
                    &entry,
                    repo_root,
                    session_id.as_deref(),
                    cwd.as_deref(),
                    model.as_deref(),
                    source.as_deref(),
                    transcript_path,
                    current_turn.turn_id.as_deref(),
                    current_turn.prompt.as_deref(),
                    observed_at_ms,
                ) {
                    current_turn.events.extend(runtime_messages);
                }
            }
            _ => {}
        }
    }

    let use_current_turn = current_turn.turn_id.is_some();
    let selected_turn = if use_current_turn { current_turn } else { latest_turn };

    let turn_started_at_ms = if selected_turn.started_at_ms > 0 {
        selected_turn.started_at_ms
    } else {
        last_seen_at_ms
    };

    Some(TranscriptSessionBackfill {
        session_id: session_id?,
        cwd: cwd?,
        model,
        transcript_path: transcript_path.to_string_lossy().to_string(),
        source,
        last_seen_at_ms,
        status: if selected_turn.completed {
            "idle".to_string()
        } else {
            "active".to_string()
        },
        turn_id: selected_turn.turn_id,
        prompt: selected_turn.prompt,
        turn_started_at_ms,
        recovered_events: selected_turn.events,
    })
}

fn parse_rfc3339_ms(timestamp: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|parsed| parsed.timestamp_millis())
}

#[allow(clippy::too_many_arguments)]
fn recover_runtime_messages_from_transcript_tool_call(
    entry: &Value,
    repo_root: &std::path::Path,
    session_id: Option<&str>,
    cwd: Option<&str>,
    model: Option<&str>,
    source: Option<&str>,
    transcript_path: &std::path::Path,
    turn_id: Option<&str>,
    prompt: Option<&str>,
    observed_at_ms: i64,
) -> Option<Vec<RuntimeMessage>> {
    let session_id = session_id?.to_string();
    let cwd = cwd?.to_string();
    let tool_name = entry.pointer("/payload/name").and_then(Value::as_str)?;
    let arguments = entry
        .pointer("/payload/arguments")
        .and_then(Value::as_str)
        .unwrap_or("");
    let task_identity = prompt.and_then(|text| task_identity_from_prompt(&session_id, turn_id, text));
    let session_display_name = transcript_display_name(transcript_path.to_string_lossy().as_ref());
    let transcript_text = transcript_path.to_string_lossy().to_string();

    match tool_name {
        "exec_command" => {
            let payload: Value = serde_json::from_str(arguments).ok()?;
            let workdir = payload
                .get("workdir")
                .and_then(Value::as_str)
                .map(std::path::PathBuf::from);
            if workdir.as_deref().is_some_and(|path| {
                detect_repo_root(path)
                    .map(|root| root != repo_root)
                    .unwrap_or_else(|_| !path.starts_with(repo_root))
            }) {
                return None;
            }

            let command = payload
                .get("cmd")
                .or_else(|| payload.get("command"))
                .and_then(Value::as_str)?
                .to_string();
            let tool_input = json!({ "command": command });
            let file_paths = extract_file_paths_for_repo(&tool_input, repo_root);
            let hook = RuntimeMessage::Hook(HookEvent {
                repo_root: repo_root.to_string_lossy().to_string(),
                observed_at_ms,
                status: None,
                client: "codex".to_string(),
                session_id: session_id.clone(),
                session_display_name: session_display_name.clone(),
                turn_id: turn_id.map(str::to_string),
                cwd,
                model: model.map(str::to_string),
                transcript_path: Some(transcript_text),
                session_source: source.map(str::to_string),
                event_name: "PostToolUse".to_string(),
                tool_name: Some("Bash".to_string()),
                tool_command: Some(command.clone()),
                file_paths,
                task_id: task_identity.as_ref().map(|(task_id, _, _)| task_id.clone()),
                task_title: task_identity.as_ref().map(|(_, title, _)| title.clone()),
                prompt_preview: task_identity
                    .as_ref()
                    .map(|(_, _, prompt_preview)| prompt_preview.clone()),
                recovered_from_transcript: true,
                tmux_session: None,
                tmux_window: None,
                tmux_pane: None,
            });

            let mut messages = vec![hook];
            if let RuntimeMessage::Hook(hook_event) = messages[0].clone() {
                if let Some(git_event_name) = infer_git_refresh_event(&hook_event) {
                    messages.push(RuntimeMessage::Git(build_git_runtime_event(
                        repo_root,
                        observed_at_ms,
                        git_event_name,
                        Some(session_id.as_str()),
                        Some(command.as_str()),
                        None,
                        None,
                        true,
                    )));
                }
            }
            Some(messages)
        }
        "apply_patch" => {
            let tool_input = json!({ "command": arguments });
            let file_paths = extract_file_paths_for_repo(&tool_input, repo_root);
            if file_paths.is_empty() {
                return None;
            }
            Some(vec![RuntimeMessage::Hook(HookEvent {
                repo_root: repo_root.to_string_lossy().to_string(),
                observed_at_ms,
                status: None,
                client: "codex".to_string(),
                session_id,
                session_display_name,
                turn_id: turn_id.map(str::to_string),
                cwd,
                model: model.map(str::to_string),
                transcript_path: Some(transcript_text),
                session_source: source.map(str::to_string),
                event_name: "PostToolUse".to_string(),
                tool_name: Some("Write".to_string()),
                tool_command: None,
                file_paths,
                task_id: task_identity.as_ref().map(|(task_id, _, _)| task_id.clone()),
                task_title: task_identity.as_ref().map(|(_, title, _)| title.clone()),
                prompt_preview: task_identity
                    .as_ref()
                    .map(|(_, _, prompt_preview)| prompt_preview.clone()),
                recovered_from_transcript: true,
                tmux_session: None,
                tmux_window: None,
                tmux_pane: None,
            })])
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn recover_prompt_from_transcript_uses_matching_turn_user_message() {
        let dir = tempdir().expect("tempdir");
        let transcript = dir.path().join("session.jsonl");
        std::fs::write(
            &transcript,
            concat!(
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn-1\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"first task\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn-1\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn-2\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"second task\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn-2\"}}\n"
            ),
        )
        .expect("write transcript");

        let prompt = recover_prompt_from_transcript(Some("turn-2"), transcript.to_str());

        assert_eq!(prompt.as_deref(), Some("second task"));
    }

    #[test]
    fn recover_prompt_from_transcript_falls_back_to_response_item_user_text() {
        let dir = tempdir().expect("tempdir");
        let transcript = dir.path().join("session.jsonl");
        std::fs::write(
            &transcript,
            concat!(
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn-3\"}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"recover from response item\"}]}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn-3\"}}\n"
            ),
        )
        .expect("write transcript");

        let prompt = recover_prompt_from_transcript(Some("turn-3"), transcript.to_str());

        assert_eq!(prompt.as_deref(), Some("recover from response item"));
    }

    #[test]
    fn parse_transcript_backfill_recovers_latest_turn_tool_events() {
        let dir = tempdir().expect("tempdir");
        let repo_root = dir.path().join("repo");
        std::fs::create_dir_all(repo_root.join("src/app")).expect("create repo");
        let transcript = dir.path().join("session.jsonl");
        let repo_root_text = repo_root.to_string_lossy();
        let payload = format!(
            concat!(
                "{{\"timestamp\":\"2026-04-12T10:00:00Z\",\"type\":\"session_meta\",\"payload\":{{\"id\":\"sess-1\",\"cwd\":\"{repo}\"}}}}\n",
                "{{\"timestamp\":\"2026-04-12T10:00:01Z\",\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_started\",\"turn_id\":\"turn-9\"}}}}\n",
                "{{\"timestamp\":\"2026-04-12T10:00:02Z\",\"type\":\"event_msg\",\"payload\":{{\"type\":\"user_message\",\"message\":\"refresh the page snapshot\"}}}}\n",
                "{{\"timestamp\":\"2026-04-12T10:00:03Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"function_call\",\"name\":\"exec_command\",\"arguments\":\"{{\\\"cmd\\\":\\\"git add -- 'src/app/page.tsx'\\\",\\\"workdir\\\":\\\"{repo}\\\"}}\"}}}}\n",
                "{{\"timestamp\":\"2026-04-12T10:00:04Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"function_call\",\"name\":\"exec_command\",\"arguments\":\"{{\\\"cmd\\\":\\\"git commit -m \\\\\\\"snapshot refresh\\\\\\\"\\\",\\\"workdir\\\":\\\"{repo}\\\"}}\"}}}}\n"
            ),
            repo = repo_root_text
        );
        std::fs::write(&transcript, payload).expect("write transcript");

        let summary =
            parse_transcript_backfill(&transcript, 0, &repo_root).expect("parse transcript");

        assert_eq!(summary.turn_id.as_deref(), Some("turn-9"));
        assert_eq!(summary.prompt.as_deref(), Some("refresh the page snapshot"));
        assert_eq!(summary.recovered_events.len(), 4);
    }
}
