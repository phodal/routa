# Platform Abstraction Migration Guide

This guide shows how to migrate existing platform-specific code to use the
platform abstraction layer in `@/core/platform`.

## Quick Start

```typescript
import { getPlatformBridge, getServerBridge } from "@/core/platform";

// In client/shared code — auto-detects platform
const bridge = getPlatformBridge();

// In server-side code (API routes, server components) — always Web
const bridge = getServerBridge();
```

## Migration Examples

### 1. Process Spawning (child_process → bridge.process)

**Before:**
```typescript
import { spawn } from "child_process";

const proc = spawn(command, args, {
  stdio: ["pipe", "pipe", "pipe"],
  cwd,
  env: { ...process.env, ...env },
});
```

**After:**
```typescript
import { getServerBridge } from "@/core/platform";

const bridge = getServerBridge();
if (!bridge.process.isAvailable()) {
  throw new Error("Process spawning not available on this platform");
}

const proc = bridge.process.spawn(command, args, { cwd, env });
```

### 2. File System (fs → bridge.fs)

**Before:**
```typescript
import * as fs from "fs";
const content = fs.readFileSync(filePath, "utf-8");
const exists = fs.existsSync(dirPath);
```

**After:**
```typescript
import { getServerBridge } from "@/core/platform";

const bridge = getServerBridge();
const content = await bridge.fs.readTextFile(filePath);
const exists = await bridge.fs.exists(dirPath);
// Or sync (only on Web/Electron, throws on Tauri):
const contentSync = bridge.fs.readTextFileSync(filePath);
```

### 3. Git Operations (execSync → bridge.git)

**Before:**
```typescript
import { execSync } from "child_process";

function getCurrentBranch(repoPath: string): string {
  return execSync("git branch --show-current", { cwd: repoPath, encoding: "utf-8" }).trim();
}
```

**After:**
```typescript
import { getServerBridge } from "@/core/platform";

const bridge = getServerBridge();
const branch = await bridge.git.getCurrentBranch(repoPath);
```

### 4. Platform Detection (process.env → bridge.env)

**Before:**
```typescript
export function isServerlessEnvironment(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}
```

**After:**
```typescript
import { getPlatformBridge, isServerless, isDesktop, isTauri } from "@/core/platform";

// Quick helpers
if (isServerless()) { /* Vercel, Lambda, etc. */ }
if (isDesktop()) { /* Tauri or Electron */ }
if (isTauri()) { /* Tauri only */ }

// Full bridge
const bridge = getPlatformBridge();
bridge.env.isServerless();
bridge.env.isTauri();
bridge.env.homeDir();
```

### 5. Database Selection

The database layer now supports dual drivers (Postgres + SQLite) via a factory pattern:

**Before:**
```typescript
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
```

**After (platform bridge):**
```typescript
import { getServerBridge } from "@/core/platform";

const bridge = getServerBridge();
if (bridge.db.isDatabaseConfigured()) {
  const db = bridge.db.getDatabase();
  // db type depends on platform:
  //   - Web: NeonHttpDatabase (Postgres)
  //   - Tauri/Electron: BetterSQLite3Database (SQLite)
}
```

**After (database factory):**
```typescript
import { getDatabase, getDatabaseDriver, isDatabaseConfigured } from "@/core/db";

// Auto-detects: DATABASE_URL → Postgres, desktop → SQLite
const driver = getDatabaseDriver(); // "postgres" | "sqlite" | "memory"

if (isDatabaseConfigured()) {
  const db = getDatabase();
}
```

**Driver selection priority:**
1. `ROUTA_DB_DRIVER` env var (explicit override: "postgres" | "sqlite" | "memory")
2. `DATABASE_URL` present → Postgres
3. Non-serverless environment → SQLite
4. Fallback → InMemory

**Store factory (RoutaSystem):**
```typescript
import { getRoutaSystem } from "@/core/routa-system";

// Automatically creates Pg/Sqlite/InMemory stores based on driver
const system = getRoutaSystem();
```

**SQLite schema:** `src/core/db/sqlite-schema.ts` mirrors the Postgres schema
with SQLite-compatible types (integer timestamps, text JSON, etc.).

**SQLite stores:** `src/core/db/sqlite-stores.ts` provides
`SqliteWorkspaceStore`, `SqliteAgentStore`, `SqliteTaskStore`,
`SqliteConversationStore`, `SqliteNoteStore`.

### 6. Dialogs (Tauri/Electron only)

```typescript
import { getPlatformBridge } from "@/core/platform";

const bridge = getPlatformBridge();

// File open dialog
const filePath = await bridge.dialog.open({
  title: "Select workspace",
  directory: true,
});

// Native message dialog
await bridge.dialog.message("Task completed!", { type: "info" });
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Application Code                     │
│  (stores, orchestrator, tools, UI components)     │
├─────────────────────────────────────────────────┤
│          IPlatformBridge Interface                 │
│  (process, fs, db, git, terminal, dialog, ...)    │
├──────────┬──────────────┬───────────────────────┤
│ WebBridge│  TauriBridge │  ElectronBridge (future)│
│ (Node.js)│  (Tauri APIs)│  (IPC + Node.js)       │
└──────────┴──────────────┴───────────────────────┘
```

## Migration Status

The following core files have been migrated to use the platform bridge:

- [x] **`acp-process.ts`** — `child_process.spawn` → `bridge.process.spawn()`, `require("fs")` → `bridge.fs.*`
- [x] **`terminal-manager.ts`** — `child_process.spawn` → `bridge.process.spawn()`
- [x] **`claude-code-process.ts`** — `child_process.spawn` → `bridge.process.spawn()`
- [x] **`git-utils.ts`** — `execSync` → `bridge.process.execSync()`, `fs.*` → `bridge.fs.*`
- [x] **`acp-presets.ts`** — `process.env` → `bridge.env.getEnv()`, `require("fs")` → `bridge.fs.*`
- [x] **`utils.ts`** — `execFile` → `bridge.process.which()`, `fs.*` → `bridge.fs.*`
- [x] **`skill-loader.ts`** — `fs.*` → `bridge.fs.*`
- [x] **`db/index.ts`** — Neon-only → multi-driver factory (Postgres + SQLite)
- [x] **`routa-system.ts`** — Added `createSqliteSystem()` alongside `createPgSystem()`

### Remaining (lower priority)

- [ ] **`specialist-file-loader.ts`** — fs → `bridge.fs.*`
- [ ] **`mcp-setup.ts`** — fs → `bridge.fs.*`
- [ ] **`acp-installer.ts`** — fs/child_process → bridge
- [ ] **API routes** (`src/app/api/**`) — These run server-side and can continue using Node.js APIs directly. For Tauri, the frontend should use `bridge.invoke()` instead of `fetch("/api/...")`.
