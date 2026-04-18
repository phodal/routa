use crate::observe::hooks::{
    build_git_runtime_event, extract_file_paths_for_repo, infer_git_refresh_event,
};
use crate::observe::repo::detect_repo_root;
use crate::shared::db::Db;
use crate::shared::models::{
    AttributionConfidence, FileEventRecord, HookEvent, RuntimeMessage, SessionRecord,
};
use anyhow::Result;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use trace_parser::{
    collect_active_transcript_summaries, collect_recent_transcript_summaries,
    collect_recent_transcripts, discover_transcript_session_roots_with_overrides,
    parse_transcript_backfill,
    recent_prompt_previews_from_transcript as learning_recent_prompt_previews_from_transcript,
    recover_prompt_from_transcript as learning_recover_prompt_from_transcript,
    TranscriptRecoveredEvent, TranscriptSessionBackfill, TranscriptSessionRoot,
    TranscriptSessionSource,
};

pub fn bootstrap_codex_transcript_messages(
    repo_root: &std::path::Path,
) -> Result<Vec<RuntimeMessage>> {
    let summaries = collect_recent_transcript_summaries(repo_root)?;
    let repo_root_text = repo_root.to_string_lossy().to_string();
    let mut messages = Vec::new();
    for summary in summaries {
        let task_identity = summary.prompt.as_deref().and_then(|prompt| {
            task_identity_from_prompt(&summary.session_id, summary.turn_id.as_deref(), prompt)
        });
        let session_display_name = transcript_display_name(&summary.transcript_path);
        let observed_at_ms = summary.turn_started_at_ms;
        let session_id = summary.session_id.clone();
        let session_status = summary.status.clone();
        let session_cwd = summary.cwd.clone();
        let turn_id = summary.turn_id.clone();
        let model = summary.model.clone();
        let transcript_path = summary.transcript_path.clone();
        let source = summary.source.clone();
        let client = summary.client.clone();
        messages.push(RuntimeMessage::Hook(HookEvent {
            repo_root: repo_root_text.clone(),
            observed_at_ms,
            status: Some(session_status),
            client,
            session_id: session_id.clone(),
            session_display_name,
            turn_id,
            cwd: session_cwd,
            model,
            transcript_path: Some(transcript_path),
            session_source: source,
            event_name: "TranscriptRecover".to_string(),
            tool_name: None,
            tool_command: None,
            file_paths: Vec::new(),
            task_id: task_identity
                .as_ref()
                .map(|(task_id, _, _)| task_id.clone()),
            task_title: task_identity.as_ref().map(|(_, title, _)| title.clone()),
            prompt_preview: task_identity
                .as_ref()
                .map(|(_, _, preview)| preview.clone()),
            recovered_from_transcript: true,
            tmux_session: None,
            tmux_window: None,
            tmux_pane: None,
        }));

        let recovered = recover_transcript_events(repo_root_text.as_str(), repo_root, &summary);
        messages.extend(recovered);
    }

    messages.sort_by_key(RuntimeMessage::observed_at_ms);
    Ok(messages)
}

pub fn backfill_codex_transcripts_to_db(repo_root: &std::path::Path, db: &Db) -> Result<usize> {
    let repo_root_text = repo_root.to_string_lossy().to_string();
    let mut recovered_session_count = 0;
    for summary in collect_active_transcript_summaries(repo_root)? {
        apply_transcript_summary_to_db(db, &repo_root_text, repo_root, &summary)?;
        recovered_session_count += 1;
    }
    Ok(recovered_session_count)
}

