---
title: "Rust tasks API performance analysis confirmed similar hot-path issues"
date: "2026-04-09"
kind: analysis
status: resolved
severity: medium
area: "backend"
tags: ["rust", "tasks-api", "performance", "analysis"]
reported_by: "agent"
related_issues:
  - "https://github.com/phodal/routa/issues/406"
  - "2026-04-09-next-task-api-head-of-line-blocking.md"
github_issue: 406
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/406"
resolved_at: "2026-04-11"
resolution: "Merged into the broader task API performance tracker so Next.js and Rust evidence live under one active issue family."
---

# Rust Tasks API Performance Analysis

**Date:** 2026-04-09  
**Related Issue:** #406 (Next.js performance issues)  
**Status:** Analysis Complete - Issues Confirmed

## Executive Summary

The Rust backend has **similar performance issues** to the Next.js version identified in #406. While Rust's async runtime provides better baseline performance, the API design patterns introduce the same N+1 query and synchronous Git execution problems.

## Deduplication Note

This file remains as supporting evidence, but it is no longer treated as a
separate active issue. The active tracker is
`docs/issues/2026-04-09-next-task-api-head-of-line-blocking.md`, which now
covers both the Next.js bottleneck and the Rust parity findings tied to GitHub
issue `#406`.

## Issues Identified

### ❌ Issue 1: Heavy Task List Serialization (N+1 Queries)

**Location:** `crates/routa-server/src/api/tasks/handlers.rs:191-217`

**Problem:**
```rust
async fn list_tasks(/*...*/) -> Result</*...*/, ServerError> {
    let tasks = state.task_store.list_by_workspace(workspace_id).await?;
    let mut serialized_tasks = Vec::with_capacity(tasks.len());
    for task in &tasks {
        serialized_tasks.push(serialize_task_with_evidence(&state, task).await?); // ❌ N+1
    }
    Ok(Json(serde_json::json!({ "tasks": serialized_tasks })))
}
```

**Impact:**
- For each task in the list, `serialize_task_with_evidence` is called
- This triggers `build_task_evidence_summary` which makes:
  - `state.artifact_store.list_by_task(&task.id)` - **N artifact queries**
  - `state.kanban_store.get(board_id)` - **N board queries**

**Example:** 50 tasks = 1 task list query + 50 artifact queries + 50 board queries = **101 queries**

### ❌ Issue 2: Duplicate Board Queries

**Location:** `crates/routa-server/src/api/tasks/evidence.rs:18-68`

**Problem:**
```rust
async fn serialize_task_with_evidence(state: &AppState, task: &Task) -> Result</*...*/, ServerError> {
    let evidence_summary = build_task_evidence_summary(state, task).await?; // Query 1
    let board = match task.board_id.as_deref() {
        Some(board_id) => state.kanban_store.get(board_id).await?,  // Query 2 (duplicate!)
        None => None,
    };
    // ...
}
```

The same board is queried **twice** for each task:
1. Inside `build_task_evidence_summary` (line 147 in evidence.rs)
2. Again in `serialize_task_with_evidence` (line 24)

### ❌ Issue 3: Synchronous Git Execution

**Location:** `crates/routa-core/src/git.rs` (throughout)

**Problem:**
All Git operations use synchronous `Command::new("git")...output()`:

```rust
pub fn get_repo_changes(repo_path: &str) -> RepoChanges {
    let branch = get_current_branch(repo_path).unwrap_or_else(|| "unknown".into());
    let status = get_repo_status(repo_path);  // Synchronous git status
    let files = Command::new("git")
        .args(["status", "--porcelain", "-uall"])
        .current_dir(repo_path)
        .output()  // ❌ Blocks the async executor thread!
        .ok()
        // ...
}
```

**Impact:**
- Blocks Tokio worker threads during Git operations
- Can cause head-of-line blocking for other concurrent requests
- Especially problematic for operations like:
  - `get_repo_changes` (git status)
  - `get_repo_file_diff` (git diff)
  - `get_repo_commit_diff` (git show)

### ❌ Issue 4: No Caching Layer

**Missing:** No caching of:
- Board configurations (queried repeatedly for same board_id)
- Artifact counts per task
- Git repository status
- Codebase/worktree metadata

## Performance Comparison with Next.js

