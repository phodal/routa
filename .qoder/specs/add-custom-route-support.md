# Docker Container Reuse (Issue #72)

## Context

Every Docker ACP session creates a fresh container and destroys it on session end. The Bridge Server already supports multiple sessions (`sessions = new Map()`), but Routa always calls `stopContainer` — no reuse. This causes 10-15s hot-start latency per session. Container reuse reduces subsequent sessions to ~2s (just a Bridge `POST /session/new`).

**Scope**: Phase 1 container reuse only. Match by image name only (not workspace). Both TypeScript and Rust backends.

## Architecture Difference Between Backends

- **TypeScript (Next.js)**: `AcpProcessManager` has `dockerAdapters` map, `createDockerSession()` calls `startContainer`, `killSession()` calls `stopContainer` directly (line 901).
- **Rust (Axum)**: `AcpManager` has NO Docker-specific code. Docker is managed via separate HTTP API endpoints in `acp_docker.rs`. `kill_session()` only kills generic ACP/Claude processes.

This means Rust changes are simpler — only `DockerProcessManager` and API routes.

## Implementation Steps

### Step 1: Extend TypeScript types (`src/core/acp/docker/types.ts`)

Add a new `PooledContainerInfo` interface (internal to process-manager, not serialized to API):

```typescript
export interface PooledContainerInfo extends DockerContainerInfo {
  poolKey: string;                    // image name used for reuse matching
  status: "active" | "idle";
  activeSessionIds: Set<string>;      // sessions currently using this container
  lastActiveAt: Date;
  idleTimerId?: ReturnType<typeof setTimeout>;
}
```

