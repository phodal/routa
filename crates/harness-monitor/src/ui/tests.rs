use super::*;
use crate::shared::models::{
    AttributionConfidence, DetectedAgent, EntryKind, EventLogEntry, EventSource, FileView,
    FitnessEvent, RuntimeMessage, RuntimeServiceInfo, SessionView,
};
use crate::ui::state::{DetailMode, FileListMode, FocusPane, ThemeMode, UNKNOWN_SESSION_ID};
use crate::ui::tui::highlight::highlight_code_text;
use pretty_assertions::assert_eq;
use ratatui::backend::TestBackend;
use ratatui::Terminal;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::time::Duration;
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
            touched_files: ["crates/harness-monitor/src/tui.rs".to_string()]
                .into_iter()
                .collect(),
            last_turn_id: Some("turn-1".to_string()),
            last_event_name: Some("PostToolUse".to_string()),
            last_tool_name: Some("Write".to_string()),
            active_task_id: Some("task:live-hook-check:turn-1".to_string()),
            active_task_title: Some("Fix harness monitor task journey".to_string()),
            last_prompt_preview: Some("Fix harness monitor task journey".to_string()),
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
            last_event_name: Some("UserPromptSubmit".to_string()),
            last_tool_name: None,
            active_task_id: Some("task:idle-review:turn-2".to_string()),
            active_task_title: Some("Review harness monitor UI".to_string()),
            last_prompt_preview: Some("Review harness monitor UI".to_string()),
        },
    );

    let mut files = BTreeMap::new();
    files.insert(
        "crates/harness-monitor/src/tui.rs".to_string(),
        FileView {
            rel_path: "crates/harness-monitor/src/tui.rs".to_string(),
            dirty: true,
            state_code: "modify".to_string(),
            entry_kind: EntryKind::File,
            last_modified_at_ms: now - 240_000,
            last_session_id: Some("live-hook-check".to_string()),
            last_task_id: Some("task:live-hook-check:turn-1".to_string()),
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
            entry_kind: EntryKind::File,
            last_modified_at_ms: now - 300_000,
            last_session_id: None,
            last_task_id: None,
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
            message: "watch modify crates/harness-monitor/src/tui.rs".to_string(),
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

    let mut state = RuntimeState::new("/tmp/project".to_string(), "main".to_string());
    state.sessions = sessions;
    state.files = files;
    state.event_log = event_log;
    state.follow_mode = true;
    state.focus = FocusPane::Files;
    state.detail_mode = DetailMode::Diff;
    state.selected_session = 0;
    state.selected_file = 0;
    state.last_refresh_at_ms = now - 120_000;
    state.runtime_transport = "socket".to_string();
    state.set_ahead_count(Some(5));
    state.set_worktree_count(Some(2));
    state.set_detected_agents(vec![
        DetectedAgent {
            key: "codex:4211".to_string(),
            name: "Codex".to_string(),
            vendor: "OpenAI".to_string(),
            icon: "◈".to_string(),
            pid: 4211,
            cwd: Some("/tmp/project".to_string()),
            cpu_percent: 2.5,
            mem_mb: 128.0,
            uptime_seconds: 95,
            status: "ACTIVE".to_string(),
            confidence: 80,
            project: "project".to_string(),
            command: "codex --cwd /tmp/project".to_string(),
        },
        DetectedAgent {
            key: "claude:9001".to_string(),
            name: "Claude".to_string(),
            vendor: "Anthropic".to_string(),
            icon: "◆".to_string(),
            pid: 9001,
            cwd: Some("/tmp/elsewhere".to_string()),
            cpu_percent: 0.1,
            mem_mb: 96.0,
            uptime_seconds: 4100,
            status: "IDLE".to_string(),
            confidence: 80,
            project: "elsewhere".to_string(),
            command: "claude --cwd /tmp/elsewhere".to_string(),
        },
    ]);
    state.refresh_views();
    state
}

fn sample_cache(state: &RuntimeState) -> AppCache {
    let mut cache = AppCache::new(&state.repo_root);
    let file = state.selected_file().expect("selected file");
    cache.diff_stats.insert(
        diff_stat_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
            file.entry_kind,
        ),
        DiffStatSummary {
            status: "M".to_string(),
            additions: Some(38),
            deletions: Some(5),
        },
    );
    if let Some(route_file) = state.files.get("src/app/api/a2a/card/route.ts") {
        cache.diff_stats.insert(
            diff_stat_key(
                "src/app/api/a2a/card/route.ts",
                "delete",
                route_file.last_modified_at_ms,
                route_file.entry_kind,
            ),
            DiffStatSummary {
                status: "D".to_string(),
                additions: None,
                deletions: Some(12),
            },
        );
    }
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
    cache.set_fitness_snapshot_for_tests(
        fitness::FitnessRunMode::Fast,
        fitness::FitnessSnapshot {
            mode: fitness::FitnessRunMode::Fast,
            final_score: 91.0,
            hard_gate_blocked: false,
            score_blocked: false,
            duration_ms: 4200.0,
            metric_count: 12,
            coverage_metric_available: false,
            coverage_summary: fitness::CoverageSummary::default(),
            dimensions: vec![
                fitness::FitnessDimensionSummary {
                    name: "code_quality".to_string(),
                    weight: 18,
                    score: 92.0,
                    passed: 4,
                    total: 4,
                    hard_gate_failures: Vec::new(),
                    metrics: Vec::new(),
                },
                fitness::FitnessDimensionSummary {
                    name: "api_contract".to_string(),
                    weight: 10,
                    score: 95.0,
                    passed: 2,
                    total: 2,
                    hard_gate_failures: Vec::new(),
                    metrics: Vec::new(),
                },
            ],
            slowest_metrics: Vec::new(),
        },
    );
    cache.set_test_mapping_snapshot_for_tests(
        vec![
            TestMappingEntry {
                source_file: "crates/harness-monitor/src/tui.rs".to_string(),
                language: "rust".to_string(),
                status: "changed".to_string(),
                related_test_files: vec!["crates/harness-monitor/src/tui_tests.rs".to_string()],
                graph_test_files: Vec::new(),
                resolver_kind: "hybrid_heuristic".to_string(),
                confidence: "medium".to_string(),
                has_inline_tests: false,
            },
            TestMappingEntry {
                source_file: "src/app/api/a2a/card/route.ts".to_string(),
                language: "typescript".to_string(),
                status: "missing".to_string(),
                related_test_files: Vec::new(),
                graph_test_files: Vec::new(),
                resolver_kind: "path_heuristic".to_string(),
                confidence: "high".to_string(),
                has_inline_tests: false,
            },
        ],
        Vec::new(),
    );
    cache
}