| Issue | Next.js (#406) | Rust Backend | Severity |
|-------|---------------|--------------|----------|
| N+1 artifact queries | ✅ Yes | ✅ Yes | High |
| N+1 board queries | ✅ Yes | ✅ Yes | High |
| Duplicate board query | ❌ No | ✅ Yes | Medium |
| Sync Git execution | ✅ Yes (execSync) | ✅ Yes (Command::output) | High |
| No caching | ✅ Yes | ✅ Yes | Medium |
| Queue blocking | ✅ Yes (event loop) | ✅ Yes (thread pool) | High |

## Recommended Solutions

### 1. Implement Batch Loading (High Priority)

Add batch query methods to stores:

```rust
// In artifact_store
pub async fn list_by_tasks(&self, task_ids: &[String]) -> Result<HashMap<String, Vec<Artifact>>>;

// In kanban_store  
pub async fn get_many(&self, board_ids: &[String]) -> Result<HashMap<String, KanbanBoard>>;
```

Then modify `list_tasks`:

```rust
async fn list_tasks(/*...*/) -> Result</*...*/, ServerError> {
    let tasks = state.task_store.list_by_workspace(workspace_id).await?;
    
    // Batch load all artifacts and boards
    let task_ids: Vec<_> = tasks.iter().map(|t| t.id.clone()).collect();
    let board_ids: Vec<_> = tasks.iter().filter_map(|t| t.board_id.clone()).collect();
    
    let artifacts_map = state.artifact_store.list_by_tasks(&task_ids).await?;
    let boards_map = state.kanban_store.get_many(&board_ids).await?;
    
    // Serialize with pre-loaded data
    let serialized_tasks = serialize_tasks_batch(&tasks, &artifacts_map, &boards_map);
    Ok(Json(serde_json::json!({ "tasks": serialized_tasks })))
}
```

**Estimated improvement:** 101 queries → 3 queries (97% reduction)

### 2. Use Async Git Execution (High Priority)

Replace synchronous `Command::output()` with `tokio::process::Command`:

```rust
// Before (blocking):
pub fn get_repo_status(repo_path: &str) -> RepoStatus {
    let output = Command::new("git")
        .args(["status", "--porcelain", "-uall"])
        .current_dir(repo_path)
        .output()  // ❌ Blocks
        .ok()?;
    // ...
}

// After (async):
pub async fn get_repo_status(repo_path: &str) -> Result<RepoStatus, Error> {
    let output = tokio::process::Command::new("git")
        .args(["status", "--porcelain", "-uall"])
        .current_dir(repo_path)
        .output()  // ✅ Async
        .await?;
    // ...
}
```

**Benefits:**
- No blocking of Tokio worker threads
- Better concurrent request handling
- Eliminates head-of-line blocking

### 3. Add Caching Layer (Medium Priority)

Implement a simple in-memory cache with TTL:

```rust
use moka::future::Cache;
use std::time::Duration;

pub struct CachedKanbanStore {
    inner: Arc<KanbanStore>,
    cache: Cache<String, Arc<KanbanBoard>>,
}

impl CachedKanbanStore {
    pub fn new(inner: Arc<KanbanStore>) -> Self {
        Self {
            inner,
            cache: Cache::builder()
                .max_capacity(100)
                .time_to_live(Duration::from_secs(60))
                .build(),
        }
    }

    pub async fn get(&self, id: &str) -> Result<Option<Arc<KanbanBoard>>> {
        if let Some(cached) = self.cache.get(id).await {
            return Ok(Some(cached));
        }

        if let Some(board) = self.inner.get(id).await? {
            let board = Arc::new(board);
            self.cache.insert(id.to_string(), board.clone()).await;
            Ok(Some(board))
        } else {
            Ok(None)
        }
    }
}
```

**Cache candidates:**
- Board configurations (rarely change)
- Repository status (TTL: 5-10 seconds)
- Artifact counts (TTL: 30 seconds)

### 4. Optimize serialize_task_with_evidence (Medium Priority)

Remove the duplicate board query:

```rust
async fn serialize_task_with_evidence(
    state: &AppState,
    task: &Task,
    board: Option<&KanbanBoard>,  // Pass pre-loaded board
) -> Result<serde_json::Value, ServerError> {
    let evidence_summary = build_task_evidence_summary(state, task, board).await?;
    let story_readiness = build_task_story_readiness(
        task,
        &resolve_next_required_task_fields(board, task.column_id.as_deref()),
    );
    // ... (no second board query needed)
}
```

### 5. Add Streaming Response for Large Lists (Low Priority)

For very large task lists, consider streaming:

```rust
use futures::stream::StreamExt;

async fn list_tasks_stream(/*...*/) -> impl Stream<Item = Result<Task, Error>> {
    let tasks = state.task_store.list_by_workspace(workspace_id).await?;
    futures::stream::iter(tasks)
        .map(|task| serialize_task_with_evidence(&state, &task).await)
}
```

## Priority Action Items

1. **Immediate (This Week)**
   - [ ] Implement batch loading for artifacts and boards
   - [ ] Remove duplicate board query in `serialize_task_with_evidence`

2. **Short Term (Next Sprint)**
   - [ ] Convert Git operations to async (`tokio::process::Command`)
   - [ ] Add caching layer for boards and repository status

3. **Medium Term (Next Month)**
   - [ ] Implement lazy loading for task details (only load when expanded)
   - [ ] Add pagination for task lists
   - [ ] Consider GraphQL with DataLoader pattern

## Testing Plan

1. **Benchmark Current Performance**
   ```bash
   ab -n 100 -c 10 http://localhost:3210/api/tasks?workspaceId=default
   ```

2. **Monitor Database Queries**
   - Enable SQLite query logging
   - Count queries per request

3. **Profile Git Operations**
   - Measure time spent in Git commands
   - Identify slowest operations

4. **Load Testing**
   - Test with 100+ tasks
   - Concurrent requests (10+ clients)
   - Measure response time and throughput

## Related Files

- `crates/routa-server/src/api/tasks/handlers.rs` - Task API handlers
- `crates/routa-server/src/api/tasks/evidence.rs` - Evidence aggregation
- `crates/routa-server/src/api/tasks/changes.rs` - Git change tracking
- `crates/routa-core/src/git.rs` - Git operations
- Next.js issue: #406

## References

- Issue #406: Next.js tasks API performance problems
- [Tokio Best Practices](https://tokio.rs/tokio/topics/bridging)
- [Async Rust Book - Blocking](https://rust-lang.github.io/async-book/08_ecosystem/00_chapter.html)
