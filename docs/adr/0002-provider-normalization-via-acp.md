# ADR 0002: Provider Normalization via ACP

- Status: accepted
- Date: 2026-02-28
- Derived from: [issue #33](https://github.com/phodal/routa/issues/33)

## Context

Routa.js orchestrates multiple agent runtimes: Claude Code SDK (stream-json), OpenCode (ACP-native), and potentially others. Each provider emits different event shapes, manages processes differently, and has distinct installation/warmup requirements.

The question was whether to let provider-specific protocol details leak through the system (faster to add new providers) or normalize everything behind a single protocol layer (harder per provider, but simpler domain and UI code).

## Decision

All agent runtimes are normalized to ACP (Agent Client Protocol) through per-provider adapter layers:

```
Provider process or bridge
  → provider-specific output / notifications
  → adapter normalization
  → unified session updates
  → persistence, traces, UI streaming
```

Key implementation:
- ACP is the primary execution transport for agent CLIs
- Claude Code SDK stream-json is translated to ACP-like updates via `claude-code-sdk-adapter.ts`
- Docker-backed providers use the same adapter pattern through `src/core/acp/docker/`
- Per-session model configuration replaces global env-var model selection (issue #33)
- Provider registry in `src/core/acp/provider-registry.ts` abstracts discovery and instantiation

## Consequences

- New providers must implement an adapter that normalizes output to unified session updates. The domain layer never sees raw provider events.
- Session persistence, traces, and UI streaming code is written once against the normalized interface.
- The Rust backend mirrors this in `crates/routa-core/src/acp/` with its own adapter set.
- Model tier selection (which model per agent role) is a provider-layer concern, not a domain-layer concern.

## Code References

- `src/core/acp/provider-registry.ts` — provider discovery and registration
- `src/core/acp/claude-code-sdk-adapter.ts` — Claude Code SDK → ACP normalization
- `src/core/acp/acp-session-manager.ts` — session lifecycle management
- `src/core/acp/provider-adapter/` — per-provider adapters
- `crates/routa-core/src/acp/` — Rust ACP subsystem
