---
name: fitness-check
description: Run and interpret architecture Fitness Function checks, reporting quality gate status. Use when asked to "run fitness", "check quality gates", "fitness check", "entrix run", "validate before merge", or "pre-commit check". Produces a structured report with pass/fail status, hard gate failures, advisory warnings, and actionable next steps.
when_to_use: Before merging a PR, after large refactors, or when you want a health snapshot of the repository quality gates.
version: 1.0.0
---

## Goal

Run `entrix` fitness checks, interpret results, and surface actionable findings — separated by tier so the operator can decide how deep to go.

Ground every conclusion in actual command output. Do not invent pass/fail status.

## Quick Start

```bash
# Install entrix (first time only)
pip install -e tools/entrix

# Preview what checks would run without executing them
entrix run --dry-run

# Fast tier only (< 30s): lint, static analysis, contract checks
entrix run --tier fast

# Standard checks (< 5min): fast + normal tier, unit tests, API tests, code quality
entrix run --tier normal

# Full check (< 15min): all tiers including E2E
entrix run

# Run in parallel for speed
entrix run --tier normal --parallel

# Run specific dimensions only
entrix run --tier normal --dimension code_quality --dimension testability
```

## Workflow

```
1. Scope      Determine check range (changed-only or full)
2. Dry-run    Preview metrics that will run (no side effects)
3. Fast       Run fast tier to catch blocking issues
4. Normal     If fast passes, run normal tier (optional)
5. Interpret  Classify results: hard gate / advisory / pass
6. Report     Output structured report with required fixes and debt items
```

### Step 1 — Scope

Decide between incremental and full checks:

```bash
# See changed files in this branch
git diff --name-only HEAD

# Incremental: only check metrics related to changed files
ROUTA_FITNESS_CHANGED_BASE=main entrix run --tier fast

# Full check
entrix run --tier fast
```

### Step 2 — Dry-run

```bash
entrix run --dry-run
```

Read the output and note:
- Which dimensions will be checked
- Which metrics are marked `hard_gate: true` (failure blocks merge)
- Which are `advisory` (failure only warns)

### Step 3 — Fast Tier

```bash
entrix run --tier fast
```

Fast tier covers:
- `legacy_hotspot_budget_guard` — frozen line-count budget for hotspot files (hard gate)
- `file_line_limit` — line budget for changed files
- `ts_test_pass` — TypeScript test pass rate (hard gate)
- Lint / static analysis / contract sync checks

> **Block threshold**: Fitness Score < 80 → must fix before proceeding.

### Step 4 — Normal Tier (optional)

Run only after fast tier passes:

```bash
entrix run --tier normal
```

Normal tier additionally covers:
- `rust_test_pass` — Cargo test pass rate (hard gate)
- API contract validation
- Deeper code quality metrics

### Step 5 — Interpret Results

Classify each finding into one of three categories:

| Category | Signal | Action |
|----------|--------|--------|
| Hard Gate failure | `BLOCKED` / `hard_gate: true` | Must fix — do not merge |
| Advisory warning | `WARN` / `gate: advisory` | Log as tech debt, may defer |
| Pass | `PASS` / green output | No action needed |

### Step 6 — Report

Use the following template for the output:

---

## Required Output

```markdown
# Fitness Check Report

## Scope
- Tier: fast / normal / deep
- Mode: changed-only (base: <ref>) / full
- Timestamp: <ISO 8601>

## Score Summary
| Dimension      | Weight | Score | Status |
|----------------|--------|-------|--------|
| code_quality   | 24%    | xx    | ✅ / ⚠️ / 🚫 |
| testability    | 20%    | xx    | ✅ / ⚠️ / 🚫 |
| security       | 20%    | xx    | ✅ / ⚠️ / 🚫 |
| api_contract   | 10%    | xx    | ✅ / ⚠️ / 🚫 |
| ...            | ...    | ...   | ...    |
| **Total**      | 100%   | **xx** | **✅ PASS / 🚫 BLOCKED** |

## Hard Gate Failures (must fix)
- [ ] `<metric_name>`: <reason> — fix: <suggested action>

## Advisory Warnings (should address)
- `<metric_name>`: <reason> — suggested: <action or debt entry>

## Passed Checks
- ✅ `<metric_name>` — <brief note>

## Recommended Next Steps
1. ...
2. ...

## Verdict
🟢 READY / 🔴 BLOCKED — <one-sentence summary>
```

---

## Fitness Dimensions

The nine dimensions defined in `docs/fitness/README.md`:

| Dimension | Weight | Evidence File |
|-----------|--------|---------------|
| code_quality | 24% | `docs/fitness/code-quality.md` |
| testability | 20% | `docs/fitness/unit-test.md` |
| security | 20% | `docs/fitness/security.md` |
| api_contract | 10% | `docs/fitness/rust-api-test.md` |
| design_system | ~6% | `docs/fitness/design-system-quality-layers.md` |
| e2e | varies | `docs/fitness/web-qa-e2e-matrix.md` |

When a metric fails, always link back to the evidence file where it is defined.

## Common Fixes

### `legacy_hotspot_budget_guard` fails
```bash
# View hotspot budget config
cat tools/entrix/file_budgets.json

# Check which files exceed budget
PYTHONPATH=tools/entrix python3 -m entrix.file_budgets \
  --config tools/entrix/file_budgets.json \
  --changed-only --base HEAD --overrides-only
```
Extract logic into smaller modules. Do not just increase the budget.

### `ts_test_pass` fails
```bash
npm run test:run 2>&1 | tail -30
```
Fix failing tests. Do not delete or skip them.

### `rust_test_pass` fails
```bash
cargo test --workspace --exclude routa-desktop 2>&1 | grep -E "FAILED|error"
```

### Lint fails
```bash
npm run lint 2>&1 | head -40
```

## Scope Hygiene

Exclude generated and dependency trees from analysis:

- `node_modules/`, `.next/`, `out/`, `dist/`, `target/`, `coverage/`, `tmp/`
- `.worktrees/`, `.routa/repos/`

## Integration with Other Skills

- After **fitness-check** passes → use `pr-verify` for full PR verification.
- If architectural gaps are found → use `evolution-architecture-review` for deeper analysis.
- If new test debt is found → create a GitHub issue with `issue-enricher`.

## Example Invocations

Skills are invoked from within Claude Code using the skill name as a slash command prefix, or by asking Claude to use the skill by name.

```bash
# Full fitness check before merging PR
claude -p "/fitness-check Run a full fitness check before merging."

# Fast check after a refactor
claude -p "/fitness-check Run fast tier only for the files changed in this PR."

# Investigate a specific dimension
claude -p "/fitness-check Check only the testability dimension and report gaps."
```

Or simply tell Claude: *"Run the fitness-check skill and report results."*