fn apply_transcript_summary_to_db(
    db: &Db,
    repo_root: &str,
    repo_root_path: &Path,
    summary: &TranscriptSessionBackfill,
) -> Result<()> {
    let existing_last_seen = db
        .session_last_seen_at_ms(&summary.session_id)?
        .unwrap_or_default();
    if existing_last_seen > summary.last_seen_at_ms {
        return Ok(());
    }

    let task_identity = summary.prompt.as_deref().and_then(|prompt| {
        task_identity_from_prompt(&summary.session_id, summary.turn_id.as_deref(), prompt)
    });
    let active_task_id = db
        .active_task_for_session(repo_root, &summary.session_id)?
        .map(|task| task.task_id);
    let recovered_task_id = task_identity
        .as_ref()
        .map(|(task_id, _, _)| task_id.as_str());
    let should_record_recover_turn = existing_last_seen < summary.turn_started_at_ms
        || active_task_id.as_deref() != recovered_task_id;

    db.upsert_session(&SessionRecord {
        session_id: summary.session_id.clone(),
        repo_root: repo_root.to_string(),
        client: summary.client.clone(),
        cwd: summary.cwd.clone(),
        model: summary.model.clone(),
        started_at_ms: summary.turn_started_at_ms,
        last_seen_at_ms: summary.last_seen_at_ms,
        ended_at_ms: if summary.status == "active" {
            None
        } else {
            Some(summary.last_seen_at_ms)
        },
        status: summary.status.clone(),
        tmux_session: None,
        tmux_window: None,
        tmux_pane: None,
        metadata_json: json!({
            "source": "transcript_recovery",
            "transcript_path": summary.transcript_path,
            "session_display_name": transcript_display_name(&summary.transcript_path),
            "recovered_from_transcript": true,
        })
        .to_string(),
    })?;

    if let Some((task_id, title, prompt_preview)) = task_identity.as_ref() {
        let objective = summary.prompt.as_deref().unwrap_or(title.as_str());
        let _ = db.upsert_task_from_prompt(
            repo_root,
            &summary.session_id,
            summary.turn_id.as_deref(),
            Some(summary.transcript_path.as_str()),
            task_id,
            title,
            objective,
            Some(prompt_preview.as_str()),
            true,
            summary.last_seen_at_ms,
        )?;
    }

    if should_record_recover_turn {
        db.record_turn(
            &summary.session_id,
            repo_root,
            summary.turn_id.as_deref(),
            &summary.client,
            "TranscriptRecover",
            None,
            None,
            summary.turn_started_at_ms,
            &json!({
                "transcript_path": summary.transcript_path,
                "source": summary.source,
                "status": summary.status,
                "recovered_from_transcript": true,
            })
            .to_string(),
        )?;
    }

    let recovered_messages = recover_transcript_events(repo_root, repo_root_path, summary);
    for message in recovered_messages
        .iter()
        .filter(|message| message.observed_at_ms() > existing_last_seen)
    {
        apply_recovered_runtime_message_to_db(db, repo_root, message)?;
    }

    Ok(())
}

fn recover_transcript_events(
    _repo_root: &str,
    repo_root_path: &Path,
    summary: &TranscriptSessionBackfill,
) -> Vec<RuntimeMessage> {
    let task_identity = summary.prompt.as_deref().and_then(|prompt| {
        task_identity_from_prompt(&summary.session_id, summary.turn_id.as_deref(), prompt)
    });
    let mut messages = Vec::new();

    for event in &summary.recovered_events {
        let Some(mut recovered_messages) = recover_runtime_messages_from_transcript_tool_call(
            summary,
            repo_root_path,
            &task_identity,
            event,
        ) else {
            continue;
        };
        messages.append(&mut recovered_messages);
    }

    messages
}

