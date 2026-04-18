use super::*;
use crate::feature_trace::SessionTraceMaterial;
use crate::observe::ipc::RuntimeFeed;
use crate::shared::models::{
    AttributionConfidence, DetectedAgent, EntryKind, EventLogEntry, EventSource, FileView,
    FitnessEvent, RuntimeMessage, RuntimeServiceInfo, SessionView, TaskView,
};
use crate::ui::state::{DetailMode, FocusPane, ThemeMode, ALL_RUNS_SESSION_ID, UNKNOWN_SESSION_ID};
use crate::ui::tui::highlight::highlight_code_text;
use pretty_assertions::assert_eq;
use ratatui::backend::TestBackend;
use ratatui::Terminal;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::process::Command;
use std::time::Duration;
use tempfile::tempdir;

fn sample_state() -> RuntimeState {
    let now = chrono::Utc::now().timestamp_millis();
    let mut sessions = BTreeMap::new();
    let live_task_id = "task:live-hook-check:turn-1".to_string();
    let idle_task_id = "task:idle-review:turn-2".to_string();
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
            active_task_id: Some(live_task_id.clone()),
            active_task_title: Some("Fix harness monitor task journey".to_string()),
            last_prompt_preview: Some("Fix harness monitor task journey".to_string()),
            active_task_recovered_from_transcript: false,
            recent_git_activity: vec!["commit: stabilize monitor journey".to_string()],
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
            active_task_id: Some(idle_task_id.clone()),
            active_task_title: Some("Review harness monitor UI".to_string()),
            last_prompt_preview: Some("Review harness monitor UI".to_string()),
            active_task_recovered_from_transcript: false,
            recent_git_activity: Vec::new(),
        },
    );

    let mut tasks = BTreeMap::new();
    tasks.insert(
        live_task_id.clone(),
        TaskView {
            task_id: live_task_id.clone(),
            session_id: "live-hook-check".to_string(),
            turn_id: Some("turn-1".to_string()),
            title: "Fix harness monitor task journey".to_string(),
            objective: "Fix harness monitor task journey".to_string(),
            prompt_preview: Some("Fix harness monitor task journey".to_string()),
            transcript_path: Some("/tmp/transcripts/impl-buddy.jsonl".to_string()),
            recovered_from_transcript: false,
            status: "active".to_string(),
            created_at_ms: now - 580_000,
            updated_at_ms: now - 180_000,
        },
    );
    tasks.insert(
        idle_task_id.clone(),
        TaskView {
            task_id: idle_task_id.clone(),
            session_id: "idle-review".to_string(),
            turn_id: Some("turn-2".to_string()),
            title: "Review harness monitor UI".to_string(),
            objective: "Review harness monitor UI".to_string(),
            prompt_preview: Some("Review harness monitor UI".to_string()),
            transcript_path: Some("/tmp/transcripts/test-master.jsonl".to_string()),
            recovered_from_transcript: false,
            status: "idle".to_string(),
            created_at_ms: now - 1_180_000,
            updated_at_ms: now - 3_600_000,
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
            last_task_id: Some(live_task_id.clone()),
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
    files.insert(
        "docs/design-docs/agentwatch-tui.md".to_string(),
        FileView {
            rel_path: "docs/design-docs/agentwatch-tui.md".to_string(),
            dirty: false,
            state_code: "clean".to_string(),
            entry_kind: EntryKind::File,
            last_modified_at_ms: now - 3_500_000,
            last_session_id: Some("idle-review".to_string()),
            last_task_id: Some(idle_task_id.clone()),
            confidence: AttributionConfidence::Exact,
            conflicted: false,
            touched_by: ["idle-review".to_string()].into_iter().collect(),
            recent_events: vec!["Read idle-review".to_string()],
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
    state.set_branch_oid(Some("abcdef".to_string()));
    state.tasks = tasks;
    state.task_change_paths.insert(
        live_task_id,
        ["crates/harness-monitor/src/tui.rs".to_string()]
            .into_iter()
            .collect(),
    );
    state.task_change_paths.insert(
        idle_task_id,
        ["docs/design-docs/agentwatch-tui.md".to_string()]
            .into_iter()
            .collect(),
    );
    state.task_git_activity.insert(
        "task:live-hook-check:turn-1".to_string(),
        vec!["commit: stabilize monitor journey".to_string()],
    );
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
    state.set_committed_change_summary(Some((38, 17)));
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
            truncated: false,
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
            truncated: false,
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
            artifact_path: None,
            producer: Some("harness-monitor".to_string()),
            generated_at_ms: Some(state.last_refresh_at_ms),
            base_ref: Some("origin/main".to_string()),
            changed_file_count: 2,
            changed_files_preview: vec![
                "crates/harness-monitor/src/tui.rs".to_string(),
                "src/app/api/a2a/card/route.ts".to_string(),
            ],
            failing_metrics: Vec::new(),
        },
    );
    cache.set_test_mapping_snapshot_for_tests(
        "test".to_string(),
        TestMappingAnalysisMode::Full,
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

fn seed_live_run_feature_trace(cache: &mut AppCache) {
    cache.set_session_feature_trace_for_tests(
        SessionTraceMaterial::new(
            "live-hook-check",
            vec!["crates/harness-monitor/src/tui.rs".to_string()],
            vec!["Write".to_string()],
        ),
        trace_parser::SessionAnalysis {
            session_id: "live-hook-check".to_string(),
            changed_files: vec!["crates/harness-monitor/src/tui.rs".to_string()],
            tool_call_counts: BTreeMap::from([("Write".to_string(), 1)]),
            prompt_previews: vec!["Inspect the feature explorer live hook output".to_string()],
            file_operation_counts: BTreeMap::from([("modified".to_string(), 1)]),
            surface_links: vec![trace_parser::FeatureSurfaceLink {
                kind: trace_parser::FeatureSurfaceKind::Page,
                route: "/workspace/:workspaceId/feature-explorer".to_string(),
                source_path: "src/app/workspace/[workspaceId]/feature-explorer/page.tsx"
                    .to_string(),
                via_path: "crates/harness-monitor/src/tui.rs".to_string(),
                confidence: trace_parser::SurfaceLinkConfidence::Medium,
            }],
            feature_links: vec![trace_parser::ProductFeatureLink {
                feature_id: "feature-explorer".to_string(),
                feature_name: "Feature Explorer".to_string(),
                route: Some("/workspace/:workspaceId/feature-explorer".to_string()),
                via_path: "crates/harness-monitor/src/tui.rs".to_string(),
                confidence: trace_parser::SurfaceLinkConfidence::Medium,
            }],
        },
    );
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

fn select_live_run(state: &mut RuntimeState) {
    state.focus = FocusPane::Runs;
    state.selected_run = state
        .runs()
        .iter()
        .position(|run| run.session_id == "live-hook-check")
        .expect("live run");
    state.refresh_views();
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

    assert_eq!(state.session_items().len(), 2);
    assert_eq!(state.session_items()[0].session_id, ALL_RUNS_SESSION_ID);
    assert_eq!(state.session_items()[1].session_id, UNKNOWN_SESSION_ID);
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
        artifact_path: None,
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
    select_live_run(&mut state);
    let mut cache = sample_cache(&state);
    seed_live_run_feature_trace(&mut cache);

    let snapshot = render_snapshot(&state, &mut cache, 180, 52);

    assert!(snapshot.contains("Fix harness monitor task journey"));
    assert!(snapshot.contains("State: active"));
    assert!(snapshot.contains("Approval: waiting_on_evidence"));
    assert!(snapshot.contains("Block: missing coverage_report"));
    assert!(snapshot.contains("Next: generate coverage evidence"));
    assert!(snapshot.contains("Evidence:"));
    assert!(snapshot.contains("Trace:"));
    assert!(snapshot.contains("Feature Explorer"));
    assert!(snapshot.contains("commit: stabilize monitor journey"));
}

#[test]
fn tui_snapshot_run_details_decision_first() {
    let mut state = sample_state();
    select_live_run(&mut state);
    let mut cache = sample_cache(&state);
    seed_live_run_feature_trace(&mut cache);

    insta::assert_snapshot!(
        "routa_watch_tui_run_details_decision_first",
        render_snapshot(&state, &mut cache, 180, 44)
    );
}

#[test]
fn file_detail_surfaces_test_mapping_context() {
    let state = sample_state();
    let mut cache = sample_cache(&state);

    let snapshot = render_snapshot(&state, &mut cache, 180, 40);

    assert!(snapshot.contains("Test mapping:"));
    assert!(snapshot.contains("changed") || snapshot.contains("missing"));
    assert!(snapshot.contains("Analysis:"));
    assert!(snapshot.contains("graph-aware"));
    assert!(snapshot.contains("TM "));
}

#[test]
fn file_detail_shows_fast_test_mapping_pending_graph_refresh() {
    let state = sample_state();
    let mut cache = sample_cache(&state);
    let cache_key = "test".to_string();
    cache.set_test_mapping_snapshot_for_tests(
        cache_key.clone(),
        TestMappingAnalysisMode::Fast,
        vec![TestMappingEntry {
            source_file: "crates/harness-monitor/src/tui.rs".to_string(),
            language: "rust".to_string(),
            status: "changed".to_string(),
            related_test_files: vec!["crates/harness-monitor/src/tui_tests.rs".to_string()],
            graph_test_files: Vec::new(),
            resolver_kind: "hybrid_heuristic".to_string(),
            confidence: "medium".to_string(),
            has_inline_tests: false,
        }],
        Vec::new(),
    );
    cache.set_test_mapping_graph_pending_for_tests(cache_key);

    let snapshot = render_snapshot(&state, &mut cache, 180, 40);

    assert!(snapshot.contains("fast heuristic"));
    assert!(snapshot.contains("graph refresh pending"));
}

#[test]
fn file_detail_shows_graph_refresh_budget_note() {
    let state = sample_state();
    let mut cache = sample_cache(&state);
    cache.set_test_mapping_snapshot_for_tests(
        "test".to_string(),
        TestMappingAnalysisMode::Fast,
        vec![TestMappingEntry {
            source_file: "crates/harness-monitor/src/tui.rs".to_string(),
            language: "rust".to_string(),
            status: "changed".to_string(),
            related_test_files: vec!["crates/harness-monitor/src/tui_tests.rs".to_string()],
            graph_test_files: Vec::new(),
            resolver_kind: "hybrid_heuristic".to_string(),
            confidence: "medium".to_string(),
            has_inline_tests: false,
        }],
        Vec::new(),
    );
    cache.set_test_mapping_graph_note_for_tests(
        "graph refresh skipped: 17 dirty files exceeds budget 12".to_string(),
    );

    let snapshot = render_snapshot(&state, &mut cache, 180, 40);

    assert!(snapshot.contains("fast heuristic"));
    assert!(snapshot.contains("graph refresh skipped"));
    assert!(snapshot.contains("budget 12"));
}

#[test]
fn selecting_prompt_session_scopes_files_to_prompt_changes() {
    let mut state = sample_state();
    state.selected_run = state
        .runs()
        .iter()
        .position(|run| run.session_id == "live-hook-check")
        .expect("live run");
    state.refresh_views();

    assert_eq!(state.prompt_sessions().len(), 2);
    assert_eq!(state.prompt_sessions()[0].primary_label(), "All prompts");
    assert_eq!(
        state.prompt_sessions()[1].primary_label(),
        "Fix harness monitor task journey"
    );

    state.selected_prompt_session = 1;
    state.refresh_views();

    let files = state.file_items();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].rel_path, "crates/harness-monitor/src/tui.rs");

    let mut cache = sample_cache(&state);
    let header = render_file_header_line(&state, &cache, 120).to_string();
    assert!(header.contains("committed") || header.contains("dirty"));
    assert!(header.contains("Fix harness monitor task journey"));

    let snapshot = render_snapshot(&state, &mut cache, 180, 28);
    assert!(snapshot.contains("Change Status"));
}

#[test]
fn hard_gate_failure_blocks_selected_run() {
    let mut state = sample_state();
    select_live_run(&mut state);
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
                metrics: vec![
                    fitness::FitnessMetricSummary {
                        name: "lint_pass".to_string(),
                        passed: false,
                        state: "fail".to_string(),
                        hard_gate: true,
                        duration_ms: 450.0,
                        output_excerpt: Some("src/ui/tui.rs: unexpected warning".to_string()),
                    },
                    fitness::FitnessMetricSummary {
                        name: "file_line_limit".to_string(),
                        passed: false,
                        state: "fail".to_string(),
                        hard_gate: false,
                        duration_ms: 380.0,
                        output_excerpt: Some(
                            "src/ui/render.rs exceeds file size budget".to_string(),
                        ),
                    },
                    fitness::FitnessMetricSummary {
                        name: "ts_typecheck_pass".to_string(),
                        passed: true,
                        state: "pass".to_string(),
                        hard_gate: false,
                        duration_ms: 240.0,
                        output_excerpt: None,
                    },
                ],
            }],
            slowest_metrics: Vec::new(),
            artifact_path: None,
            producer: Some("harness-monitor".to_string()),
            generated_at_ms: Some(chrono::Utc::now().timestamp_millis()),
            base_ref: Some("origin/main".to_string()),
            changed_file_count: 1,
            changed_files_preview: vec!["crates/harness-monitor/src/tui.rs".to_string()],
            failing_metrics: vec![fitness::FitnessMetricSummary {
                name: "lint_pass".to_string(),
                passed: false,
                state: "fail".to_string(),
                hard_gate: true,
                duration_ms: 450.0,
                output_excerpt: Some("src/ui/tui.rs: unexpected warning".to_string()),
            }],
        },
    );

    let snapshot = render_snapshot(&state, &mut cache, 180, 52);

    assert!(snapshot.contains("State: blocked"));
    assert!(snapshot.contains("Block: hard gate failure"));
    assert!(snapshot.contains("Next: fix failing hard gates and rerun fast eval"));
    assert!(snapshot.contains("Eval: fast blocked(hard) 62.0%"));
    assert!(snapshot.contains("2 failures"));
    assert!(snapshot.contains("lint_pass"));
    assert!(snapshot.contains("src/ui/tui.rs: unexpected warning"));
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
            hard_gate_blocked: true,
            score_blocked: false,
            duration_ms: 1000.0,
            metric_count: 4,
            coverage_metric_available: false,
            coverage_summary: fitness::CoverageSummary::default(),
            dimensions: Vec::new(),
            slowest_metrics: Vec::new(),
            artifact_path: None,
            producer: Some("harness-monitor".to_string()),
            generated_at_ms: Some(now),
            base_ref: None,
            changed_file_count: 0,
            changed_files_preview: Vec::new(),
            failing_metrics: Vec::new(),
        },
    );
    let snapshot = render_snapshot(&state, &mut cache, 180, 40);

    assert!(snapshot.contains("process-scan"));
    assert!(snapshot.contains("State: observing"));
    assert!(!snapshot.contains("failed"));
}

