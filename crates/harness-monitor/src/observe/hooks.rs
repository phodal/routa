use crate::observe::codex_transcript::{
    derive_task_identity, recover_prompt_from_transcript, task_identity_from_prompt,
    transcript_display_name,
};
use crate::observe::ipc;
use crate::observe::repo::{resolve, resolve_runtime, RepoContext};
use crate::shared::db::Db;
use crate::shared::models::{
    AttributionConfidence, FileEventRecord, GitEvent, HookClient, HookEvent, RuntimeMessage,
    SessionRecord,
};
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
    let payload: Value = if payload_raw.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(payload_raw).context("parse hook payload")?
    };

    let cwd = extract_field(&payload, &["cwd", "workingDir", "working_directory"])
        .or_else(|| repo_hint.map(|r| r.to_string()))
        .unwrap_or_else(|| ".".to_string());
    let ctx = resolve(Some(&cwd), db_hint)?;
    let db = Db::open(&ctx.db_path)?;
    let repo_root = ctx.repo_root.to_string_lossy().to_string();
    let now_ms = Utc::now().timestamp_millis();
    let client = HookClient::from_str(client_name);

    let session_id = extract_field(&payload, &["session_id", "sessionId", "thread_id"])
        .unwrap_or_else(|| "unknown".to_string());
    let turn_id = extract_field(&payload, &["turn_id", "turnId"]);
    let model = extract_field(&payload, &["model"]).filter(|value| !value.is_empty());
    let transcript_path = extract_field(&payload, &["transcript_path", "transcriptPath"]);
    let session_source = extract_field(&payload, &["source"]);
    let prompt = extract_field(&payload, &["prompt"]);
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
    let mut task_prompt = prompt.clone();
    let mut task_identity = derive_task_identity(
        &hook_event_name,
        &session_id,
        turn_id.as_deref(),
        task_prompt.as_deref(),
    );
    if task_identity.is_none()
        && db
            .resolve_task_id(&repo_root, Some(&session_id), turn_id.as_deref())?
            .is_none()
    {
        if let Some(recovered_prompt) =
            recover_prompt_from_transcript(turn_id.as_deref(), transcript_path.as_deref())
        {
            task_identity = task_identity_from_prompt(
                &session_id,
                turn_id.as_deref(),
                recovered_prompt.as_str(),
            );
            task_prompt = Some(recovered_prompt);
        }
    }

    let payload_json = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
    let tmux_session = extract_field(&payload, &["tmux_session", "tmuxSession"])
        .or_else(|| std::env::var("TMUX_SESSION").ok());
    let tmux_window = extract_field(&payload, &["tmux_window", "tmuxWindow"])
        .or_else(|| std::env::var("TMUX_WINDOW").ok());
    let tmux_pane = extract_field(&payload, &["tmux_pane", "tmuxPane"])
        .or_else(|| std::env::var("TMUX_PANE").ok());
    let session_display_name = extract_session_display_name(
        &payload,
        transcript_path.as_deref(),
        session_source.as_deref(),
        tmux_session.as_deref(),
        tmux_pane.as_deref(),
    );

    let metadata_json = json!({
        "client_event": event_name,
        "session_started_from": client.as_str(),
        "session_source": session_source,
        "transcript_path": transcript_path,
        "session_display_name": session_display_name,
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

    if let Some((task_id, task_title, prompt_preview)) = &task_identity {
        let objective = task_prompt.as_deref().unwrap_or(task_title.as_str());
        let _ = db.upsert_task_from_prompt(
            &repo_root,
            &session_id,
            turn_id.as_deref(),
            transcript_path.as_deref(),
            task_id,
            task_title,
            objective,
            Some(prompt_preview.as_str()),
            task_prompt.is_some() && prompt.as_deref() != task_prompt.as_deref(),
            now_ms,
        )?;
    }

    if event_is_file_mutating(&hook_event_name, &client, tool_name.as_deref()) {
        let tool_input = payload
            .get("tool_input")
            .cloned()
            .unwrap_or_else(|| payload.clone());
        let candidate_paths = extract_file_paths(&tool_input, &ctx);
        for rel_path in candidate_paths {
            let abs_path = ctx.repo_root.join(&rel_path);
            let metadata = std::fs::metadata(&abs_path).ok();
            let (mtime_ms, size_bytes) = metadata
                .and_then(|meta| {
                    meta.modified()
                        .ok()
                        .and_then(|ts| ts.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|dur| {
                            (
                                Some(dur.as_millis() as i64),
                                if meta.is_file() {
                                    Some(meta.len() as i64)
                                } else {
                                    None
                                },
                            )
                        })
                })
                .unwrap_or((None, None));
            let task_id = db.resolve_task_id(&repo_root, Some(&session_id), turn_id.as_deref())?;
            let _ = db.insert_file_event(&FileEventRecord {
                id: None,
                repo_root: repo_root.clone(),
                rel_path: rel_path.clone(),
                event_kind: "hook-file".to_string(),
                observed_at_ms: now_ms,
                session_id: Some(session_id.clone()),
                turn_id: turn_id.clone(),
                task_id: task_id.clone(),
                confidence: AttributionConfidence::Exact,
                source: client.as_str().to_string(),
                metadata_json: json!({ "raw_event": hook_event_name }).to_string(),
            })?;
            db.update_file_state(
                &repo_root,
                &rel_path,
                true,
                "modify",
                mtime_ms,
                size_bytes,
                now_ms,
                Some(&session_id),
                turn_id.as_deref(),
                Some(AttributionConfidence::Exact),
                Some(client.as_str()),
            )?;
        }
    }

    let _ = try_forward_hook_to_runtime(client_name, event_name, repo_hint, db_hint, payload_raw)?;

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
    if let Err(err) = send_runtime_message(&ctx, &message) {
        eprintln!(
            "harness-monitor warning: runtime transport unavailable, fallback to local store: {err}"
        );
        return Ok(false);
    }

    if let RuntimeMessage::Hook(event) = &message {
        if let Some(git_event_name) = infer_git_refresh_event(event) {
            let git_message = RuntimeMessage::Git(build_git_runtime_event(
                &ctx.repo_root,
                event.observed_at_ms,
                git_event_name,
                Some(event.session_id.as_str()),
                event.tool_command.as_deref(),
                Some(current_head(&ctx.repo_root)?),
                Some(current_branch(&ctx.repo_root)?),
                event.recovered_from_transcript,
            ));
            let _ = send_runtime_message(&ctx, &git_message);
        }
    }

    Ok(true)
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
    let transcript_path = extract_field(&payload, &["transcript_path", "transcriptPath"]);
    let session_source = extract_field(&payload, &["source"]);
    let prompt = extract_field(&payload, &["prompt"]);
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
    let mut task_prompt = prompt.clone();
    let mut task_identity = derive_task_identity(
        &hook_event_name,
        &session_id,
        turn_id.as_deref(),
        task_prompt.as_deref(),
    );
    if task_identity.is_none() {
        if let Some(recovered_prompt) =
            recover_prompt_from_transcript(turn_id.as_deref(), transcript_path.as_deref())
        {
            task_identity = task_identity_from_prompt(
                &session_id,
                turn_id.as_deref(),
                recovered_prompt.as_str(),
            );
            task_prompt = Some(recovered_prompt);
        }
    }
    let tool_command = extract_tool_command(&payload);
    let tmux_session = extract_field(&payload, &["tmux_session", "tmuxSession"])
        .or_else(|| std::env::var("TMUX_SESSION").ok());
    let tmux_window = extract_field(&payload, &["tmux_window", "tmuxWindow"])
        .or_else(|| std::env::var("TMUX_WINDOW").ok());
    let tmux_pane = extract_field(&payload, &["tmux_pane", "tmuxPane"])
        .or_else(|| std::env::var("TMUX_PANE").ok());
    let session_display_name = extract_session_display_name(
        &payload,
        transcript_path.as_deref(),
        session_source.as_deref(),
        tmux_session.as_deref(),
        tmux_pane.as_deref(),
    );
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
            status: None,
            client: client.as_str().to_string(),
            session_id,
            session_display_name,
            turn_id,
            cwd,
            model,
            transcript_path,
            session_source,
            event_name: hook_event_name,
            tool_name,
            tool_command,
            file_paths,
            task_id: task_identity
                .as_ref()
                .map(|(task_id, _, _)| task_id.clone()),
            task_title: task_identity
                .as_ref()
                .map(|(_, task_title, _)| task_title.clone()),
            prompt_preview: task_identity
                .as_ref()
                .map(|(_, _, prompt_preview)| prompt_preview.clone()),
            recovered_from_transcript: task_prompt.is_some()
                && prompt.as_deref() != task_prompt.as_deref(),
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
        crate::shared::models::DEFAULT_INFERENCE_WINDOW_MS,
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
        session_id: None,
        summary: None,
        recovered_from_transcript: false,
    });
    match send_runtime_message(ctx, &message) {
        Ok(_) => Ok(true),
        Err(err) => {
            eprintln!(
                "harness-monitor warning: runtime transport unavailable, fallback to local store: {err}"
            );
            Ok(false)
        }
    }
}

