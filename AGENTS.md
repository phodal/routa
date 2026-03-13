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
- For Rust test coverage work, follow this sequence: `AGENTS.md` -> `docs/fitness/README.md` -> `docs/fitness/unit-test.md`.
- For Rust test coverage work, maintain progress and coverage metrics (line coverage when `llvm-cov` is available, otherwise file-level proxy) in `docs/fitness/unit-test.md`; progress checklist alone is insufficient.
- When changes span many files, do a full manual walkthrough in the browser:
  - Home page → select claude code → enter a requirement → auto-redirect to detail page → trigger ACP session
  - Visit a workspace detail page → click a session → switch to Trace UI to check history
  - Open browser DevTools to inspect network requests
- When debugging frontend bugs, use `console.log` and read output via Playwright.
- After fixing, **always clean up** all debug `console.log` statements.

## Fitness Function

Before any PR, verify fitness using [docs/fitness/README.md](docs/fitness/README.md):

1. Check hard gates (must all pass):
   - `npm run test:run` — TS tests
   - `cargo test --workspace` — Rust tests
   - `npm run api:check` — API contract parity
   - `npm run lint` — Lint

2. Update evidence files if tests changed:
   - [docs/fitness/unit-test.md](docs/fitness/unit-test.md)
   - [docs/fitness/rust-api-test.md](docs/fitness/rust-api-test.md)

## After generating or modifying code

After generating or modifying **source code** (not docs, configs, or workflows), agents must run the following checks automatically.

> If any step fails, fix and re-validate. Never skip.
>
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

### PR Description Template (建议)

Use this template to avoid vague/low-signal summaries:

- 目标：一句话说明要解决的业务问题。
- 影响范围：改动了哪些模块（文件/域名）与为什么。
- 变更清单：逐条列出关键改动（建议 4-8 条）。
- 风险与影响：是否有行为变更、兼容性风险、回归面。
- 验证：列出执行过的命令与结果。
- 跟踪：关联 issue（例如 `Fixes #124`）。

示例：

```text
## Why
修复 Kanban 自动化列在某些路径下不触发 agent 会话的问题，恢复「移动卡片自动开始」的核心流程。

## What Changed
- 修复 workflow orchestrator 重复实例导致 createSession 回调丢失的问题。
- MCP 侧 Kanban 流程改为复用全局 singleton，避免 handler 被覆盖。
- 修复 manual issue 弹窗的 TipTap SSR 崩溃。
- 补齐 Kanban column automation e2e，并同步更新旧的 kanban e2e 用例。

## Validation
- `npm run lint`
- `npm run typecheck`（如有）
- `npm run test`
- `npx playwright test e2e/kanban-column-automation.spec.ts ...`

## Risks
- 自动化触发链路新增了会话启动的依赖路径，建议观察新建卡片到启动耗时是否有回归。

## References
- Fixes #124
```

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