#[test]
fn semantic_run_status_prefers_recovered_and_attention_labels() {
    let now = chrono::Utc::now().timestamp_millis();
    let mut state = sample_state();
    state.sessions.insert(
        "recovered-run".to_string(),
        SessionView {
            session_id: "recovered-run".to_string(),
            display_name: Some("transcript-recovered".to_string()),
            cwd: "/tmp/project".to_string(),
            model: Some("gpt-5.4".to_string()),
            client: "codex".to_string(),
            transcript_path: Some("/tmp/transcripts/recovered-run.jsonl".to_string()),
            source: Some("transcript".to_string()),
            started_at_ms: now - 300_000,
            last_seen_at_ms: now - 30_000,
            status: "active".to_string(),
            tmux_pane: None,
            touched_files: BTreeSet::new(),
            last_turn_id: Some("turn-r".to_string()),
            last_event_name: Some("PostToolUse".to_string()),
            last_tool_name: Some("Write".to_string()),
            active_task_id: Some("task:recovered-run:turn-r".to_string()),
            active_task_title: Some("Recovered task".to_string()),
            last_prompt_preview: Some("Recovered task".to_string()),
            active_task_recovered_from_transcript: true,
            recent_git_activity: Vec::new(),
        },
    );
    state.refresh_views();
    let cache = sample_cache(&state);

    let recovered = state
        .runs()
        .iter()
        .find(|run| run.session_id == "recovered-run")
        .expect("recovered run");
    let recovered_model = build_run_operator_model(&state, &cache, recovered);
    assert_eq!(
        semantic_run_status(recovered, &recovered_model),
        "recovered"
    );

    let review = state
        .runs()
        .iter()
        .find(|run| run.session_id == UNKNOWN_SESSION_ID)
        .expect("review bucket");
    let review_model = build_run_operator_model(&state, &cache, review);
    assert_eq!(semantic_run_status(review, &review_model), "attention");
}

