# Routa.js — Multi-agent coordination platform with dual-backend architecture (Next.js + Rust/Axum).

## Repository Map

- `docs/product-specs/FEATURE_TREE.md`: Auto-generated product and API surface index. Start here when you need route or endpoint discovery.
- `docs/ARCHITECTURE.md`: Canonical architecture overview, system boundaries, domain model, protocol stack, and cross-backend invariants.
- `docs/adr/`: Architecture Decision Records — durable decisions that shape boundaries, protocols, and patterns. Start here when asking "why is it built this way?"
- `docs/design-docs/`: Human-reviewed design intent and normalized decisions migrated from `.kiro/specs/`.
- `docs/exec-plans/active/`: Short-lived implementation plans for work in progress.
- `docs/exec-plans/completed/`: Archived plans that reflect what actually shipped.
- `docs/exec-plans/tech-debt-tracker.md`: Cross-cutting debt ledger for cleanup work that does not fit a single feature plan.
- `docs/issues/`: Feedback-driven incident and repro records. Capture WHAT happened and WHY it mattered.
- `docs/fitness/`: Executable quality, testing, API contract, and verification rulebook consumed by `entrix`.
- `docs/REFACTOR.md`: Refactor playbook for long-file triage, test-first extraction, and concept-based clustering.
- `docs/references/`: LLM-friendly reference material and distilled external docs for high-frequency dependencies.
- `docs/release-guide.md`: Comprehensive release guide for CLI (npm + crates.io), Desktop (Tauri), and multi-platform distribution.
- `docs/RELEASE_CHECKLIST.md`: Quick release checklist for version publishing.
- `tools/entrix/docs/adr/README.md`: Entrix-specific ADRs, including long-file analysis heuristics.

## Reading Order

When starting work on this repository, read in this order:

1. This file (`AGENTS.md`) — operating contract and pointers
2. `docs/ARCHITECTURE.md` — system boundaries and runtime topology
3. `docs/adr/README.md` — architectural decisions index; read specific ADRs relevant to your task
4. `docs/fitness/README.md` — quality gates and verification
5. The specific `docs/design-docs/` or `docs/exec-plans/` files related to your task


## Documentation Rules

- Treat `AGENTS.md` as a table of contents and operating contract, not a knowledge dump.
- Prefer adding durable knowledge under `docs/` instead of expanding `AGENTS.md`.
- When adding a new long-lived document, place it in the most specific `docs/` subdirectory and update the repository map if the new area becomes a standard entry point.
- Do not duplicate the same normative guidance across `AGENTS.md`, `.kiro/specs/`, and `docs/`. If content is migrated, leave an index or pointer instead of maintaining parallel copies.
- Unless explicitly asked, do not write additional documentation for your work.

## Coding Standards

- Use `docs/fitness/` and `entrix` as the source of truth for executable quality gates, file-budget enforcement, and review escalation. Do not duplicate tool-level checks here unless they are repository-specific exceptions.
- When a long file mixes layout/rendering with side effects, queues, streaming updates, or session/task orchestration, refactor toward an **orchestration shell + domain hooks** shape instead of only splitting JSX. Here, **orchestration shell** means a thin top-level entrypoint that routes flow and coordinates modules without carrying the full implementation mass itself.
- Apply the same rule to oversized API routes: keep the top-level route as an orchestration shell, and extract heavy method workflows like session creation, prompt streaming, or provider dispatch into dedicated modules.
- Prefer extracting one stable workflow boundary at a time, for example bootstrap, navigation, task execution, or streaming sync; do not replace one oversized file with one oversized catch-all hook.
- For route refactors, split by workflow branch before shared helpers; do not start with a generic `utils` file when the real mass lives in one or two protocol branches.
- Before large refactors on behavior-heavy files, add or extend characterization tests that lock current routing, lifecycle, persistence, and recovery behavior.

## Testing & Debugging

