---
title: "Backlog/history memory retrieval lacks evidence from real Codex search behavior"
date: "2026-04-22"
kind: issue
status: resolved
severity: medium
area: kanban
tags:
  - history-memory
  - backlog-refiner
  - codex-sessions
  - search-patterns
reported_by: "codex"
related_issues:
  - "2026-04-21-task-adaptive-harness-kanban-backlog-refine-and-card-detail.md"
  - "2026-04-21-jit-context-needs-repo-root-context-discovery.md"
github_issue: 523
github_state: closed
github_url: "https://github.com/phodal/routa/issues/523"
---

# Backlog/history memory retrieval lacks evidence from real Codex search behavior

## What Happened

Current `History Memory` / task-adaptive retrieval relies mainly on title/query/feature/file hints and feature-tree fallback, but there is still no evidence-backed model of what coding agents actually search for first when they start narrowing scope.

The repository already contains transcript tooling for session inspection, yet there is no dedicated analysis of `~/.codex/sessions` focused on grep/glob-like search behavior. As a result, Kanban backlog planning and history-memory preload are still shaped by product hypotheses rather than by observed search patterns from real coding sessions.

## Expected Behavior

We should have a repeatable transcript analysis that answers questions such as:

- which grep/glob-like search families agents use most often (`rg`, `rg --files`, `find`, `fd`, etc.)
- what patterns they search for most often (symbol names, route fragments, file suffix globs, natural-language phrases)
- which path roots or globs recur most often (`src/`, `crates/`, `docs/`, `*.tsx`, `*.rs`, etc.)
- whether this evidence supports letting backlog refiner generate a retrieval condition first, before task-level `contextSearchSpec` is persisted

## Reproduction Context

- Environment: web / local Node development
- Trigger: trying to decide whether Kanban backlog refiner should pre-populate retrieval hints or generate them through agent-driven repo inspection first

## Why This Might Happen

- We already parse transcripts for feature/task-adaptive recovery, but not for search-intent statistics
- Current preload thresholds measure match strength, not whether the underlying retrieval condition resembles real agent search behavior
- Backlog planning was recently upgraded to allow `Read`, `Grep`, and `Glob`, but we still lack evidence on what those searches usually look like in practice

## Relevant Files

- `scripts/harness/analyze-search-tool-usage.ts`
- `scripts/__tests__/analyze-search-tool-usage.test.ts`
- `src/core/harness/transcript-sessions.ts`
- `src/core/kanban/context-preload.ts`
- `src/core/kanban/agent-trigger.ts`

## Observations

- `~/.codex/sessions` currently contains `1892` transcript files on this machine.
- A repo-filtered scan (`--cwd-contains routa-js`) found:
  - `841` sessions with grep/glob-like searches
  - `20900` search events
  - `18535` `rg` text searches (`88.7%`)
  - `1338` `find` searches (`6.4%`)
  - `682` `rg --files` searches (`3.3%`)
  - `343` plain `grep` searches (`1.6%`)
  - `0` first-class custom `grep` / `glob` MCP tool calls
- This means real Codex search behavior is overwhelmingly shell-driven and centered on `rg`, not on a separate MCP grep/glob primitive.
- Search intent is mixed, not purely semantic:
  - `symbol_like`: `6558`
  - `natural_language`: `6221`
  - `path_like`: `4553`
- The most common globs are heavily code-surface oriented:
  - `*.ts` (`744`)
  - `*.rs` (`622`)
  - `*.tsx` (`556`)
  - `*.md` (`238`)
  - plus strong test-oriented globs such as `*test*`, `*.test.ts`, `*.test.tsx`
- The most common path roots are:
  - `src` (`17666`)
  - `crates` (`6872`)
  - `docs` (`2272`)
  - `tools` (`1031`)
  - `scripts` (`620`)
  - `apps` (`529`)
