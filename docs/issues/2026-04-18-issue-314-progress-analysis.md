---
title: "Issue #314 Progress Analysis: Self-Bootstrapping Harness Engineering Agent"
date: "2026-04-18"
kind: verification_report
status: resolved
severity: low
area: "fitness"
tags: ["harness", "harness-engineering", "progress-analysis"]
reported_by: "agent"
github_issue: 314
github_state: "open"
github_url: "https://github.com/phodal/routa/issues/314"
resolution: "All 7 acceptance criteria fully implemented and verified. Issue can be closed."
---

# Issue #314 Progress Analysis

> **Date**: 2026-04-18
> **Issue**: [#314 Design a self-bootstrapping, fitness-driven Harness Engineering Agent](https://github.com/phodal/routa/issues/314)
> **Verdict**: ✅ All acceptance criteria met — ready to close

## Acceptance Criteria Status

### ✅ 1. A dedicated Harness Engineering Agent can read repo signals, fitness inputs, and harness surfaces together

**Implementation**: `crates/routa-cli/src/commands/harness/engineering/mod.rs`

- `evaluate_harness_engineering()` orchestrates the full loop
- Reads: repo signals (`detect_repo_signals()`), harness templates (`harness_template::doctor()`), automation wiring (`detect_repo_automations()`), spec sources (`detect_spec_sources()`), fluency snapshots (both `generic` and `agent_orchestrator` profiles), fitness rulebook (`docs/fitness/manifest.yaml`)
- Specialist definition: `resources/specialists/tools/harness-engineering-evolution.yaml`

### ✅ 2. The agent outputs structured gap classification instead of only raw suggestions

**Implementation**: `crates/routa-cli/src/commands/harness/engineering/mod.rs` + `types.rs`

- 6 structured gap categories: `missing_execution_surface`, `missing_verification_surface`, `missing_evidence`, `missing_automation`, `missing_governance_gate`, `non_harness_engineering_gap`
- Classification functions: `classify_repo_signals()`, `classify_templates()`, `classify_automations()`, `classify_specs()`, `classify_fitness()`, `classify_fluency_blocker()`
- Output type: `HarnessEngineeringGap` with fields: `id`, `category`, `severity`, `title`, `detail`, `evidence`, `suggested_fix`, `harness_mutation_candidate`

### ✅ 3. The system distinguishes harness gaps from non-harness engineering gaps

**Implementation**: `classify_fluency_blocker()` heuristic

- Harness patterns (codeowners, dependabot, review-trigger, harness, automation, surface, entrypoint, fitness) → classified as harness mutation targets
- Non-harness patterns → classified as `non_harness_engineering_gap` with `harness_mutation_candidate: false`
- Summary tracks `non_harness_gaps` count separately

### ✅ 4. The agent can propose low-risk harness evolution steps in dry-run mode

**Implementation**: `build_patch_candidates()` + CLI `--dry-run` flag

- 7 patch types: build surface, test surface, harness template, codeowners, dependabot, coverage threshold, operational docs
- All classified as "low" or "medium" risk
- Default behavior: evaluation-first (dry-run)
- CLI: `routa harness evolve --dry-run --format json`

### ✅ 5. Proposed changes are followed by verification, not emitted blindly

**Implementation**: `apply.rs` + `ratchet.rs`

- Snapshot → Apply → Verify → Ratchet → Rollback (on failure)
- 4-step verification plan: harness engineering dry-run, surface detection, template drift doctor, fitness rulebook dry-run
- Ratchet enforcement: compares fluency baselines before/after, prevents regression
- Rollback safety: `rollback_snapshot()` restores original files on verification failure

### ✅ 6. Results are persisted as a report or snapshot for comparison over time

**Implementation**: `mod.rs` + `history.rs` + `learning.rs`

- Report: `docs/fitness/reports/harness-engineering-latest.json`
- Evolution history: `docs/fitness/evolution/history.jsonl` (8+ entries)
- Playbooks: `docs/fitness/playbooks/*.json` (auto-generated from 3+ successful runs)
- Trace learning: pattern extraction → playbook generation → runtime patch reordering

### ✅ 7. Documentation in docs/fitness/README.md or a related design doc explains the loop and boundaries

**Implementation**: Multiple locations

- `docs/fitness/README.md` lines 43-119: CLI quick start, harness engineering loop explanation, boundaries
- `docs/design-docs/harness-trace-learning-phase2.md`: Full architecture design doc (276 lines)
- `docs/issues/2026-04-06-issue-314-fixes-complete.md`: Implementation evidence

## Test Verification

All 19 harness engineering tests pass:

```
running 19 tests
test commands::harness::engineering::tests::bootstrap_detects_weak_repo ... ok
test commands::harness::engineering::tests::bootstrap_skips_repo_with_existing_harness ... ok
test commands::harness::engineering::tests::detects_fluency_automation_target_mismatch ... ok
test commands::harness::engineering::tests::classifies_fluency_blockers_into_harness_and_non_harness ... ok
test commands::harness::engineering::tests::rollback_snapshot_removes_newly_created_files ... ok
test commands::harness::engineering::tests::reports_missing_bootstrap_surfaces_for_weak_repo ... ok
test commands::harness::engineering::tests::verification_plan_executes_successfully ... ok
test commands::harness::engineering::tests_learning::test_detect_common_patterns ... ok
test commands::harness::engineering::tests_learning::test_find_matching_playbook ... ok
test commands::harness::engineering::tests_learning::test_fuzzy_matching_playbook ... ok
test commands::harness::engineering::tests_learning::test_generate_playbook_candidates ... ok
test commands::harness::engineering::tests_learning::test_load_evolution_history ... ok
test commands::harness::engineering::tests_learning::test_load_playbooks_for_task ... ok
test commands::harness::engineering::tests_learning::test_no_match_when_overlap_too_low ... ok
test commands::harness::engineering::tests_learning::test_reorder_patches_by_playbook ... ok
test commands::harness::engineering::tests_learning::test_save_playbook ... ok
test commands::harness::engineering::tests::verification_plan_reports_failures ... ok
test commands::harness::engineering::tests::apply_mode_rolls_back_when_ratchet_regresses ... ok
test commands::harness::engineering::tests::apply_mode_creates_harness_files ... ok

test result: ok. 19 passed; 0 failed; 0 ignored
```

## Phase Completion Summary

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Evaluation + Guided Evolution | ✅ Complete |
| Phase 2 | Bootstrap Mode | ✅ Complete |
| Phase 3 | Controlled Auto-Evolution | ✅ Complete |
| Phase 3.5 | Trace Learning (Playbooks) | ✅ Complete |

## Implementation Size

```
crates/routa-cli/src/commands/harness/engineering/
├── mod.rs              (1,308 lines) - Evaluation, classification, recommendations
├── types.rs            (302 lines)   - Type definitions
├── apply.rs            (797 lines)   - Patch application, verification, rollback
├── ratchet.rs          (339 lines)   - Baseline comparison, regression prevention
├── bootstrap.rs        (274 lines)   - Weak repo detection, initial surface synthesis
├── learning.rs         (438 lines)   - Pattern extraction, playbook generation
├── history.rs          (232 lines)   - Evolution outcome recording
├── tests.rs            (461 lines)   - Core tests (11 cases)
└── tests_learning.rs   (377 lines)   - Learning tests (8 cases)
```

## Gaps Found: None

All 7 acceptance criteria are fully satisfied. The implementation goes beyond the Phase 1 scope outlined in the issue, having also completed Phases 2 and 3.

## Recommendation

**Close Issue #314.** All acceptance criteria are met, tests pass, documentation is complete, and the full observe → evaluate → synthesize → verify → ratchet → learn loop is operational.
