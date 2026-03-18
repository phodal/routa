# Routa.js — Multi-agent coordination platform with dual-backend architecture (Next.js + Rust/Axum).

## Project Overview

- Product feature tree can be found in `docs/product-specs/FEATURE_TREE.md`

## Coding Standards

- Limit file size to **1000 lines** as much as possible if the file is too large, split it into smaller files.
- Unless explicitly asked, do not write additional documentation for your work.
- **Linter**: ESLint 9 flat config (`eslint.config.mjs`) — TypeScript-ESLint + React Hooks + Next.js plugin. Run with `npm run lint`. Rust side uses `cargo clippy`. Fix all warnings before committing; do not disable rules inline without justification.

## Testing & Debugging

- Use **Playwright MCP tool** or CLI (`playwright-cli`) or Skills to test the web UI directly.
- Use **Playwright e2e** tests for automated coverage.
- Test Tauri UI: `npm run tauri dev`, then use Playwright against `http://127.0.0.1:3210/`.
- **Tauri routing debug**: If Tauri shows wrong page, check `crates/routa-server/src/lib.rs` fallback service maps routes to correct `__placeholder__` files; verify with `ls -la out/workspace/__placeholder__/`.
- For Rust test coverage work, follow this sequence: `AGENTS.md` -> `docs/fitness/README.md` -> `docs/fitness/unit-test.md`.
- When changes span many files or touch shared core modules, run `routa-fitness graph impact`, `graph test-radius`, or `graph review-context` first to identify blast radius and prioritize regression coverage.
- When changes span many files, do a full manual walkthrough in the browser:
  - Home page → select claude code → enter a requirement → auto-redirect to detail page → trigger ACP session
  - Visit a workspace detail page → click a session → switch to Trace UI to check history
  - Open browser DevTools to inspect network requests
- When debugging frontend bugs, use `console.log` and read output via Playwright.
- After fixing, **always clean up** all debug `console.log` statements.

## Fitness Function

Before any PR, verify fitness using [docs/fitness/README.md](docs/fitness/README.md):

```bash
routa-fitness run --dry-run
routa-fitness run
```

> Install: `pip install -e tools/routa-fitness`

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
