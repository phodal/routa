# Routa Worktree Feature - Implementation Plan

## Context

When multiple Agents work in parallel on the same repository, they currently share the same working directory (`cwd`). This causes file conflicts -- one agent's uncommitted changes can interfere with another's. Git worktree allows creating multiple independent working directories from the same repository, each checked out on a different branch, without cloning the repo multiple times.

This feature adds **on-demand git worktree management** to Routa, enabling isolated working directories for parallel agent sessions. Inspired by the Intent project's worktree implementation.

**Requirements** (confirmed with user):
- Both TypeScript (Next.js) and Rust (Axum) backends
- Use case: multiple agents working in parallel on the same repo
- Trigger: on-demand manual creation (not automatic)
- No remote (SSH) worktree support needed

---

## Phase 1: Data Model + Store Layer

### 1.1 New TypeScript Model

**New file**: `src/core/models/worktree.ts`

```typescript
export type WorktreeStatus = "creating" | "active" | "error" | "removing";

export interface Worktree {
  id: string;
  codebaseId: string;
  workspaceId: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;        // branch this worktree was created from
  status: WorktreeStatus;
  sessionId?: string;        // ACP session currently using this worktree
  label?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Factory function `createWorktree(params)` following `createCodebase` pattern.

### 1.2 Postgres Schema

**New migration**: `drizzle/0014_add_worktrees.sql`

Add `worktrees` pgTable to `src/core/db/schema.ts`:

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | UUID |
| codebase_id | text NOT NULL | FK -> codebases(id) ON DELETE CASCADE |
| workspace_id | text NOT NULL | FK -> workspaces(id) ON DELETE CASCADE |
| worktree_path | text NOT NULL | absolute disk path |
| branch | text NOT NULL | branch checked out in worktree |
| base_branch | text NOT NULL | branch worktree was forked from |
| status | text NOT NULL DEFAULT 'creating' | creating/active/error/removing |
| session_id | text | optional FK to acp_sessions |
| label | text | human-readable label |
| error_message | text | error details when status=error |
| created_at | timestamp | |
| updated_at | timestamp | |

Index on `(workspace_id)` and `(codebase_id)`.

### 1.3 SQLite Schema (TS)

Add matching `worktrees` sqliteTable to `src/core/db/sqlite-schema.ts` (integer timestamps, text JSON).

### 1.4 Rust Model

**New file**: `crates/routa-core/src/models/worktree.rs`

Rust struct mirroring the TS model with `#[serde(rename_all = "camelCase")]`. Register in `crates/routa-core/src/models/mod.rs`.

### 1.5 Rust SQLite DDL

Add `CREATE TABLE IF NOT EXISTS worktrees (...)` to `crates/routa-core/src/db/mod.rs` `initialize_tables()`.

### 1.6 Files to modify/create

| File | Action |
|------|--------|
| `src/core/models/worktree.ts` | **Create** |
| `src/core/db/schema.ts` | Add worktrees pgTable |
| `src/core/db/sqlite-schema.ts` | Add worktrees sqliteTable |
| `drizzle/0014_add_worktrees.sql` | **Create** migration |
| `crates/routa-core/src/models/worktree.rs` | **Create** |
| `crates/routa-core/src/models/mod.rs` | Register worktree module |
| `crates/routa-core/src/db/mod.rs` | Add worktrees table DDL |

---

## Phase 2: Store Layer

### 2.1 TypeScript WorktreeStore

**New file**: `src/core/db/pg-worktree-store.ts`

Interface + PgWorktreeStore + InMemoryWorktreeStore (following `pg-codebase-store.ts` pattern):

- `add(worktree): Promise<void>`
- `get(id): Promise<Worktree | undefined>`
- `listByCodebase(codebaseId): Promise<Worktree[]>`
- `listByWorkspace(workspaceId): Promise<Worktree[]>`
- `updateStatus(id, status, errorMessage?): Promise<void>`
- `assignSession(id, sessionId | null): Promise<void>`
- `remove(id): Promise<void>`
- `findByBranch(codebaseId, branch): Promise<Worktree | undefined>`