- Use `agent-browser` or the relevant browser/Electron Skills for manual UI testing, walkthroughs, and screenshot or recording capture. Use `playwright-cli` only when you specifically need Playwright snapshots or scripted Playwright interaction.
- Use **Playwright e2e** tests for automated coverage.
- Test Tauri UI: `npm run tauri dev`, then use `agent-browser` against `http://127.0.0.1:3210/`.
- **Tauri routing debug**: If Tauri shows wrong page, check `crates/routa-server/src/lib.rs` fallback service maps routes to correct `__placeholder__` files; verify with `ls -la out/workspace/__placeholder__/`.
- **Kanban + OpenCode desktop replay**: For Rust desktop automation validation, run `cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml --example standalone_server`, open `http://127.0.0.1:3210/workspace/default/kanban` with `agent-browser`, select `OpenCode`, submit a unique KanbanTask Agent prompt, then verify Rust logs show `Creating session`, `wrote MCP config`, `tools/list`, and `tools/call`, and confirm the unique card appears in `Backlog`.
- **Kanban cross-column automation replay**: To verify Rust lane transition automation instead of only create-time automation, create a card in `Backlog`, move it into a lane with `automation.enabled=true` such as `Todo`, then confirm the task gains `assignedProvider`, `assignedRole`, and `triggerSessionId`, the board UI shows the card in the new lane, and `GET /api/sessions?workspaceId=...` returns the matching `OpenCode` session.
- **Kanban full auto-chain replay**: To verify `input -> backlog -> todo -> dev`, import a board config, create a card from the top Kanban input, then move the same card through `Todo` and `Dev`. Confirm each automated lane transition can create a fresh `OpenCode` session even if the task already has an older `triggerSessionId`.
- For Rust test coverage work, follow this sequence: `AGENTS.md` -> `docs/fitness/README.md` -> `docs/fitness/unit-test.md`.
- When changes span many files or touch shared core modules, run `entrix graph impact`, `entrix graph test-radius`, or `entrix graph review-context` first to identify blast radius and prioritize regression coverage.
- When changes span many files, do a full manual walkthrough in the browser with `agent-browser`:
  - Home page → select claude code → enter a requirement → auto-redirect to detail page → trigger ACP session
  - Visit a workspace detail page → click a session → switch to Trace UI to check history
  - Open browser DevTools to inspect network requests
- When debugging frontend bugs, use temporary `console.log` statements and inspect the output via `agent-browser` or `playwright-cli`.
- After fixing, **always clean up** all debug `console.log` statements.

## Fitness Function

Before any PR, verify fitness using [docs/fitness/README.md](docs/fitness/README.md):

`tools/fitness-function` has been replaced by `entrix`.
`entrix` is the repository governance tool that executes fitness rules, review triggers, and validation orchestration from `docs/fitness/`.

```bash
entrix run --dry-run
entrix run
```

> Install: `pip install -e tools/entrix`

## After generating or modifying code

After generating or modifying **source code** (not docs, configs, or workflows), agents must run the following checks automatically.

> If any step fails, fix and re-validate. Never skip.
> **Skip checks** for changes that only touch: `*.md`, `*.yml`, `*.yaml`, `.github/`, `docs/`, or other non-code files.

- Run `entrix run --tier fast` for normal source edits.
- Run `entrix run --tier normal` when behavior, shared modules, APIs, or workflow orchestration changed.
- Use `entrix run --dry-run` or targeted dimensions if you need to inspect or narrow the validation scope before running the full tier.

## Git Discipline

### Baby-Step Commits (Enforced)

- Each commit does **one thing** with Conventional Commits format: one feature, one bug fix, or one refactor. Each commit should less than 10 files and less than 1000 lines of code.
- No "kitchen sink" commits. If changes span multiple concerns, split into multiple commits.
- Always include the related **GitHub issue ID** when applicable.

### Co-Author Format

- If you want to add `closed issue` in commit message, should view issue against the main branch with `gh issue view <issue-id>` 
- Append a co-author line in the following format: (YourName, like Copilot,Augment,Claude etc.) (Your model name) <YourEmail, like, <claude@anthropic.com>, <auggie@augmentcode.com>)
  for example:

```
Co-authored-by: Kiro AI (Claude Opus 4.6) <kiro@kiro.dev>
Co-authored-by: GitHub Copilot Agent (GPT 5.4) <198982749+copilot@users.noreply.github.com>
Co-authored-by: QoderAI (Qwen 3.5 Max) <qoder_ai@qoder.com>
Co-authored-by: gemini-cli (...) <218195315+gemini-cli@users.noreply.github.com>
```

## Pull Request

- PR body must include browser screenshots or recordings for UI-affecting changes. Prefer `agent-browser` capture for manual evidence.
- Attach e2e test screenshots or recordings when available.

## Issue Management — Feedback-Driven Loop

Building agents is complex — failures happen. Use a feedback-driven loop:

### 1. Capture Feedback
- Immediately log failures in `docs/issues/YYYY-MM-DD-short-description.md` (YAML front-matter).
- Document **WHAT** happened and **WHY** — not HOW to fix it.
- These files serve as context handoff between agents and humans.

### 2. Search Before Creating
- Always search `docs/issues/` first — someone may have already documented the same problem.
- When creating a GitHub issue, try to use `agent-browser` to capture an image and attach it to the issue body.

### 3. Escalate to GitHub
```bash
gh issue create --label "Agent" --body "Agent: YourName\n\n[issue details]"
```
- Link the local issue file in the GitHub issue body.

### 4. Close the Loop
- Resolved? Update the local issue file with resolution notes and close the GitHub issue.