fn apply_recovered_runtime_message_to_db(
    db: &Db,
    repo_root: &str,
    message: &RuntimeMessage,
) -> Result<()> {
    match message {
        RuntimeMessage::Hook(event) => {
            db.record_turn(
                &event.session_id,
                repo_root,
                event.turn_id.as_deref(),
                &event.client,
                &event.event_name,
                event.tool_name.as_deref(),
                event.tool_command.as_deref(),
                event.observed_at_ms,
                &serde_json::to_string(event).unwrap_or_else(|_| "{}".to_string()),
            )?;

            for rel_path in &event.file_paths {
                let task_id = event.task_id.clone().or_else(|| {
                    db.resolve_task_id(repo_root, Some(&event.session_id), event.turn_id.as_deref())
                        .ok()
                        .flatten()
                });
                let _ = db.insert_file_event(&FileEventRecord {
                    id: None,
                    repo_root: repo_root.to_string(),
                    rel_path: rel_path.clone(),
                    event_kind: "hook-file".to_string(),
                    observed_at_ms: event.observed_at_ms,
                    session_id: Some(event.session_id.clone()),
                    turn_id: event.turn_id.clone(),
                    task_id,
                    confidence: AttributionConfidence::Exact,
                    source: "transcript_recovery".to_string(),
                    metadata_json: json!({
                        "raw_event": event.event_name,
                        "recovered_from_transcript": true,
                    })
                    .to_string(),
                })?;

                if let Some((mtime_ms, size_bytes, is_dirty)) =
                    db.get_file_state(repo_root, rel_path)?
                {
                    if is_dirty {
                        db.update_file_state(
                            repo_root,
                            rel_path,
                            true,
                            "modify",
                            mtime_ms,
                            size_bytes,
                            event.observed_at_ms,
                            Some(&event.session_id),
                            event.turn_id.as_deref(),
                            Some(AttributionConfidence::Exact),
                            Some("transcript_recovery"),
                        )?;
                    }
                }
            }
        }
        RuntimeMessage::Git(event) => {
            db.insert_git_event(
                repo_root,
                &event.event_name,
                event.head_commit.as_deref(),
                event.branch.as_deref(),
                event.observed_at_ms,
                &json!({
                    "args": event.args,
                    "session_id": event.session_id,
                    "summary": event.summary,
                    "recovered_from_transcript": event.recovered_from_transcript,
                })
                .to_string(),
            )?;
        }
        RuntimeMessage::Attribution(_) | RuntimeMessage::Fitness(_) => {}
    }
    Ok(())
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
    learning_recover_prompt_from_transcript(turn_id, transcript_path)
}

