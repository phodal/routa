use super::{
    display_status_code, fitness, load_diff_text, AppCache, FitnessHistoryEntry,
    FitnessHistoryRecord, FITNESS_HISTORY_FILE, FITNESS_HISTORY_SCHEMA_VERSION,
};
use crate::observe as repo;
use crate::shared::models::{
    AttributionConfidence, EntryKind, FileView, FitnessEvent, RuntimeMessage,
};
use crate::ui::state::RuntimeState;
use std::collections::BTreeSet;
use tempfile::tempdir;

fn sample_runtime_state_with_dirty_file() -> RuntimeState {
    let mut state = RuntimeState::new("/tmp/project".to_string(), "main".to_string());
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
        .arg("init")
        .arg(repo_root)
        .output()
        .expect("init repo");

    let submodule_root = repo_root.join("tools").join("entrix");
    std::fs::create_dir_all(submodule_root.join("entrix").join("reporters"))
        .expect("create submodule dirs");
    std::process::Command::new("git")
        .arg("init")
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
fn nested_submodule_file_diff_uses_submodule_repo() {
    let dir = tempdir().expect("tempdir");
    let repo_root = dir.path();
    std::process::Command::new("git")
        .arg("init")
        .arg(repo_root)
        .output()
        .expect("init repo");

    let submodule_root = repo_root.join("tools").join("entrix");
    std::fs::create_dir_all(submodule_root.join("entrix")).expect("create submodule dirs");
    std::process::Command::new("git")
        .arg("init")
        .arg(&submodule_root)
        .output()
        .expect("init submodule repo");
    std::process::Command::new("git")
        .arg("-C")
        .arg(&submodule_root)
        .arg("config")
        .arg("user.email")
        .arg("test@example.com")
        .output()
        .expect("config submodule email");
    std::process::Command::new("git")
        .arg("-C")
        .arg(&submodule_root)
        .arg("config")
        .arg("user.name")
        .arg("Test User")
        .output()
        .expect("config submodule name");

    let nested = submodule_root.join("entrix").join("cli.py");
    std::fs::write(&nested, "print('before')\n").expect("write initial file");
    std::process::Command::new("git")
        .arg("-C")
        .arg(&submodule_root)
        .arg("add")
        .arg(".")
        .output()
        .expect("stage submodule file");
    std::process::Command::new("git")
        .arg("-C")
        .arg(&submodule_root)
        .arg("commit")
        .arg("-m")
        .arg("init")
        .output()
        .expect("commit submodule file");

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

    std::fs::write(&nested, "print('after')\n").expect("modify nested file");

    let preview = load_diff_text(
        &repo_root.to_string_lossy(),
        "tools/entrix/entrix/cli.py",
        "modify",
    )
    .expect("load diff")
    .expect("preview text");

    assert!(preview.contains("--- a/entrix/cli.py"));
    assert!(preview.contains("+++ b/entrix/cli.py"));
    assert!(preview.contains("-print('before')"));
    assert!(preview.contains("+print('after')"));
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
fn warm_test_mappings_waits_for_startup_delay() {
    let state = sample_runtime_state_with_dirty_file();
    let mut cache = AppCache::new(&state.repo_root);

    cache.warm_test_mappings(&state);

    assert!(cache.pending_test_mapping_key.is_none());
}

#[test]
fn warm_test_mappings_respects_retry_backoff() {
    let state = sample_runtime_state_with_dirty_file();
    let mut cache = AppCache::new(&state.repo_root);
    cache.test_mapping_not_before_ms = Some(chrono::Utc::now().timestamp_millis() + 30_000);

    cache.warm_test_mappings(&state);

    assert!(cache.pending_test_mapping_key.is_none());
}
