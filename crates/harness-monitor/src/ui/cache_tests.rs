use super::{
    build_test_mapping_snapshot, detail_cache_key, display_status_code, facts_cache_key, fitness,
    load_diff_text, load_file_preview, read_test_mapping_history_record, test_mapping_cache_key,
    test_mapping_full_cache_key, test_mapping_history_path, AppCache, FileFactsEntry,
    FilePreviewScope, FitnessHistoryEntry, FitnessHistoryRecord, TestMappingAnalysisMode,
    TestMappingEntry, TestMappingHistoryRecord, FITNESS_HISTORY_FILE,
    FITNESS_HISTORY_SCHEMA_VERSION,
};
use crate::observe as repo;
use crate::shared::models::{
    AttributionConfidence, EntryKind, FileView, FitnessEvent, RuntimeMessage,
};
use crate::ui::state::{DetailMode, FocusPane, RuntimeState};
use std::collections::BTreeSet;
use tempfile::tempdir;

fn sample_runtime_state_with_dirty_file() -> RuntimeState {
    let mut state = RuntimeState::new("/tmp/project".to_string(), "main".to_string());
    state.set_branch_oid(Some("abc123".to_string()));
    state.files.insert(
        "src/lib.rs".to_string(),
        FileView {
            rel_path: "src/lib.rs".to_string(),
            dirty: true,
            state_code: "modify".to_string(),
            entry_kind: EntryKind::File,
            last_modified_at_ms: 1,
            last_session_id: None,
            last_task_id: None,
            confidence: AttributionConfidence::Unknown,
            conflicted: false,
            touched_by: BTreeSet::new(),
            recent_events: Vec::new(),
        },
    );
    state.refresh_views();
    state
}

#[test]
fn directory_entries_use_dir_status_label() {
    let file = FileView {
        rel_path: ".kiro/skills/developer-onboarding".to_string(),
        dirty: true,
        state_code: "untracked".to_string(),
        entry_kind: EntryKind::Directory,
        last_modified_at_ms: 0,
        last_session_id: None,
        last_task_id: None,
        confidence: AttributionConfidence::Unknown,
        conflicted: false,
        touched_by: BTreeSet::new(),
        recent_events: Vec::new(),
    };

    assert_eq!(display_status_code(&file), "DIR");
}

#[test]
fn submodule_entries_use_sub_status_label() {
    let file = FileView {
        rel_path: "tools/entrix".to_string(),
        dirty: true,
        state_code: "modify".to_string(),
        entry_kind: EntryKind::Submodule,
        last_modified_at_ms: 0,
        last_session_id: None,
        last_task_id: None,
        confidence: AttributionConfidence::Unknown,
        conflicted: false,
        touched_by: BTreeSet::new(),
        recent_events: Vec::new(),
    };

    assert_eq!(display_status_code(&file), "SUB");
}

