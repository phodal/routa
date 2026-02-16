/**
 * RoutaSystem - port of routa-core RoutaFactory / RoutaSystem
 *
 * Central system object that holds all stores, event bus, and tools.
 * Supports three storage modes:
 *   1. InMemory (no database) — for quick dev / tests
 *   2. Postgres (DATABASE_URL set) — Neon Serverless via Drizzle ORM (Web/Vercel)
 *   3. SQLite (ROUTA_DB_DRIVER=sqlite or desktop) — local file via better-sqlite3 (Tauri/Electron)
 *
 * Workspace is a first-class citizen: every agent/task/note belongs
 * to a workspace. A "default" workspace is auto-created on first use.
 */

import { InMemoryAgentStore, AgentStore } from "./store/agent-store";
import { InMemoryConversationStore, ConversationStore } from "./store/conversation-store";
import { InMemoryTaskStore, TaskStore } from "./store/task-store";
import { NoteStore } from "./store/note-store";
import { WorkspaceStore, InMemoryWorkspaceStore } from "./db/pg-workspace-store";
import { EventBus } from "./events/event-bus";
import { AgentTools } from "./tools/agent-tools";
import { NoteTools } from "./tools/note-tools";
import { WorkspaceTools } from "./tools/workspace-tools";
import { CRDTNoteStore } from "./notes/crdt-note-store";
import { CRDTDocumentManager } from "./notes/crdt-document-manager";
import { NoteEventBroadcaster, getNoteEventBroadcaster } from "./notes/note-event-broadcaster";

export interface RoutaSystem {
  agentStore: AgentStore;
  conversationStore: ConversationStore;
  taskStore: TaskStore;
  noteStore: NoteStore;
  workspaceStore: WorkspaceStore;
  eventBus: EventBus;
  tools: AgentTools;
  noteTools: NoteTools;
  workspaceTools: WorkspaceTools;
  /** CRDT document manager (available when noteStore is CRDTNoteStore) */
  crdtManager: CRDTDocumentManager;
  /** Note event broadcaster for SSE */
  noteBroadcaster: NoteEventBroadcaster;
  /** Whether the system is using Postgres (true) or InMemory (false) */
  isPersistent: boolean;
}

/**
 * Create an in-memory RoutaSystem (equivalent to RoutaFactory.createInMemory)
 */
export function createInMemorySystem(): RoutaSystem {
  const agentStore = new InMemoryAgentStore();
  const conversationStore = new InMemoryConversationStore();
  const taskStore = new InMemoryTaskStore();
  const workspaceStore = new InMemoryWorkspaceStore();

  // CRDT-backed note store with event broadcasting
  const noteBroadcaster = getNoteEventBroadcaster();
  const crdtManager = new CRDTDocumentManager();
  const noteStore = new CRDTNoteStore(noteBroadcaster, crdtManager);

  const eventBus = new EventBus();
  const tools = new AgentTools(agentStore, conversationStore, taskStore, eventBus);
  const noteTools = new NoteTools(noteStore, taskStore);
  const workspaceTools = new WorkspaceTools(agentStore, taskStore, noteStore);

  // Wire workspace store and event bus to workspace tools
  workspaceTools.setWorkspaceStore(workspaceStore);
  workspaceTools.setEventBus(eventBus);

  return {
    agentStore,
    conversationStore,
    taskStore,
    noteStore,
    workspaceStore,
    eventBus,
    tools,
    noteTools,
    workspaceTools,
    crdtManager,
    noteBroadcaster,
    isPersistent: false,
  };
}

/**
 * Create a Postgres-backed RoutaSystem.
 * Requires DATABASE_URL to be set.
 */
export function createPgSystem(): RoutaSystem {
  const { getPostgresDatabase } = require("./db/index") as typeof import("./db/index");
  const { PgAgentStore } = require("./db/pg-agent-store") as typeof import("./db/pg-agent-store");
  const { PgConversationStore } = require("./db/pg-conversation-store") as typeof import("./db/pg-conversation-store");
  const { PgTaskStore } = require("./db/pg-task-store") as typeof import("./db/pg-task-store");
  const { PgNoteStore } = require("./db/pg-note-store") as typeof import("./db/pg-note-store");
  const { PgWorkspaceStore } = require("./db/pg-workspace-store") as typeof import("./db/pg-workspace-store");

  const db = getPostgresDatabase();
  const agentStore = new PgAgentStore(db);
  const conversationStore = new PgConversationStore(db);
  const taskStore = new PgTaskStore(db);
  const noteStore = new PgNoteStore(db);
  const workspaceStore = new PgWorkspaceStore(db);

  // CRDT manager and broadcaster still used for real-time collab
  const noteBroadcaster = getNoteEventBroadcaster();
  const crdtManager = new CRDTDocumentManager();

  const eventBus = new EventBus();
  const tools = new AgentTools(agentStore, conversationStore, taskStore, eventBus);
  const noteTools = new NoteTools(noteStore, taskStore);
  const workspaceTools = new WorkspaceTools(agentStore, taskStore, noteStore);

  // Wire workspace store and event bus
  workspaceTools.setWorkspaceStore(workspaceStore);
  workspaceTools.setEventBus(eventBus);

  return {
    agentStore,
    conversationStore,
    taskStore,
    noteStore,
    workspaceStore,
    eventBus,
    tools,
    noteTools,
    workspaceTools,
    crdtManager,
    noteBroadcaster,
    isPersistent: true,
  };
}

