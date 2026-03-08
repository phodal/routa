# Routa.js Architecture Guide

## Project Overview

**Routa.js** is a multi-agent coordination platform with a **dual-backend architecture**:
- **Next.js Backend** (TypeScript) — Web deployment on Vercel with Postgres/SQLite
- **Rust Backend** (Axum) — Desktop application with embedded server and SQLite
- `crates/routa-server` — the same logic of Next.js backend, but implemented in Rust

Both backends implement **identical REST APIs** for seamless frontend compatibility.

## Documentation

- Unless I ask to write docs, you don't need to write docs for your work.

## Testing

- Use playwright tool (mcp) to test the web UI by youself if possible
- Use playwright testing e2e
- Test Tauri UI with `npm run tauri dev`, then use playwright to test the UI (http://127.0.0.1:3210/) too.

## Pull Request

- When plan to create a PR, should  attach screenshot with Playwright in GitHub PR body
- Attach e2e image or video if possible.

## Issue Management — Feedback-Driven Loop

Building agents is complex — API calls, web interactions, and integrations may fail unexpectedly.
We use a **feedback-driven loop** to capture, share, and resolve issues systematically:

### 1. **Capture Feedback** (Observe & Record)

- When you encounter a failure or unexpected behavior, **immediately log it** in `docs/issues/` as a structured Markdown file with YAML front-matter
- File Naming: `docs/issues/YYYY-MM-DD-short-description.md`
- Document **WHAT happened** and **WHY it might happen** — not HOW to fix it
- These files serve as **context handoff** between agents and humans

### 2. **Search for Existing Feedback** (Learn from History)

- Before creating a new issue, **always search** `docs/issues/` directory first
- Someone (agent or human) may have already documented the same problem
- Reuse existing context to avoid duplicate work and accelerate resolution

### 3. **Escalate to GitHub** (Broadcast & Track)
- For issues requiring human attention or cross-session tracking, create GitHub issues:
  ```bash
  gh issue create --label "Agent" --body "Agent: YourName\n\n[issue details]"
  ```
- Link the local issue file in the GitHub issue body for full context

### 4. **Close the Loop** (Resolve & Document)

- When an issue is resolved, update the local issue file with resolution notes
- Close the GitHub issue if applicable
- The documented feedback becomes **knowledge** for future agents and humans

### 5. **Garbage Collection** (Periodic Cleanup)
- Periodically run the `issue-garbage-collector` skill to clean up duplicates
- Merge similar issues by filename pattern and content similarity
- Keep resolved issues as knowledge base, archive if directory is cluttered
- See: `.claude/skills/issue-garbage-collector/SKILL.md`

## Debug

- When debug developing frontend Bug, you can use console.log to log in browser, use Playwright read and reslove it.
- After resolve bug, should clear unused console.log

## Testing 

- 当遇到改动文件多的场景，请使用浏览器（playwright/MCP Tool），从头到尾执行一次看看
  - 首页选 claude code，输入个需求，会自动跳转到详细页，并触发 ACP 会话，根据你的场景，你可以问这个 AI Chatbot 一些问题
  - 访问一个 workspace 详情页，点击会话，切换 Trace UI 看是否有历史
  - 你也可以在浏览器里，打开开发者工具，查看网络请求，看看是否符合预期

## Commit

- Follow the Baby-Step Commit principle — keep commits small, but not excessively granular.
- Always include the related GitHub issue ID when applicable.
- Make sure tests pass before pushing. (also API Contract, `npm run api:check`)
- Append a co-author line in the following format: (YourName, like Copilot,Augment,Claude etc.) (Your model name) <YourEmail, like, <claude@anthropic.com>, <auggie@augmentcode.com>)
  for example:
  ```
  Co-authored-by: GitHub Copilot Agent (GPT 5.4) <198982749+copilot@users.noreply.github.com>
  Co-authored-by: Kiro AI (...) <kiro@kiro.dev>
  Co-authored-by: QoderAI (Qwen 3.5 Max) <qoder_ai@qoder.com>
  Co-authored-by: gemini-cli (...) <218195315+gemini-cli@users.noreply.github.com>
  ```