fn render_snapshot(state: &RuntimeState, cache: &mut AppCache, width: u16, height: u16) -> String {
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
    state.refresh_views();
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
    state.refresh_views();
    state.selected_run = state
        .runs()
        .iter()
        .position(|run| run.session_id == UNKNOWN_SESSION_ID)
        .expect("unknown run");
    state.selected_session = state
        .runs()
        .iter()
        .position(|run| run.session_id == "live-hook-check")
        .expect("live run");
    state.refresh_views();
    state.selected_file = state
        .file_items()
        .iter()
        .position(|file| file.rel_path == "src/app/api/a2a/card/route.ts")
        .expect("route file");

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
fn sync_dirty_files_rebuilds_unknown_session_and_file_views() {
    let mut state = RuntimeState::new("/tmp/project".to_string(), "main".to_string());

    state.sync_dirty_files(vec![(
        "src/app/globals.css".to_string(),
        "modify".to_string(),
        Some(1_700_000_000_000),
        EntryKind::File,
    )]);

    assert_eq!(state.session_items().len(), 1);
    assert_eq!(state.session_items()[0].session_id, UNKNOWN_SESSION_ID);
    assert_eq!(state.file_items().len(), 1);
    assert_eq!(state.file_items()[0].rel_path, "src/app/globals.css");
}

#[test]
fn file_preview_highlight_uses_extension_fallback_for_typescript() {
    let text = highlight_code_text(
        Some("tools/hook-runtime/src/review.test.ts"),
        "const value = 1;\nfunction demo() { return value; }\n",
        ThemeMode::Dark,
    );

    let has_colored_span = text
        .lines
        .iter()
        .flat_map(|line| line.spans.iter())
        .any(|span| span.style.fg.is_some() && span.content.as_ref().contains("const"));

    assert!(
        has_colored_span,
        "expected syntax-colored span for TypeScript"
    );
    assert_eq!(text.lines[0].spans[0].content.as_ref().trim(), "1");
}

#[test]
fn page_down_scrolls_file_preview_when_detail_has_focus() {
    let mut state = sample_state();
    state.focus = FocusPane::Detail;
    state.detail_mode = DetailMode::File;
    state.detail_scroll = 0;

    state.page_down();

    assert!(state.detail_scroll > 0);
}

#[test]
fn page_down_scrolls_fitness_panel_when_fitness_has_focus() {
    let mut state = sample_state();
    state.focus = FocusPane::Fitness;
    state.fitness_scroll = 0;

    state.page_down();

    assert!(state.fitness_scroll > 0);
}

#[test]
fn compact_focus_cycle_includes_fitness_panel() {
    let mut state = sample_state();
    state.focus = FocusPane::Files;

    state.cycle_focus_for_width(120);
    assert_eq!(state.focus, FocusPane::Detail);

    state.cycle_focus_for_width(120);
    assert_eq!(state.focus, FocusPane::Fitness);
}

#[test]
fn focus_cycle_backward_wraps_to_fitness_panel() {
    let mut state = sample_state();
    state.focus = FocusPane::Files;

    state.cycle_focus_backward_for_width(120);

    assert_eq!(state.focus, FocusPane::Fitness);
}

#[test]
fn toggling_fitness_mode_updates_cache_key_prefix() {
    let mut state = sample_state();

    assert!(state.fitness_cache_key().starts_with("mode=fast;"));

    state.toggle_fitness_view_mode();

    assert!(state.fitness_cache_key().starts_with("mode=full;"));
}

#[test]
fn fitness_cache_key_changes_when_coverage_artifact_changes() {
    let dir = tempdir().expect("tempdir");
    let repo_root = dir.path().to_string_lossy().to_string();
    let mut state = RuntimeState::new(repo_root.clone(), "main".to_string());

    let initial_key = state.fitness_cache_key();
    assert!(initial_key.contains("coverage=missing"));

    let coverage_dir = dir.path().join("target").join("coverage");
    std::fs::create_dir_all(&coverage_dir).expect("create coverage dir");
    std::fs::write(
        coverage_dir.join("fitness-summary.json"),
        "{\"schema_version\":1}\n",
    )
    .expect("write coverage summary");

    let refreshed_key = state.fitness_cache_key();
    assert_ne!(initial_key, refreshed_key);
    assert!(!refreshed_key.contains("coverage=missing"));

    std::thread::sleep(Duration::from_millis(5));
    std::fs::write(
        coverage_dir.join("fitness-summary.json"),
        "{\"schema_version\":1,\"sources\":{\"typescript\":{\"line_percent\":47.2}}}\n",
    )
    .expect("rewrite coverage summary");

    let updated_key = state.fitness_cache_key();
    assert_ne!(refreshed_key, updated_key);

    state.toggle_fitness_view_mode();
    assert!(state.fitness_cache_key().starts_with("mode=full;"));
}

#[test]
fn selected_file_assignment_message_is_attribution_event() {
    let mut state = sample_state();
    state.file_list_mode = FileListMode::Global;
    state.refresh_views();
    state.selected_run = state
        .runs()
        .iter()
        .position(|run| run.session_id == UNKNOWN_SESSION_ID)
        .expect("unknown run");
    state.selected_session = state
        .runs()
        .iter()
        .position(|run| run.session_id == "live-hook-check")
        .expect("live run");
    state.refresh_views();
    state.selected_file = state
        .file_items()
        .iter()
        .position(|file| file.rel_path == "src/app/api/a2a/card/route.ts")
        .expect("route file");

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
fn fitness_event_is_logged_in_event_stream() {
    let mut state = sample_state();
    state.apply_message(RuntimeMessage::Fitness(FitnessEvent {
        repo_root: state.repo_root.clone(),
        observed_at_ms: chrono::Utc::now().timestamp_millis(),
        mode: "fast".to_string(),
        status: "passed".to_string(),
        final_score: Some(97.0),
        hard_gate_blocked: Some(false),
        score_blocked: Some(false),
        duration_ms: Some(10_200.0),
        dimension_count: Some(2),
        metric_count: Some(8),
    }));

    assert!(state
        .visible_event_log_items()
        .iter()
        .any(|entry| entry.source == EventSource::Fitness
            && entry.message.contains("fitness fast passed 97.0%")));
}

#[test]
fn tui_snapshot_summary_mode() {
    let state = sample_state();
    let mut cache = sample_cache(&state);
    insta::assert_snapshot!(
        "routa_watch_tui_summary",
        render_snapshot(&state, &mut cache, 120, 28)
    );
}

#[test]
fn tui_snapshot_full_runs_mode() {
    let mut state = sample_state();
    state.focus = FocusPane::Runs;
    let mut cache = sample_cache(&state);
    insta::assert_snapshot!(
        "routa_watch_tui_full_runs",
        render_snapshot(&state, &mut cache, 180, 28)
    );
}

#[test]
fn run_details_surface_run_centric_operator_context() {
    let mut state = sample_state();
    state.focus = FocusPane::Runs;
    let mut cache = sample_cache(&state);

    let snapshot = render_snapshot(&state, &mut cache, 180, 40);

    assert!(snapshot.contains("Fix harness monitor task journey"));
    assert!(snapshot.contains("fixer  hook-backed"));
    assert!(snapshot.contains("Model: gpt-5.4"));
    assert!(snapshot.contains("Last: PostToolUse"));
    assert!(snapshot.contains("Files: "));
}

#[test]
fn file_detail_surfaces_test_mapping_context() {
    let state = sample_state();
    let mut cache = sample_cache(&state);

    let snapshot = render_snapshot(&state, &mut cache, 180, 32);

    assert!(snapshot.contains("Test mapping:"));
    assert!(snapshot.contains("Resolver:"));
    assert!(snapshot.contains("TM "));
}

#[test]
fn hard_gate_failure_blocks_selected_run() {
    let mut state = sample_state();
    state.focus = FocusPane::Runs;
    let mut cache = sample_cache(&state);
    cache.set_fitness_snapshot_for_tests(
        fitness::FitnessRunMode::Fast,
        fitness::FitnessSnapshot {
            mode: fitness::FitnessRunMode::Fast,
            final_score: 62.0,
            hard_gate_blocked: true,
            score_blocked: false,
            duration_ms: 1800.0,
            metric_count: 6,
            coverage_metric_available: false,
            coverage_summary: fitness::CoverageSummary::default(),
            dimensions: vec![fitness::FitnessDimensionSummary {
                name: "code_quality".to_string(),
                weight: 18,
                score: 62.0,
                passed: 1,
                total: 3,
                hard_gate_failures: vec!["lint_pass".to_string()],
                metrics: Vec::new(),
            }],
            slowest_metrics: Vec::new(),
        },
    );

    let snapshot = render_snapshot(&state, &mut cache, 180, 40);

    assert!(snapshot.contains("Status: failed"));
    assert!(snapshot.contains("hard gate failure"));
    assert!(snapshot.contains("Recovery: "));
}

#[test]
fn synthetic_run_details_surface_process_scan_origin() {
    let now = chrono::Utc::now().timestamp_millis();
    let mut state = RuntimeState::new("/tmp/project".to_string(), "main".to_string());
    state.last_refresh_at_ms = now;
    state.sync_dirty_files(vec![(
        "crates/harness-monitor/src/tui_render.rs".to_string(),
        "modify".to_string(),
        Some(now),
        EntryKind::File,
    )]);
    state.set_detected_agents(vec![DetectedAgent {
        key: "codex:5297".to_string(),
        name: "Codex".to_string(),
        vendor: "OpenAI".to_string(),
        icon: "◈".to_string(),
        pid: 5297,
        cwd: Some("/tmp/project".to_string()),
        cpu_percent: 0.4,
        mem_mb: 143.0,
        uptime_seconds: 1_000,
        status: "IDLE".to_string(),
        confidence: 75,
        project: "project".to_string(),
        command: "codex --cwd /tmp/project".to_string(),
    }]);
    state.focus = FocusPane::Runs;
    state.refresh_views();
    state.selected_run = state
        .runs()
        .iter()
        .position(|run| run.is_synthetic_agent_run)
        .expect("synthetic run");

    let mut cache = AppCache::new(&state.repo_root);
    cache.set_fitness_snapshot_for_tests(
        fitness::FitnessRunMode::Fast,
        fitness::FitnessSnapshot {
            mode: fitness::FitnessRunMode::Fast,
            final_score: 88.0,
            hard_gate_blocked: false,
            score_blocked: false,
            duration_ms: 1000.0,
            metric_count: 4,
            coverage_metric_available: false,
            coverage_summary: fitness::CoverageSummary::default(),
            dimensions: Vec::new(),
            slowest_metrics: Vec::new(),
        },
    );
    let snapshot = render_snapshot(&state, &mut cache, 180, 40);

    assert!(snapshot.contains("process-scan"));
    assert!(snapshot.contains("observing"));
}

#[test]
fn tui_snapshot_search_mode() {
    let mut state = sample_state();
    state.search_query = "route.ts".to_string();
    state.search_active = true;
    state.file_list_mode = FileListMode::Global;
    state.selected_file = 0;
    state.refresh_views();
    let mut cache = sample_cache(&state);
    insta::assert_snapshot!(
        "routa_watch_tui_search",
        render_snapshot(&state, &mut cache, 120, 24)
    );
}

#[test]
fn tui_snapshot_file_preview_mode() {
    let mut state = sample_state();
    state.detail_mode = DetailMode::File;
    state.refresh_views();
    let mut cache = sample_cache(&state);
    insta::assert_snapshot!(
        "routa_watch_tui_file_preview",
        render_snapshot(&state, &mut cache, 120, 24)
    );
}

#[test]
fn tui_snapshot_compact_mode() {
    let state = sample_state();
    let mut cache = sample_cache(&state);
    insta::assert_snapshot!(
        "routa_watch_tui_compact",
        render_snapshot(&state, &mut cache, 96, 24)
    );
}

#[test]
fn transport_degrades_to_feed_when_socket_is_unreachable() {
    let dir = tempdir().expect("tempdir");
    let repo_root = dir.path().join("repo");
    let git_dir = repo_root.join(".git");
    std::fs::create_dir_all(&git_dir).expect("git dir");
    let event_path = dir.path().join("runtime").join("events.jsonl");
    let info_path = dir.path().join("runtime").join("service.json");
    let socket_path = dir.path().join("runtime").join("events.sock");

    std::fs::create_dir_all(info_path.parent().expect("info parent")).expect("runtime dir");
    std::fs::write(&event_path, b"{}\n").expect("feed");
    crate::observe::ipc::write_service_info(
        &info_path,
        &RuntimeServiceInfo {
            pid: 1,
            transport: "socket".to_string(),
            started_at_ms: chrono::Utc::now().timestamp_millis(),
            last_seen_at_ms: chrono::Utc::now().timestamp_millis(),
        },
    )
    .expect("service info");

    let ctx = RepoContext {
        repo_root,
        git_dir,
        db_path: dir.path().join("harness-monitor.db"),
        runtime_event_path: event_path,
        runtime_socket_path: socket_path,
        runtime_info_path: info_path,
        runtime_tcp_addr: "127.0.0.1:49123".to_string(),
    };

    assert_eq!(read_runtime_transport(&ctx), "feed");
}

#[test]
fn bootstrap_history_cutoff_uses_day_scale_window() {
    let now_ms = 1_700_000_000_000i64;
    assert_eq!(
        bootstrap_history_cutoff(now_ms),
        now_ms - 24 * 60 * 60 * 1000
    );
}

#[test]
fn parse_branch_resolution_reads_branch_and_upstream() {
    let status = parse_branch_resolution("main\norigin/main\n");

    assert_eq!(
        status,
        BranchResolution {
            branch: Some("main".to_string()),
            upstream: Some("origin/main".to_string()),
        }
    );
}

#[test]
fn parse_ahead_count_reads_left_side_count() {
    assert_eq!(parse_ahead_count("7\t2\n"), Some(7));
}

#[test]
fn current_worktree_count_reads_git_worktrees_directory() {
    let dir = tempdir().expect("tempdir");
    let repo_root = dir.path().join("repo");
    let git_dir = repo_root.join(".git");
    std::fs::create_dir_all(git_dir.join("worktrees").join("feature-a")).expect("feature-a");
    std::fs::create_dir_all(git_dir.join("worktrees").join("feature-b")).expect("feature-b");

    let ctx = RepoContext {
        repo_root,
        git_dir,
        db_path: dir.path().join("harness-monitor.db"),
        runtime_event_path: dir.path().join("runtime").join("events.jsonl"),
        runtime_socket_path: dir.path().join("runtime").join("events.sock"),
        runtime_info_path: dir.path().join("runtime").join("service.json"),
        runtime_tcp_addr: "127.0.0.1:49123".to_string(),
    };

    assert_eq!(current_worktree_count(&ctx).expect("worktree count"), 3);
}

#[test]
fn detected_agents_attach_to_session_when_match_is_unique() {
    let mut state = sample_state();
    if let Some(session) = state.sessions.get_mut("idle-review") {
        session.client = "claude".to_string();
        session.cwd = "/tmp/other-project".to_string();
    }
    state.refresh_views();
    let session = state
        .session_items()
        .iter()
        .find(|item| item.session_id == "live-hook-check")
        .expect("session item");

    assert_eq!(session.agent_summary.as_deref(), Some("agent codex#4211"));
    assert_eq!(state.unmatched_agents().len(), 1);
    assert_eq!(state.unmatched_agents()[0].name, "Claude");
}

#[test]
fn run_filter_attention_keeps_unknown_review_bucket() {
    let mut state = sample_state();
    state.run_filter_mode = crate::ui::state::RunFilterMode::Attention;
    state.refresh_views();

    let runs = state.runs();
    assert!(runs.iter().any(|run| run.session_id == UNKNOWN_SESSION_ID));
    assert!(runs.iter().all(|run| {
        run.is_unknown_bucket
            || run.is_synthetic_agent_run
            || run.unknown_count > 0
            || matches!(
                run.status.as_str(),
                "idle" | "unknown" | "stopped" | "ended"
            )
    }));
}

#[test]
fn run_sort_by_name_orders_named_runs_alphabetically() {
    let mut state = sample_state();
    state.run_sort_mode = crate::ui::state::RunSortMode::Name;
    state.refresh_views();

    let runs = state.runs();
    assert_eq!(
        runs.first().map(|run| run.display_name.as_str()),
        Some("Fix harness monitor task journey")
    );
    assert_eq!(
        runs.get(1).map(|run| run.display_name.as_str()),
        Some("Review harness monitor UI")
    );
}

#[test]
fn unmatched_repo_local_agents_become_synthetic_runs() {
    let now = chrono::Utc::now().timestamp_millis();
    let mut state = RuntimeState::new("/tmp/project".to_string(), "main".to_string());
    state.last_refresh_at_ms = now;
    state.sync_dirty_files(vec![(
        "crates/harness-monitor/src/detect.rs".to_string(),
        "modify".to_string(),
        Some(now),
        EntryKind::File,
    )]);
    state.set_detected_agents(vec![
        DetectedAgent {
            key: "codex:5297".to_string(),
            name: "Codex".to_string(),
            vendor: "OpenAI".to_string(),
            icon: "◈".to_string(),
            pid: 5297,
            cwd: Some("/tmp/project".to_string()),
            cpu_percent: 0.0,
            mem_mb: 143.0,
            uptime_seconds: 1_000,
            status: "IDLE".to_string(),
            confidence: 75,
            project: "project".to_string(),
            command: "codex".to_string(),
        },
        DetectedAgent {
            key: "claude:19765".to_string(),
            name: "Claude".to_string(),
            vendor: "Anthropic".to_string(),
            icon: "◆".to_string(),
            pid: 19_765,
            cwd: Some("/tmp/project".to_string()),
            cpu_percent: 0.0,
            mem_mb: 274.0,
            uptime_seconds: 2_000,
            status: "IDLE".to_string(),
            confidence: 75,
            project: "project".to_string(),
            command: "claude".to_string(),
        },
    ]);

    let runs = state.runs();
    assert!(runs
        .iter()
        .any(|run| run.is_synthetic_agent_run && run.display_name == "Codex#5297"));
    assert!(runs
        .iter()
        .any(|run| run.is_synthetic_agent_run && run.display_name == "Claude#19765"));
    assert!(runs.iter().any(|run| run.session_id == UNKNOWN_SESSION_ID));
}

#[test]
fn agents_from_recovered_repo_alias_still_count_as_repo_local_runs() {
    let now = chrono::Utc::now().timestamp_millis();
    let mut state = RuntimeState::new("/Users/phodal/ai/routa-js".to_string(), "main".to_string());
    state.last_refresh_at_ms = now;
    state.set_detected_agents(vec![DetectedAgent {
        key: "codex:5297".to_string(),
        name: "Codex".to_string(),
        vendor: "OpenAI".to_string(),
        icon: "◈".to_string(),
        pid: 5297,
        cwd: Some("/Users/phodal/ai/routa-js-broken-20260411-205048".to_string()),
        cpu_percent: 0.0,
        mem_mb: 143.0,
        uptime_seconds: 1_000,
        status: "IDLE".to_string(),
        confidence: 75,
        project: "routa-js-broken-20260411-205048".to_string(),
        command: "codex --full-auto".to_string(),
    }]);

    let runs = state.runs();
    assert!(runs
        .iter()
        .any(|run| run.is_synthetic_agent_run && run.display_name == "Codex#5297"));
}

#[test]
fn file_list_remains_repo_scoped_when_run_selection_changes() {
    let mut state = sample_state();
    state.focus = FocusPane::Runs;

    assert_eq!(state.selected_workspace_scope_label(), "project");
    assert_eq!(state.selected_workspace_agent_count(), 1);
    assert_eq!(state.file_items().len(), 2);

    state.move_selection_down();
    assert_eq!(state.selected_workspace_scope_label(), "project");
    assert_eq!(state.file_items().len(), 2);
}

#[test]
fn ambiguous_agents_become_candidates_instead_of_false_matches() {
    let mut state = sample_state();
    state.set_detected_agents(vec![
        DetectedAgent {
            key: "codex:4211".to_string(),
            name: "Codex".to_string(),
            vendor: "OpenAI".to_string(),
            icon: "◈".to_string(),
            pid: 4211,
            cwd: Some("/tmp/project".to_string()),
            cpu_percent: 2.5,
            mem_mb: 128.0,
            uptime_seconds: 95,
            status: "ACTIVE".to_string(),
            confidence: 80,
            project: "project".to_string(),
            command: "codex --cwd /tmp/project".to_string(),
        },
        DetectedAgent {
            key: "codex:4212".to_string(),
            name: "Codex".to_string(),
            vendor: "OpenAI".to_string(),
            icon: "◈".to_string(),
            pid: 4212,
            cwd: Some("/tmp/project".to_string()),
            cpu_percent: 0.4,
            mem_mb: 64.0,
            uptime_seconds: 120,
            status: "IDLE".to_string(),
            confidence: 80,
            project: "project".to_string(),
            command: "codex --cwd /tmp/project".to_string(),
        },
    ]);
    state.refresh_views();

    let live = state
        .session_items()
        .iter()
        .find(|item| item.session_id == "live-hook-check")
        .expect("live session");
    let idle = state
        .session_items()
        .iter()
        .find(|item| item.session_id == "idle-review")
        .expect("idle session");

    assert_eq!(live.agent_summary.as_deref(), Some("candidates codex x2"));
    assert_eq!(idle.agent_summary.as_deref(), Some("candidates codex x2"));
    assert_eq!(state.unmatched_agents().len(), 2);
}

#[test]
fn detected_agent_stats_are_stored_on_runtime_state() {
    let state = sample_state();

    assert_eq!(state.agent_stats.total, 2);
    assert_eq!(state.agent_stats.active, 1);
    assert_eq!(state.agent_stats.idle, 1);
    assert!((state.agent_stats.total_mem_mb - 224.0).abs() < f32::EPSILON);
    assert_eq!(state.agent_stats.by_vendor.get("OpenAI"), Some(&1));
}
