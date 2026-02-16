/**
 * RoutaSystem - port of routa-core RoutaFactory / RoutaSystem
 *
 * Central system object that holds all stores, event bus, and tools.
 * Supports two modes:
 *   1. InMemory (no DATABASE_URL) — for quick dev / tests
 *   2. Postgres (DATABASE_URL set)  — Neon Serverless via Drizzle ORM
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
  const { getDatabase } = require("./db/index") as typeof import("./db/index");
  const { PgAgentStore } = require("./db/pg-agent-store") as typeof import("./db/pg-agent-store");
  const { PgConversationStore } = require("./db/pg-conversation-store") as typeof import("./db/pg-conversation-store");
  const { PgTaskStore } = require("./db/pg-task-store") as typeof import("./db/pg-task-store");
  const { PgNoteStore } = require("./db/pg-note-store") as typeof import("./db/pg-note-store");
  const { PgWorkspaceStore } = require("./db/pg-workspace-store") as typeof import("./db/pg-workspace-store");

  const db = getDatabase();
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

// ─── Singleton for Next.js server ──────────────────────────────────────
// Use globalThis to survive HMR in Next.js dev mode.

const GLOBAL_KEY = "__routa_system__";

export function getRoutaSystem(): RoutaSystem {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    const { isDatabaseConfigured } = require("./db/index") as typeof import("./db/index");
    if (isDatabaseConfigured()) {
      console.log("[RoutaSystem] Initializing with Postgres (Neon) stores");
      g[GLOBAL_KEY] = createPgSystem();
    } else {
      console.log("[RoutaSystem] Initializing with InMemory stores (no DATABASE_URL)");
      g[GLOBAL_KEY] = createInMemorySystem();
    }
  }
  return g[GLOBAL_KEY] as RoutaSystem;
}
