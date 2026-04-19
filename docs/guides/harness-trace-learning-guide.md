---
title: Harness Trace Learning Guide
---

# Harness Trace Learning - User Guide

> **Learn from experience, evolve faster**: A practical guide to using Harness Evolution's self-learning capabilities.

## Quick Start

### 1. Generate Evolution History

Run harness evolution a few times to build learning data:

```bash
# Option A: Bootstrap mode (new repositories)
routa harness evolve --bootstrap --apply

# Option B: Regular evolution (existing harness)
routa harness evolve --apply
```

Each run appends a detailed record to `docs/fitness/evolution/history.jsonl`.

### 2. Generate Playbooks

After 3+ successful runs with similar gap patterns:

```bash
routa harness evolve --learn
```

**Expected output**:
```
📊 Harness Evolution - Learning Mode
  Loading evolution history...
  Found 5 evolution runs
  Detected 2 common patterns:
    - Gap pattern: ["missing_governance_gate"] (seen 3 times, avg success: 100.0%)
    - Gap pattern: ["missing_execution_surface"] (seen 4 times, avg success: 95.0%)
  Generated 2 playbook candidates:
    ✓ harness-evolution-missing-governance.json (confidence: 100.0%, evidence: 3 runs)
    ✓ harness-evolution-missing-execution-surface.json (confidence: 95.0%, evidence: 4 runs)

✅ Playbooks saved to docs/fitness/playbooks
```

### 3. Use Playbooks Automatically

Playbooks are loaded automatically in subsequent runs:

```bash
routa harness evolve --apply
```