Keep `DockerContainerInfo` unchanged (it's the API-facing type).

### Step 2: Refactor TypeScript `DockerProcessManager` (`src/core/acp/docker/process-manager.ts`)

Replace the internal data structures:

```
// OLD
private containers = new Map<string, DockerContainerInfo>();

// NEW
private containerPool = new Map<string, PooledContainerInfo>();   // poolKey (image) → container
private sessionToPoolKey = new Map<string, string>();             // sessionId → poolKey
```

Add constants:
```typescript
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
```

**New methods:**

1. **`acquireContainer(config: DockerContainerConfig): Promise<{ container: DockerContainerInfo; reused: boolean }>`**
   - Compute `poolKey = config.image || DEFAULT_DOCKER_AGENT_IMAGE`
   - Check `containerPool.get(poolKey)`:
     - If found: health check (`GET /health`). If healthy → cancel idle timer, add sessionId to `activeSessionIds`, set status="active", update `sessionToPoolKey`. Return `{ container, reused: true }`.
     - If found but unhealthy: `destroyContainer(poolKey)`, fall through to new creation.
   - If not found: call existing `startContainer(config)` internally (keep `--rm`), wrap result in `PooledContainerInfo`, store in `containerPool` and `sessionToPoolKey`. Return `{ container, reused: false }`.

2. **`releaseContainer(sessionId: string): void`**
   - Look up `poolKey` from `sessionToPoolKey`
   - Remove sessionId from `activeSessionIds`
   - Delete from `sessionToPoolKey`
   - If `activeSessionIds` is empty:
     - Set status="idle", update `lastActiveAt`
     - Start idle timeout: `setTimeout(() => destroyContainer(poolKey), idleTimeoutMs)`
     - Store timer in `idleTimerId`

3. **`destroyContainer(poolKey: string): Promise<void>`**
   - Get container from `containerPool`
   - Clear idle timer if any
   - Run `docker stop -t 10` → `docker kill` → `docker rm -f` (same as current `stopContainer`)
   - Remove from `containerPool`, `usedPorts`
   - Clean up any remaining `sessionToPoolKey` entries pointing to this poolKey

**Modify existing methods:**

- **`listContainers()`**: iterate `containerPool.values()` instead of `containers.values()`
- **`getContainer(sessionId)`**: look up via `sessionToPoolKey` → `containerPool`
- **`stopContainer(sessionId)`**: keep as public API for manual stop. Internally: find poolKey, call `destroyContainer(poolKey)`.
- **`stopAll()`**: iterate `containerPool` keys, call `destroyContainer` for each.
- **`startContainer()`**: make private. Remove from public API (callers use `acquireContainer`).
- **`waitForHealthy(sessionId)`**: update to find container via `sessionToPoolKey` → `containerPool` instead of `containers.get(sessionId)`.

**Add resource limits** to the internal `startContainer` docker run command:
```
--memory=${process.env.ROUTA_DOCKER_MEMORY_LIMIT || "4g"}
--cpus=${process.env.ROUTA_DOCKER_CPU_LIMIT || "2"}
--pids-limit=${process.env.ROUTA_DOCKER_PIDS_LIMIT || "256"}
```

### Step 3: Adapt TypeScript `AcpProcessManager` (`src/core/acp/acp-process-manager.ts`)

**`createDockerSession` (line 237-302):**
```
// OLD
const container = await dockerManager.startContainer({...});
await dockerManager.waitForHealthy(sessionId, undefined, onNotification);

// NEW
const { container, reused } = await dockerManager.acquireContainer({...});
if (!reused) {
  await dockerManager.waitForHealthy(sessionId, undefined, onNotification);
}
```

**`killSession` (line 897-903):**
```
// OLD (line 901)
getDockerProcessManager().stopContainer(sessionId).catch(() => {});

// NEW
getDockerProcessManager().releaseContainer(sessionId);
```

**`killAll` (line 938-942):** Keep as-is — `stopAll()` will destroy all pooled containers.

### Step 4: Extend Rust types (`crates/routa-core/src/acp/docker/types.rs`)

Add runtime-only fields to a new internal struct (not serialized):

```rust
pub struct PooledContainerInfo {
    pub info: DockerContainerInfo,
    pub pool_key: String,
    pub status: ContainerStatus,  // enum { Active, Idle }
    pub active_session_ids: HashSet<String>,
    pub last_active_at: DateTime<Utc>,
    // idle timer is a JoinHandle, stored separately
}

#[derive(Debug, Clone, PartialEq)]
pub enum ContainerStatus {
    Active,
    Idle,
}
```

### Step 5: Refactor Rust `DockerProcessManager` (`crates/routa-core/src/acp/docker/process_manager.rs`)

Mirror TypeScript changes:

```rust
pub struct DockerProcessManager {
    container_pool: Arc<RwLock<HashMap<String, PooledContainerInfo>>>,  // poolKey → container
    session_to_pool_key: Arc<RwLock<HashMap<String, String>>>,          // sessionId → poolKey
    used_ports: Arc<RwLock<HashSet<u16>>>,
    idle_timers: Arc<RwLock<HashMap<String, tokio::task::JoinHandle<()>>>>,  // poolKey → timer
}
```

**New methods** (mirror TypeScript):
- `acquire_container(config) -> Result<(DockerContainerInfo, bool), String>` — reuse or create
- `release_container(session_id)` — detach session, start idle timer if empty
- `destroy_container(pool_key)` — kill container, cleanup

**Idle timeout** via `tokio::spawn` + `tokio::time::sleep`:
```rust
let handle = tokio::spawn(async move {
    tokio::time::sleep(Duration::from_millis(idle_timeout_ms)).await;
    // destroy container
});
// Cancel with handle.abort()
```

**Resource limits**: same `--memory`, `--cpus`, `--pids-limit` flags.

### Step 6: Adapt Rust API routes (`crates/routa-server/src/api/acp_docker.rs`)

- **`start_container` endpoint**: call `acquire_container` instead of `start_container`. Add `reused: bool` to response JSON.
- **`stop_container` endpoint**: keep as-is (manual stop → `destroy_container`).
- Add new **`POST /api/acp/docker/container/release`** endpoint that calls `release_container(session_id)`.

### Step 7: Add idle timeout env var to utils

**TypeScript** (`src/core/acp/docker/utils.ts`):
```typescript
export const DEFAULT_IDLE_TIMEOUT_MS = Number(process.env.ROUTA_DOCKER_IDLE_TIMEOUT_MS) || 5 * 60 * 1000;
```

**Rust** (`crates/routa-core/src/acp/docker/utils.rs`):
```rust
pub const DEFAULT_IDLE_TIMEOUT_MS: u64 = 5 * 60 * 1000; // 5 minutes
```

## Files to Modify

| File | Change |
|------|--------|
| `src/core/acp/docker/types.ts` | Add `PooledContainerInfo` interface |
| `src/core/acp/docker/utils.ts` | Add `DEFAULT_IDLE_TIMEOUT_MS` constant |
| `src/core/acp/docker/process-manager.ts` | **Core refactor**: pool data structures, `acquireContainer`, `releaseContainer`, `destroyContainer`, resource limits |
| `src/core/acp/acp-process-manager.ts` | `createDockerSession` → `acquireContainer`, `killSession` → `releaseContainer` |
| `crates/routa-core/src/acp/docker/types.rs` | Add `PooledContainerInfo`, `ContainerStatus` |
| `crates/routa-core/src/acp/docker/utils.rs` | Add `DEFAULT_IDLE_TIMEOUT_MS` constant |
| `crates/routa-core/src/acp/docker/process_manager.rs` | **Core refactor**: mirror TypeScript pool logic with tokio timers |
| `crates/routa-server/src/api/acp_docker.rs` | `start_container` → `acquire_container`, add `release` endpoint |

## Bridge Server: No Changes

`docker/opencode-bridge/server.js` — zero modifications needed. It already supports:
- Multiple sessions via `sessions = new Map()`
- `POST /session/new` with `cwd` parameter for per-session working directory
- `POST /session/delete` for single session cleanup

## Edge Cases

| Case | Handling |
|------|---------|
| Container crashes while idle | `acquireContainer` health check fails → `destroyContainer` → create new |
| Two sessions request same image simultaneously | First creates container, second waits then reuses (use lock around acquire) |
| Different workspace, same image | Bridge session's `cwd` param handles this (already supported) |
| `killAll` called | Destroys all containers, cancels all idle timers |
| Manual stop via API | `stopContainer` → `destroyContainer` (force-kills regardless of status) |
| Bridge sessions accumulate | `releaseContainer` calls adapter's `close()` → `POST /session/delete` |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ROUTA_DOCKER_IDLE_TIMEOUT_MS` | `300000` (5min) | Idle container auto-destroy timeout |
| `ROUTA_DOCKER_MEMORY_LIMIT` | `4g` | Container memory limit |
| `ROUTA_DOCKER_CPU_LIMIT` | `2` | Container CPU limit |
| `ROUTA_DOCKER_PIDS_LIMIT` | `256` | Container process count limit |

## Verification

1. **Build check**: `npm run build` (TypeScript), `cargo build` (Rust) — no errors
2. **Lint/type check**: `npm run lint`, `npm run typecheck`, `cargo clippy`
3. **Unit tests**: Run existing tests to ensure no regressions
4. **E2E test**: `e2e/docker-opencode.spec.ts` — update if needed to verify reuse behavior
5. **Manual test flow**:
   - Start a Docker OpenCode session → verify container starts
   - End the session → verify container stays running (idle)
   - Start a new session with same image → verify it reuses (no `docker run`, just `POST /session/new`)
   - Wait 5+ minutes → verify idle container is auto-destroyed
   - Check `docker ps --filter label=routa.managed` at each step
6. **Resource limits**: `docker inspect <container>` to verify `--memory`, `--cpus`, `--pids-limit` are set
