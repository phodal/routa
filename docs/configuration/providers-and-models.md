---
title: Providers and Models
---

# Providers and Models

Routa can execute work through local ACP-backed providers and API-backed provider connections.

## Built-in Provider Types

Common built-in options currently include:

- `Claude Code`
- `OpenCode`
- `OpenCode SDK`
- `Codex`

## Configuration Surfaces

In the UI, provider setup is split across:

- `Providers`: available runtimes, visibility, and provider-specific credentials
- `Registry`: installable ACP agents
- `Role Defaults`: default provider/model choices per role
- `Models`: saved model aliases with base URL and API key

## Recommended Setup Order

1. Make one provider available in `Providers`.
2. If needed, create a model alias in `Models`.
3. Bind that provider/model to a role in `Role Defaults`.
4. Return to a workspace and launch a Session.

## Product Implication

You do not need every provider configured. One working provider is enough to get started.

## Related Docs

- [Quick Start](/quick-start)
- [Environment Variables](/configuration/environment-variables)