/**
 * Create a SQLite-backed RoutaSystem.
 * Used for desktop deployments (Tauri, Electron).
 *
 * NOTE: sqlite.ts and sqlite-stores.ts are loaded via dynamic require
 * to prevent webpack from bundling better-sqlite3 in web builds.
 * These files are excluded from tsconfig.json for the same reason.
 */
export function createSqliteSystem(): RoutaSystem {
  const noteBroadcaster = getNoteEventBroadcaster();
  const crdtManager = new CRDTDocumentManager();

  let agentStore: AgentStore;
  let conversationStore: ConversationStore;
  let taskStore: TaskStore;
  let noteStore: NoteStore;
  let workspaceStore: WorkspaceStore;

  try {
    // Use indirect require to prevent webpack from statically analyzing these imports.
    // These modules depend on better-sqlite3 which is only available on desktop.
    // eslint-disable-next-line no-eval
    const dynamicRequire = eval("require") as NodeRequire;
    const { getSqliteDatabase } = dynamicRequire("./db/sqlite");
    const {
      SqliteAgentStore,
      SqliteConversationStore,
      SqliteTaskStore,
      SqliteNoteStore,
      SqliteWorkspaceStore,
    } = dynamicRequire("./db/sqlite-stores");

    const db = getSqliteDatabase();
    agentStore = new SqliteAgentStore(db);
    conversationStore = new SqliteConversationStore(db);
    taskStore = new SqliteTaskStore(db);
    noteStore = new SqliteNoteStore(db);
    workspaceStore = new SqliteWorkspaceStore(db);
  } catch (err) {
    // Standalone desktop bundles may not include sqlite dynamic modules.
    // Keep app usable by falling back to in-memory stores.
    console.warn(
      "[RoutaSystem] SQLite modules unavailable, falling back to in-memory stores:",
      err
    );
    agentStore = new InMemoryAgentStore();
    conversationStore = new InMemoryConversationStore();
    taskStore = new InMemoryTaskStore();
    noteStore = new CRDTNoteStore(noteBroadcaster, crdtManager);
    workspaceStore = new InMemoryWorkspaceStore();
  }

  const eventBus = new EventBus();
  const tools = new AgentTools(agentStore, conversationStore, taskStore, eventBus);
  const noteTools = new NoteTools(noteStore, taskStore);
  const workspaceTools = new WorkspaceTools(agentStore, taskStore, noteStore);

  workspaceTools.setWorkspaceStore(workspaceStore);
  workspaceTools.setEventBus(eventBus);

  return {
    agentStore,
    conversationStore,
    taskStore,
    noteStore,
    workspaceStore,
    eventBus,
    tools,
    noteTools,
    workspaceTools,
    crdtManager,
    noteBroadcaster,
    isPersistent: !(workspaceStore instanceof InMemoryWorkspaceStore),
  };
}

// ─── Singleton for Next.js server ──────────────────────────────────────
// Use globalThis to survive HMR in Next.js dev mode.

const GLOBAL_KEY = "__routa_system__";

export function getRoutaSystem(): RoutaSystem {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    const { getDatabaseDriver } = require("./db/index") as typeof import("./db/index");
    const driver = getDatabaseDriver();

    switch (driver) {
      case "postgres":
        console.log("[RoutaSystem] Initializing with Postgres (Neon) stores");
        g[GLOBAL_KEY] = createPgSystem();
        break;
      case "sqlite":
        console.log("[RoutaSystem] Initializing with SQLite stores (desktop)");
        g[GLOBAL_KEY] = createSqliteSystem();
        break;
      default:
        console.log("[RoutaSystem] Initializing with InMemory stores (no database)");
        g[GLOBAL_KEY] = createInMemorySystem();
        break;
    }
  }
  return g[GLOBAL_KEY] as RoutaSystem;
}