fn send_runtime_message(ctx: &RepoContext, message: &RuntimeMessage) -> Result<()> {
    ipc::send_socket_message(&ctx.runtime_socket_path, message)
        .or_else(|_| ipc::send_tcp_message(&ctx.runtime_tcp_addr, message))
        .or_else(|_| ipc::send_message(&ctx.runtime_event_path, message))
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

fn extract_session_display_name(
    payload: &Value,
    transcript_path: Option<&str>,
    session_source: Option<&str>,
    tmux_session: Option<&str>,
    tmux_pane: Option<&str>,
) -> Option<String> {
    extract_field(
        payload,
        &[
            "session_name",
            "sessionName",
            "name",
            "pane_title",
            "paneTitle",
            "title",
        ],
    )
    .filter(|value| !value.trim().is_empty())
    .or_else(|| std::env::var("TMUX_PANE_TITLE").ok())
    .filter(|value| !value.trim().is_empty())
    .or_else(|| {
        transcript_path
            .and_then(transcript_display_name)
            .filter(|value| !value.trim().is_empty())
    })
    .or_else(|| {
        tmux_session.map(|session| match tmux_pane {
            Some(pane) if !pane.is_empty() => format!("{session} {pane}"),
            _ => session.to_string(),
        })
    })
    .or_else(|| session_source.map(|source| format!("codex {source}")))
}

fn event_is_file_mutating(event: &str, client: &HookClient, tool_name: Option<&str>) -> bool {
    if matches!(event, "Edit" | "edit" | "Write" | "write") {
        return true;
    }

    if matches!(
        event,
        "PostToolUse" | "post-tool-use" | "PreToolUse" | "pre-tool-use"
    ) {
        return match client {
            HookClient::Claude | HookClient::Codex => is_edit_like_tool(tool_name),
            HookClient::Cursor
            | HookClient::Aider
            | HookClient::Gemini
            | HookClient::Copilot
            | HookClient::Qoder
            | HookClient::Auggie
            | HookClient::Kiro => is_edit_like_tool(tool_name),
            HookClient::Unknown => false,
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
    let normalized = event.trim().to_ascii_lowercase().replace(['_', ' '], "-");

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

pub(crate) fn infer_git_refresh_event(event: &HookEvent) -> Option<&'static str> {
    if !matches!(event.event_name.as_str(), "PostToolUse" | "post-tool-use") {
        return None;
    }
    if !event
        .tool_name
        .as_deref()
        .is_some_and(|name| name.eq_ignore_ascii_case("bash"))
    {
        return None;
    }

    let command = event.tool_command.as_deref()?.trim();
    let command = command.strip_prefix("git ")?;

    if command.starts_with("add ") || command == "add" {
        Some("git-add")
    } else if command.starts_with("commit ") || command == "commit" {
        Some("git-commit")
    } else if command.starts_with("reset ") || command == "reset" {
        Some("git-reset")
    } else if command.starts_with("restore ") || command == "restore" {
        Some("git-restore")
    } else if command.starts_with("checkout ") || command == "checkout" {
        Some("git-checkout")
    } else if command.starts_with("rm ") || command == "rm" {
        Some("git-rm")
    } else if command.starts_with("stash ") || command == "stash" {
        Some("git-stash")
    } else {
        None
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn build_git_runtime_event(
    repo_root: &std::path::Path,
    observed_at_ms: i64,
    event_name: &str,
    session_id: Option<&str>,
    tool_command: Option<&str>,
    head_commit: Option<String>,
    branch: Option<String>,
    recovered_from_transcript: bool,
) -> GitEvent {
    GitEvent {
        repo_root: repo_root.to_string_lossy().to_string(),
        observed_at_ms,
        event_name: event_name.to_string(),
        args: Vec::new(),
        head_commit,
        branch,
        session_id: session_id.map(str::to_string),
        summary: git_summary_from_command(event_name, tool_command),
        recovered_from_transcript,
    }
}

fn git_summary_from_command(event_name: &str, tool_command: Option<&str>) -> Option<String> {
    let command = tool_command?.trim();
    if event_name == "git-commit" {
        extract_commit_message(command)
            .map(|message| format!("commit: {message}"))
            .or_else(|| Some("commit".to_string()))
    } else if event_name == "git-add" {
        Some("staged changes".to_string())
    } else if event_name == "git-reset" {
        Some("reset changes".to_string())
    } else if event_name == "git-restore" || event_name == "git-checkout" {
        Some("restored changes".to_string())
    } else if event_name == "git-rm" {
        Some("removed files".to_string())
    } else if event_name == "git-stash" {
        Some("stashed changes".to_string())
    } else {
        None
    }
}

fn extract_commit_message(command: &str) -> Option<String> {
    let tokens = shell_like_split(command);
    tokens
        .windows(2)
        .find(|window| window[0] == "-m")
        .map(|window| window[1].trim().to_string())
        .filter(|message| !message.is_empty())
}

fn extract_file_paths(tool_input: &Value, ctx: &RepoContext) -> Vec<String> {
    extract_file_paths_for_repo(tool_input, &ctx.repo_root)
}

pub(crate) fn extract_file_paths_for_repo(
    tool_input: &Value,
    repo_root: &std::path::Path,
) -> Vec<String> {
    let mut candidates = HashSet::new();
    collect_file_values(tool_input, &mut candidates);
    if let Some(command) = tool_input.get("command").and_then(Value::as_str) {
        for path in parse_patch_block(command) {
            candidates.insert(path);
        }
        for path in parse_command_paths(command) {
            candidates.insert(path);
        }
    }
    candidates
        .into_iter()
        .filter_map(|value| normalize_repo_relative(repo_root, &value))
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

fn parse_command_paths(command: &str) -> Vec<String> {
    let tokens = shell_like_split(command);
    if tokens.is_empty() {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    if let Some(separator_index) = tokens.iter().position(|token| token == "--") {
        candidates.extend(
            tokens[separator_index + 1..]
                .iter()
                .filter(|token| !token.starts_with('-'))
                .cloned(),
        );
    } else if tokens.first().is_some_and(|token| token == "git")
        && tokens
            .get(1)
            .is_some_and(|subcommand| matches!(subcommand.as_str(), "add" | "rm"))
    {
        candidates.extend(
            tokens[2..]
                .iter()
                .filter(|token| !token.starts_with('-'))
                .cloned(),
        );
    }

    candidates
}

fn shell_like_split(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote = None;

    for ch in command.chars() {
        match quote {
            Some(active_quote) if ch == active_quote => quote = None,
            Some(_) => current.push(ch),
            None if ch == '\'' || ch == '"' => quote = Some(ch),
            None if ch.is_whitespace() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            None => current.push(ch),
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
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
    fn file_mutating_events_do_not_mark_codex_reads_as_writes() {
        assert!(event_is_file_mutating(
            "PreToolUse",
            &HookClient::Codex,
            Some("Edit")
        ));
        assert!(event_is_file_mutating(
            "PostToolUse",
            &HookClient::Codex,
            Some("Write")
        ));
        assert!(!event_is_file_mutating(
            "PreToolUse",
            &HookClient::Codex,
            Some("Read")
        ));
        assert!(!event_is_file_mutating(
            "PostToolUse",
            &HookClient::Codex,
            Some("Grep")
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

    #[test]
    fn parse_command_paths_extracts_git_paths_after_separator() {
        let paths =
            parse_command_paths("git add -- 'src/app/page.tsx' 'docs/design-docs/example.md'");

        assert_eq!(
            paths,
            vec![
                "src/app/page.tsx".to_string(),
                "docs/design-docs/example.md".to_string()
            ]
        );
    }
}
