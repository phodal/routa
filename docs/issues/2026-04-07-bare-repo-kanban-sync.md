---
date: 2026-04-07
title: Bare Git Repository Handling in Kanban Workflow
status: resolved
severity: medium
area: kanban
affected_component: Kanban - Auto-sync
github_issue: 386
github_state: closed
github_url: https://github.com/phodal/routa/issues/386
---

# Bare Git Repository Handling in Kanban Workflow

## Problem

When the kanban page loads, it automatically syncs all codebases to the latest code. This failed with a confusing error when a codebase pointed to a bare git repository:

> phodal/routa: Repository path points to a bare git repo. Switch branches in a worktree instead.

**Impact:**
- Error displayed on every kanban page load
- Users confused about what to do
- Workflow disrupted

## Root Cause

1. **Auto-sync on page load**: `kanban-page-client.tsx` automatically calls `syncWorkspaceRepos()` for all codebases
2. **Bare repos have no working tree**: These operations fail:
   - `git checkout <branch>` - no working directory to check out to
   - `git pull --ff-only` - no working directory to update
   - `git status` - no working directory to check
3. **No validation**: System allowed adding bare repos as codebases without warning

## Why Users Had Bare Repos as Codebases

Users may accidentally add bare repositories as codebases:
- Manually pointing to a `.git` directory
- Pointing to a mirror clone (`git clone --mirror`)
- Pointing to a bare repo intended for worktree management
- Pointing to a repo that was converted to bare after initial setup

## Solution

Implemented 3 complementary fixes:

### 1. Skip Auto-Sync for Bare Repos

**File**: `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`

```typescript
const syncCodebaseToLatest = useCallback(async (codebase: CodebaseData): Promise<void> => {
  // Check if this is a bare repository
  const bareCheckRes = await desktopAwareFetch(...);
  const bareCheckData = await bareCheckRes.json().catch(() => ({}));
  
  // If the error mentions bare repo, skip sync
  if (!bareCheckRes.ok && bareCheckData.error?.includes("bare git repo")) {
    console.log(`[sync] Skipping bare repo: ${codebase.label}`);
    return; // Bare repos can't be synced
  }
  
  // ... rest of sync logic
}, []);
```

**Result**: Kanban page loads without errors even if workspace has bare repos.

### 2. Validate When Adding Codebase

**File**: `src/app/api/workspaces/[workspaceId]/codebases/route.ts`

```typescript
// Check if this is a bare repository
if (isBareGitRepository(repoPath)) {
  return NextResponse.json(
    { 
      error: "Cannot add a bare git repository as a codebase",
      suggestion: "Bare repos don't have a working directory and can't be synced or checked out. Clone a regular working copy instead, or use this repo as a worktree source for task-specific branches."
    },
    { status: 400 }
  );
}
```

**Result**: Users can't accidentally add bare repos as codebases.

### 3. Improved Error Messages

Updated 5 API endpoints to provide clearer, more actionable error messages:

**Before**:
```
"Repository path points to a bare git repo. Switch branches in a worktree instead."
```

**After**:
```json
{
  "error": "This repository is a bare git repository (no working directory)",
  "suggestion": "Bare repos can't be checked out or synced. Use them as worktree sources instead, or clone a regular working copy."
}
```

**Updated endpoints**:
- `/api/clone/branches` (PATCH - checkout)
- `/api/clone/branches` (DELETE - branch deletion)  
- `/api/clone` (PATCH - branch switch)
- `/api/workspaces/[workspaceId]/codebases/changes` (GET)
- `/api/tasks/[taskId]/changes` (GET)

## Testing

- ✅ All unit tests passing
- ✅ Updated test expectations to match new error format
- ✅ Manual testing: kanban loads correctly with bare repos present
- ✅ Validation prevents adding new bare repos

## Files Changed

- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx` - Skip auto-sync
- `src/app/api/workspaces/[workspaceId]/codebases/route.ts` - Add validation
- `src/app/api/clone/branches/route.ts` - Improved errors
- `src/app/api/clone/route.ts` - Improved errors
- `src/app/api/tasks/[taskId]/changes/route.ts` - Improved errors
- `src/app/api/workspaces/[workspaceId]/codebases/changes/route.ts` - Improved errors
- `src/app/api/clone/branches/__tests__/route.test.ts` - Updated tests
- `src/app/api/workspaces/[workspaceId]/codebases/changes/__tests__/route.test.ts` - Updated tests

## Related Work

The worktree mechanism itself is working correctly. This issue was about preventing users from accidentally using bare repos as regular codebases, which can't be synced or checked out.

Bare repos are still valid and useful as **worktree sources** - this is the intended use case where tasks create worktrees from a shared bare repo.