#[test]
fn run_details_surface_recent_transcript_prompts_and_compact_meta() {
    let dir = tempdir().expect("tempdir");
    let transcript = dir.path().join("session.jsonl");
    std::fs::write(
        &transcript,
        concat!(
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn-1\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"first prompt\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn-1\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn-2\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"second prompt\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn-2\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn-3\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"third prompt\"}}\n"
        ),
    )
    .expect("write transcript");

    let mut state = sample_state();
    let session = state
        .sessions
        .get_mut("live-hook-check")
        .expect("live session");
    session.transcript_path = Some(transcript.to_string_lossy().to_string());
    session.active_task_title = Some("third prompt".to_string());
    session.last_prompt_preview = Some("third prompt".to_string());
    session.active_task_recovered_from_transcript = true;
    select_live_run(&mut state);
    state.refresh_views();

    let mut cache = sample_cache(&state);
    let snapshot = render_snapshot(&state, &mut cache, 180, 52);

    assert!(snapshot.contains("Context: codex"));
    assert!(snapshot.contains("transcript"));
    assert!(snapshot.contains("Journey: first prompt  ->  second prompt  ->  third prompt"));
    assert!(snapshot.contains("Recent: second prompt  |  first prompt"));
}

#[test]
fn run_details_surface_auggie_session_prompts_and_session_label() {
    let dir = tempdir().expect("tempdir");
    let session_path = dir.path().join("session.json");
    std::fs::write(
        &session_path,
        r#"{
  "sessionId":"sess-1",
  "chatHistory":[
    {"sequenceId":1,"exchange":{"request_message":"first session prompt"}},
    {"sequenceId":2,"exchange":{"request_message":"second session prompt"}},
    {"sequenceId":3,"exchange":{"request_message":"third session prompt"}}
  ]
}"#,
    )
    .expect("write session");

    let mut state = sample_state();
    let session = state
        .sessions
        .get_mut("live-hook-check")
        .expect("live session");
    session.client = "auggie".to_string();
    session.model = Some("claude-sonnet-4".to_string());
    session.source = Some("auggie-session".to_string());
    session.transcript_path = Some(session_path.to_string_lossy().to_string());
    session.active_task_title = Some("third session prompt".to_string());
    session.last_prompt_preview = Some("third session prompt".to_string());
    session.active_task_recovered_from_transcript = true;
    select_live_run(&mut state);
    state.refresh_views();

    let mut cache = sample_cache(&state);
    let snapshot = render_snapshot(&state, &mut cache, 180, 52);

    assert!(snapshot.contains("Context: auggie"));
    assert!(snapshot.contains("session"));
    assert!(snapshot.contains(
        "Journey: first session prompt  ->  second session prompt  ->  third session prompt"
    ));
    assert!(snapshot.contains("Recent: second session prompt  |  first session prompt"));
}