pub fn recent_prompt_previews_from_transcript(transcript_path: &str, limit: usize) -> Vec<String> {
    if limit == 0 {
        return Vec::new();
    }
    learning_recent_prompt_previews_from_transcript(transcript_path, limit)
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

#[allow(clippy::too_many_arguments)]
fn recover_runtime_messages_from_transcript_tool_call(
    summary: &TranscriptSessionBackfill,
    repo_root: &Path,
    task_identity: &Option<(String, String, String)>,
    event: &TranscriptRecoveredEvent,
) -> Option<Vec<RuntimeMessage>> {
    let (turn_id_from_event, observed_at_ms, tool_name, arguments) = match event {
        TranscriptRecoveredEvent::ToolUse {
            turn_id,
            observed_at_ms,
            tool_name,
            tool_input,
        } => (
            turn_id.clone(),
            *observed_at_ms,
            tool_name.as_str(),
            tool_input.clone(),
        ),
    };

    let turn_id = turn_id_from_event.as_deref().or(summary.turn_id.as_deref());
    let session_display_name = transcript_display_name(&summary.transcript_path);
    let event_repo_root = repo_root.to_string_lossy().to_string();
    let mut messages = Vec::new();

    let workdir = arguments
        .get("workdir")
        .and_then(Value::as_str)
        .map(PathBuf::from);
    if workdir.as_deref().is_some_and(|path| {
        detect_repo_root(path)
            .map(|root| root != repo_root)
            .unwrap_or_else(|_| !path.starts_with(repo_root))
    }) {
        return None;
    }

    let command = arguments
        .get("cmd")
        .or_else(|| arguments.get("command"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let file_paths = extract_file_paths_for_repo(&arguments, repo_root);

    let normalized_tool_name = match tool_name {
        "exec_command" | "Bash" | "launch-process" => Some("Bash".to_string()),
        "apply_patch" | "Write" | "Edit" | "MultiEdit" | "session-files" => {
            Some("Write".to_string())
        }
        other if !other.trim().is_empty() => Some(other.to_string()),
        _ => None,
    };

    if command.is_none() && file_paths.is_empty() {
        return None;
    }

    let hook = RuntimeMessage::Hook(HookEvent {
        repo_root: event_repo_root,
        observed_at_ms,
        status: None,
        client: summary.client.clone(),
        session_id: summary.session_id.clone(),
        session_display_name: session_display_name.clone(),
        turn_id: turn_id.map(str::to_string),
        cwd: summary.cwd.clone(),
        model: summary.model.clone(),
        transcript_path: Some(summary.transcript_path.clone()),
        session_source: summary.source.clone(),
        event_name: "PostToolUse".to_string(),
        tool_name: normalized_tool_name,
        tool_command: command.clone(),
        file_paths,
        task_id: task_identity
            .as_ref()
            .map(|(task_id, _, _)| task_id.clone()),
        task_title: task_identity.as_ref().map(|(_, title, _)| title.clone()),
        prompt_preview: task_identity
            .as_ref()
            .map(|(_, _, prompt_preview)| prompt_preview.clone()),
        recovered_from_transcript: true,
        tmux_session: None,
        tmux_window: None,
        tmux_pane: None,
    });

    messages.push(hook);
    if let Some(command) = command.as_deref() {
        if let RuntimeMessage::Hook(event) = messages[0].clone() {
            if let Some(git_event_name) = infer_git_refresh_event(&event) {
                messages.push(RuntimeMessage::Git(build_git_runtime_event(
                    repo_root,
                    observed_at_ms,
                    git_event_name,
                    Some(event.session_id.as_str()),
                    Some(command),
                    None,
                    None,
                    true,
                )));
            }
        }
    }
    Some(messages)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::db::Db;
    use tempfile::tempdir;

    #[test]
    fn discover_transcript_session_roots_prefers_override_for_claude_config_dir() {
        let dir = tempdir().expect("tempdir");
        let home = dir.path().join("home");
        let codex_root = home.join(".codex").join("sessions");
        let custom_claude_root = dir.path().join("custom-claude").join("config");
        let default_claude_root = home.join(".claude").join("projects");
        let custom_projects_root = custom_claude_root.join("projects");
        std::fs::create_dir_all(&codex_root).expect("create codex dir");
        std::fs::create_dir_all(&default_claude_root).expect("create default claude dir");
        std::fs::create_dir_all(&custom_projects_root).expect("create custom claude dir");

        let roots = discover_transcript_session_roots_with_overrides(
            Some(&home),
            Some(&custom_claude_root),
        );

        assert!(roots.iter().any(|root| {
            root.kind == TranscriptSessionSource::Codex && root.path == codex_root
        }));
        assert!(roots
            .iter()
            .any(|root| root.kind == TranscriptSessionSource::ClaudeProjects
                && root.path == custom_projects_root));
        assert!(!roots
            .iter()
            .any(|root| root.kind == TranscriptSessionSource::ClaudeProjects
                && root.path == default_claude_root));
    }

    #[test]
    fn collect_recent_transcripts_scans_all_under_root() {
        let dir = tempdir().expect("tempdir");
        let home = dir.path().join("home");
        let date_dir = home.join(".codex").join("sessions").join("legacy");
        let raw_file = date_dir.join("legacy-session.jsonl");
        let claude_file = home
            .join(".claude")
            .join("projects")
            .join("repo")
            .join("session.jsonl");
        std::fs::create_dir_all(&date_dir).expect("create legacy dir");
        std::fs::create_dir_all(claude_file.parent().expect("parent")).expect("create claude dir");
        std::fs::write(&raw_file, "{}\n").expect("write legacy transcript");
        std::fs::write(&claude_file, "{}\n").expect("write claude transcript");

        let roots = vec![
            TranscriptSessionRoot {
                kind: TranscriptSessionSource::Codex,
                path: home.join(".codex").join("sessions"),
            },
            TranscriptSessionRoot {
                kind: TranscriptSessionSource::ClaudeProjects,
                path: home.join(".claude").join("projects"),
            },
        ];
        let files = collect_recent_transcripts(&roots).expect("collect transcripts");

        let paths: Vec<_> = files.iter().map(|(path, _)| path.as_path()).collect();
        assert!(paths.contains(&raw_file.as_path()));
        assert!(paths.contains(&claude_file.as_path()));
    }

    #[test]
    fn recover_prompt_from_transcript_uses_matching_turn_user_message() {
        let dir = tempdir().expect("tempdir");
        let transcript = dir.path().join("session.jsonl");
        std::fs::write(
            &transcript,
            concat!(
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
    fn recent_prompt_previews_from_transcript_returns_latest_first() {
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
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn-2\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn-3\"}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"third task\"}]}}\n"
            ),
        )
        .expect("write transcript");

        let prompts = recent_prompt_previews_from_transcript(transcript.to_str().expect("path"), 3);
        assert_eq!(
            prompts,
            vec![
                "third task".to_string(),
                "second task".to_string(),
                "first task".to_string()
            ]
        );
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

        let summary = parse_transcript_backfill(&transcript, 0).expect("parse transcript");

        assert_eq!(summary.turn_id.as_deref(), Some("turn-9"));
        assert_eq!(summary.prompt.as_deref(), Some("refresh the page snapshot"));
        assert_eq!(summary.recovered_events.len(), 2);
    }

    #[test]
    fn transcript_db_backfill_recovers_task_and_attributes_current_dirty_file() {
        let dir = tempdir().expect("tempdir");
        let repo_root = dir.path().join("repo");
        std::fs::create_dir_all(repo_root.join("src/app")).expect("create repo");
        std::fs::write(
            repo_root.join("src/app/page.tsx"),
            "export default function Page() {}\n",
        )
        .expect("write file");
        let db = Db::open(&dir.path().join("monitor.sqlite")).expect("open db");
        let repo_root_text = repo_root.to_string_lossy().to_string();
        let transcript_path = dir
            .path()
            .join("session.jsonl")
            .to_string_lossy()
            .to_string();
        let (task_id, _task_title, prompt_preview) =
            task_identity_from_prompt("sess-1", Some("turn-9"), "refresh the page snapshot")
                .expect("task identity");

        db.update_file_state(
            &repo_root_text,
            "src/app/page.tsx",
            true,
            "modify",
            None,
            None,
            1,
            None,
            None,
            None,
            None,
        )
        .expect("seed dirty file");

        let summary = TranscriptSessionBackfill {
            client: "codex".to_string(),
            session_id: "sess-1".to_string(),
            cwd: repo_root_text.clone(),
            model: Some("gpt-5.4".to_string()),
            transcript_path,
            source: Some("cli".to_string()),
            last_seen_at_ms: 1_004,
            status: "active".to_string(),
            turn_id: Some("turn-9".to_string()),
            prompt: Some("refresh the page snapshot".to_string()),
            turn_started_at_ms: 1_001,
            recovered_events: vec![TranscriptRecoveredEvent::ToolUse {
                turn_id: Some("turn-9".to_string()),
                observed_at_ms: 1_003,
                tool_name: "apply_patch".to_string(),
                tool_input: json!({ "command": "*** Update File: src/app/page.tsx" }),
            }],
        };

        apply_transcript_summary_to_db(&db, &repo_root_text, &repo_root, &summary)
            .expect("backfill");

        let sessions = db.list_active_sessions(&repo_root_text).expect("sessions");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].0, "sess-1");
        assert_eq!(sessions[0].4, 1_004);

        let task = db
            .active_task_for_session(&repo_root_text, "sess-1")
            .expect("task query")
            .expect("active task");
        assert_eq!(task.task_id, task_id);
        assert!(task.recovered_from_transcript);
        assert_eq!(
            task.prompt_preview.as_deref(),
            Some(prompt_preview.as_str())
        );

        let dirty_files = db
            .file_state_all_dirty(&repo_root_text)
            .expect("dirty files");
        assert_eq!(dirty_files.len(), 1);
        assert_eq!(dirty_files[0].session_id.as_deref(), Some("sess-1"));
        assert_eq!(
            dirty_files[0].task_id.as_deref(),
            Some(task.task_id.as_str())
        );

        let file_events = db
            .file_events_since(&repo_root_text, 0)
            .expect("file events");
        assert_eq!(file_events.len(), 1);
        assert_eq!(
            file_events[0].task_id.as_deref(),
            Some(task.task_id.as_str())
        );

        apply_transcript_summary_to_db(&db, &repo_root_text, &repo_root, &summary)
            .expect("repeat backfill");
        let file_events = db
            .file_events_since(&repo_root_text, 0)
            .expect("file events repeat");
        assert_eq!(file_events.len(), 1);
    }
}
