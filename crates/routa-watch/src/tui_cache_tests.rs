use super::{
    display_status_code, fitness, AppCache, FitnessHistoryEntry, FitnessHistoryRecord,
    FITNESS_HISTORY_FILE, FITNESS_HISTORY_SCHEMA_VERSION,
};
use crate::models::{AttributionConfidence, EntryKind, FileView};
use crate::repo;
use std::collections::BTreeSet;
use tempfile::tempdir;

#[test]
fn directory_entries_use_dir_status_label() {
    let file = FileView {
        rel_path: ".kiro/skills/developer-onboarding".to_string(),
        dirty: true,
        state_code: "untracked".to_string(),
        entry_kind: EntryKind::Directory,
        last_modified_at_ms: 0,
        last_session_id: None,
        confidence: AttributionConfidence::Unknown,
        conflicted: false,
        touched_by: BTreeSet::new(),
        recent_events: Vec::new(),
    };

    assert_eq!(display_status_code(&file), "DIR");
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
                    dimensions: vec![],
                    slowest_metrics: vec![],
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
    assert_eq!(cache.fitness_snapshot().expect("snapshot").final_score, 88.5);
    assert_eq!(cache.fitness_trend(), &[88.5, 89.0]);
}