Add `SqliteWorktreeStore` to `src/core/db/sqlite-stores.ts`.

### 2.2 Register in RoutaSystem

Modify `src/core/routa-system.ts`:
- Add `worktreeStore: WorktreeStore` to `RoutaSystem` interface
- Initialize in `createInMemorySystem()`, `createPgSystem()`, `createSqliteSystem()`

### 2.3 Rust WorktreeStore

**New file**: `crates/routa-core/src/store/worktree_store.rs`

Following `codebase_store.rs` pattern with `with_conn_async`. Register in:
- `crates/routa-core/src/store/mod.rs`
- `crates/routa-core/src/state.rs` (add to `AppStateInner`)

### 2.4 Files to modify/create

| File | Action |
|------|--------|
| `src/core/db/pg-worktree-store.ts` | **Create** |
| `src/core/db/sqlite-stores.ts` | Add SqliteWorktreeStore |
| `src/core/routa-system.ts` | Register worktreeStore |
| `crates/routa-core/src/store/worktree_store.rs` | **Create** |
| `crates/routa-core/src/store/mod.rs` | Register module |
| `crates/routa-core/src/state.rs` | Add worktree_store to AppStateInner |

---

## Phase 3: Git Worktree Service

### 3.1 TypeScript Service

**New file**: `src/core/git/git-worktree-service.ts`

**Concurrency lock**: Per-repository Promise chain (`Map<repoPath, Promise>`) to serialize git worktree operations on the same repo, preventing `.git/worktrees` corruption.

**Worktree path structure**:
```
~/.routa/worktrees/{workspaceId}/{codebaseId}/{branch-safe-name}/
```

Uses `~/.routa/worktrees/` as base dir (consistent with existing `~/.routa/repos/`).

**Core methods**:

1. `createWorktree(codebaseId, options: { branch?, baseBranch?, label? })`:
   - Get codebase -> repoPath
   - Acquire repo lock
   - `git worktree prune` (clean stale refs)
   - Check branch not already in use by another worktree
   - Auto-generate branch name if not provided: `wt/{workspaceId-short}-{label-or-uuid-short}`
   - Create DB record (status=creating)
   - `git worktree add -b <branch> <path> <baseBranch>` or `git worktree add <path> <existing-branch>`
   - Update DB (status=active), or (status=error) on failure

2. `removeWorktree(worktreeId, options: { deleteBranch? })`:
   - Get worktree record
   - Acquire repo lock
   - Update DB (status=removing)
   - `git worktree remove --force <path>`
   - `git worktree prune`
   - Optionally `git branch -D <branch>`
   - Delete DB record

3. `listWorktrees(codebaseId)`:
   - Query DB, optionally cross-check with `git worktree list --porcelain`

4. `validateWorktree(worktreeId)`:
   - Check path exists, `.git` file present, matches `git worktree list`
   - Update status=error if unhealthy

### 3.2 Rust Implementation

Add worktree functions to `crates/routa-core/src/git.rs`:
- `worktree_add(repo_path, worktree_path, branch, base_branch) -> Result<(), String>`
- `worktree_remove(repo_path, worktree_path, force) -> Result<(), String>`
- `worktree_list(repo_path) -> Vec<WorktreeListEntry>`
- `worktree_prune(repo_path) -> Result<(), String>`

Concurrency: Use `tokio::sync::Mutex<()>` per repo_path in the API layer.

### 3.3 Files to modify/create

| File | Action |
|------|--------|
| `src/core/git/git-worktree-service.ts` | **Create** |
| `crates/routa-core/src/git.rs` | Add worktree_add/remove/list/prune functions |

---

## Phase 4: REST API

### 4.1 TypeScript (Next.js) Routes

**New file**: `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/worktrees/route.ts`
- `GET` - List worktrees for a codebase
- `POST` - Create worktree `{ branch?, baseBranch?, label? }`

**New file**: `src/app/api/worktrees/[worktreeId]/route.ts`
- `GET` - Get single worktree details
- `DELETE` - Remove worktree `?deleteBranch=true`

**New file**: `src/app/api/worktrees/[worktreeId]/validate/route.ts`
- `POST` - Health check

