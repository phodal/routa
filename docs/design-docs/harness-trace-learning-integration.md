# Harness Evolution + Trace Learning Integration

**Status**: Draft  
**Created**: 2026-04-06  
**Related Issues**: #294, #314, #315, #316

## Overview

This document outlines how to integrate **Trace Learning** (#294) with the existing **Harness Evolution Agent** (#315) to create a closed-loop self-improvement system.

## Current State (Post-#315)

### Harness Evolution Agent
- ✅ Records evolution outcomes to `docs/fitness/evolution/history.jsonl`
- ✅ Tracks `patches_applied`, `patches_failed`, `success_rate`
- ✅ 7 implemented patches with risk-based classification
- ✅ Snapshot/rollback safety mechanism
- ✅ Ratchet enforcement to prevent fitness regressions

### Existing Trace Structure
```jsonl
{"timestamp":"2026-04-06T01:29:43Z","repo_root":"/path/to/repo","mode":"apply","patches_applied":["patch.normalize_automation_target"],"patches_failed":[],"success_rate":1.0}
```

## Gap Analysis

### What We Have
1. ✅ Execution outcomes (success/failure)
2. ✅ Patch IDs and risk levels
3. ✅ Historical success rates
4. ⚠️  Minimal context (no task fingerprint, evidence bundle, or failure reasons)

### What We Need (from #294)
1. ❌ **Card fingerprint** (task type, repo scope, workflow)
2. ❌ **Evidence bundle** (changed paths, test results, fitness checks)
3. ❌ **Step sequence** (tool order, decision points)
4. ❌ **Failure details** (rollback reason, error messages)
5. ❌ **Learned playbooks** (distilled strategies)
6. ❌ **Runtime injection** (preflight guidance)

## Proposed Integration

### Phase 1: Enhanced Trace Schema (MVP)

#### 1.1 Extend `docs/fitness/evolution/history.jsonl`

```jsonl
{
  "timestamp": "2026-04-06T01:29:43Z",
  "repo_root": "/path/to/repo",
  "mode": "apply",
  
  // NEW: Task Context
  "task_fingerprint": {
    "task_type": "harness_evolution",
    "workflow": "weekly_maintenance",
    "trigger": "automation|manual|ci"
  },
  
  // NEW: Evidence Bundle
  "evidence": {
    "gaps_detected": 8,
    "gap_categories": ["missing_governance_gate", "missing_verification_surface"],
    "changed_paths": [".github/dependabot.yml", "docs/operational/"],
    "fitness_checks": {
      "clippy": "pass",
      "tests": "pass",
      "ratchet": "pass"
    }
  },
  
  // NEW: Execution Trace
  "execution_steps": [
    {"step": "evaluate", "duration_ms": 234, "gaps_found": 8},
    {"step": "generate_patches", "patches": 2, "low_risk": 2},
    {"step": "apply_patches", "applied": 2, "failed": 0},
    {"step": "verify", "ratchet_passed": true}
  ],
  
  // Existing fields
  "patches_applied": ["patch.create_dependabot", "patch.normalize_automation_target"],
  "patches_failed": [],
  "success_rate": 1.0,
  
  // NEW: Failure details (if any)
  "rollback_reason": null,
  "error_messages": []
}
```

#### 1.2 Create Playbook Candidates

After 3+ successful runs with the same pattern, generate:

**`docs/fitness/playbooks/harness-evolution-missing-governance.yaml`**
```yaml
id: harness-evolution-missing-governance
task_type: harness_evolution
confidence: high  # 3/3 runs succeeded
created_at: 2026-04-06T01:30:00Z
last_validated: 2026-04-06T01:30:00Z

strategy:
  preferred_patch_order:
    - patch.create_codeowners  # Apply governance before automation
    - patch.create_dependabot
    - patch.normalize_automation_target
  
  evidence_requirements:
    - fitness.manifest_present
    - fitness.clippy_pass
    - fitness.tests_pass
  
  anti_patterns:
    - do_not: "apply medium/high-risk patches without --force"
      reason: "May require manual review"
    - do_not: "skip ratchet enforcement"
      reason: "Can cause fitness regressions"

provenance:
  source_runs:
    - timestamp: "2026-04-06T01:28:30Z"
      success: false
      failure_reason: "patch not implemented"
    - timestamp: "2026-04-06T01:29:43Z"
      success: true
    - timestamp: "2026-04-06T02:15:22Z"
      success: true
  
  evidence_count: 3
  success_rate: 0.67  # 2/3 runs
```

### Phase 2: Runtime Preflight Injection

#### 2.1 Modify `evaluate_harness_engineering()`

```rust
pub async fn evaluate_harness_engineering(
    repo_root: &Path,
    options: &HarnessEngineeringOptions,
    state: Option<&AppState>,
) -> Result<HarnessEngineeringReport, String> {
    // NEW: Load learned playbooks
    let playbooks = load_playbooks_for_task(repo_root, "harness_evolution")?;
    
    if !playbooks.is_empty() {
        emit_preflight_guidance(options, &playbooks);
    }
    
    // Existing evaluation logic...
    let mut gaps = Vec::new();
    classify_fitness(repo_root, &fluency_snapshots, &mut gaps);
    
    // NEW: Apply learned strategies
    let mut patch_candidates = build_patch_candidates(repo_root, repo_signals.as_ref(), &gaps);
    if let Some(playbook) = playbooks.get(0) {
        reorder_patches_by_playbook(&mut patch_candidates, &playbook);
    }
    
    // Continue existing logic...
}
```

#### 2.2 Example Runtime Output

```bash
$ routa harness evolve --dry-run

🧠 Loaded 1 learned playbook (confidence: high)
  ✓ harness-evolution-missing-governance (validated 2 hours ago)
  
💡 Recommended patch order (from 3 similar runs):
  1. patch.create_codeowners
  2. patch.create_dependabot
  3. patch.normalize_automation_target
  
📊 Harness Evolution - Dry Run
  Found 8 gaps...
```

### Phase 3: Guardrail Promotion (V2)

Allow high-confidence playbooks to become executable fitness rules:

**`docs/fitness/rules/harness-governance-required.yaml`**
```yaml
# Promoted from playbook: harness-evolution-missing-governance
# Confidence: high (5/5 runs over 2 weeks)

rule: harness_governance_required
severity: error

check:
  - name: CODEOWNERS exists
    path: .github/CODEOWNERS
    required: true
  
  - name: Dependabot configured
    path: .github/dependabot.yml
    required: true

provenance:
  promoted_from: harness-evolution-missing-governance
  promoted_at: 2026-04-13T10:00:00Z
  approved_by: phodal
```

## Implementation Roadmap

### MVP (Week 1)
- [ ] Extend `EvolutionHistory` struct with `task_fingerprint`, `evidence`, `execution_steps`
- [ ] Modify `record_evolution_outcome()` to capture enriched trace
- [ ] Create `docs/fitness/playbooks/` directory structure
- [ ] Implement `generate_playbook_candidate()` (triggered after 3+ runs)

### V1 (Week 2-3)
- [ ] Implement `load_playbooks_for_task()`
- [ ] Add preflight guidance emission in `evaluate_harness_engineering()`
- [ ] Implement `reorder_patches_by_playbook()`
- [ ] Add playbook provenance UI/reporting

### V2 (Week 4+)
- [ ] Build guardrail promotion CLI (`routa fitness promote-playbook`)
- [ ] Integrate promoted playbooks into `entrix` checks
- [ ] Add playbook approval workflow
- [ ] Cross-repo playbook sharing

## Benefits

1. **Reduced Manual Tuning**: Common patterns automatically discovered
2. **Faster Convergence**: New repos benefit from learned strategies
3. **Traceable Improvements**: Every playbook links back to evidence
4. **Safe Automation**: Playbooks require validation before promotion
5. **Closed Loop**: run → evidence → playbook → runtime → guardrail

## Open Questions

1. **Playbook Scope**: Should playbooks be repo-local or workspace-global?
2. **Confidence Threshold**: How many runs before generating a candidate? (Proposal: 3)
3. **Staleness**: How to expire outdated playbooks? (Proposal: 30 days without validation)
4. **Storage Format**: YAML vs JSONL? (Proposal: YAML for readability)
