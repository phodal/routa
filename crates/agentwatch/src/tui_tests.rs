use super::*;
use crate::models::{
    AttributionConfidence, EventLogEntry, EventSource, FileView, RuntimeMessage, SessionView,
};
use crate::state::{FileListMode, FocusPane, UNKNOWN_SESSION_ID};
use pretty_assertions::assert_eq;
use ratatui::backend::TestBackend;
use ratatui::Terminal;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use tempfile::tempdir;

fn sample_state() -> RuntimeState {
    let now = chrono::Utc::now().timestamp_millis();
    let mut sessions = BTreeMap::new();
    sessions.insert(
        "live-hook-check".to_string(),
        SessionView {
            session_id: "live-hook-check".to_string(),
            display_name: Some("impl-buddy".to_string()),
            cwd: "/tmp/project".to_string(),
            model: Some("gpt-5.4".to_string()),
            client: "codex".to_string(),
            transcript_path: Some("/tmp/transcripts/impl-buddy.jsonl".to_string()),
            source: Some("startup".to_string()),
            started_at_ms: now - 600_000,
            last_seen_at_ms: now - 180_000,
            status: "active".to_string(),
            tmux_pane: Some("%12".to_string()),
            touched_files: ["crates/agentwatch/src/tui.rs".to_string()]
                .into_iter()
                .collect(),
            last_turn_id: Some("turn-1".to_string()),
        },
    );
    sessions.insert(
        "idle-review".to_string(),
        SessionView {
            session_id: "idle-review".to_string(),
            display_name: Some("test-master".to_string()),
            cwd: "/tmp/project".to_string(),
            model: Some("gpt-5.4-mini".to_string()),
            client: "codex".to_string(),
            transcript_path: Some("/tmp/transcripts/test-master.jsonl".to_string()),
            source: Some("resume".to_string()),
            started_at_ms: now - 1_200_000,
            last_seen_at_ms: now - 3_600_000,
            status: "idle".to_string(),
            tmux_pane: Some("%18".to_string()),
            touched_files: ["docs/design-docs/agentwatch-tui.md".to_string()]
                .into_iter()
                .collect(),
            last_turn_id: Some("turn-2".to_string()),
        },
    );

    let mut files = BTreeMap::new();
    files.insert(
        "crates/agentwatch/src/tui.rs".to_string(),
        FileView {
            rel_path: "crates/agentwatch/src/tui.rs".to_string(),
            dirty: true,
            state_code: "modify".to_string(),
            last_modified_at_ms: now - 240_000,
            last_session_id: Some("live-hook-check".to_string()),
            confidence: AttributionConfidence::Exact,
            conflicted: false,
            touched_by: ["live-hook-check".to_string()].into_iter().collect(),
            recent_events: vec!["Edit live-hook-".to_string()],
        },
    );
    files.insert(
        "src/app/api/a2a/card/route.ts".to_string(),
        FileView {
            rel_path: "src/app/api/a2a/card/route.ts".to_string(),
            dirty: true,
            state_code: "delete".to_string(),
            last_modified_at_ms: now - 300_000,
            last_session_id: None,
            confidence: AttributionConfidence::Unknown,
            conflicted: false,
            touched_by: BTreeSet::new(),
            recent_events: vec!["watch delete".to_string()],
        },
    );

    let event_log = VecDeque::from(vec![
        EventLogEntry {
            observed_at_ms: now - 240_000,
            source: EventSource::Watch,
            message: "watch modify crates/agentwatch/src/tui.rs".to_string(),
        },
        EventLogEntry {
            observed_at_ms: now - 180_000,
            source: EventSource::Hook,
            message: "live-hook-check Edit Write".to_string(),
        },
        EventLogEntry {
            observed_at_ms: now - 120_000,
            source: EventSource::Git,
            message: "git post-commit main".to_string(),
        },
    ]);

    let mut state = RuntimeState::new(
        "/tmp/project".to_string(),
        "routa-js".to_string(),
        "main".to_string(),
    );
    state.sessions = sessions;
    state.files = files;
    state.event_log = event_log;
    state.follow_mode = true;
    state.focus = FocusPane::Files;
    state.detail_mode = DetailMode::Summary;
    state.selected_session = 0;
    state.selected_file = 0;
    state.last_refresh_at_ms = now - 120_000;
    state.runtime_transport = "socket".to_string();
    state
}

fn sample_cache(state: &RuntimeState) -> AppCache {
    let mut cache = AppCache::new();
    let file = state.selected_file().expect("selected file");
    cache.diff_stats.insert(
        diff_stat_key(&file.rel_path, &file.state_code, file.last_modified_at_ms),
        DiffStatSummary {
            status: "M".to_string(),
            additions: Some(38),
            deletions: Some(5),
        },
    );
    cache.diff_stats.insert(
        diff_stat_key(
            "src/app/api/a2a/card/route.ts",
            "delete",
            state.files["src/app/api/a2a/card/route.ts"].last_modified_at_ms,
        ),
        DiffStatSummary {
            status: "D".to_string(),
            additions: None,
            deletions: Some(12),
        },
    );
    cache.preview_cache.insert(
        detail_cache_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
            DetailMode::File,
        ),
        DetailCacheEntry {
            key: detail_cache_key(
                &file.rel_path,
                &file.state_code,
                file.last_modified_at_ms,
                DetailMode::File,
            ),
            text: "fn render(frame: &mut Frame) {\n    // preview\n}".to_string(),
        },
    );
    cache.diff_cache.insert(
        detail_cache_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
            DetailMode::Diff,
        ),
        DetailCacheEntry {
            key: detail_cache_key(
                &file.rel_path,
                &file.state_code,
                file.last_modified_at_ms,
                DetailMode::Diff,
            ),
            text: "@@ -1,2 +1,3 @@\n-use old\n+use new\n+use cache".to_string(),
        },
    );
    cache
}

