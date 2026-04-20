---
title: Environment Variables
---

# Environment Variables

The most relevant environment variables exposed by the current codebase are:

```bash
ROUTA_RUST_BACKEND_URL=...
OPENCODE_SERVER_URL=...
OPENCODE_API_KEY=...
ANTHROPIC_API_KEY=...
ANTHROPIC_AUTH_TOKEN=...
OPENAI_API_KEY=...
CODEX_API_KEY=...
```

## What They Affect

- `ROUTA_RUST_BACKEND_URL`: points the web UI at a local backend server
- `OPENCODE_SERVER_URL` / `OPENCODE_API_KEY`: enables OpenCode SDK-backed execution
- `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`: enables Anthropic-backed execution paths
- `OPENAI_API_KEY`: enables OpenAI-backed model usage where supported
- `CODEX_API_KEY`: enables Codex-backed flows where supported

## Practical Rule

Only set what matches the provider path you actually use. For most first runs:

- Desktop users often start with a local provider or provider-specific credentials in the app
- CLI users often start with one globally configured provider
- Web contributors often set `ROUTA_RUST_BACKEND_URL` during local development