#[test]
fn summary_mode_compacts_long_git_status_paths_without_wrapping() {
    let mut state = sample_state();
    let now = chrono::Utc::now().timestamp_millis();
    state.files.insert(
        "crates/harness-monitor/src/ui/snapshots/harness_monitor__ui__tui__tests__routa_watch_tui_full_runs.snap".to_string(),
        FileView {
            rel_path: "crates/harness-monitor/src/ui/snapshots/harness_monitor__ui__tui__tests__routa_watch_tui_full_runs.snap".to_string(),
            dirty: true,
            state_code: "modify".to_string(),
            entry_kind: EntryKind::File,
            last_modified_at_ms: now - 60_000,
            last_session_id: None,
            last_task_id: None,
            confidence: AttributionConfidence::Unknown,
            conflicted: false,
            touched_by: BTreeSet::new(),
            recent_events: vec!["watch modify".to_string()],
        },
    );
    state.selected_file = 2;
    state.refresh_views();
    let mut cache = sample_cache(&state);

    let snapshot = render_snapshot(&state, &mut cache, 120, 28);

    assert!(snapshot.contains("routa_watch_tui_full_runs.snap"));
    assert!(snapshot.contains(".snap"));
    assert!(!snapshot
        .contains("crates/harness-monitor/src/ui/snapshots/harness_monitor__ui__tui__tests__"));
}