**With playbook loaded**:
```
🧠 Loaded learned playbook (confidence: 95%, exact match)
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

## Understanding Evolution History

### What Gets Recorded

Every `routa harness evolve --apply` run records:

```json
{
  "timestamp": "2026-04-06T01:29:43Z",
  "sessionId": null,
  "taskType": "harness_evolution",
  "workflow": "bootstrap",
  "trigger": "manual",
  "gapsDetected": 2,
  "gapCategories": ["missing_governance_gate", "missing_execution_surface"],
  "changedPaths": [".github/CODEOWNERS", "docs/harness/build.yml"],
  "patchesApplied": ["patch.create_codeowners", "bootstrap.synthesize_build_yml"],
  "patchesFailed": [],
  "successRate": 1.0,
  "rollbackReason": null,
  "errorMessages": null
}
```

### Key Fields

- **`gapCategories`**: Which gaps were detected (used for pattern matching)
- **`patchesApplied`**: Which patches succeeded (used for learning patch order)
- **`successRate`**: 1.0 = all patches succeeded, 0.0 = all failed
- **`workflow`**: "bootstrap" | "auto-apply" | "evaluation"

### Storage

- **Path**: `docs/fitness/evolution/history.jsonl`
- **Format**: JSONL (one JSON object per line)
- **Committed**: Yes (recommended to track evolution over time)

## Understanding Playbooks

### Playbook Structure

```json
{
  "id": "harness-evolution-missing-governance",
  "taskType": "harness_evolution",
  "confidence": 0.95,
  "strategy": {
    "preferredPatchOrder": [
      "patch.create_codeowners",
      "patch.create_dependabot"
    ],
    "gapPatterns": ["missing_governance_gate"],
    "antiPatterns": [
      {
        "doNot": "skip ratchet enforcement",
        "reason": "Caused fitness regression in 2/5 runs"
      }
    ]
  },
  "provenance": {
    "sourceRuns": [
      "2026-04-06T01:29:43Z",
      "2026-04-06T02:15:22Z",
      "2026-04-07T10:30:15Z"
    ],
    "successRate": 0.95,
    "evidenceCount": 3
  }
}
```

### Key Concepts

**Strategy**:
- `preferredPatchOrder`: Apply patches in this order (learned from successful runs)
- `gapPatterns`: This playbook applies when these gap categories are detected
- `antiPatterns`: Things to avoid (learned from failed runs)

**Provenance**:
- `sourceRuns`: Timestamps of runs this playbook learned from
- `successRate`: Average success rate across source runs
- `evidenceCount`: Number of runs that contributed to this playbook

### Storage

- **Path**: `docs/fitness/playbooks/*.json`
- **Format**: JSON (one file per playbook)
- **Committed**: Recommended (shareable knowledge across team)

## Playbook Matching

### Exact Match (Preferred)

Playbook gap patterns **exactly match** current gaps:

```
Playbook:  ["missing_governance_gate", "missing_execution_surface"]
Current:   ["missing_governance_gate", "missing_execution_surface"]
Result:    Exact match ✓
```

### Fuzzy Match (Fallback)

Playbook has **>= 50% overlap** with current gaps:

```
Playbook:  ["missing_governance_gate", "missing_execution_surface"]
Current:   ["missing_governance_gate", "missing_execution_surface", "missing_automation"]
Overlap:   2/3 = 66% >= 50% ✓
Result:    Partial match ✓
```

### No Match

Overlap is **< 50%**:

```
Playbook:  ["missing_governance_gate"]
Current:   ["missing_execution_surface", "missing_automation", "missing_boundary"]
Overlap:   0/3 = 0% < 50% ✗
Result:    No match ✗
```

### Selection Algorithm

1. Try exact match first
2. If no exact match, calculate overlap for all playbooks
3. Filter candidates with overlap >= 50%
4. Select highest `weighted_score = overlap_ratio * confidence`
5. If no candidates, proceed without playbook

## Common Workflows

### Workflow 1: Bootstrap Multiple Repositories

**Scenario**: You're setting up harness for 5 similar repositories.

```bash
# Repository 1: Bootstrap and generate initial playbook
cd repo1
routa harness evolve --bootstrap --apply
cd ..

# Repository 2-3: Accumulate more data
cd repo2 && routa harness evolve --bootstrap --apply && cd ..
cd repo3 && routa harness evolve --bootstrap --apply && cd ..

# Generate playbook from 3 runs
cd repo1
routa harness evolve --learn
# ✓ harness-evolution-missing-execution-surface.json generated

# Copy playbook to other repos (or commit to shared location)
cp docs/fitness/playbooks/*.json ../repo4/docs/fitness/playbooks/
cp docs/fitness/playbooks/*.json ../repo5/docs/fitness/playbooks/

# Repository 4-5: Benefit from learned strategy
cd ../repo4 && routa harness evolve --bootstrap --apply
# 🧠 Loaded learned playbook (confidence: 100%, exact match)
# 💡 Recommended patch order: ...
```

### Workflow 2: Continuous Improvement

**Scenario**: Regular harness maintenance with learning.

```bash
# Week 1: Initial run
routa harness evolve --apply
# Recorded to history.jsonl (1 entry)

# Week 2: Another run
routa harness evolve --apply
# Recorded to history.jsonl (2 entries)

# Week 3: Third run
routa harness evolve --apply
# Recorded to history.jsonl (3 entries)

# Week 3: Generate playbook
routa harness evolve --learn
# ✓ Playbook generated from 3 successful runs

# Week 4+: Use learned strategy
routa harness evolve --apply
# 🧠 Loaded learned playbook (automatic)
```

### Workflow 3: Review and Refine

**Scenario**: Review generated playbooks before using.

```bash
# Generate playbooks
routa harness evolve --learn

# Review playbooks
cat docs/fitness/playbooks/*.json | jq

# Check provenance (which runs contributed?)
jq '.provenance.sourceRuns' docs/fitness/playbooks/*.json

# Check confidence
jq '.confidence' docs/fitness/playbooks/*.json

# If playbook looks good, commit it
git add docs/fitness/playbooks/
git commit -m "Add learned playbook for missing_governance pattern"

# If playbook needs adjustment, edit manually or delete
rm docs/fitness/playbooks/low-confidence-playbook.json
```

## Advanced Topics

### Manual Playbook Editing

Playbooks are JSON files and can be edited manually:

```bash
# Edit playbook
vim docs/fitness/playbooks/harness-evolution-missing-governance.json

# Add custom anti-pattern
{
  "doNot": "apply patches without testing",
  "reason": "Team policy: always run tests first"
}

# Adjust patch order
"preferredPatchOrder": [
  "patch.create_tests",      // Custom: tests first
  "patch.create_codeowners",
  "patch.create_dependabot"
]
```

### Playbook Versioning

Track playbook evolution with Git:

```bash
# View playbook history
git log -p docs/fitness/playbooks/harness-evolution-*.json

# Compare playbook versions
git diff HEAD~1 docs/fitness/playbooks/harness-evolution-missing-governance.json

# Restore previous playbook version
git checkout HEAD~1 -- docs/fitness/playbooks/harness-evolution-missing-governance.json
```

### Cross-Repository Sharing

**Option A: Git submodule** (for centralized playbooks)

```bash
# In central repo
mkdir playbooks-shared
mv docs/fitness/playbooks/*.json playbooks-shared/
git add playbooks-shared && git commit -m "Centralize playbooks"

# In other repos
git submodule add <central-repo-url> .playbooks-shared
ln -s .playbooks-shared docs/fitness/playbooks
```

**Option B: Manual sync** (simpler)

```bash
# Copy playbooks to other repos
scp docs/fitness/playbooks/*.json user@server:/repos/repo2/docs/fitness/playbooks/
```

### Debugging

**Playbook not loading?**

```bash
# Check if playbook file exists
ls -la docs/fitness/playbooks/

# Validate JSON syntax
jq . docs/fitness/playbooks/*.json

# Check playbook task type
jq '.taskType' docs/fitness/playbooks/*.json
# Should be "harness_evolution"
```

**Playbook not matching?**

```bash
# See current gaps
routa harness evolve --dry-run --format json | jq '.gaps[].category'

# See playbook gap patterns
jq '.strategy.gapPatterns' docs/fitness/playbooks/*.json

# Check overlap
# Current: ["gap_a", "gap_b", "gap_c"]
# Playbook: ["gap_a", "gap_b"]
# Overlap: 2/3 = 66% (should match)
```

**Why no playbook generated?**

```bash
# Check history entries
wc -l docs/fitness/evolution/history.jsonl
# Need at least 3 entries

# Check success rate
jq '.successRate' docs/fitness/evolution/history.jsonl
# Need >= 0.8 (80%)

# Check gap patterns
jq '.gapCategories' docs/fitness/evolution/history.jsonl
# Need 3+ runs with same pattern
```

## Best Practices

### 1. Commit Evolution History

```bash
git add docs/fitness/evolution/history.jsonl
git commit -m "Update evolution history"
```

**Why**: Team members can benefit from collective learning.

### 2. Review Playbooks Before Committing

```bash
# Generate playbook
routa harness evolve --learn

# Review before committing
cat docs/fitness/playbooks/*.json | jq

# Commit only high-confidence playbooks
jq 'select(.confidence >= 0.9)' docs/fitness/playbooks/*.json
```

**Why**: Avoid propagating low-quality strategies.

### 3. Periodic Playbook Cleanup

```bash
# Find old playbooks (adjust date as needed)
find docs/fitness/playbooks/ -name "*.json" -mtime +90

# Review and delete stale playbooks
rm docs/fitness/playbooks/old-playbook.json
```

**Why**: Keep playbooks relevant to current codebase state.

### 4. Document Playbook Decisions

Add comments in commit messages:

```bash
git commit -m "Add playbook for governance gaps

This playbook was generated from 5 successful runs across 3 repos.
It consistently applies CODEOWNERS before dependabot, which reduces
merge conflicts.

Evidence: 5/5 runs successful with this order.
"
```

## Troubleshooting

### Issue: Playbook always shows "partial match"

**Cause**: Current gaps differ from playbook pattern.

**Solution**:
1. Check exact gap categories in current run
2. Regenerate playbook after more runs with current pattern
3. Or adjust fuzzy matching threshold (code change required)

### Issue: Wrong patch order applied

**Cause**: Multiple playbooks match, wrong one selected.

**Solution**:
1. Check all matching playbooks: `ls docs/fitness/playbooks/`
2. Review confidence scores: `jq '.confidence' docs/fitness/playbooks/*.json`
3. Delete lower-confidence playbooks or adjust confidence manually

### Issue: Playbook not improving performance

**Cause**: Learned strategy may not be optimal for current repo state.

**Solution**:
1. Delete the playbook: `rm docs/fitness/playbooks/playbook-name.json`
2. Let system learn from fresh runs
3. Or manually edit playbook to adjust strategy

## Related Documentation

- [Harness Trace Learning - Feature Overview](../features/harness-trace-learning.md)
- [Harness Trace Learning - Phase 2 Design](../design-docs/harness-trace-learning-phase2.md)
- [Fitness Function Rulebook](https://github.com/phodal/routa/blob/main/docs/fitness/README.md)
- [Harness Fitness Blog](/blog/harness-fitness-function)

## Feedback

Found a bug or have a feature request?

- [Open an issue](https://github.com/phodal/routa/issues/new)
- Related: Issue [#294](https://github.com/phodal/routa/issues/294)
