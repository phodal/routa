//! Tests for trace learning functionality

use super::learning::*;
use std::fs;
use tempfile::TempDir;

#[test]
fn test_load_evolution_history() {
    let temp_dir = TempDir::new().unwrap();
    let repo_root = temp_dir.path();

    // Create history file
    let history_dir = repo_root.join("docs/fitness/evolution");
    fs::create_dir_all(&history_dir).unwrap();

    let history_content = r#"{"timestamp":"2026-04-06T01:00:00Z","repo_root":"/test","mode":"auto-apply","task_type":"harness_evolution","workflow":"bootstrap","trigger":"manual","gaps_detected":1,"gap_categories":["missing_execution_surface"],"changed_paths":["build.yml"],"patches_applied":["patch.A"],"patches_failed":[],"success_rate":1.0}
{"timestamp":"2026-04-06T02:00:00Z","repo_root":"/test","mode":"auto-apply","task_type":"harness_evolution","workflow":"bootstrap","trigger":"manual","gaps_detected":1,"gap_categories":["missing_execution_surface"],"changed_paths":["build.yml"],"patches_applied":["patch.A"],"patches_failed":[],"success_rate":1.0}
{"timestamp":"2026-04-06T03:00:00Z","repo_root":"/test","mode":"auto-apply","task_type":"harness_evolution","workflow":"bootstrap","trigger":"manual","gaps_detected":1,"gap_categories":["missing_execution_surface"],"changed_paths":["build.yml"],"patches_applied":["patch.A"],"patches_failed":[],"success_rate":1.0}
"#;

    fs::write(history_dir.join("history.jsonl"), history_content).unwrap();

    // Load history
    let history = load_evolution_history(repo_root).unwrap();

    assert_eq!(history.len(), 3);
    assert_eq!(history[0].patches_applied, vec!["patch.A"]);
    assert_eq!(history[0].success_rate, 1.0);
}

#[test]
fn test_detect_common_patterns() {
    let temp_dir = TempDir::new().unwrap();
    let repo_root = temp_dir.path();

    // Create history with repeated pattern
    let history_dir = repo_root.join("docs/fitness/evolution");
    fs::create_dir_all(&history_dir).unwrap();

    let history_content = r#"{"timestamp":"2026-04-06T01:00:00Z","repo_root":"/test","mode":"auto-apply","task_type":"harness_evolution","gaps_detected":2,"gap_categories":["missing_automation","missing_execution_surface"],"patches_applied":["patch.A","patch.B"],"patches_failed":[],"success_rate":1.0}
{"timestamp":"2026-04-06T02:00:00Z","repo_root":"/test","mode":"auto-apply","task_type":"harness_evolution","gaps_detected":2,"gap_categories":["missing_automation","missing_execution_surface"],"patches_applied":["patch.A","patch.B"],"patches_failed":[],"success_rate":1.0}
{"timestamp":"2026-04-06T03:00:00Z","repo_root":"/test","mode":"auto-apply","task_type":"harness_evolution","gaps_detected":2,"gap_categories":["missing_automation","missing_execution_surface"],"patches_applied":["patch.A","patch.B"],"patches_failed":[],"success_rate":1.0}
"#;

    fs::write(history_dir.join("history.jsonl"), history_content).unwrap();

    let history = load_evolution_history(repo_root).unwrap();
    let patterns = detect_common_patterns(&history, 0.8);

    assert_eq!(patterns.len(), 1);
    assert_eq!(patterns[0].occurrence_count, 3);
    assert_eq!(patterns[0].gap_categories.len(), 2);
    assert_eq!(
        patterns[0].preferred_patch_order,
        vec!["patch.A", "patch.B"]
    );
}

#[test]
fn test_generate_playbook_candidates() {
    let temp_dir = TempDir::new().unwrap();
    let repo_root = temp_dir.path();

    // Create history
    let history_dir = repo_root.join("docs/fitness/evolution");
    fs::create_dir_all(&history_dir).unwrap();

    let history_content = r#"{"timestamp":"2026-04-06T01:00:00Z","repo_root":"/test","mode":"auto-apply","task_type":"harness_evolution","gaps_detected":1,"gap_categories":["missing_governance_gate"],"patches_applied":["patch.create_codeowners"],"patches_failed":[],"success_rate":1.0}
{"timestamp":"2026-04-06T02:00:00Z","repo_root":"/test","mode":"auto-apply","task_type":"harness_evolution","gaps_detected":1,"gap_categories":["missing_governance_gate"],"patches_applied":["patch.create_codeowners"],"patches_failed":[],"success_rate":1.0}
{"timestamp":"2026-04-06T03:00:00Z","repo_root":"/test","mode":"auto-apply","task_type":"harness_evolution","gaps_detected":1,"gap_categories":["missing_governance_gate"],"patches_applied":["patch.create_codeowners"],"patches_failed":[],"success_rate":1.0}
"#;

    fs::write(history_dir.join("history.jsonl"), history_content).unwrap();

    let history = load_evolution_history(repo_root).unwrap();
    let patterns = detect_common_patterns(&history, 0.8);
    let playbooks = generate_playbook_candidates(repo_root, &patterns).unwrap();

    assert_eq!(playbooks.len(), 1);
    assert_eq!(playbooks[0].task_type, "harness_evolution");
    assert_eq!(playbooks[0].confidence, 1.0);
    assert_eq!(playbooks[0].provenance.evidence_count, 3);
    assert_eq!(
        playbooks[0].strategy.preferred_patch_order,
        vec!["patch.create_codeowners"]
    );
}