#[test]
fn snapshot_files_are_treated_as_changed_test_files() {
    let mut state = sample_state();
    let now = chrono::Utc::now().timestamp_millis();
    state.files.insert(
        "crates/harness-monitor/src/ui/snapshots/example.snap".to_string(),
        FileView {
            rel_path: "crates/harness-monitor/src/ui/snapshots/example.snap".to_string(),
            dirty: true,
            state_code: "modify".to_string(),
            entry_kind: EntryKind::File,
            last_modified_at_ms: now - 60_000,
            last_session_id: None,
            last_task_id: None,
            confidence: AttributionConfidence::Unknown,
            conflicted: false,
            touched_by: BTreeSet::new(),
            recent_events: vec!["watch modify".to_string()],
        },
    );
    state.selected_file = state
        .files
        .keys()
        .position(|path| path == "crates/harness-monitor/src/ui/snapshots/example.snap")
        .expect("snapshot file index");
    state.refresh_views();
    let mut cache = sample_cache(&state);

    let file = state.selected_file().expect("selected file");
    assert!(cache.is_changed_test_file(file));

    let snapshot = render_snapshot(&state, &mut cache, 180, 32);
    assert!(snapshot.contains("Test mapping: changed test file"));
}

#[test]
fn tui_snapshot_search_mode() {
    let mut state = sample_state();
    state.search_query = "route.ts".to_string();
    state.search_active = true;
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
fn git_status_title_keeps_total_summary_without_dirty_diff() {
    let mut state = sample_state();
    state.files.clear();
    state.set_committed_change_summary(Some((7432, 1461)));
    state.refresh_views();
    let cache = AppCache::new(&state.repo_root);
    let line = render_file_panel_title(&state, &cache, "Git Status", 120, palette(ThemeMode::Dark));
    let text = line
        .spans
        .iter()
        .map(|span| span.content.as_ref())
        .collect::<String>();

    assert!(text.contains("Git Status"));
    assert!(text.contains("Total: +7432 -1461"));
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
fn parse_repo_status_reads_branch_and_ahead_count() {
    let status = parse_repo_status(
        "# branch.oid abcdef\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +7 -2\n",
    );

    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(status.branch_oid.as_deref(), Some("abcdef"));
    assert_eq!(status.upstream.as_deref(), Some("origin/main"));
    assert_eq!(status.ahead_count, Some(7));
    assert_eq!(status.committed_change_summary, None);
}

#[test]
fn parse_shortstat_reads_insertions_and_deletions() {
    assert_eq!(
        parse_shortstat(" 12 files changed, 211 insertions(+), 311 deletions(-)\n"),
        Some((211, 311))
    );
    assert_eq!(
        parse_shortstat(" 1 file changed, 7 insertions(+)\n"),
        Some((7, 0))
    );
    assert_eq!(
        parse_shortstat(" 1 file changed, 4 deletions(-)\n"),
        Some((0, 4))
    );
    assert_eq!(parse_shortstat(""), None);
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
fn runs_prefer_recent_prompt_preview_as_primary_label() {
    let mut state = sample_state();
    let session = state
        .sessions
        .get_mut("live-hook-check")
        .expect("live session");
    session.display_name = Some("impl-buddy".to_string());
    session.active_task_title = Some("Task title summary".to_string());
    session.last_prompt_preview = Some(
        "show the latest user input in Runs so file changes align after selection".to_string(),
    );
    state.refresh_views();

    let run = state
        .runs()
        .iter()
        .find(|run| run.session_id == "live-hook-check")
        .expect("run");

    assert_eq!(
        run.primary_label(),
        "show the latest user input in Runs so file changes align after selection"
    );
}

#[test]
fn changed_files_for_selected_run_prefer_active_task_id() {
    let now = chrono::Utc::now().timestamp_millis();
    let mut state = sample_state();
    state.files.insert(
        "crates/harness-monitor/src/legacy.rs".to_string(),
        FileView {
            rel_path: "crates/harness-monitor/src/legacy.rs".to_string(),
            dirty: true,
            state_code: "modify".to_string(),
            entry_kind: EntryKind::File,
            last_modified_at_ms: now - 60_000,
            last_session_id: Some("live-hook-check".to_string()),
            last_task_id: Some("task:live-hook-check:turn-0".to_string()),
            confidence: AttributionConfidence::Exact,
            conflicted: false,
            touched_by: ["live-hook-check".to_string()].into_iter().collect(),
            recent_events: vec!["Edit live-hook-check".to_string()],
        },
    );
    state.focus = FocusPane::Runs;
    state.refresh_views();
    let run = state
        .runs()
        .iter()
        .find(|run| run.session_id == "live-hook-check")
        .expect("live run");
    let cache = sample_cache(&state);

    let model = build_run_operator_model(&state, &cache, run);

    assert_eq!(
        model.changed_files,
        vec!["crates/harness-monitor/src/tui.rs".to_string()]
    );
    assert_eq!(
        model.journey_files,
        vec!["crates/harness-monitor/src/tui.rs".to_string()]
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

    assert_eq!(
        live.agent_summary.as_deref(),
        Some("agents codex#4211, codex#4212")
    );
    assert_eq!(state.unmatched_agents().len(), 0);
}

#[test]
fn default_runs_hide_stale_sessions_without_current_signal() {
    let state = sample_state();

    assert!(!state
        .session_items()
        .iter()
        .any(|item| item.session_id == "idle-review"));
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
