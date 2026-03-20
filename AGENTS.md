# Routa.js — Multi-agent coordination platform with dual-backend architecture (Next.js + Rust/Axum).

## Project Overview

- Product feature tree can be found in `docs/product-specs/FEATURE_TREE.md`
- Repository architecture and system boundaries live in `docs/ARCHITECTURE.md`
- Design intent, decision records, and migration map from `.kiro/specs/` live in `docs/design-docs/`
- Execution plans and debt tracking live in `docs/exec-plans/`
- Repro reports and agent feedback logs live in `docs/issues/`
- Quality and fitness guidance live in `docs/fitness/`

## Documentation Map

- `docs/product-specs/FEATURE_TREE.md`: Auto-generated product and API surface index. Start here when you need route or endpoint discovery.
- `docs/ARCHITECTURE.md`: Canonical architecture overview, domain model, protocol stack, and cross-backend invariants.
- `docs/design-docs/`: Human-reviewed design intent. Use for why a system exists, what constraints it must keep, and which older specs are still authoritative.
- `docs/exec-plans/active/`: Short-lived implementation plans for work in progress.
- `docs/exec-plans/completed/`: Archived plans that reflect what was actually shipped.
- `docs/exec-plans/tech-debt-tracker.md`: Cross-cutting debt ledger for cleanup work that does not fit a single feature plan.
- `docs/issues/`: Feedback-driven incident and bug records. Capture WHAT happened and WHY it mattered.
- `docs/fitness/`: Fitness function, code quality, API contract, testing, and verification guidance.
- `docs/references/`: LLM-friendly reference material and distilled external docs for high-frequency dependencies.

## Documentation Rules

- Treat `AGENTS.md` as a table of contents and operating contract, not a knowledge dump.
- Prefer adding durable knowledge under `docs/` instead of expanding `AGENTS.md`.
- When adding a new long-lived document, place it in the most specific `docs/` subdirectory and update this map if the new area becomes a standard entry point.
- Do not duplicate the same normative guidance across `AGENTS.md`, `.kiro/specs/`, and `docs/`. If content is migrated, leave an index or pointer instead of maintaining parallel copies.

## Coding Standards

- Limit file size to **1000 lines** as much as possible if the file is too large, split it into smaller files.
- Unless explicitly asked, do not write additional documentation for your work.
- **Linter**: ESLint 9 flat config (`eslint.config.mjs`) — TypeScript-ESLint + React Hooks + Next.js plugin. Run with `npm run lint`. Rust side uses `cargo clippy`. Fix all warnings before committing; do not disable rules inline without justification.

## Testing & Debugging

- Use **Playwright MCP tool** or CLI (`playwright-cli`) or Skills to test the web UI directly.
- Use **Playwright e2e** tests for automated coverage.
- Test Tauri UI: `npm run tauri dev`, then use Playwright against `http://127.0.0.1:3210/`.
- **Tauri routing debug**: If Tauri shows wrong page, check `crates/routa-server/src/lib.rs` fallback service maps routes to correct `__placeholder__` files; verify with `ls -la out/workspace/__placeholder__/`.
- **Kanban + OpenCode desktop replay**: For Rust desktop automation validation, run `cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml --example standalone_server`, open `http://127.0.0.1:3210/workspace/default/kanban`, select `OpenCode`, submit a unique KanbanTask Agent prompt, then verify Rust logs show `Creating session`, `wrote MCP config`, `tools/list`, and `tools/call`, and confirm the unique card appears in `Backlog`.
- **Kanban cross-column automation replay**: To verify Rust lane transition automation instead of only create-time automation, create a card in `Backlog`, move it into a lane with `automation.enabled=true` such as `Todo`, then confirm the task gains `assignedProvider`, `assignedRole`, and `triggerSessionId`, the board UI shows the card in the new lane, and `GET /api/sessions?workspaceId=...` returns the matching `OpenCode` session.
- **Kanban full auto-chain replay**: To verify `input -> backlog -> todo -> dev`, import a board config, create a card from the top Kanban input, then move the same card through `Todo` and `Dev`. Confirm each automated lane transition can create a fresh `OpenCode` session even if the task already has an older `triggerSessionId`.
- For Rust test coverage work, follow this sequence: `AGENTS.md` -> `docs/fitness/README.md` -> `docs/fitness/unit-test.md`.
- When changes span many files or touch shared core modules, run `entrix graph impact`, `graph test-radius`, or `graph review-context` first to identify blast radius and prioritize regression coverage.
- When changes span many files, do a full manual walkthrough in the browser:
  - Home page → select claude code → enter a requirement → auto-redirect to detail page → trigger ACP session
  - Visit a workspace detail page → click a session → switch to Trace UI to check history
  - Open browser DevTools to inspect network requests
- When debugging frontend bugs, use `console.log` and read output via Playwright.
- After fixing, **always clean up** all debug `console.log` statements.

## Fitness Function

Before any PR, verify fitness using [docs/fitness/README.md](docs/fitness/README.md):

```bash
entrix run --dry-run
entrix run
```

> Install: `pip install -e tools/entrix`

## After generating or modifying code

After generating or modifying **source code** (not docs, configs, or workflows), agents must run the following checks automatically.

> If any step fails, fix and re-validate. Never skip.
> **Skip checks** for changes that only touch: `*.md`, `*.yml`, `*.yaml`, `.github/`, `docs/`, or other non-code files.

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

- PR body must include **Playwright screenshots** or recordings.
- Attach e2e test screenshots or recordings when available.

## Issue Management — Feedback-Driven Loop

Building agents is complex — failures happen. Use a feedback-driven loop:

### 1. Capture Feedback
- Immediately log failures in `docs/issues/YYYY-MM-DD-short-description.md` (YAML front-matter).
- Document **WHAT** happened and **WHY** — not HOW to fix it.
- These files serve as context handoff between agents and humans.

### 2. Search Before Creating
- Always search `docs/issues/` first — someone may have already documented the same problem.
- When create issue to github, try to use `agent-browser` to capture  image and attach to issue body

### 3. Escalate to GitHub
```bash
gh issue create --label "Agent" --body "Agent: YourName\n\n[issue details]"
```
- Link the local issue file in the GitHub issue body.

### 4. Close the Loop
- Resolved? Update the local issue file with resolution notes and close the GitHub issue.