#[test]
fn test_save_playbook() {
    let temp_dir = TempDir::new().unwrap();
    let repo_root = temp_dir.path();

    use super::learning::{PlaybookCandidate, PlaybookProvenance, PlaybookStrategy};

    let playbook = PlaybookCandidate {
        id: "test-playbook".to_string(),
        task_type: "harness_evolution".to_string(),
        confidence: 0.95,
        strategy: PlaybookStrategy {
            preferred_patch_order: vec!["patch.A".to_string()],
            gap_patterns: vec!["missing_automation".to_string()],
            anti_patterns: vec![],
        },
        provenance: PlaybookProvenance {
            source_runs: vec!["2026-04-06T01:00:00Z".to_string()],
            success_rate: 0.95,
            evidence_count: 3,
        },
    };

    save_playbook(repo_root, &playbook).unwrap();

    let playbook_file = repo_root.join("docs/fitness/playbooks/test-playbook.json");
    assert!(playbook_file.exists());

    let content = fs::read_to_string(playbook_file).unwrap();
    assert!(content.contains("test-playbook"));
    assert!(content.contains("harness_evolution"));
}

#[test]
fn test_load_playbooks_for_task() {
    let temp_dir = TempDir::new().unwrap();
    let repo_root = temp_dir.path();

    // Create playbook directory
    let playbook_dir = repo_root.join("docs/fitness/playbooks");
    fs::create_dir_all(&playbook_dir).unwrap();

    // Save a playbook
    let playbook_json = r#"{
        "id": "test-playbook",
        "taskType": "harness_evolution",
        "confidence": 0.95,
        "strategy": {
            "preferredPatchOrder": ["patch.A"],
            "gapPatterns": ["missing_automation"],
            "antiPatterns": []
        },
        "provenance": {
            "sourceRuns": ["2026-04-06T01:00:00Z"],
            "successRate": 0.95,
            "evidenceCount": 3
        }
    }"#;

    fs::write(playbook_dir.join("test-playbook.json"), playbook_json).unwrap();

    // Load playbooks
    let playbooks = load_playbooks_for_task(repo_root, "harness_evolution").unwrap();

    assert_eq!(playbooks.len(), 1);
    assert_eq!(playbooks[0].id, "test-playbook");
    assert_eq!(playbooks[0].confidence, 0.95);
}

#[test]
fn test_find_matching_playbook() {
    use super::learning::{
        find_matching_playbook, PlaybookCandidate, PlaybookProvenance, PlaybookStrategy,
    };
    use super::HarnessEngineeringGap;

    let playbooks = vec![PlaybookCandidate {
        id: "playbook-1".to_string(),
        task_type: "harness_evolution".to_string(),
        confidence: 0.95,
        strategy: PlaybookStrategy {
            preferred_patch_order: vec![],
            gap_patterns: vec!["missing_automation".to_string()],
            anti_patterns: vec![],
        },
        provenance: PlaybookProvenance {
            source_runs: vec![],
            success_rate: 0.95,
            evidence_count: 3,
        },
    }];

    let gaps = vec![HarnessEngineeringGap {
        id: "gap-1".to_string(),
        category: "missing_automation".to_string(),
        severity: "medium".to_string(),
        title: "Test Gap".to_string(),
        detail: "test detail".to_string(),
        evidence: vec![],
        suggested_fix: "test fix".to_string(),
        harness_mutation_candidate: true,
    }];

    let matched = find_matching_playbook(&playbooks, &gaps);
    assert!(matched.is_some());
    assert_eq!(matched.unwrap().id, "playbook-1");
}

#[test]
fn test_reorder_patches_by_playbook() {
    use super::learning::{
        reorder_patches_by_playbook, PlaybookCandidate, PlaybookProvenance, PlaybookStrategy,
    };
    use super::HarnessEngineeringPatchCandidate;

    let playbook = PlaybookCandidate {
        id: "test".to_string(),
        task_type: "harness_evolution".to_string(),
        confidence: 0.95,
        strategy: PlaybookStrategy {
            preferred_patch_order: vec!["patch.B".to_string(), "patch.A".to_string()],
            gap_patterns: vec![],
            anti_patterns: vec![],
        },
        provenance: PlaybookProvenance {
            source_runs: vec![],
            success_rate: 0.95,
            evidence_count: 3,
        },
    };

    let mut patches = vec![
        HarnessEngineeringPatchCandidate {
            id: "patch.A".to_string(),
            risk: "low".to_string(),
            title: "Patch A".to_string(),
            rationale: "Test A".to_string(),
            targets: vec![],
            change_kind: "create".to_string(),
            script_name: None,
            script_command: None,
        },
        HarnessEngineeringPatchCandidate {
            id: "patch.B".to_string(),
            risk: "low".to_string(),
            title: "Patch B".to_string(),
            rationale: "Test B".to_string(),
            targets: vec![],
            change_kind: "create".to_string(),
            script_name: None,
            script_command: None,
        },
    ];

    reorder_patches_by_playbook(&mut patches, &playbook);

    // Should be reordered: B, A
    assert_eq!(patches[0].id, "patch.B");
    assert_eq!(patches[1].id, "patch.A");
}

