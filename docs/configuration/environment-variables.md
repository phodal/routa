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
ATLASCLOUD_API_KEY=...
ATLASCLOUD_API_BASE=https://api.atlascloud.ai/v1
STANDARDCOMPUTE_API_KEY=...
STANDARDCOMPUTE_API_BASE=https://api.stdcmpt.com/v1
UBERLLM_API_KEY=...
UBERLLM_API_BASE=https://api.uberllm.dev/v1
CODEX_API_KEY=...
```

## What They Affect

- `ROUTA_RUST_BACKEND_URL`: points the web UI at a local backend server
- `OPENCODE_SERVER_URL` / `OPENCODE_API_KEY`: enables OpenCode SDK-backed execution
- `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`: enables Anthropic-backed execution paths
- `OPENAI_API_KEY`: enables OpenAI-backed model usage where supported
- `ATLASCLOUD_API_KEY`: enables Atlas Cloud when `WORKSPACE_AGENT_PROVIDER=atlascloud` or a model alias base URL is exactly `https://api.atlascloud.ai/v1`. The server key is not sent to a different per-session base URL; that session must pass its own `apiKey`.
- `ATLASCLOUD_API_BASE`: optional operator base URL. It receives `ATLASCLOUD_API_KEY` only when the session does not replace it with a different destination.
- `STANDARDCOMPUTE_API_KEY`: enables the OpenAI-compatible Standard Compute provider when `WORKSPACE_AGENT_PROVIDER=standardcompute` or a model alias base URL is exactly `https://api.stdcmpt.com/v1`. When no model is set, Routa sends `standardcompute`, the smart-routing id documented for OpenAI clients (https://docs.standardcompute.com/models). The response `model` field for that route is `StandardCompute`; pin a catalog id explicitly when you do not want routing. Legacy Claude ids such as `claude-sonnet-4-20250514` are not a Standard Compute default: the docs say those names return `model_not_found` on the OpenAI endpoints. The server key is bound to the canonical endpoint, or to `STANDARDCOMPUTE_API_BASE` when the session does not substitute a different base URL.
- `STANDARDCOMPUTE_API_BASE`: optional operator override for the OpenAI-compatible base (`https://api.stdcmpt.com/v1`). The Anthropic/Claude base `https://api.stdcmpt.com` is a different surface and is not selected by the `standardcompute` provider.
- `UBERLLM_API_KEY`: enables the OpenAI-compatible UberLLM provider when `WORKSPACE_AGENT_PROVIDER=uberllm` or a model alias base URL is exactly `https://api.uberllm.dev/v1`. UberLLM documents no platform default model, so set `WORKSPACE_AGENT_MODEL` or the session model to a catalog id (the quickstart uses ids such as `deepseek/deepseek-v4-flash`; https://uberllm.dev/docs/quickstart). The same key is also read on the Anthropic-compatible path only when the provider is `anthropic`, no `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or session `apiKey` is set, and the base URL is exactly `https://api.uberllm.dev` or `https://api.uberllm.dev/v1` (https://uberllm.dev/docs/anthropic-sdk). `ANTHROPIC_BASE_URL` alone does not attach `UBERLLM_API_KEY` to any other host. A session `apiKey` or Anthropic credential still wins on that path.
- `UBERLLM_API_BASE`: optional operator override for the OpenAI-compatible `/v1` base. It does not move the session onto the Anthropic Messages path. `https://api.uberllm.dev` without `/v1` stays on the Anthropic-compatible path instead of being inferred as `uberllm`.
- `CODEX_API_KEY`: enables Codex-backed flows where supported

## Practical Rule

Only set what matches the provider path you actually use. For most first runs:

- Desktop users often start with a local provider or provider-specific credentials in the app
- CLI users often start with one globally configured provider
- Web contributors often set `ROUTA_RUST_BACKEND_URL` during local development
