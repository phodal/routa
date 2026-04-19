---
title: Harness Trace Learning
---

# Harness Evolution Trace Learning

> **Self-Improving Harness Evolution**: Learn from past runs, generate evidence-backed playbooks, and accelerate future evolutions.

## Overview

Harness Evolution's **Trace Learning** feature enables the system to learn from its own execution history, automatically detecting patterns in successful runs and distilling them into reusable playbooks. This creates a self-improvement loop where each harness evolution run makes the next one smarter.

## Key Concepts

### Evolution History

Every `routa harness evolve --apply` run records rich execution context to `docs/fitness/evolution/history.jsonl`:

```json
{
  "timestamp": "2026-04-06T01:29:43Z",
  "sessionId": "abc-123",                    // Links to agent traces
  "taskType": "harness_evolution",
  "workflow": "bootstrap",                   // Auto-inferred
  "trigger": "manual",
  "gapsDetected": 2,
  "gapCategories": ["missing_governance_gate", "missing_execution_surface"],
  "changedPaths": [".github/CODEOWNERS", "docs/harness/build.yml"],
  "patchesApplied": ["patch.create_codeowners", "bootstrap.synthesize_build_yml"],
  "patchesFailed": [],
  "successRate": 1.0
}
```

### Pattern Detection

The learning algorithm analyzes historical runs to find recurring patterns:

1. **Group by gap patterns** - Which gap categories appear together?
2. **Filter successful runs** - success_rate ≥ 80%
3. **Find consensus** - Patterns appearing 3+ times
4. **Extract strategies** - Preferred patch order, common file changes

### Playbooks

Generated playbooks capture proven strategies with full provenance:

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

## Usage

### Phase 1: Generate Evolution History

Run harness evolution multiple times to build a learning dataset:

```bash
# Bootstrap multiple repos
for repo in repo1 repo2 repo3; do
  cd $repo
  routa harness evolve --bootstrap --apply
done

# Or run on the same repo after making changes
routa harness evolve --apply
```

Each run appends to `docs/fitness/evolution/history.jsonl`.

### Phase 2: Learn from History

After 3+ successful runs with similar gap patterns:

```bash
routa harness evolve --learn
```

**Output**:
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

### Phase 3: Review Playbooks

Inspect generated playbooks:

```bash
# List all playbooks
ls docs/fitness/playbooks/

# View a playbook
cat docs/fitness/playbooks/harness-evolution-missing-governance.json | jq

# Check patch order
jq '.strategy.preferredPatchOrder' docs/fitness/playbooks/*.json
```

### Phase 4: Runtime Integration (Coming in Phase 2)

Future versions will automatically load playbooks at runtime:

```bash
routa harness evolve --apply

# 🧠 Loaded 1 learned playbook (confidence: 95%)
#   Recommended patch order: ["patch.A", "patch.B"]
#   Evidence: 3 successful runs over 2 weeks
```

## Benefits

### 1. Self-Improvement Loop

```
Run → Evidence → Playbook → Runtime → Guardrail
```

Each evolution run makes the system smarter for the next one.

### 2. Evidence-Backed Strategies

Every playbook links back to concrete runs with timestamps, ensuring strategies are validated by real execution, not hunches.

### 3. Cross-Project Knowledge Transfer

Playbooks generated from one repo can inform evolutions on similar repos, accelerating bootstrapping.

### 4. Continuous Refinement

As more runs accumulate, confidence scores increase and anti-patterns emerge, making playbooks more reliable over time.

## Storage

### Evolution History
- **Path**: `docs/fitness/evolution/history.jsonl`
- **Format**: JSONL (append-only)
- **Committed**: Yes (part of repo history)

### Playbooks
- **Path**: `docs/fitness/playbooks/*.json`
- **Format**: JSON
- **Committed**: Recommended (shareable knowledge)

## Integration with Agent Traces

Evolution history entries include `sessionId` to link with full agent execution traces in `.routa/traces/`, enabling deep analysis:

- Which files were read during gap detection?
- What was the exact tool call sequence?
- What was the Git state before/after?

See [Harness Trace Learning - Phase 2 Design](../design-docs/harness-trace-learning-phase2.md) for the follow-up design and operational direction.

## Roadmap

- **Phase 0** (✅ Completed): Schema extension for trace learning
- **Phase 1** (✅ Completed): Pattern detection + playbook generation
- **Phase 2** (⏭️ Next): Runtime playbook loading + preflight guidance
- **Phase 3** (Future): Guardrail promotion + cross-repo sharing

## Related

- [Fitness Function Rulebook](https://github.com/phodal/routa/blob/main/docs/fitness/README.md)
- [Harness Fitness Blog](/blog/harness-fitness-function)
- [Architecture](../ARCHITECTURE.md)
- Issue [#294](https://github.com/phodal/routa/issues/294) - Trace Learning
- PR [#342](https://github.com/phodal/routa/pull/342) - Design RFC
- PR [#343](https://github.com/phodal/routa/pull/343) - Phase 0
- PR [#345](https://github.com/phodal/routa/pull/345) - Phase 1