### 4.2 Rust (Axum) Routes

**New file**: `crates/routa-server/src/api/worktrees.rs`

```
router() -> Router<AppState>
  /workspaces/{workspace_id}/codebases/{codebase_id}/worktrees  GET/POST
  /worktrees/{id}                                                GET/DELETE
  /worktrees/{id}/validate                                       POST
```

Register in `crates/routa-server/src/api/mod.rs`:
```rust
.nest("/api", worktrees::router())
```

### 4.3 Files to modify/create

| File | Action |
|------|--------|
| `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/worktrees/route.ts` | **Create** |
| `src/app/api/worktrees/[worktreeId]/route.ts` | **Create** |
| `src/app/api/worktrees/[worktreeId]/validate/route.ts` | **Create** |
| `crates/routa-server/src/api/worktrees.rs` | **Create** |
| `crates/routa-server/src/api/mod.rs` | Register worktrees router |

---

## Phase 5: ACP Session Integration

Modify ACP session creation to accept an optional `worktreeId` parameter:
- If provided, use the worktree's `worktreePath` as the session's `cwd`
- Mark the worktree's `sessionId` field with the new session ID
- When session ends, clear the worktree's `sessionId`

### Files to modify

| File | Action |
|------|--------|
| `src/app/api/acp/route.ts` | Accept worktreeId in createSession |
| `crates/routa-core/src/acp/mod.rs` | Accept worktree_id in create_session |

---

## Phase 6: Cleanup Logic

When a codebase is deleted:
1. Query all worktrees for that codebase
2. Execute `git worktree remove --force` for each
3. Execute `git worktree prune`
4. DB records auto-cascade-delete via FK

Modify existing codebase delete handlers:
- `src/app/api/workspaces/[workspaceId]/codebases/route.ts` (or wherever codebase DELETE lives)
- `crates/routa-server/src/api/codebases.rs` `delete_codebase`

---

## Implementation Order

1. **Phase 1** (Data Model) - Foundation, no runtime deps
2. **Phase 2** (Store) - Depends on Phase 1
3. **Phase 3** (Git Service) - Core logic, depends on Phase 2
4. **Phase 4** (API) - HTTP layer, depends on Phase 3
5. **Phase 5** (ACP Integration) - Optional enhancement, depends on Phase 4
6. **Phase 6** (Cleanup) - Safety net, depends on Phase 2+3

Each phase can be a separate PR/commit.

---

## Verification

### Build check
```bash
npm run build          # Next.js build
cd crates && cargo build  # Rust build
```

### Manual API test (after dev server running)
```bash
# 1. Create workspace + codebase (if not exists)
# 2. Create worktree
curl -X POST http://localhost:3000/api/workspaces/{wsId}/codebases/{cbId}/worktrees \
  -H 'Content-Type: application/json' \
  -d '{"branch": "wt/test-feature", "baseBranch": "main"}'

# 3. List worktrees
curl http://localhost:3000/api/workspaces/{wsId}/codebases/{cbId}/worktrees

# 4. Validate worktree
curl -X POST http://localhost:3000/api/worktrees/{wtId}/validate

# 5. Verify disk: ls ~/.routa/worktrees/{wsId}/{cbId}/

# 6. Delete worktree
curl -X DELETE http://localhost:3000/api/worktrees/{wtId}?deleteBranch=true

# 7. Verify cleanup: disk path gone, git worktree list shows removal
```

### Playwright E2E (if UI added)
- Use Playwright to navigate workspace page, create/list/delete worktrees

### Rust backend test
```bash
cd crates && cargo test
# Same curl tests against http://127.0.0.1:3210/api/...
```

---

## GitHub Issues to Create

After plan approval, create the following issues with `--label "Agent"`:

1. **[Worktree] Data model: worktrees table + model + migration** (Phase 1+2)
2. **[Worktree] Git worktree service with concurrency lock** (Phase 3)
3. **[Worktree] REST API endpoints for worktree CRUD** (Phase 4)
4. **[Worktree] ACP session integration with worktreeId** (Phase 5)
5. **[Worktree] Cleanup logic on codebase/workspace delete** (Phase 6)
