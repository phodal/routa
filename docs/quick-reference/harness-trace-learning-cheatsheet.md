---
title: Harness Trace Learning Cheatsheet
---

# Harness Trace Learning - Quick Reference

> **One-page cheatsheet** for Harness Evolution's self-learning features.

## Commands

```bash
# Run harness evolution (records to history)
routa harness evolve --apply

# Generate playbooks from history (needs 3+ runs)
routa harness evolve --learn

# Dry-run to preview (no changes)
routa harness evolve --dry-run
```

## File Locations

```
repo/
├── docs/
│   └── fitness/
│       ├── evolution/
│       │   └── history.jsonl           # Evolution history (append-only)
│       └── playbooks/
│           └── harness-evolution-*.json # Generated playbooks
```

## Evolution History Entry

```json
{
  "timestamp": "2026-04-06T01:29:43Z",
  "taskType": "harness_evolution",
  "workflow": "bootstrap",
  "gapsDetected": 2,
  "gapCategories": ["missing_governance_gate", "missing_execution_surface"],
  "changedPaths": [".github/CODEOWNERS", "docs/harness/build.yml"],
  "patchesApplied": ["patch.create_codeowners", "bootstrap.synthesize_build_yml"],
  "successRate": 1.0
}
```

**Key fields**:
- `gapCategories` - Used for pattern matching
- `patchesApplied` - Used for learning patch order
- `successRate` - 1.0 = success, 0.0 = failure

## Playbook Structure

```json
{
  "id": "harness-evolution-missing-governance",
  "confidence": 0.95,
  "strategy": {
    "preferredPatchOrder": ["patch.A", "patch.B"],
    "gapPatterns": ["missing_governance_gate"],
    "antiPatterns": [{"doNot": "...", "reason": "..."}]
  },
  "provenance": {
    "sourceRuns": ["2026-04-06T01:29:43Z", ...],
    "evidenceCount": 3
  }
}
```

**Key fields**:
- `preferredPatchOrder` - Patches will be reordered to match
- `gapPatterns` - Playbook matches when these gaps appear
- `provenance.evidenceCount` - Number of runs that generated this

## Playbook Matching

| Match Type | Condition | Example |
|------------|-----------|---------|
| **Exact** | 100% gap match | Playbook: `[a,b]`, Current: `[a,b]` ✓ |
| **Partial** | ≥50% overlap | Playbook: `[a,b]`, Current: `[a,b,c]` ✓ (66%) |
| **No match** | <50% overlap | Playbook: `[a]`, Current: `[b,c,d]` ✗ (0%) |

**Selection**: Highest `weighted_score = overlap_ratio * confidence`

## Preflight Guidance

**Exact match**:
```
🧠 Loaded learned playbook (confidence: 95%, exact match)
  ID: harness-evolution-missing-governance
  Evidence: 3 successful runs

💡 Recommended patch order:
  1. patch.create_codeowners
  2. patch.create_dependabot
```

**Partial match**:
```
🧠 Loaded learned playbook (confidence: 95%, partial match)
  ID: harness-evolution-missing-governance
  Evidence: 3 successful runs

💡 Recommended patch order:
  1. patch.create_codeowners
  2. patch.create_dependabot

⚠️  Known issues:
  - skip ratchet: Caused regression in 2/5 runs
```

## Thresholds

| Parameter | Value | Meaning |
|-----------|-------|---------|
| Min success rate | 80% | Only learn from successful runs |
| Min occurrences | 3 | Need 3+ runs to detect pattern |
| Min overlap | 50% | Fuzzy match requires ≥50% gap overlap |

## Common Tasks

### Review evolution history
```bash
cat docs/fitness/evolution/history.jsonl | jq .
```

### View all gap categories in history
```bash
jq '.gapCategories[]' docs/fitness/evolution/history.jsonl | sort -u
```

### Check playbook confidence
```bash
jq '.confidence' docs/fitness/playbooks/*.json
```

### Review playbook provenance
```bash
jq '.provenance' docs/fitness/playbooks/*.json
```

### Delete low-confidence playbook
```bash
# Check confidence first
jq 'select(.confidence < 0.8) | .id' docs/fitness/playbooks/*.json

# Delete if needed
rm docs/fitness/playbooks/low-confidence-playbook.json
```

### Manually edit playbook
```bash
vim docs/fitness/playbooks/harness-evolution-missing-governance.json

# Adjust patch order
"preferredPatchOrder": [
  "patch.custom_first",  // Your custom order
  "patch.create_codeowners",
  "patch.create_dependabot"
]
```

## Debugging

### Why no playbook generated?

```bash
# Check history count
wc -l docs/fitness/evolution/history.jsonl
# Need: ≥ 3 entries

# Check success rates
jq '.successRate' docs/fitness/evolution/history.jsonl
# Need: ≥ 0.8 (80%)

# Check gap patterns
jq '.gapCategories' docs/fitness/evolution/history.jsonl | sort | uniq -c
# Need: 3+ runs with same pattern
```

### Why playbook not matching?

```bash
# Current gaps
routa harness evolve --dry-run --format json | jq '.gaps[].category'

# Playbook patterns
jq '.strategy.gapPatterns' docs/fitness/playbooks/*.json

# Calculate overlap
# If <50%, playbook won't match
```

### Why wrong patch order?

```bash
# Check all playbooks
ls docs/fitness/playbooks/

# Check confidence scores
jq '{id, confidence}' docs/fitness/playbooks/*.json

# Check which playbook matched
routa harness evolve --dry-run 2>&1 | grep "Loaded learned playbook"
```

## Best Practices

✅ **DO**:
- Commit `history.jsonl` to Git (team learning)
- Review playbooks before committing
- Delete stale playbooks (>90 days old)
- Edit playbooks to add team knowledge

❌ **DON'T**:
- Manually edit `history.jsonl` (append-only)
- Commit low-confidence playbooks (<80%)
- Mix playbooks from different harness versions

## Related Docs

- **User Guide**: [docs/guides/harness-trace-learning-guide.md](../guides/harness-trace-learning-guide.md)
- **Feature Overview**: [docs/features/harness-trace-learning.md](../features/harness-trace-learning.md)
- **Issue #294**: https://github.com/phodal/routa/issues/294
- **PR #345**: https://github.com/phodal/routa/pull/345
