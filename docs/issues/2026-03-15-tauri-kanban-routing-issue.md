---
date: 2026-03-15
agent: Augment Agent (Claude Sonnet 4.5)
status: resolved
severity: high
component: tauri-frontend
---

# Tauri Kanban Routing Issue

## Problem

When clicking "Open board" on the homepage in the Tauri desktop app, the URL changes to `/workspace/{id}/kanban` but the page displays the workspace detail page (with HomeInput and tabs) instead of the standalone Kanban page.

## Root Cause

Next.js static export only generates placeholder paths:
- `/workspace/__placeholder__`
- `/workspace/__placeholder__/kanban`

When accessing a real workspace ID like `/workspace/8844519a-5f3c-437c-aac4-286d2e7517a7/kanban`, the Rust backend cannot find the corresponding static HTML file and falls back to serving the wrong page.

## Evidence

### Expected Behavior (Next.js dev server on port 3000)
- Clean Kanban page with only:
  - Top navigation bar
  - Small input box for creating tasks
  - Kanban columns (Backlog, Todo, Dev, etc.)
  - No large HomeInput component
  - No tabs (Kanban/Notes/Activity)

### Actual Behavior (Tauri/Rust backend on port 3210)
- Workspace detail page with:
  - Large HomeInput component ("What are you working on?")
  - Three tabs: Kanban, Notes, Activity
  - Kanban board displayed below the tabs
  - URL shows `/workspace/{id}/kanban` but content is from `/workspace/{id}`

## Test Results

E2E test screenshot: `test-results/tauri-homepage-03-kanban-page.png`

Page snapshot shows:
- Line 32-66: HomeInput component (should not be present)
- Line 91-93: Tab buttons (should not be present)
- Line 110-146: Kanban columns (correct, but in wrong context)

## Impact

- Users cannot access the standalone Kanban view in Tauri app
- Navigation is confusing (URL says `/kanban` but shows workspace page)
- Breaks the expected user flow: Homepage → Open board → Kanban page

## Possible Solutions

1. **Client-side routing**: Use Next.js client-side routing to handle dynamic workspace IDs
2. **Fallback HTML**: Configure Rust backend to serve a generic fallback HTML that handles routing client-side
3. **SPA mode**: Build Next.js as a true SPA with a single `index.html` and client-side routing
4. **Pre-generate common paths**: Generate static HTML for common workspace IDs (not scalable)

## Related Files

- `src/app/workspace/[workspaceId]/kanban/page.tsx` - Kanban page component
- `src/app/workspace/[workspaceId]/page.tsx` - Workspace detail page
- `crates/routa-server/src/lib.rs` - Rust backend static file serving
- `next.config.ts` - Next.js static export configuration

## Resolution

**Fixed in commit:** [pending]

The issue was resolved by updating the Rust backend's static file serving logic in `crates/routa-server/src/lib.rs` to correctly map the `/workspace/{workspaceId}/kanban` route to `workspace/__placeholder__/kanban.html`.

### Changes Made

1. Added kanban route handling in the fallback service:
   ```rust
   } else if segments.len() == 2 && segments[1] == "kanban" {
       // /workspace/{workspaceId}/kanban[.txt]
       (
           format!("workspace/__placeholder__/kanban.{}", ext),
           content,
       )
   }
   ```

2. Updated comments to document the kanban route mapping

### Verification

- ✅ E2E test `e2e/homepage-open-board-tauri.spec.ts` now passes
- ✅ Kanban page loads correctly on Tauri backend (port 3210)
- ✅ No more workspace detail page showing when navigating to kanban
- ✅ Correct page content: Kanban columns, task input, no HomeInput component

