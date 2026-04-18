use crate::error::TraceLearningError;
use crate::transcript_discovery::{
    discover_transcript_session_roots, discover_transcript_session_roots_for_client,
    TranscriptSessionRoot, TranscriptSessionSource,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;

const BACKFILL_WINDOW_MS: i64 = 24 * 60 * 60 * 1000;
const BROAD_WINDOW_MS: i64 = 30 * 24 * 60 * 60 * 1000; // 30 days
const ACTIVE_WINDOW_MS: i64 = 30 * 60 * 1000;
const FAST_RECENT_TRANSCRIPTS: usize = 12;
const MAX_TRANSCRIPTS: usize = 48;
const MAX_BROAD_TRANSCRIPTS: usize = 200;

#[derive(Clone, Debug)]
pub struct TranscriptSessionBackfill {
    pub client: String,
    pub session_id: String,
    pub cwd: String,
    pub model: Option<String>,
    pub transcript_path: String,
    pub source: Option<String>,
    pub last_seen_at_ms: i64,
    pub status: String,
    pub turn_id: Option<String>,
    pub prompt: Option<String>,
    pub turn_started_at_ms: i64,
    pub recovered_events: Vec<TranscriptRecoveredEvent>,
}

#[derive(Clone, Debug, Default)]
struct TranscriptTurnBackfill {
    turn_id: Option<String>,
    prompt: Option<String>,
    completed: bool,
    started_at_ms: i64,
    _events: Vec<TranscriptRecoveredEvent>,
}

#[derive(Clone, Debug)]
pub enum TranscriptRecoveredEvent {
    ToolUse {
        turn_id: Option<String>,
        observed_at_ms: i64,
        tool_name: String,
        tool_input: Value,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TranscriptFormat {
    CodexJsonl,
    ChatJsonl,
    AugmentSessionJson,
}

pub fn collect_recent_transcript_summaries(
    repo_root: &Path,
) -> Result<Vec<TranscriptSessionBackfill>, TraceLearningError> {
    collect_recent_transcript_summaries_for_client(repo_root, None)
}

pub fn collect_recent_transcript_summaries_for_client(
    repo_root: &Path,
    client: Option<&str>,
) -> Result<Vec<TranscriptSessionBackfill>, TraceLearningError> {
    let session_roots = if let Some(client) = client {
        discover_transcript_session_roots_for_client(Some(client))
    } else {
        discover_transcript_session_roots()
    };
    if session_roots.is_empty() {
        return Ok(Vec::new());
    }

    let now_ms = Utc::now().timestamp_millis();
    let mut transcripts = collect_recent_transcripts(&session_roots)?;
    transcripts
        .retain(|(_, modified_ms)| now_ms.saturating_sub(*modified_ms) <= BACKFILL_WINDOW_MS);
    transcripts.sort_by(|a, b| b.1.cmp(&a.1));

    let recent_candidates = transcripts
        .iter()
        .filter(|(_, modified_ms)| now_ms.saturating_sub(*modified_ms) <= ACTIVE_WINDOW_MS)
        .take(FAST_RECENT_TRANSCRIPTS)
        .map(|(path, modified_ms)| (path.clone(), *modified_ms))
        .collect::<Vec<_>>();
    let recent_matches = parse_matching_transcript_summaries(
        &recent_candidates,
        repo_root,
        now_ms,
        ACTIVE_WINDOW_MS,
    );
    if !recent_matches.is_empty() {
        return Ok(recent_matches);
    }

    transcripts.truncate(MAX_TRANSCRIPTS);
    Ok(parse_matching_transcript_summaries(
        &transcripts,
        repo_root,
        now_ms,
        ACTIVE_WINDOW_MS,
    ))
}

/// Broader collection for analytics: 30-day window, up to 200 transcripts, no active-window filter.
pub fn collect_broad_transcript_summaries(
    repo_root: &Path,
) -> Result<Vec<TranscriptSessionBackfill>, TraceLearningError> {
    let session_roots = discover_transcript_session_roots();
    if session_roots.is_empty() {
        return Ok(Vec::new());
    }

    let now_ms = Utc::now().timestamp_millis();
    let mut transcripts = collect_recent_transcripts(&session_roots)?;
    transcripts.retain(|(_, modified_ms)| now_ms.saturating_sub(*modified_ms) <= BROAD_WINDOW_MS);
    transcripts.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(collect_matching_transcript_summaries(
        &transcripts,
        repo_root,
        now_ms,
        BROAD_WINDOW_MS,
        Some(MAX_BROAD_TRANSCRIPTS),
    ))
}

pub fn collect_active_transcript_summaries(
    repo_root: &Path,
) -> Result<Vec<TranscriptSessionBackfill>, TraceLearningError> {
    let session_roots = discover_transcript_session_roots();
    if session_roots.is_empty() {
        return Ok(Vec::new());
    }

    let now_ms = Utc::now().timestamp_millis();
    let mut transcripts = collect_recent_transcripts(&session_roots)?;
    transcripts
        .retain(|(_, modified_ms)| now_ms.saturating_sub(*modified_ms) <= BACKFILL_WINDOW_MS);
    transcripts.sort_by(|a, b| b.1.cmp(&a.1));

    let recent_candidates = transcripts
        .iter()
        .filter(|(_, modified_ms)| now_ms.saturating_sub(*modified_ms) <= ACTIVE_WINDOW_MS)
        .take(FAST_RECENT_TRANSCRIPTS)
        .map(|(path, modified_ms)| (path.clone(), *modified_ms))
        .collect::<Vec<_>>();

    Ok(parse_matching_transcript_summaries(
        &recent_candidates,
        repo_root,
        now_ms,
        ACTIVE_WINDOW_MS,
    ))
}

pub fn parse_matching_transcript_summaries(
    transcripts: &[(PathBuf, i64)],
    repo_root: &Path,
    now_ms: i64,
    active_window_ms: i64,
) -> Vec<TranscriptSessionBackfill> {
    collect_matching_transcript_summaries(transcripts, repo_root, now_ms, active_window_ms, None)
}

fn collect_matching_transcript_summaries(
    transcripts: &[(PathBuf, i64)],
    repo_root: &Path,
    now_ms: i64,
    active_window_ms: i64,
    max_matches: Option<usize>,
) -> Vec<TranscriptSessionBackfill> {
    let mut summaries = Vec::new();
    let repo_identity = resolve_repo_identity(repo_root);
    let mut identity_cache: HashMap<PathBuf, Option<RepoIdentity>> = HashMap::new();

    for (path, modified_ms) in transcripts {
        if max_matches.is_some_and(|limit| summaries.len() >= limit) {
            break;
        }
        let Some(summary) = parse_transcript_backfill(path, *modified_ms) else {
            continue;
        };
        if !repo_path_matches_with_identity(
            repo_root,
            repo_identity.as_ref(),
            Path::new(&summary.cwd),
            &mut identity_cache,
        ) {
            continue;
        }
        if summary.status != "active"
            && now_ms.saturating_sub(summary.last_seen_at_ms) > active_window_ms
        {
            continue;
        }
        summaries.push(summary);
    }

    summaries
}

pub fn collect_recent_transcripts(
    roots: &[TranscriptSessionRoot],
) -> Result<Vec<(PathBuf, i64)>, TraceLearningError> {
    let mut files = Vec::new();
    for root in roots {
        let mut root_files = match root.kind {
            TranscriptSessionSource::Codex => {
                collect_recent_transcripts_from_dirs(&mut vec![root.path.clone()], &["jsonl"])?
            }
            TranscriptSessionSource::ClaudeProjects => {
                collect_recent_claude_project_transcripts(&root.path)?
            }
            TranscriptSessionSource::QoderProjects => {
                collect_recent_transcripts_from_dirs(&mut vec![root.path.clone()], &["jsonl"])?
            }
            TranscriptSessionSource::AugmentSessions => {
                collect_recent_transcripts_from_dirs(&mut vec![root.path.clone()], &["json"])?
            }
        };
        files.append(&mut root_files);
    }

    let mut deduped = Vec::new();
    let mut seen_paths = HashSet::new();
    for (path, modified_ms) in files {
        if seen_paths.insert(path.clone()) {
            deduped.push((path, modified_ms));
        }
    }

    Ok(deduped)
}

pub fn collect_recent_codex_transcripts(
    root: &Path,
) -> Result<Vec<(PathBuf, i64)>, TraceLearningError> {
    collect_recent_transcripts_from_dirs(&mut vec![root.to_path_buf()], &["jsonl"])
}

pub fn collect_recent_claude_project_transcripts(
    root: &Path,
) -> Result<Vec<(PathBuf, i64)>, TraceLearningError> {
    collect_recent_transcripts_from_dirs(&mut vec![root.to_path_buf()], &["jsonl"])
}

pub fn collect_recent_transcripts_from_dirs(
    dirs: &mut Vec<PathBuf>,
    allowed_extensions: &[&str],
) -> Result<Vec<(PathBuf, i64)>, TraceLearningError> {
    if let Some(files) = collect_recent_transcripts_with_rg(dirs, allowed_extensions) {
        return Ok(files);
    }

    collect_recent_transcripts_from_dirs_fallback(dirs, allowed_extensions)
}

fn collect_recent_transcripts_with_rg(
    dirs: &[PathBuf],
    allowed_extensions: &[&str],
) -> Option<Vec<(PathBuf, i64)>> {
    let globs = transcript_globs(allowed_extensions);
    if globs.is_empty() {
        return None;
    }

    let mut files = Vec::new();
    for dir in dirs {
        let output = Command::new("rg")
            .arg("--files")
            .arg(dir)
            .args(globs.iter().flat_map(|glob| ["-g", glob]))
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }

        let stdout = String::from_utf8(output.stdout).ok()?;
        for raw_line in stdout.lines() {
            let candidate = raw_line.trim();
            if candidate.is_empty() {
                continue;
            }
            let path = PathBuf::from(candidate);
            if !should_keep_transcript_candidate(&path, allowed_extensions) {
                continue;
            }
            let modified_ms = std::fs::metadata(&path)
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|dur| dur.as_millis() as i64)
                .unwrap_or_default();
            files.push((path, modified_ms));
        }
    }

    Some(files)
}

fn collect_recent_transcripts_from_dirs_fallback(
    dirs: &mut Vec<PathBuf>,
    allowed_extensions: &[&str],
) -> Result<Vec<(PathBuf, i64)>, TraceLearningError> {
    let mut files = Vec::new();
    while let Some(dir) = dirs.pop() {
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
                dirs.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if !should_keep_transcript_candidate(&path, allowed_extensions) {
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

fn transcript_globs<'a>(allowed_extensions: &'a [&'a str]) -> Vec<&'a str> {
    let mut globs = Vec::new();
    if allowed_extensions.contains(&"jsonl") {
        globs.push("*.jsonl");
    }
    if allowed_extensions.contains(&"json") {
        globs.push("*.json");
    }
    globs
}

fn should_keep_transcript_candidate(path: &Path, allowed_extensions: &[&str]) -> bool {
    let Some(extension) = path.extension().and_then(|ext| ext.to_str()) else {
        return false;
    };
    if !allowed_extensions.contains(&extension) {
        return false;
    }
    if extension == "jsonl"
        && path.file_name().and_then(|name| name.to_str()) == Some("sessions-index.json")
    {
        return false;
    }
    if extension == "json"
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with("-session.json"))
    {
        return false;
    }
    true
}

pub fn parse_transcript_backfill(
    transcript_path: &Path,
    modified_ms: i64,
) -> Option<TranscriptSessionBackfill> {
    let format = detect_transcript_format(transcript_path)?;
    match format {
        TranscriptFormat::CodexJsonl => parse_codex_jsonl_backfill(transcript_path, modified_ms),
        TranscriptFormat::ChatJsonl => parse_chat_jsonl_backfill(transcript_path, modified_ms),
        TranscriptFormat::AugmentSessionJson => {
            parse_augment_session_backfill(transcript_path, modified_ms)
        }
    }
}

pub fn recover_prompt_from_transcript(
    turn_id: Option<&str>,
    transcript_path: Option<&str>,
) -> Option<String> {
    let turn_id = turn_id?.trim();
    let transcript_path = transcript_path?.trim();
    if turn_id.is_empty() || transcript_path.is_empty() {
        return None;
    }

    let path = Path::new(transcript_path);
    let format = detect_transcript_format(path)?;
    match format {
        TranscriptFormat::CodexJsonl => recover_prompt_from_codex_jsonl(turn_id, path),
        TranscriptFormat::ChatJsonl => recover_prompt_from_chat_jsonl(turn_id, path),
        TranscriptFormat::AugmentSessionJson => recover_prompt_from_augment_json(turn_id, path),
    }
}

pub fn recent_prompt_previews_from_transcript(transcript_path: &str, limit: usize) -> Vec<String> {
    if limit == 0 {
        return Vec::new();
    }

    let path = Path::new(transcript_path);
    let Some(format) = detect_transcript_format(path) else {
        return Vec::new();
    };

    let prompts = match format {
        TranscriptFormat::CodexJsonl => prompts_from_codex_jsonl(path),
        TranscriptFormat::ChatJsonl => prompts_from_chat_jsonl(path),
        TranscriptFormat::AugmentSessionJson => prompts_from_augment_json(path),
    };

    dedupe_prompt_previews(prompts.into_iter().rev().collect(), limit)
}

fn detect_transcript_format(path: &Path) -> Option<TranscriptFormat> {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("json") => Some(TranscriptFormat::AugmentSessionJson),
        Some("jsonl") => detect_jsonl_format(path),
        _ => None,
    }
}

fn detect_jsonl_format(path: &Path) -> Option<TranscriptFormat> {
    let file = std::fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    for line in reader.lines().take(16) {
        let line = line.ok()?;
        if line.trim().is_empty() {
            continue;
        }
        let entry: Value = serde_json::from_str(&line).ok()?;
        match entry.get("type").and_then(Value::as_str) {
            Some("session_meta" | "event_msg" | "response_item") => {
                return Some(TranscriptFormat::CodexJsonl);
            }
            Some("user" | "assistant" | "queue-operation" | "system" | "last-prompt") => {
                return Some(TranscriptFormat::ChatJsonl);
            }
            _ => {}
        }
        if entry.get("message").is_some() && entry.get("sessionId").is_some() {
            return Some(TranscriptFormat::ChatJsonl);
        }
    }

    None
}

fn parse_codex_jsonl_backfill(
    transcript_path: &Path,
    modified_ms: i64,
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
    // Accumulate ALL tool events across all turns for feature matching
    let mut all_events: Vec<TranscriptRecoveredEvent> = Vec::new();

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
                let payload = entry.get("payload").cloned().unwrap_or(Value::Null);
                session_id = payload
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                cwd = payload
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                model = payload
                    .get("model")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| {
                        payload
                            .get("model_provider")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    });
                source = payload
                    .get("source")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
            Some("event_msg") => match entry.pointer("/payload/type").and_then(Value::as_str) {
                Some("task_started") => {
                    if current_turn.turn_id.is_some() {
                        latest_turn = std::mem::take(&mut current_turn);
                    }
                    current_turn.turn_id = entry
                        .pointer("/payload/turn_id")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    current_turn.prompt = None;
                    current_turn.completed = false;
                    current_turn.started_at_ms = observed_at_ms;
                }
                Some("user_message") if current_turn.turn_id.is_some() => {
                    current_turn.prompt = entry
                        .pointer("/payload/message")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string);
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
                if entry.pointer("/payload/type").and_then(Value::as_str)
                    == Some("function_call")
                    && current_turn.turn_id.is_some() =>
            {
                let tool_name = entry.pointer("/payload/name").and_then(Value::as_str)?;
                let tool_input = entry
                    .pointer("/payload/arguments")
                    .and_then(Value::as_str)
                    .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                    .unwrap_or_else(|| {
                        json!({ "command": entry.pointer("/payload/arguments").and_then(Value::as_str).unwrap_or_default() })
                    });
                all_events.push(TranscriptRecoveredEvent::ToolUse {
                    turn_id: current_turn.turn_id.clone(),
                    observed_at_ms,
                    tool_name: tool_name.to_string(),
                    tool_input,
                });
            }
            _ => {}
        }
    }

    let selected_turn = if current_turn.turn_id.is_some() {
        current_turn
    } else {
        latest_turn
    };
    let turn_started_at_ms = if selected_turn.started_at_ms > 0 {
        selected_turn.started_at_ms
    } else {
        last_seen_at_ms
    };

    Some(TranscriptSessionBackfill {
        client: "codex".to_string(),
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
        recovered_events: all_events,
    })
}

fn parse_chat_jsonl_backfill(
    transcript_path: &Path,
    modified_ms: i64,
) -> Option<TranscriptSessionBackfill> {
    let file = std::fs::File::open(transcript_path).ok()?;
    let reader = BufReader::new(file);
    let mut session_id = None;
    let mut cwd = None;
    let mut model = None;
    let mut source = None;
    let mut client = infer_client_from_path(transcript_path);
    let mut last_seen_at_ms = modified_ms;
    let mut current_turn = TranscriptTurnBackfill::default();
    let mut latest_turn = TranscriptTurnBackfill::default();
    // Accumulate ALL tool events across all turns for feature matching
    let mut all_events: Vec<TranscriptRecoveredEvent> = Vec::new();

    for line in reader.lines() {
        let line = line.ok()?;
        let entry: Value = serde_json::from_str(&line).ok()?;
        let observed_at_ms = entry
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_rfc3339_ms)
            .unwrap_or_else(|| {
                entry
                    .get("updated_at")
                    .and_then(Value::as_i64)
                    .unwrap_or(last_seen_at_ms)
            });
        last_seen_at_ms = observed_at_ms;

        session_id = session_id
            .or_else(|| {
                entry
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .or_else(|| entry.get("id").and_then(Value::as_str).map(str::to_string));
        cwd = cwd
            .or_else(|| entry.get("cwd").and_then(Value::as_str).map(str::to_string))
            .or_else(|| {
                entry
                    .get("working_dir")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .or_else(|| {
                entry
                    .get("workingDir")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
        model = model.or_else(|| {
            entry
                .pointer("/message/model")
                .and_then(Value::as_str)
                .map(str::to_string)
        });
        source = source.or_else(|| {
            entry
                .get("entrypoint")
                .and_then(Value::as_str)
                .map(str::to_string)
        });
        if let Some(detected) = infer_client_from_entry(&entry) {
            client = detected;
        }

        match entry.get("type").and_then(Value::as_str) {
            Some("user") => {
                if let Some(prompt) = extract_chat_user_prompt(&entry) {
                    if current_turn.turn_id.is_some() {
                        latest_turn = std::mem::take(&mut current_turn);
                    }
                    current_turn.turn_id = chat_turn_id(&entry);
                    current_turn.prompt = Some(prompt);
                    current_turn.completed = false;
                    current_turn.started_at_ms = observed_at_ms;
                    continue;
                }
            }
            Some("assistant") => {
                if current_turn.turn_id.is_none() {
                    current_turn.turn_id = chat_turn_id(&entry);
                    if current_turn.started_at_ms == 0 {
                        current_turn.started_at_ms = observed_at_ms;
                    }
                }
                for tool_use in extract_chat_tool_uses(&entry) {
                    let event = TranscriptRecoveredEvent::ToolUse {
                        turn_id: current_turn.turn_id.clone(),
                        observed_at_ms,
                        tool_name: tool_use.0,
                        tool_input: tool_use.1,
                    };
                    all_events.push(event);
                }
            }
            _ => {}
        }
    }

    if latest_turn.turn_id.is_none() && current_turn.turn_id.is_none() && session_id.is_some() {
        let sidecar = qoder_session_sidecar(transcript_path);
        if let Some(payload) = read_json_file(sidecar.as_deref()) {
            cwd = cwd.or_else(|| {
                payload
                    .get("working_dir")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
            model = model.or_else(|| {
                payload
                    .get("model")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
            last_seen_at_ms = payload
                .get("updated_at")
                .and_then(Value::as_i64)
                .unwrap_or(last_seen_at_ms);
        }
    }

    let selected_turn = if current_turn.turn_id.is_some() || current_turn.prompt.is_some() {
        current_turn
    } else {
        latest_turn
    };
    let turn_started_at_ms = if selected_turn.started_at_ms > 0 {
        selected_turn.started_at_ms
    } else {
        last_seen_at_ms
    };
    let cwd = cwd.or_else(|| {
        let payload = read_json_file(qoder_session_sidecar(transcript_path).as_deref())?;
        payload
            .get("working_dir")
            .and_then(Value::as_str)
            .map(str::to_string)
    })?;

    Some(TranscriptSessionBackfill {
        client,
        session_id: session_id?,
        cwd,
        model,
        transcript_path: transcript_path.to_string_lossy().to_string(),
        source,
        last_seen_at_ms,
        status: "active".to_string(),
        turn_id: selected_turn.turn_id,
        prompt: selected_turn.prompt,
        turn_started_at_ms,
        recovered_events: all_events,
    })
}

fn parse_augment_session_backfill(
    transcript_path: &Path,
    fallback_modified_ms: i64,
) -> Option<TranscriptSessionBackfill> {
    let payload = read_json_file(Some(transcript_path))?;
    let session_id = payload.get("sessionId")?.as_str()?.trim().to_string();
    if session_id.is_empty() {
        return None;
    }

    let cwd = extract_augment_session_repo_root(&payload)?;
    let model = payload
        .pointer("/agentState/modelId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let created_ms = payload
        .get("created")
        .and_then(Value::as_str)
        .and_then(parse_rfc3339_ms)
        .unwrap_or(fallback_modified_ms);
    let modified_ms = payload
        .get("modified")
        .and_then(Value::as_str)
        .and_then(parse_rfc3339_ms)
        .unwrap_or(fallback_modified_ms);
    let chat_history = payload
        .get("chatHistory")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let latest_entry = chat_history
        .iter()
        .rev()
        .find(|entry| augment_prompt_from_entry(entry).is_some())?;

    let prompt = augment_prompt_from_entry(latest_entry);
    let turn_id = augment_turn_id(latest_entry);
    let turn_started_at_ms = latest_entry
        .get("finishedAt")
        .and_then(Value::as_str)
        .and_then(parse_rfc3339_ms)
        .or_else(|| latest_entry.get("sequenceId").and_then(Value::as_i64))
        .unwrap_or(modified_ms.max(created_ms));
    let recovered_events = augment_recovered_events_from_chat_history(&chat_history);

    Some(TranscriptSessionBackfill {
        client: "auggie".to_string(),
        session_id,
        cwd,
        model,
        transcript_path: transcript_path.to_string_lossy().to_string(),
        source: Some("auggie-session".to_string()),
        last_seen_at_ms: modified_ms.max(turn_started_at_ms),
        status: "active".to_string(),
        turn_id,
        prompt,
        turn_started_at_ms,
        recovered_events,
    })
}

fn recover_prompt_from_codex_jsonl(turn_id: &str, path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
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

fn recover_prompt_from_chat_jsonl(turn_id: &str, path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    for line in reader.lines() {
        let line = line.ok()?;
        let entry: Value = serde_json::from_str(&line).ok()?;
        let candidate_turn_id = chat_turn_id(&entry);
        if candidate_turn_id.as_deref() != Some(turn_id) {
            continue;
        }
        if let Some(prompt) = extract_chat_user_prompt(&entry) {
            return Some(prompt);
        }
    }

    None
}

fn recover_prompt_from_augment_json(turn_id: &str, path: &Path) -> Option<String> {
    let payload = read_json_file(Some(path))?;
    let chat_history = payload.get("chatHistory")?.as_array()?;
    for entry in chat_history.iter().rev() {
        if augment_turn_id(entry).as_deref() == Some(turn_id) {
            return augment_prompt_from_entry(entry);
        }
    }
    None
}

fn prompts_from_codex_jsonl(path: &Path) -> Vec<String> {
    let Ok(file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let reader = BufReader::new(file);
    let mut current_turn_id: Option<String> = None;
    let mut current_prompt: Option<String> = None;
    let mut prompts = Vec::new();

    for line in reader.lines() {
        let Ok(line) = line else {
            continue;
        };
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match entry.get("type").and_then(Value::as_str) {
            Some("event_msg") => match entry.pointer("/payload/type").and_then(Value::as_str) {
                Some("task_started") => {
                    if let Some(prompt) = current_prompt.take() {
                        prompts.push(prompt);
                    }
                    current_turn_id = entry
                        .pointer("/payload/turn_id")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                }
                Some("user_message") if current_turn_id.is_some() => {
                    current_prompt = entry
                        .pointer("/payload/message")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                }
                Some("task_complete")
                    if entry.pointer("/payload/turn_id").and_then(Value::as_str)
                        == current_turn_id.as_deref() =>
                {
                    if let Some(prompt) = current_prompt.take() {
                        prompts.push(prompt);
                    }
                    current_turn_id = None;
                }
                _ => {}
            },
            Some("response_item")
                if entry.pointer("/payload/type").and_then(Value::as_str) == Some("message")
                    && entry.pointer("/payload/role").and_then(Value::as_str) == Some("user")
                    && current_turn_id.is_some() =>
            {
                if let Some(message) = extract_user_prompt_from_response_item(&entry) {
                    current_prompt = Some(message);
                }
            }
            _ => {}
        }
    }

    if let Some(prompt) = current_prompt {
        prompts.push(prompt);
    }
    prompts
}

fn prompts_from_chat_jsonl(path: &Path) -> Vec<String> {
    let Ok(file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let reader = BufReader::new(file);
    let mut prompts = Vec::new();

    for line in reader.lines() {
        let Ok(line) = line else {
            continue;
        };
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(prompt) = extract_chat_user_prompt(&entry) {
            prompts.push(prompt);
        }
    }

    prompts
}

fn prompts_from_augment_json(path: &Path) -> Vec<String> {
    let Some(payload) = read_json_file(Some(path)) else {
        return Vec::new();
    };
    payload
        .get("chatHistory")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(augment_prompt_from_entry)
        .collect()
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

fn extract_chat_user_prompt(entry: &Value) -> Option<String> {
    if entry.get("type").and_then(Value::as_str) != Some("user") {
        return None;
    }
    if entry.pointer("/message/role").and_then(Value::as_str) != Some("user") {
        return None;
    }

    if entry
        .pointer("/message/content/0/type")
        .and_then(Value::as_str)
        == Some("tool_result")
    {
        return None;
    }

    extract_text_parts(entry.pointer("/message/content")?)
}

fn extract_chat_tool_uses(entry: &Value) -> Vec<(String, Value)> {
    let mut uses = Vec::new();
    let Some(items) = entry.pointer("/message/content").and_then(Value::as_array) else {
        return uses;
    };

    for item in items {
        if item.get("type").and_then(Value::as_str) != Some("tool_use") {
            continue;
        }
        let Some(name) = item.get("name").and_then(Value::as_str) else {
            continue;
        };
        let input = item.get("input").cloned().unwrap_or(Value::Null);
        uses.push((name.to_string(), input));
    }
    uses
}

fn extract_text_parts(content: &Value) -> Option<String> {
    let items = content.as_array()?;
    let mut parts = Vec::new();
    for item in items {
        if let Some("text" | "input_text") = item.get("type").and_then(Value::as_str) {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    parts.push(trimmed.to_string());
                }
            }
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn chat_turn_id(entry: &Value) -> Option<String> {
    entry
        .get("promptId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            entry
                .pointer("/message/id")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| {
            entry
                .get("uuid")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn infer_client_from_path(path: &Path) -> String {
    let path_text = path.to_string_lossy().to_ascii_lowercase();
    if path_text.contains(".qoder/") {
        "qoder".to_string()
    } else if path_text.contains(".claude/") {
        "claude".to_string()
    } else {
        "unknown".to_string()
    }
}

fn infer_client_from_entry(entry: &Value) -> Option<String> {
    let version = entry
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let entrypoint = entry
        .get("entrypoint")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if version.starts_with("0.") {
        Some("qoder".to_string())
    } else if entrypoint.contains("sdk-cli") || entry.get("permissionMode").is_some() {
        Some("claude".to_string())
    } else {
        None
    }
}

fn qoder_session_sidecar(transcript_path: &Path) -> Option<PathBuf> {
    let stem = transcript_path.file_stem()?.to_string_lossy();
    Some(transcript_path.with_file_name(format!("{stem}-session.json")))
}

fn read_json_file(path: Option<&Path>) -> Option<Value> {
    let text = std::fs::read_to_string(path?).ok()?;
    serde_json::from_str(&text).ok()
}

fn extract_augment_session_repo_root(payload: &Value) -> Option<String> {
    if let Some(working_dir) = payload
        .get("working_dir")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        return Some(working_dir.to_string());
    }

    let chat_history = payload.get("chatHistory")?.as_array()?;
    for entry in chat_history.iter().rev() {
        let nodes = entry.pointer("/exchange/request_nodes")?.as_array()?;
        for node in nodes {
            let ide_state = node.get("ide_state_node")?;
            if let Some(repo_root) = ide_state
                .get("workspace_folders")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|folder| {
                    folder
                        .get("repository_root")
                        .and_then(Value::as_str)
                        .or_else(|| folder.get("folder_root").and_then(Value::as_str))
                })
                .map(str::trim)
                .find(|path| !path.is_empty())
            {
                return Some(repo_root.to_string());
            }
            if let Some(cwd) = ide_state
                .get("current_terminal")
                .and_then(Value::as_object)
                .and_then(|terminal| terminal.get("current_working_directory"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|path| !path.is_empty())
            {
                return Some(cwd.to_string());
            }
        }
    }
    None
}

fn augment_prompt_from_entry(entry: &Value) -> Option<String> {
    entry
        .pointer("/exchange/request_message")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(str::to_string)
}

fn augment_turn_id(entry: &Value) -> Option<String> {
    entry
        .pointer("/exchange/request_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            entry
                .get("sequenceId")
                .and_then(Value::as_i64)
                .map(|value| value.to_string())
        })
}

fn augment_recovered_events_from_chat_history(
    chat_history: &[Value],
) -> Vec<TranscriptRecoveredEvent> {
    let mut events = Vec::new();
    for entry in chat_history {
        let changed_files = entry
            .get("changedFiles")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if changed_files.is_empty() {
            continue;
        }
        let observed_at_ms = entry
            .get("finishedAt")
            .and_then(Value::as_str)
            .and_then(parse_rfc3339_ms)
            .unwrap_or_default();
        events.push(TranscriptRecoveredEvent::ToolUse {
            turn_id: augment_turn_id(entry),
            observed_at_ms,
            tool_name: "session-files".to_string(),
            tool_input: json!({ "paths": changed_files }),
        });
    }
    events
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct RepoIdentity {
    top_level: PathBuf,
    common_dir: PathBuf,
}

#[cfg(test)]
fn repo_path_matches(repo_root: &Path, session_cwd: &Path) -> bool {
    let repo_identity = resolve_repo_identity(repo_root);
    let mut identity_cache = HashMap::new();
    repo_path_matches_with_identity(
        repo_root,
        repo_identity.as_ref(),
        session_cwd,
        &mut identity_cache,
    )
}

fn repo_path_matches_with_identity(
    repo_root: &Path,
    repo_identity: Option<&RepoIdentity>,
    session_cwd: &Path,
    identity_cache: &mut HashMap<PathBuf, Option<RepoIdentity>>,
) -> bool {
    repo_root == session_cwd
        || repo_root.starts_with(session_cwd)
        || session_cwd.starts_with(repo_root)
        || repo_identity.is_some_and(|repo_identity| {
            let session_identity = identity_cache
                .entry(session_cwd.to_path_buf())
                .or_insert_with(|| resolve_repo_identity(session_cwd));

            session_identity.as_ref().is_some_and(|session_identity| {
                session_identity.top_level == repo_identity.top_level
                    || session_identity.common_dir == repo_identity.common_dir
            })
        })
}

fn resolve_repo_identity(path: &Path) -> Option<RepoIdentity> {
    let top_level = git_rev_parse_path(path, &["rev-parse", "--show-toplevel"])?;
    let common_dir = git_rev_parse_path(path, &["rev-parse", "--git-common-dir"])
        .or_else(|| Some(top_level.join(".git")))?;

    Some(RepoIdentity {
        top_level: std::fs::canonicalize(&top_level).unwrap_or(top_level),
        common_dir: std::fs::canonicalize(&common_dir).unwrap_or(common_dir),
    })
}

fn git_rev_parse_path(path: &Path, args: &[&str]) -> Option<PathBuf> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8(output.stdout).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let parsed = PathBuf::from(trimmed);
    Some(if parsed.is_absolute() {
        parsed
    } else {
        path.join(parsed)
    })
}

fn parse_rfc3339_ms(timestamp: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|parsed| parsed.timestamp_millis())
        .or_else(|| {
            DateTime::parse_from_rfc3339(&format!("{timestamp}Z"))
                .ok()
                .map(|parsed| parsed.timestamp_millis())
        })
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

fn dedupe_prompt_previews(prompts: Vec<String>, limit: usize) -> Vec<String> {
    let mut deduped = Vec::new();
    let mut seen = BTreeSet::new();
    for prompt in prompts {
        let normalized = summarize_prompt_preview(&prompt);
        if normalized.is_empty() || !seen.insert(normalized.clone()) {
            continue;
        }
        deduped.push(normalized);
        if deduped.len() >= limit {
            break;
        }
    }
    deduped
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::tempdir;

    #[test]
    fn recover_prompt_from_transcript_uses_matching_codex_turn() {
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
    fn parse_transcript_backfill_supports_qoder_jsonl() {
        let dir = tempdir().expect("tempdir");
        let project_dir = dir.path().join(".qoder").join("projects").join("demo");
        std::fs::create_dir_all(&project_dir).expect("project dir");
        let transcript = project_dir.join("session.jsonl");
        std::fs::write(
            &transcript,
            concat!(
                "{\"uuid\":\"u1\",\"promptId\":\"turn-1\",\"type\":\"user\",\"timestamp\":\"2026-04-13T09:40:03.004Z\",\"cwd\":\"/tmp/repo\",\"sessionId\":\"sess-qoder\",\"version\":\"0.1.42\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"build hello world\"}]}}\n",
                "{\"uuid\":\"a1\",\"type\":\"assistant\",\"timestamp\":\"2026-04-13T09:40:11.415Z\",\"cwd\":\"/tmp/repo\",\"sessionId\":\"sess-qoder\",\"version\":\"0.1.42\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"name\":\"Write\",\"input\":{\"file_path\":\"/tmp/repo/hello.js\"}}]}}\n"
            ),
        )
        .expect("write transcript");

        let summary = parse_transcript_backfill(&transcript, 0).expect("summary");
        assert_eq!(summary.client, "qoder");
        assert_eq!(summary.session_id, "sess-qoder");
        assert_eq!(summary.prompt.as_deref(), Some("build hello world"));
        assert_eq!(summary.turn_id.as_deref(), Some("turn-1"));
        assert_eq!(summary.recovered_events.len(), 1);
    }

    #[test]
    fn parse_transcript_backfill_supports_augment_json() {
        let dir = tempdir().expect("tempdir");
        let session = dir.path().join("session.json");
        std::fs::write(
            &session,
            r#"{
  "sessionId":"sess-1",
  "created":"2026-04-13T02:09:41.851Z",
  "modified":"2026-04-13T02:11:22.963Z",
  "working_dir":"/tmp/repo",
  "agentState":{"modelId":"claude-sonnet-4"},
  "chatHistory":[
    {
      "sequenceId":1,
      "finishedAt":"2026-04-13T02:10:00.000Z",
      "exchange":{"request_id":"req-1","request_message":"analyze harness monitor"},
      "changedFiles":["/tmp/repo/src/main.rs"]
    }
  ]
}"#,
        )
        .expect("session");

        let summary = parse_transcript_backfill(&session, 0).expect("summary");
        assert_eq!(summary.client, "auggie");
        assert_eq!(summary.cwd, "/tmp/repo");
        assert_eq!(summary.turn_id.as_deref(), Some("req-1"));
        assert_eq!(summary.prompt.as_deref(), Some("analyze harness monitor"));
        assert_eq!(summary.recovered_events.len(), 1);
    }

    #[test]
    fn recent_prompt_previews_from_transcript_returns_latest_first() {
        let dir = tempdir().expect("tempdir");
        let transcript = dir.path().join("session.jsonl");
        std::fs::write(
            &transcript,
            concat!(
                "{\"type\":\"user\",\"promptId\":\"turn-1\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"first task\"}]},\"sessionId\":\"s1\",\"cwd\":\"/tmp/repo\"}\n",
                "{\"type\":\"user\",\"promptId\":\"turn-2\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"second task\"}]},\"sessionId\":\"s1\",\"cwd\":\"/tmp/repo\"}\n",
                "{\"type\":\"user\",\"promptId\":\"turn-3\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"third task\"}]},\"sessionId\":\"s1\",\"cwd\":\"/tmp/repo\"}\n"
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
    fn transcript_candidate_filter_skips_index_and_qoder_sidecar() {
        assert!(!should_keep_transcript_candidate(
            Path::new("/tmp/sessions-index.json"),
            &["jsonl"]
        ));
        assert!(!should_keep_transcript_candidate(
            Path::new("/tmp/demo-session.json"),
            &["json"]
        ));
        assert!(should_keep_transcript_candidate(
            Path::new("/tmp/demo.jsonl"),
            &["jsonl"]
        ));
        assert!(should_keep_transcript_candidate(
            Path::new("/tmp/demo.json"),
            &["json"]
        ));
    }

    #[test]
    fn transcript_globs_follow_allowed_extensions() {
        assert_eq!(transcript_globs(&["jsonl"]), vec!["*.jsonl"]);
        assert_eq!(transcript_globs(&["json"]), vec!["*.json"]);
        assert_eq!(
            transcript_globs(&["jsonl", "json"]),
            vec!["*.jsonl", "*.json"]
        );
    }

    #[test]
    fn repo_path_matches_accepts_git_worktrees_with_shared_common_dir() {
        let dir = tempdir().expect("tempdir");
        let repo_root = dir.path().join("repo");
        let worktree_root = dir.path().join("repo-worktree");
        std::fs::create_dir_all(&repo_root).expect("repo dir");
        std::fs::write(repo_root.join("README.md"), "hello\n").expect("write readme");

        run_git(&repo_root, &["init"]);
        run_git(&repo_root, &["config", "user.name", "Test User"]);
        run_git(&repo_root, &["config", "user.email", "test@example.com"]);
        run_git(&repo_root, &["add", "README.md"]);
        run_git(&repo_root, &["commit", "-m", "init"]);
        run_git(
            &repo_root,
            &[
                "worktree",
                "add",
                "-b",
                "feature/test-worktree",
                worktree_root.to_str().expect("worktree path"),
            ],
        );

        assert!(repo_path_matches(&repo_root, &worktree_root));
        assert!(repo_path_matches(&worktree_root, &repo_root));
    }

    #[test]
    fn collect_matching_transcript_summaries_limits_after_repo_matching() {
        let dir = tempdir().expect("tempdir");
        let repo_root = dir.path().join("repo");
        std::fs::create_dir_all(&repo_root).expect("repo dir");

        let unmatched = dir.path().join("unmatched.jsonl");
        let matched = dir.path().join("matched.jsonl");
        write_codex_session_meta(&unmatched, "sess-unmatched", "/tmp/other-repo");
        write_codex_session_meta(
            &matched,
            "sess-matched",
            repo_root.to_str().expect("repo path"),
        );

        let now_ms = Utc::now().timestamp_millis();
        let summaries = collect_matching_transcript_summaries(
            &[
                (unmatched.clone(), now_ms - 1_000),
                (matched.clone(), now_ms - 2_000),
            ],
            &repo_root,
            now_ms,
            BROAD_WINDOW_MS,
            Some(1),
        );

        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].session_id, "sess-matched");
    }

    fn write_codex_session_meta(path: &Path, session_id: &str, cwd: &str) {
        std::fs::write(
            path,
            format!(
                "{{\"timestamp\":\"2026-04-17T01:51:41.963Z\",\"type\":\"session_meta\",\"payload\":{{\"id\":\"{session_id}\",\"timestamp\":\"2026-04-17T01:50:56.919Z\",\"cwd\":\"{cwd}\",\"source\":\"cli\",\"model_provider\":\"openai\"}}}}\n"
            ),
        )
        .expect("write session meta");
    }

    fn run_git(repo_root: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo_root)
            .args(args)
            .output()
            .expect("git command should run");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