- The most common file-enumeration commands are root-first:
  - `rg --files src`
  - `rg --files docs/issues`
  - `rg --files src/app`
  - `rg --files crates/routa-server/src`
  - `find resources/specialists -maxdepth 3 -type f`
- Representative high-signal search sessions show the same pattern:
  - enumerate likely roots/files first
  - then issue dense `rg -n` symbol/route/contract searches
  - then narrow on candidate files with `Read`/`sed`

## Implications

These results support changing Kanban backlog refinement in a more explicit way:

1. `backlog refiner` should not start with a persisted `contextSearchSpec` guessed from the card title alone.
2. It should instead generate a temporary retrieval/search condition and execute it:
   - likely roots (`src`, `crates`, `docs`, `resources`, `tools`)
   - likely file globs (`*.ts`, `*.tsx`, `*.rs`, tests)
   - likely symbol/module/route terms
3. Only after repo inspection should it persist a confirmed `contextSearchSpec`, especially:
   - `featureCandidates`
   - `relatedFiles`
   - `moduleHints`
   - `symptomHints`
4. This also suggests that automatic preload for fresh backlog cards should stay conservative; the higher-value moment to persist retrieval hints is after the agent has run `rg --files` / `rg -n` against the repo.

One caveat became clear during verification: raw top globs such as `*.ts`, `*.tsx`, and `*.rs` are too generic to use directly as backlog retrieval seeds. They are still useful as evidence that agents search code surfaces broadly, but the more actionable signals are:

- root-first enumeration commands such as `rg --files src/app`, `rg --files crates/routa-server/src`, `rg --files src/core`, `find resources/specialists -maxdepth 3 -type f`
- narrowed structural globs such as `route.ts`, `*.test.ts`, `*.test.tsx`, `Cargo.toml`, `package.json`, `*.jsonl`
- stable code-surface roots: `src`, `crates`, `resources`, `tools`, `scripts`, `apps`

The analysis script now emits these as `topEnumerationCommands`, `topActionableGlobs`, and `topActionablePathRoots` so future backlog-refiner work can consume higher-signal seeds instead of generic file extensions.

## Verification

- 2026-04-22: added `scripts/harness/analyze-search-tool-usage.ts`
- 2026-04-22: added `scripts/__tests__/analyze-search-tool-usage.test.ts`
- 2026-04-22: `npx vitest run scripts/__tests__/analyze-search-tool-usage.test.ts` passed (`7` tests)
- 2026-04-22: real scan run:
  - `npx tsx scripts/harness/analyze-search-tool-usage.ts --cwd-contains routa-js --max-items 25`
- The repo-filtered output is the evidence source for the counts listed above
- 2026-04-22: implemented backlog confirmation gating so speculative `contextSearchSpec` is stripped unless the current backlog session has already inspected the repo or called `load_feature_tree_context`
- 2026-04-22: updated Kanban backlog prompts and MCP tool descriptions to require confirmed retrieval hints before persisting `contextSearchSpec`
- 2026-04-22: `npx vitest run src/core/kanban/__tests__/backlog-context-confirmation.test.ts src/core/tools/__tests__/kanban-tools.test.ts src/core/tools/__tests__/agent-tools.test.ts 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-agent-input.test.ts' src/core/kanban/__tests__/agent-trigger.test.ts` passed (`53` tests, `2` skipped)
- 2026-04-22: `npx tsc --noEmit` passed
- 2026-04-22: `entrix run --tier fast` passed (`100.0%`)
- 2026-04-22: refined `analyze-search-tool-usage.ts` to emit `topActionableGlobs`, `topActionablePathRoots`, and `topEnumerationCommands`, explicitly downgrading generic globs like `*.ts` / `*.rs`
- 2026-04-22: `npx vitest run scripts/__tests__/analyze-search-tool-usage.test.ts` passed (`10` tests)

## References

- `docs/issues/2026-04-21-task-adaptive-harness-kanban-backlog-refine-and-card-detail.md`
- `docs/issues/2026-04-21-jit-context-needs-repo-root-context-discovery.md`
