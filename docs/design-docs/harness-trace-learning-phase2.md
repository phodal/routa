---
title: Harness Trace Learning Phase 2
---

# Harness Trace Learning - Phase 2: Runtime Integration

**Status**: In Development  
**Created**: 2026-04-06  
**Related**: #294, #342, #343, #345

## Overview

Phase 2 implements **runtime playbook loading and preflight guidance**, allowing harness evolution to use learned strategies during execution.

## Goals

1. Load relevant playbooks at harness evolve startup
2. Display preflight guidance to users
3. Reorder patches based on learned strategies
4. Show provenance for transparency

## Architecture

### 1. Playbook Loading

**Function**: `load_playbooks_for_task(repo_root, task_type)`

```rust
pub fn load_playbooks_for_task(
    repo_root: &Path,
    task_type: &str,
) -> Result<Vec<PlaybookCandidate>, String> {
    let playbook_dir = repo_root.join("docs/fitness/playbooks");
    
    if !playbook_dir.exists() {
        return Ok(Vec::new());
    }
    
    // Read all .json files
    // Filter by task_type
    // Sort by confidence (descending)
    // Return top N (e.g., 3)
}
```

### 2. Gap Pattern Matching

**Function**: `find_matching_playbook(playbooks, gaps)`

```rust
pub fn find_matching_playbook<'a>(
    playbooks: &'a [PlaybookCandidate],
    gaps: &[HarnessEngineeringGap],
) -> Option<&'a PlaybookCandidate> {
    // Extract gap categories from current run
    let current_categories: Vec<String> = gaps
        .iter()
        .map(|g| g.category.clone())
        .collect();
    
    // Find exact match
    playbooks.iter().find(|pb| {
        pb.strategy.gap_patterns == current_categories
    })
    
    // Or find best partial match
}
```

### 3. Preflight Guidance Display

```rust
fn display_preflight_guidance(
    playbook: &PlaybookCandidate,
    options: &HarnessEngineeringOptions,
) {
    if options.json_output {
        return; // Skip in JSON mode
    }
    
    println!("🧠 Loaded learned playbook (confidence: {:.0}%)", playbook.confidence * 100.0);
    println!("  ID: {}", playbook.id);
    println!("  Evidence: {} successful runs", playbook.provenance.evidence_count);
    println!();
    println!("💡 Recommended patch order:");
    for (idx, patch_id) in playbook.strategy.preferred_patch_order.iter().enumerate() {
        println!("  {}. {}", idx + 1, patch_id);
    }
    
    if !playbook.strategy.anti_patterns.is_empty() {
        println!();
        println!("⚠️  Known issues:");
        for anti in &playbook.strategy.anti_patterns {
            println!("  - {}: {}", anti.do_not, anti.reason);
        }
    }
    
    println!();
}
```

### 4. Patch Reordering

**Function**: `reorder_patches_by_playbook(patches, playbook)`

```rust
pub fn reorder_patches_by_playbook(
    patches: &mut Vec<HarnessEngineeringPatchCandidate>,
    playbook: &PlaybookCandidate,
) {
    // Create priority map from playbook order
    let priority_map: HashMap<String, usize> = playbook
        .strategy
        .preferred_patch_order
        .iter()
        .enumerate()
        .map(|(idx, id)| (id.clone(), idx))
        .collect();
    
    // Sort patches by:
    // 1. Patches in playbook order (by priority)
    // 2. Patches not in playbook (original order)
    patches.sort_by_key(|patch| {
        priority_map.get(&patch.id).copied().unwrap_or(usize::MAX)
    });
}
```

## Integration Points

### In `evaluate_harness_engineering()`

```rust
pub async fn evaluate_harness_engineering(
    repo_root: &Path,
    options: &HarnessEngineeringOptions,
    state: Option<&AppState>,
) -> Result<HarnessEngineeringReport, String> {
    // ... existing gap detection ...
    
    // NEW: Load playbooks
    let playbooks = learning::load_playbooks_for_task(repo_root, "harness_evolution")?;
    
    // NEW: Find matching playbook
    let matching_playbook = playbooks
        .iter()
        .find(|pb| {
            let mut sorted_pattern = pb.strategy.gap_patterns.clone();
            sorted_pattern.sort();
            let mut current_categories: Vec<String> = gaps
                .iter()
                .map(|g| g.category.clone())
                .collect();
            current_categories.sort();
            sorted_pattern == current_categories
        });
    
    // ... existing patch generation ...
    
    // NEW: Reorder patches if playbook found
    if let Some(playbook) = matching_playbook {
        learning::display_preflight_guidance(playbook, options);
        learning::reorder_patches_by_playbook(&mut patch_candidates, playbook);
    }
    
    // ... rest of execution ...
}
```

## User Experience

### Before (Phase 1)

```bash
$ routa harness evolve --apply

📊 Harness Evolution - Evaluation
  Found 2 gaps...
  Generated 2 patches...
  
✅ Applied 2 patches
```

### After (Phase 2)

```bash
$ routa harness evolve --apply

🧠 Loaded learned playbook (confidence: 95%)
  ID: harness-evolution-missing-governance
  Evidence: 3 successful runs

💡 Recommended patch order:
  1. patch.create_codeowners
  2. patch.create_dependabot

📊 Harness Evolution - Evaluation
  Found 2 gaps...
  Generated 2 patches (reordered by playbook)...
  
✅ Applied 2 patches
```

## Opt-Out Mechanism

Users can disable playbook loading:

```bash
# Disable playbook loading
routa harness evolve --apply --no-playbooks

# Or via environment variable
NO_PLAYBOOKS=1 routa harness evolve --apply
```

## Testing Strategy

### Unit Tests

1. `test_load_playbooks_for_task` - Load from directory
2. `test_find_matching_playbook` - Gap pattern matching
3. `test_reorder_patches_by_playbook` - Patch sorting

### Integration Tests

1. Create playbook + run evolve → verify patch order
2. Multiple playbooks → verify best match selected
3. No matching playbook → verify no reordering

## Implementation Plan

### Step 1: Playbook Loading (1 hour)
- [ ] Implement `load_playbooks_for_task()`
- [ ] Add unit tests
- [ ] Handle missing playbook directory gracefully

### Step 2: Pattern Matching (1 hour)
- [ ] Implement `find_matching_playbook()`
- [ ] Add fuzzy matching (partial overlap)
- [ ] Add unit tests

### Step 3: Preflight Guidance (1 hour)
- [ ] Implement `display_preflight_guidance()`
- [ ] Format output nicely
- [ ] Skip in JSON mode

### Step 4: Patch Reordering (1 hour)
- [ ] Implement `reorder_patches_by_playbook()`
- [ ] Preserve patches not in playbook
- [ ] Add unit tests

### Step 5: Integration (2 hours)
- [ ] Wire up in `evaluate_harness_engineering()`
- [ ] Add integration tests
- [ ] Test with real playbooks

### Step 6: Polish (1 hour)
- [ ] Add `--no-playbooks` flag
- [ ] Update help text
- [ ] Update documentation

**Total Estimate**: 7 hours (1 day)

## Success Criteria

1. ✅ Playbooks loaded automatically when present
2. ✅ Matching playbook selected based on gap patterns
3. ✅ Preflight guidance displayed to user
4. ✅ Patches reordered according to learned strategy
5. ✅ Users can opt-out if desired
6. ✅ All tests passing
7. ✅ Documentation updated

## Next Steps (Phase 3)

- Playbook staleness detection (expire after 30 days)
- Cross-repo playbook sharing
- Playbook approval workflow
- Guardrail promotion (playbook → fitness rule)