#[test]
fn test_fuzzy_matching_playbook() {
    use super::learning::{
        find_matching_playbook, PlaybookCandidate, PlaybookProvenance, PlaybookStrategy,
    };
    use super::HarnessEngineeringGap;

    // Playbook trained on 2 specific gaps
    let playbooks = vec![PlaybookCandidate {
        id: "playbook-1".to_string(),
        task_type: "harness_evolution".to_string(),
        confidence: 0.95,
        strategy: PlaybookStrategy {
            preferred_patch_order: vec![],
            gap_patterns: vec![
                "missing_automation".to_string(),
                "missing_governance_gate".to_string(),
            ],
            anti_patterns: vec![],
        },
        provenance: PlaybookProvenance {
            source_runs: vec![],
            success_rate: 0.95,
            evidence_count: 3,
        },
    }];

    // Current run has 3 gaps, 2 of which match the playbook (66% overlap)
    let gaps = vec![
        HarnessEngineeringGap {
            id: "gap-1".to_string(),
            category: "missing_automation".to_string(),
            severity: "medium".to_string(),
            title: "Test Gap 1".to_string(),
            detail: "test detail 1".to_string(),
            evidence: vec![],
            suggested_fix: "test fix 1".to_string(),
            harness_mutation_candidate: true,
        },
        HarnessEngineeringGap {
            id: "gap-2".to_string(),
            category: "missing_governance_gate".to_string(),
            severity: "medium".to_string(),
            title: "Test Gap 2".to_string(),
            detail: "test detail 2".to_string(),
            evidence: vec![],
            suggested_fix: "test fix 2".to_string(),
            harness_mutation_candidate: true,
        },
        HarnessEngineeringGap {
            id: "gap-3".to_string(),
            category: "missing_execution_surface".to_string(),
            severity: "medium".to_string(),
            title: "Test Gap 3".to_string(),
            detail: "test detail 3".to_string(),
            evidence: vec![],
            suggested_fix: "test fix 3".to_string(),
            harness_mutation_candidate: true,
        },
    ];

    // Should still match because overlap is >= 50%
    let matched = find_matching_playbook(&playbooks, &gaps);
    assert!(matched.is_some());
    assert_eq!(matched.unwrap().id, "playbook-1");
}

#[test]
fn test_no_match_when_overlap_too_low() {
    use super::learning::{
        find_matching_playbook, PlaybookCandidate, PlaybookProvenance, PlaybookStrategy,
    };
    use super::HarnessEngineeringGap;

    let playbooks = vec![PlaybookCandidate {
        id: "playbook-1".to_string(),
        task_type: "harness_evolution".to_string(),
        confidence: 0.95,
        strategy: PlaybookStrategy {
            preferred_patch_order: vec![],
            gap_patterns: vec!["missing_automation".to_string()],
            anti_patterns: vec![],
        },
        provenance: PlaybookProvenance {
            source_runs: vec![],
            success_rate: 0.95,
            evidence_count: 3,
        },
    }];

    // Current run has 3 gaps, only 1 matches (33% overlap, below 50% threshold)
    let gaps = vec![
        HarnessEngineeringGap {
            id: "gap-1".to_string(),
            category: "missing_automation".to_string(),
            severity: "medium".to_string(),
            title: "Test Gap 1".to_string(),
            detail: "test detail 1".to_string(),
            evidence: vec![],
            suggested_fix: "test fix 1".to_string(),
            harness_mutation_candidate: true,
        },
        HarnessEngineeringGap {
            id: "gap-2".to_string(),
            category: "missing_execution_surface".to_string(),
            severity: "medium".to_string(),
            title: "Test Gap 2".to_string(),
            detail: "test detail 2".to_string(),
            evidence: vec![],
            suggested_fix: "test fix 2".to_string(),
            harness_mutation_candidate: true,
        },
        HarnessEngineeringGap {
            id: "gap-3".to_string(),
            category: "missing_governance_gate".to_string(),
            severity: "medium".to_string(),
            title: "Test Gap 3".to_string(),
            detail: "test detail 3".to_string(),
            evidence: vec![],
            suggested_fix: "test fix 3".to_string(),
            harness_mutation_candidate: true,
        },
    ];

    // Should NOT match because overlap < 50%
    let matched = find_matching_playbook(&playbooks, &gaps);
    assert!(matched.is_none());
}
