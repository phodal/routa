use super::*;
use crate::shared::models::{DetectedAgent, SessionView};
use std::collections::BTreeSet;

#[test]
fn sessions_match_agents_by_start_time_proximity() {
    let now = chrono::Utc::now().timestamp_millis();
    let mut state = RuntimeState::new("/tmp/project".to_string(), "main".to_string());
    state.last_refresh_at_ms = now;
    state.sessions.insert(
        "session-early".to_string(),
        SessionView {
            session_id: "session-early".to_string(),
            display_name: Some("rollout-early".to_string()),
            cwd: "/tmp/project".to_string(),
            model: Some("gpt-5.4".to_string()),
            client: "codex".to_string(),
            transcript_path: Some("/tmp/transcripts/early.jsonl".to_string()),
            source: Some("cli".to_string()),
            started_at_ms: now - 60 * 60 * 1000,
            last_seen_at_ms: now - 30_000,
            status: "active".to_string(),
            tmux_pane: None,
            touched_files: BTreeSet::new(),
            last_turn_id: Some("turn-early".to_string()),
            last_event_name: Some("TranscriptRecover".to_string()),
            last_tool_name: None,
            active_task_id: Some("task:session-early:turn-early".to_string()),
            active_task_title: Some("Fix early task".to_string()),
            last_prompt_preview: Some("Fix early task".to_string()),
            active_task_recovered_from_transcript: true,
            recent_git_activity: Vec::new(),
        },
    );
    state.sessions.insert(
        "session-late".to_string(),
        SessionView {
            session_id: "session-late".to_string(),
            display_name: Some("rollout-late".to_string()),
            cwd: "/tmp/project".to_string(),
            model: Some("gpt-5.4".to_string()),
            client: "codex".to_string(),
            transcript_path: Some("/tmp/transcripts/late.jsonl".to_string()),
            source: Some("cli".to_string()),
            started_at_ms: now - 5 * 60 * 1000,
            last_seen_at_ms: now - 15_000,
            status: "active".to_string(),
            tmux_pane: None,
            touched_files: BTreeSet::new(),
            last_turn_id: Some("turn-late".to_string()),
            last_event_name: Some("TranscriptRecover".to_string()),
            last_tool_name: None,
            active_task_id: Some("task:session-late:turn-late".to_string()),
            active_task_title: Some("Fix late task".to_string()),
            last_prompt_preview: Some("Fix late task".to_string()),
            active_task_recovered_from_transcript: true,
            recent_git_activity: Vec::new(),
        },
    );
    state.set_detected_agents(vec![
        DetectedAgent {
            key: "codex:1001".to_string(),
            name: "Codex".to_string(),
            vendor: "OpenAI".to_string(),
            icon: "◈".to_string(),
            pid: 1001,
            cwd: Some("/tmp/project".to_string()),
            cpu_percent: 0.0,
            mem_mb: 64.0,
            uptime_seconds: 60 * 60,
            status: "IDLE".to_string(),
            confidence: 80,
            project: "project".to_string(),
            command: "codex".to_string(),
        },
        DetectedAgent {
            key: "codex:1002".to_string(),
            name: "Codex".to_string(),
            vendor: "OpenAI".to_string(),
            icon: "◈".to_string(),
            pid: 1002,
            cwd: Some("/tmp/project".to_string()),
            cpu_percent: 0.0,
            mem_mb: 64.0,
            uptime_seconds: 5 * 60,
            status: "IDLE".to_string(),
            confidence: 80,
            project: "project".to_string(),
            command: "codex".to_string(),
        },
    ]);
    state.refresh_views();

    let early = state
        .session_items()
        .iter()
        .find(|item| item.session_id == "session-early")
        .expect("early session");
    let late = state
        .session_items()
        .iter()
        .find(|item| item.session_id == "session-late")
        .expect("late session");

    assert_eq!(early.agent_summary.as_deref(), Some("agent codex#1001"));
    assert_eq!(late.agent_summary.as_deref(), Some("agent codex#1002"));
    assert!(!state.runs().iter().any(|run| run.is_synthetic_agent_run));
}
