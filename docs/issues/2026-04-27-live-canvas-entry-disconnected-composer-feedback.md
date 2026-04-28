---
title: "Live Canvas entry gives no usable next step when the composer is disconnected"
date: "2026-04-27"
kind: issue
status: resolved
severity: medium
area: "ui"
tags: ["canvas", "session", "ux", "dogfood"]
reported_by: "codex"
related_issues: ["https://github.com/phodal/routa/pull/536"]
github_issue: 537
github_state: closed
github_url: "https://github.com/phodal/routa/issues/537"
---

# Live Canvas entry gives no usable next step when the composer is disconnected

## What Happened

During local dogfood testing of the live session Canvas entry, the session page showed a clickable `Use Canvas` action while the chat composer was disconnected.

After clicking `Use Canvas`, the action label changed to `Canvas`, but the composer stayed empty and continued to show the disabled `Connect first...` placeholder. No generated Canvas prompt, toast, inline message, disabled state, or recovery guidance was shown.

## Expected Behavior

The Canvas entry should not leave the user in a dead-end state. It should either:

- Be disabled until the composer can accept and send the generated Canvas prompt.
- Or show clear guidance that the user must select/connect a provider before Canvas mode can start.

## Reproduction Context

- Environment: web
- URL: `http://localhost:3000/workspace/default/sessions/session-1`
- Branch: `feat/live-canvas-session-entry`
- Trigger: click `Use Canvas` while the composer shows `Connect first...`

Steps:

1. Start the local Next.js dev server with `npm run dev -- --port 3000`.
2. Open `/workspace/default/sessions/session-1`.
3. Confirm the composer shows `Connect first...`.
4. Click `Use Canvas`.
5. Observe that the button label changes to `Canvas`, but the composer remains empty and no guidance appears.

## Why This Might Happen

- The Canvas prefill state may be set while the composer refuses or hides prefilled text in a disconnected state.
- The Canvas entry likely does not share the same availability/disabled contract as the chat composer send path.
- The post-click UI state may indicate Canvas mode without verifying that the user can actually proceed.

## Relevant Files

- `src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx`
- `src/client/components/session-canvas-panel.tsx`
- `src/core/canvas/session-canvas-prompt.ts`

## Observations

- Dogfood report: `docs/issues/assets/2026-04-27-live-canvas-entry/report.md`
- Repro video: `docs/issues/assets/2026-04-27-live-canvas-entry/videos/canvas-entry-repro.webm`
- Initial screenshot: `docs/issues/assets/2026-04-27-live-canvas-entry/screenshots/initial-session.png`
- Result screenshot: `docs/issues/assets/2026-04-27-live-canvas-entry/screenshots/canvas-entry-result.png`
- Browser console showed no runtime errors during reproduction.
- Resolved on 2026-04-28 by disabling the Canvas action while ACP is disconnected and pre-filling a localized default Canvas request when the action is enabled.
- Verification: targeted Vitest, `npx tsc --noEmit`, targeted ESLint, browser smoke on `http://localhost:3000/workspace/default/sessions/session-1`, and `entrix run --tier fast`.

## References

- PR: https://github.com/phodal/routa/pull/536
- GitHub issue: https://github.com/phodal/routa/issues/537