fn render_snapshot(state: &RuntimeState, cache: &AppCache, width: u16, height: u16) -> String {
    let dir = tempdir().expect("tempdir");
    let feed = RuntimeFeed::open(&dir.path().join("events.jsonl")).expect("feed");
    let mut terminal = Terminal::new(TestBackend::new(width, height)).expect("terminal");
    terminal
        .draw(|frame| render(frame, state, &feed, cache))
        .expect("draw");
    normalize_snapshot(buffer_to_string(terminal.backend()))
}

fn buffer_to_string(backend: &TestBackend) -> String {
    let buffer = backend.buffer();
    let area = buffer.area;
    let mut lines = Vec::new();
    for y in 0..area.height {
        let mut line = String::new();
        for x in 0..area.width {
            line.push_str(buffer[(x, y)].symbol());
        }
        lines.push(line.trim_end().to_string());
    }
    lines.join("\n")
}

fn normalize_snapshot(text: String) -> String {
    scrub_clock_tokens(text.replace("/tmp/project", "<repo>"))
}

fn scrub_clock_tokens(text: String) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut idx = 0;
    while idx < chars.len() {
        if idx + 7 < chars.len()
            && chars[idx].is_ascii_digit()
            && chars[idx + 1].is_ascii_digit()
            && chars[idx + 2] == ':'
            && chars[idx + 3].is_ascii_digit()
            && chars[idx + 4].is_ascii_digit()
            && chars[idx + 5] == ':'
            && chars[idx + 6].is_ascii_digit()
            && chars[idx + 7].is_ascii_digit()
        {
            out.push_str("<ts>");
            idx += 8;
        } else {
            out.push(chars[idx]);
            idx += 1;
        }
    }
    out
}

#[test]
fn diff_stat_spans_use_green_for_add_and_red_for_delete() {
    let spans = render_diff_stat_spans(&DiffStatSummary {
        status: "M".to_string(),
        additions: Some(8),
        deletions: Some(2),
    });
    assert_eq!(spans[2].style.fg, Some(ACTIVE));
    assert_eq!(spans[4].style.fg, Some(STOPPED));
}

#[test]
fn search_filters_sessions_and_files() {
    let mut state = sample_state();
    state.search_query = "route.ts".to_string();
    let sessions = state.session_items();
    let files = state.file_items();
    assert_eq!(
        sessions.last().map(|it| it.session_id.as_str()),
        Some(UNKNOWN_SESSION_ID)
    );
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].rel_path, "src/app/api/a2a/card/route.ts");
}

#[test]
fn assign_selected_file_to_selected_session_updates_owner() {
    let mut state = sample_state();
    state.file_list_mode = FileListMode::Global;
    state.selected_session = 0;
    state.selected_file = 1;

    let message = state
        .selected_file_assignment_message()
        .expect("assignment message");
    state.apply_message(message);

    let file = state
        .files
        .get("src/app/api/a2a/card/route.ts")
        .expect("file");
    assert_eq!(file.last_session_id.as_deref(), Some("live-hook-check"));
    assert!(matches!(file.confidence, AttributionConfidence::Inferred));
    assert!(state
        .visible_event_log_items()
        .iter()
        .any(|entry| entry.message.contains("assign live-hook-")));
}

#[test]
fn selected_file_assignment_message_is_attribution_event() {
    let mut state = sample_state();
    state.file_list_mode = FileListMode::Global;
    state.selected_session = 0;
    state.selected_file = 1;

    let message = state
        .selected_file_assignment_message()
        .expect("assignment message");

    match message {
        RuntimeMessage::Attribution(event) => {
            assert_eq!(event.rel_path, "src/app/api/a2a/card/route.ts");
            assert_eq!(event.session_id, "live-hook-check");
            assert_eq!(event.reason, "manual-assign");
        }
        other => panic!("unexpected runtime message: {other:?}"),
    }
}

#[test]
fn tui_snapshot_summary_mode() {
    let state = sample_state();
    let cache = sample_cache(&state);
    insta::assert_snapshot!(
        "agentwatch_tui_summary",
        render_snapshot(&state, &cache, 120, 28)
    );
}

#[test]
fn tui_snapshot_search_mode() {
    let mut state = sample_state();
    state.search_query = "route.ts".to_string();
    state.search_active = true;
    state.file_list_mode = FileListMode::Global;
    state.selected_file = 0;
    let cache = sample_cache(&state);
    insta::assert_snapshot!(
        "agentwatch_tui_search",
        render_snapshot(&state, &cache, 120, 24)
    );
}

#[test]
fn tui_snapshot_file_preview_mode() {
    let mut state = sample_state();
    state.detail_mode = DetailMode::File;
    let cache = sample_cache(&state);
    insta::assert_snapshot!(
        "agentwatch_tui_file_preview",
        render_snapshot(&state, &cache, 120, 24)
    );
}