#[test]
fn review_trigger_rules_surface_high_risk_hint_for_matching_file() {
    let dir = tempdir().expect("tempdir");
    std::fs::create_dir_all(dir.path().join("docs").join("fitness")).expect("fitness dir");
    std::fs::write(
        dir.path()
            .join("docs")
            .join("fitness")
            .join("review-triggers.yaml"),
        r#"
review_triggers:
  - name: high_risk_directory_change
    type: changed_paths
    paths:
      - crates/routa-server/src/api/**
    severity: high
    action: require_human_review
"#,
    )
    .expect("write review triggers");

    let cache = AppCache::new(&dir.path().to_string_lossy());
    let file = FileView {
        rel_path: "crates/routa-server/src/api/harness.rs".to_string(),
        dirty: true,
        state_code: "modify".to_string(),
        entry_kind: EntryKind::File,
        last_modified_at_ms: 0,
        last_session_id: None,
        last_task_id: None,
        confidence: AttributionConfidence::Unknown,
        conflicted: false,
        touched_by: BTreeSet::new(),
        recent_events: Vec::new(),
    };

    let hint = cache.review_hint(&file).expect("review hint");
    assert_eq!(hint.label, "HIGH");
    assert_eq!(hint.rule_name, "high_risk_directory_change");
}

#[test]
fn repo_review_hints_include_diff_size_trigger() {
    let dir = tempdir().expect("tempdir");
    std::fs::create_dir_all(dir.path().join("docs").join("fitness")).expect("fitness dir");
    std::fs::write(
        dir.path()
            .join("docs")
            .join("fitness")
            .join("review-triggers.yaml"),
        r#"
review_triggers:
  - name: oversized_change
    type: diff_size
    max_files: 1
    severity: medium
    action: require_human_review
"#,
    )
    .expect("write review triggers");

    let cache = AppCache::new(&dir.path().to_string_lossy());
    let files = vec![
        FileView {
            rel_path: "src/a.rs".to_string(),
            dirty: true,
            state_code: "modify".to_string(),
            entry_kind: EntryKind::File,
            last_modified_at_ms: 0,
            last_session_id: None,
            last_task_id: None,
            confidence: AttributionConfidence::Unknown,
            conflicted: false,
            touched_by: BTreeSet::new(),
            recent_events: Vec::new(),
        },
        FileView {
            rel_path: "src/b.rs".to_string(),
            dirty: true,
            state_code: "modify".to_string(),
            entry_kind: EntryKind::File,
            last_modified_at_ms: 0,
            last_session_id: None,
            last_task_id: None,
            confidence: AttributionConfidence::Unknown,
            conflicted: false,
            touched_by: BTreeSet::new(),
            recent_events: Vec::new(),
        },
    ];
    let refs = files.iter().collect::<Vec<_>>();

    let hints = cache.repo_review_hints(&refs);
    assert!(hints
        .iter()
        .any(|hint| hint.rule_name == "oversized_change"));
}

#[test]
fn repo_review_context_for_file_matches_cross_boundary_trigger() {
    let dir = tempdir().expect("tempdir");
    std::fs::create_dir_all(dir.path().join("docs").join("fitness")).expect("fitness dir");
    std::fs::write(
        dir.path()
            .join("docs")
            .join("fitness")
            .join("review-triggers.yaml"),
        r#"
review_triggers:
  - name: cross_boundary_change_web_rust
    type: cross_boundary_change
    boundaries:
      web:
        - src/**
      rust:
        - crates/**
    min_boundaries: 2
    severity: medium
    action: require_human_review
"#,
    )
    .expect("write review triggers");

    let cache = AppCache::new(&dir.path().to_string_lossy());
    let web_file = FileView {
        rel_path: "src/app/page.tsx".to_string(),
        dirty: true,
        state_code: "modify".to_string(),
        entry_kind: EntryKind::File,
        last_modified_at_ms: 0,
        last_session_id: None,
        last_task_id: None,
        confidence: AttributionConfidence::Unknown,
        conflicted: false,
        touched_by: BTreeSet::new(),
        recent_events: Vec::new(),
    };
    let rust_file = FileView {
        rel_path: "crates/routa-server/src/api/harness.rs".to_string(),
        dirty: true,
        state_code: "modify".to_string(),
        entry_kind: EntryKind::File,
        last_modified_at_ms: 0,
        last_session_id: None,
        last_task_id: None,
        confidence: AttributionConfidence::Unknown,
        conflicted: false,
        touched_by: BTreeSet::new(),
        recent_events: Vec::new(),
    };
    let files = vec![&web_file, &rust_file];

    let hints = cache.repo_review_context_for_file(&web_file, &files);
    assert!(hints
        .iter()
        .any(|hint| hint.rule_name == "cross_boundary_change_web_rust"));
}

#[test]
fn submodule_diff_preview_lists_nested_dirty_entries() {
    let dir = tempdir().expect("tempdir");
    let repo_root = dir.path();
    std::process::Command::new("git")
        .args(["init", "--no-bare"])
        .arg(repo_root)
        .output()
        .expect("init repo");

    let submodule_root = repo_root.join("tools").join("entrix");
    std::fs::create_dir_all(submodule_root.join("entrix").join("reporters"))
        .expect("create submodule dirs");
    std::process::Command::new("git")
        .args(["init", "--no-bare"])
        .arg(&submodule_root)
        .output()
        .expect("init submodule repo");
    std::process::Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("update-index")
        .arg("--add")
        .arg("--info-only")
        .arg("--cacheinfo")
        .arg("160000")
        .arg("a745c6f9664e4525be45e02582e7dc970158ec74")
        .arg("tools/entrix")
        .output()
        .expect("register gitlink");
    std::fs::write(
        submodule_root
            .join("entrix")
            .join("reporters")
            .join("terminal.py"),
        "print('dirty')\n",
    )
    .expect("write dirty file");

    let preview = load_diff_text(&repo_root.to_string_lossy(), "tools/entrix", "modify")
        .expect("load diff")
        .expect("preview text");

    assert!(preview.contains("Submodule: tools/entrix"));
    assert!(preview.contains("terminal.py"));
}

#[test]
fn head_file_preview_reads_only_first_hundred_lines() {
    let dir = tempdir().expect("tempdir");
    let repo_root = dir.path();
    std::fs::create_dir_all(repo_root.join("src")).expect("create src");
    let rel_path = "src/lib.rs";
    let content = (1..=150)
        .map(|index| format!("line {index}"))
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(repo_root.join(rel_path), content).expect("write test file");

    let (preview, truncated) = load_file_preview(
        &repo_root.to_string_lossy(),
        rel_path,
        FilePreviewScope::Head,
    )
    .expect("load preview")
    .expect("preview text");

    assert!(truncated);
    assert_eq!(preview.lines().count(), 100);
    assert!(preview.contains("line 100"));
    assert!(!preview.contains("line 101"));
}

#[test]
fn full_file_preview_reads_entire_file_content() {
    let dir = tempdir().expect("tempdir");
    let repo_root = dir.path();
    std::fs::create_dir_all(repo_root.join("src")).expect("create src");
    let rel_path = "src/lib.rs";
    let content = (1..=150)
        .map(|index| format!("line {index}"))
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(repo_root.join(rel_path), content).expect("write test file");

    let (preview, truncated) = load_file_preview(
        &repo_root.to_string_lossy(),
        rel_path,
        FilePreviewScope::Full,
    )
    .expect("load preview")
    .expect("preview text");

    assert!(!truncated);
    assert_eq!(preview.lines().count(), 150);
    assert!(preview.contains("line 150"));
}

#[test]
fn warm_selected_detail_promotes_scrolled_file_preview_to_full() {
    let dir = tempdir().expect("tempdir");
    let repo_root = dir.path().to_string_lossy().to_string();
    let mut state = RuntimeState::new(repo_root, "main".to_string());
    state.detail_mode = DetailMode::File;
    state.files.insert(
        "src/lib.rs".to_string(),
        FileView {
            rel_path: "src/lib.rs".to_string(),
            dirty: true,
            state_code: "modify".to_string(),
            entry_kind: EntryKind::File,
            last_modified_at_ms: 1,
            last_session_id: None,
            last_task_id: None,
            confidence: AttributionConfidence::Unknown,
            conflicted: false,
            touched_by: BTreeSet::new(),
            recent_events: Vec::new(),
        },
    );
    state.refresh_views();

    let mut cache = AppCache::new(&state.repo_root);
    let detail_key = detail_cache_key("src/lib.rs", "modify", 1, DetailMode::File);

    cache.warm_selected_detail(&state);
    assert_eq!(
        cache.pending_preview_request,
        Some((detail_key.clone(), FilePreviewScope::Head))
    );

    state.detail_scroll = 1;
    cache.warm_selected_detail(&state);
    assert_eq!(
        cache.pending_preview_request,
        Some((detail_key, FilePreviewScope::Full))
    );
}

#[test]
fn warm_selected_detail_does_not_request_git_history_outside_detail_focus() {
    let mut state = sample_runtime_state_with_dirty_file();
    state.focus = FocusPane::Files;
    let mut cache = AppCache::new(&state.repo_root);

    cache.warm_selected_detail(&state);

    assert_eq!(
        cache.pending_facts_key,
        Some(facts_cache_key("src/lib.rs", 1, EntryKind::File))
    );
    assert_eq!(cache.pending_git_history_key, None);
}

#[test]
fn warm_selected_detail_requests_git_history_once_detail_is_focused() {
    let mut state = sample_runtime_state_with_dirty_file();
    state.focus = FocusPane::Detail;
    let mut cache = AppCache::new(&state.repo_root);
    let facts_key = facts_cache_key("src/lib.rs", 1, EntryKind::File);
    cache.facts_cache.insert(
        facts_key.clone(),
        FileFactsEntry {
            key: facts_key.clone(),
            entry_kind: EntryKind::File,
            line_count: 12,
            byte_size: 120,
            child_count: None,
            git_change_count: None,
        },
    );

    cache.warm_selected_detail(&state);

    assert_eq!(cache.pending_git_history_key, Some(facts_key));
}

#[test]
fn app_cache_restores_fitness_history_on_startup() {
    let dir = tempdir().expect("tempdir");
    let repo_root = dir.path().to_string_lossy().to_string();
    let history_path = repo::runtime_event_path(std::path::Path::new(&repo_root))
        .parent()
        .expect("runtime directory")
        .join(FITNESS_HISTORY_FILE);
    std::fs::create_dir_all(history_path.parent().expect("runtime history parent"))
        .expect("create runtime history parent");
    let record = FitnessHistoryRecord {
        schema_version: FITNESS_HISTORY_SCHEMA_VERSION,
        histories: std::collections::BTreeMap::from([(
            "fast".to_string(),
            FitnessHistoryEntry {
                snapshot: Some(fitness::FitnessSnapshot {
                    mode: fitness::FitnessRunMode::Fast,
                    final_score: 88.5,
                    hard_gate_blocked: false,
                    score_blocked: false,
                    duration_ms: 1234.0,
                    metric_count: 10,
                    coverage_metric_available: false,
                    coverage_summary: fitness::CoverageSummary::default(),
                    dimensions: vec![],
                    slowest_metrics: vec![],
                    artifact_path: None,
                    producer: Some("harness-monitor".to_string()),
                    generated_at_ms: Some(12_345),
                    base_ref: Some("origin/main".to_string()),
                    changed_file_count: 1,
                    changed_files_preview: vec!["foo.rs".to_string()],
                    failing_metrics: vec![],
                }),
                trend: vec![88.5, 89.0],
                last_run_ms: Some(12_345),
                last_error: Some("cached error".to_string()),
                cache_key: Some("mode=fast;branch=main;ahead=0;files=foo.rs:modify:1".to_string()),
            },
        )]),
        snapshot: None,
        trend: vec![],
        last_run_ms: None,
        last_error: None,
        cache_key: None,
    };
    let payload = serde_json::to_vec_pretty(&record).expect("serialize history");
    std::fs::write(&history_path, payload).expect("write history");

    let cache = AppCache::new(&repo_root);
    assert!(cache.has_fitness_data());
    assert_eq!(cache.fitness_last_run_ms(), Some(12_345));
    assert_eq!(
        cache.fitness_snapshot().expect("snapshot").final_score,
        88.5
    );
    assert_eq!(cache.fitness_trend(), &[88.5, 89.0]);
}

#[test]
fn app_cache_prefers_mailbox_artifact_before_local_rerun() {
    let dir = tempdir().expect("tempdir");
    let repo_root = dir.path().to_string_lossy().to_string();
    let artifact_dir = repo::runtime_fitness_artifact_dir(std::path::Path::new(&repo_root));
    let mailbox_dir = repo::runtime_fitness_mailbox_dir(std::path::Path::new(&repo_root));
    std::fs::create_dir_all(&artifact_dir).expect("create artifact dir");
    std::fs::create_dir_all(&mailbox_dir).expect("create mailbox dir");

    let artifact_path = artifact_dir.join("123-fast.json");
    std::fs::write(
        &artifact_path,
        serde_json::to_vec_pretty(&fitness::FitnessSnapshot {
            mode: fitness::FitnessRunMode::Fast,
            final_score: 93.0,
            hard_gate_blocked: false,
            score_blocked: false,
            duration_ms: 2100.0,
            metric_count: 7,
            coverage_metric_available: false,
            coverage_summary: fitness::CoverageSummary::default(),
            dimensions: vec![],
            slowest_metrics: vec![],
            artifact_path: Some(artifact_path.to_string_lossy().to_string()),
            producer: Some("entrix".to_string()),
            generated_at_ms: Some(123),
            base_ref: Some("origin/main".to_string()),
            changed_file_count: 2,
            changed_files_preview: vec!["src/lib.rs".to_string()],
            failing_metrics: vec![],
        })
        .expect("serialize artifact"),
    )
    .expect("write artifact");
    let mailbox_message = RuntimeMessage::Fitness(FitnessEvent {
        repo_root: repo_root.clone(),
        observed_at_ms: 123,
        mode: "fast".to_string(),
        status: "passed".to_string(),
        final_score: Some(93.0),
        hard_gate_blocked: Some(false),
        score_blocked: Some(false),
        duration_ms: Some(2100.0),
        dimension_count: Some(0),
        metric_count: Some(7),
        artifact_path: Some(artifact_path.to_string_lossy().to_string()),
    });
    std::fs::write(
        mailbox_dir.join("123-fast.json"),
        serde_json::to_vec_pretty(&mailbox_message).expect("serialize mailbox message"),
    )
    .expect("write mailbox message");

    let mut cache = AppCache::new(&repo_root);
    cache.request_fitness_refresh(
        repo_root.clone(),
        "mode=fast;branch=main;ahead=0;files=".to_string(),
        false,
        fitness::FitnessRunMode::Fast,
    );

    let snapshot = cache.fitness_snapshot().expect("mailbox snapshot");
    assert_eq!(snapshot.final_score, 93.0);
    assert_eq!(
        snapshot.artifact_path.as_deref(),
        Some(artifact_path.to_string_lossy().as_ref())
    );
    assert_eq!(cache.fitness_trend(), &[93.0]);
    assert!(!cache.is_fitness_running());
}

#[test]
fn app_cache_does_not_start_local_run_without_force() {
    let state = sample_runtime_state_with_dirty_file();
    let mut cache = AppCache::new(&state.repo_root);

    cache.request_fitness_refresh(
        state.repo_root.clone(),
        "mode=fast;branch=main;ahead=0;files=src/lib.rs:modify:1".to_string(),
        false,
        fitness::FitnessRunMode::Fast,
    );

    assert!(!cache.is_fitness_running());
    assert!(cache.fitness_snapshot().is_none());
}

#[test]
fn app_cache_ignores_duplicate_idle_force_refresh_within_debounce_window() {
    let state = sample_runtime_state_with_dirty_file();
    let mut cache = AppCache::new(&state.repo_root);
    let cache_key = "mode=fast;branch=main;ahead=0;files=src/lib.rs:modify:1".to_string();

    cache.active_fitness_history_mut().cache_key = Some(cache_key.clone());
    cache.sync_cache_key_from_active_mode();
    cache.fitness_last_triggered_ms = Some(chrono::Utc::now().timestamp_millis());

    cache.request_fitness_refresh(
        state.repo_root.clone(),
        cache_key,
        true,
        fitness::FitnessRunMode::Fast,
    );

    assert!(!cache.is_fitness_running());
    assert!(!cache.pending_fitness);
    assert!(cache.queued_fitness_refresh.is_none());
}

#[test]
fn app_cache_starts_new_force_refresh_for_new_cache_key_within_debounce_window() {
    let state = sample_runtime_state_with_dirty_file();
    let mut cache = AppCache::new(&state.repo_root);

    cache.active_fitness_history_mut().cache_key = Some("mode=fast;branch=main;ahead=0;files=".to_string());
    cache.sync_cache_key_from_active_mode();
    cache.fitness_last_triggered_ms = Some(chrono::Utc::now().timestamp_millis());

    cache.request_fitness_refresh(
        state.repo_root.clone(),
        "mode=fast;branch=main;ahead=1;files=src/lib.rs:modify:2".to_string(),
        true,
        fitness::FitnessRunMode::Fast,
    );

    assert!(cache.is_fitness_running());
    assert!(cache.pending_fitness);
    assert_eq!(
        cache.fitness_cache_key.as_deref(),
        Some("mode=fast;branch=main;ahead=1;files=src/lib.rs:modify:2")
    );
}

#[test]
fn warm_test_mappings_waits_for_startup_delay() {
    let state = sample_runtime_state_with_dirty_file();
    let mut cache = AppCache::new(&state.repo_root);

    cache.warm_test_mappings(&state);

    assert!(cache.pending_test_mapping_fast_key.is_none());
    assert!(cache.pending_test_mapping_full_key.is_none());
}

#[test]
fn store_test_mapping_full_snapshot_persists_history_record() {
    let dir = tempdir().expect("tempdir");
    let repo_root = dir.path().to_string_lossy().to_string();
    let mut cache = AppCache::new(&repo_root);
    let cache_key = "src/lib.rs:modify:1".to_string();
    let full_cache_key = "head=abc123;files=src/lib.rs:modify:1".to_string();
    let snapshot = build_test_mapping_snapshot(
        cache_key,
        TestMappingAnalysisMode::Full,
        vec![TestMappingEntry {
            source_file: "src/lib.rs".to_string(),
            language: "rust".to_string(),
            status: "changed".to_string(),
            related_test_files: vec!["tests/lib_test.rs".to_string()],
            graph_test_files: Vec::new(),
            resolver_kind: "hybrid_heuristic".to_string(),
            confidence: "high".to_string(),
            has_inline_tests: false,
        }],
        Vec::new(),
    );

    cache.store_test_mapping_full_snapshot(Some(full_cache_key.clone()), 123, snapshot);

    let record = read_test_mapping_history_record(&repo_root).expect("history record");
    assert_eq!(record.schema_version, 1);
    assert_eq!(
        record
            .histories
            .get(&full_cache_key)
            .and_then(|entry| entry.observed_at_ms),
        Some(123)
    );
    assert_eq!(
        record
            .histories
            .get(&full_cache_key)
            .and_then(|entry| entry.snapshot.as_ref())
            .map(|snapshot| snapshot.analysis_mode),
        Some(TestMappingAnalysisMode::Full)
    );
}

#[test]
fn warm_test_mappings_prefers_persisted_full_snapshot() {
    let dir = tempdir().expect("tempdir");
    let repo_root = dir.path().to_string_lossy().to_string();
    let mut state = RuntimeState::new(repo_root.clone(), "main".to_string());
    state.set_branch_oid(Some("persisted-head".to_string()));
    state.files.insert(
        "src/lib.rs".to_string(),
        FileView {
            rel_path: "src/lib.rs".to_string(),
            dirty: true,
            state_code: "modify".to_string(),
            entry_kind: EntryKind::File,
            last_modified_at_ms: 1,
            last_session_id: None,
            last_task_id: None,
            confidence: AttributionConfidence::Unknown,
            conflicted: false,
            touched_by: BTreeSet::new(),
            recent_events: Vec::new(),
        },
    );
    state.refresh_views();
    let cache_key = test_mapping_cache_key(&state);
    let full_cache_key = test_mapping_full_cache_key(&state).expect("full cache key");
    let history_path = test_mapping_history_path(&repo_root).expect("history path");
    std::fs::create_dir_all(history_path.parent().expect("history parent")).expect("create dir");
    std::fs::write(
        &history_path,
        serde_json::to_vec_pretty(&TestMappingHistoryRecord {
            schema_version: 1,
            histories: [(
                full_cache_key,
                super::TestMappingHistoryEntry {
                    snapshot: Some(build_test_mapping_snapshot(
                        cache_key.clone(),
                        TestMappingAnalysisMode::Full,
                        vec![TestMappingEntry {
                            source_file: "src/lib.rs".to_string(),
                            language: "rust".to_string(),
                            status: "changed".to_string(),
                            related_test_files: vec!["tests/lib_test.rs".to_string()],
                            graph_test_files: Vec::new(),
                            resolver_kind: "hybrid_heuristic".to_string(),
                            confidence: "high".to_string(),
                            has_inline_tests: false,
                        }],
                        Vec::new(),
                    )),
                    observed_at_ms: Some(456),
                },
            )]
            .into_iter()
            .collect(),
        })
        .expect("serialize history"),
    )
    .expect("write history");

    let mut cache = AppCache::new(&repo_root);
    cache.test_mapping_not_before_ms = None;
    cache.warm_test_mappings(&state);

    assert_eq!(
        cache.test_mapping_analysis_mode(),
        Some(TestMappingAnalysisMode::Full)
    );
    assert!(cache.pending_test_mapping_fast_key.is_none());
    assert!(cache.pending_test_mapping_full_key.is_none());
}

#[test]
fn warm_test_mappings_respects_retry_backoff() {
    let state = sample_runtime_state_with_dirty_file();
    let mut cache = AppCache::new(&state.repo_root);
    cache.test_mapping_not_before_ms = Some(chrono::Utc::now().timestamp_millis() + 30_000);

    cache.warm_test_mappings(&state);

    assert!(cache.pending_test_mapping_fast_key.is_none());
    assert!(cache.pending_test_mapping_full_key.is_none());
}

#[test]
fn warm_test_mappings_requests_fast_snapshot_first() {
    let state = sample_runtime_state_with_dirty_file();
    let mut cache = AppCache::new(&state.repo_root);
    cache.test_mapping_not_before_ms = None;

    cache.warm_test_mappings(&state);

    assert_eq!(
        cache.pending_test_mapping_fast_key.as_deref(),
        Some(test_mapping_cache_key(&state).as_str())
    );
    assert!(cache.pending_test_mapping_full_key.is_none());
}

#[test]
fn warm_test_mappings_enqueues_full_refresh_after_fast_snapshot() {
    let state = sample_runtime_state_with_dirty_file();
    let mut cache = AppCache::new(&state.repo_root);
    let cache_key = test_mapping_cache_key(&state);
    cache.test_mapping_not_before_ms = None;
    cache.set_test_mapping_snapshot_for_tests(
        cache_key.clone(),
        TestMappingAnalysisMode::Fast,
        vec![TestMappingEntry {
            source_file: "src/lib.rs".to_string(),
            language: "rust".to_string(),
            status: "changed".to_string(),
            related_test_files: vec!["tests/lib_test.rs".to_string()],
            graph_test_files: Vec::new(),
            resolver_kind: "path_heuristic".to_string(),
            confidence: "medium".to_string(),
            has_inline_tests: false,
        }],
        Vec::new(),
    );

    cache.warm_test_mappings(&state);

    assert_eq!(
        cache.pending_test_mapping_full_key.as_deref(),
        Some(cache_key.as_str())
    );
    assert!(cache.pending_test_mapping_fast_key.is_none());
}

#[test]
fn warm_test_mappings_skips_full_refresh_when_dirty_set_exceeds_budget() {
    let mut state = RuntimeState::new("/tmp/project".to_string(), "main".to_string());
    state.set_branch_oid(Some("budget-head".to_string()));
    for idx in 0..13 {
        let rel_path = format!("src/file_{idx}.rs");
        state.files.insert(
            rel_path.clone(),
            FileView {
                rel_path,
                dirty: true,
                state_code: "modify".to_string(),
                entry_kind: EntryKind::File,
                last_modified_at_ms: idx,
                last_session_id: None,
                last_task_id: None,
                confidence: AttributionConfidence::Unknown,
                conflicted: false,
                touched_by: BTreeSet::new(),
                recent_events: Vec::new(),
            },
        );
    }
    state.refresh_views();

    let mut cache = AppCache::new(&state.repo_root);
    cache.test_mapping_not_before_ms = None;
    cache.set_test_mapping_snapshot_for_tests(
        test_mapping_cache_key(&state),
        TestMappingAnalysisMode::Fast,
        vec![TestMappingEntry {
            source_file: "src/file_0.rs".to_string(),
            language: "rust".to_string(),
            status: "changed".to_string(),
            related_test_files: vec!["tests/file_0_test.rs".to_string()],
            graph_test_files: Vec::new(),
            resolver_kind: "path_heuristic".to_string(),
            confidence: "medium".to_string(),
            has_inline_tests: false,
        }],
        Vec::new(),
    );

    cache.warm_test_mappings(&state);

    assert!(cache.pending_test_mapping_full_key.is_none());
    assert_eq!(
        cache.test_mapping_graph_enrichment_note(),
        Some("graph refresh skipped: 13 dirty files exceeds budget 12")
    );
}
