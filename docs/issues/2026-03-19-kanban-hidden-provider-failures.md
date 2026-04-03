---
title: "Kanban card override can hide ACP provider runtime failures"
date: "2026-03-19"
status: resolved
resolved_at: "2026-03-19"
severity: high
area: "kanban"
tags: [kanban, acp, provider, runtime-error, ui, automation]
reported_by: "Codex"
github_issue: 201
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/201"
related_issues: [
  "docs/issues/2026-03-11-card-detail-rerun-mechanism-issues.md",
  "docs/issues/2026-03-17-dev-acp-session-watchdog-auto-recovery.md",
  "https://github.com/phodal/routa/issues/201"
]
---

# Kanban card override can hide ACP provider runtime failures

## What Happened

In the Kanban card detail overlay, a user can select a different ACP provider in `Card Session Override` and manually rerun the card. When the selected provider fails at runtime, the failure is not surfaced clearly in the Kanban UI even though the underlying ACP session reports an error.

Observed behavior in this flow:

1. Open a Kanban card detail panel and expand `Card Session Override`.
2. Choose a provider such as `Auggie` and rerun the card.
3. The right-side session pane shows provider stderr with an ACP/runtime error such as `Permission denied: HTTP error: 403 Forbidden`.
4. The left-side `Execution` panel still looks mostly normal, without an explicit provider failure banner or actionable guidance.
5. The provider selector itself does not indicate that the chosen provider is risky, unavailable, or recently failed.

## Expected Behavior

- If a selected ACP provider fails during session startup or prompt execution, the Kanban card detail UI should show that failure clearly in the `Execution` panel.
- The user should be able to understand which provider failed, why it failed, and what to do next without opening stderr or trace details.
- The Kanban provider selector should reflect provider health/status in a way consistent with the main ACP input experience.
- Kanban workflow automation should not treat a JSON-RPC or streamed ACP error as a successful run.

## Reproduction Context

- Environment: web
- Trigger: selecting a Kanban card override provider and running a card with a provider that can start but fails during prompt execution or authorization

## Why This Might Happen

- The Kanban override provider selector appears to use a flattened list of available providers and does not expose provider health metadata or unavailable reasons.
- The Kanban automation prompt path may rely on HTTP success instead of inspecting JSON-RPC error payloads or streamed error events.
- Standard ACP provider error notifications may not be normalized into semantic failure events consistently.
- The card detail execution UI may not currently render `acpError` or `lastSyncError` even when those fields are available elsewhere in the session/task model.

## Relevant Files

- `src/core/kanban/agent-trigger.ts`
- `src/core/kanban/workflow-orchestrator-singleton.ts`
- `src/app/api/acp/route.ts`
- `src/core/acp/provider-adapter/standard-acp-adapter.ts`
- `src/core/acp/agent-event-bridge/agent-event-bridge.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `src/app/api/providers/route.ts`

## Observations

- The user-provided screenshot shows a Kanban card with `Auggie · DEVELOPER · None` selected in override state while the session pane stderr reports `HTTP error: 403 Forbidden`.
- The same Kanban surface does not currently provide a clear inline error banner in the execution panel.
- The main ACP input already has richer provider-state UI than the Kanban override selector.
- Local verification screenshot captured at `/tmp/kanban-provider-failure/kanban-auggie-failure.png`.

## References

- User report and screenshot from the 2026-03-19 Kanban debugging session
- GitHub issue: https://github.com/phodal/routa/issues/201

## Resolution

This issue is resolved in the current codebase and the upstream GitHub issue is
closed.

Evidence in current implementation:

- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx` now derives a
  failure message from `sessionInfo.acpError` or `task.lastSyncError` via
  `getPromptFailureMessage(...)`.
- The same execution panel renders an explicit failure banner:
  `Current run failed on ...` together with actionable next steps for ACP or
  A2A reruns.
- `src/app/api/acp/acp-session-prompt.ts` marks prompt failures by updating the
  session ACP status to `error`, and `src/core/acp/prompt-response.ts` extracts
  explicit SSE error messages from streamed error envelopes.
- `src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab.test.tsx`
  contains a focused regression test,
  `surfaces provider runtime failures in the execution panel`, which verifies
  that the provider failure banner renders with the ACP error message.
