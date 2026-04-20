/**
 * RoutaSystem - port of routa-core RoutaFactory / RoutaSystem
 *
 * Central system object that holds all stores, event bus, and tools.
 * Supports three storage modes:
 *   1. InMemory (no database) — for quick dev / tests
 *   2. Postgres (DATABASE_URL set) — Neon Serverless via Drizzle ORM (Web/Vercel)
 *   3. SQLite (ROUTA_DB_DRIVER=sqlite or local Node dev) — local file via better-sqlite3
 *
 * Workspace is a first-class citizen: every agent/task/note belongs
 * to a workspace.
 */

import { InMemoryAgentStore, AgentStore } from "./store/agent-store";
import { InMemoryConversationStore, ConversationStore } from "./store/conversation-store";
import { InMemoryTaskStore, TaskStore } from "./store/task-store";
import { NoteStore } from "./store/note-store";
import { PgArtifactStore } from "./db/pg-artifact-store";
import { WorkspaceStore, InMemoryWorkspaceStore } from "./db/pg-workspace-store";
import { CodebaseStore, InMemoryCodebaseStore } from "./db/pg-codebase-store";
import { WorktreeStore, InMemoryWorktreeStore } from "./db/pg-worktree-store";
import { BackgroundTaskStore, InMemoryBackgroundTaskStore } from "./store/background-task-store";
import { ScheduleStore, InMemoryScheduleStore } from "./store/schedule-store";
import { EventBus } from "./events/event-bus";
import { AgentTools } from "./tools/agent-tools";
import { NoteTools } from "./tools/note-tools";
import { WorkspaceTools } from "./tools/workspace-tools";
import { CRDTNoteStore } from "./notes/crdt-note-store";
import { CRDTDocumentManager } from "./notes/crdt-document-manager";
import { NoteEventBroadcaster, getNoteEventBroadcaster } from "./notes/note-event-broadcaster";
import { WorkflowRunStore, InMemoryWorkflowRunStore } from "./workflows/workflow-store";
import { InMemoryKanbanBoardStore, KanbanBoardStore } from "./store/kanban-board-store";
import { InMemoryArtifactStore, ArtifactStore } from "./store/artifact-store";
import { PermissionStore } from "./tools/permission-store";
import { startWorkflowOrchestrator } from "./kanban/workflow-orchestrator-singleton";
import { getKanbanEventBroadcaster } from "./kanban/kanban-event-broadcaster";
import { AgentEventType } from "./events/event-bus";

export interface RoutaSystem {
  agentStore: AgentStore;
  conversationStore: ConversationStore;
  taskStore: TaskStore;
  noteStore: NoteStore;
  workspaceStore: WorkspaceStore;
  codebaseStore: CodebaseStore;
  worktreeStore: WorktreeStore;
  backgroundTaskStore: BackgroundTaskStore;
  scheduleStore: ScheduleStore;
  /** Workflow run store for multi-step workflow execution */
  workflowRunStore: WorkflowRunStore;
  kanbanBoardStore: KanbanBoardStore;
  /** Artifact store for agent-to-agent communication */
  artifactStore: ArtifactStore;
  /** Permission store for runtime permission delegation protocol */
  permissionStore: PermissionStore;
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
  const codebaseStore = new InMemoryCodebaseStore();
  const worktreeStore = new InMemoryWorktreeStore();
  const backgroundTaskStore = new InMemoryBackgroundTaskStore();
  const scheduleStore = new InMemoryScheduleStore();
  const workflowRunStore = new InMemoryWorkflowRunStore();
  const kanbanBoardStore = new InMemoryKanbanBoardStore();
  const artifactStore = new InMemoryArtifactStore();
  const permissionStore = new PermissionStore();

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

  // Wire artifact store for artifact-related tools
  tools.setArtifactStore(artifactStore);
  tools.setKanbanBoardStore(kanbanBoardStore);
  tools.setPermissionStore(permissionStore);

  return {
    agentStore,
    conversationStore,
    taskStore,
    noteStore,
    workspaceStore,
    codebaseStore,
    worktreeStore,
    backgroundTaskStore,
    scheduleStore,
    workflowRunStore,
    kanbanBoardStore,
    artifactStore,
    permissionStore,
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
  const { PgCodebaseStore } = require("./db/pg-codebase-store") as typeof import("./db/pg-codebase-store");
  const { PgBackgroundTaskStore } = require("./db/pg-background-task-store") as typeof import("./db/pg-background-task-store");
  const { PgScheduleStore } = require("./db/pg-schedule-store") as typeof import("./db/pg-schedule-store");
  const { PgWorktreeStore } = require("./db/pg-worktree-store") as typeof import("./db/pg-worktree-store");
  const { PgKanbanBoardStore } = require("./db/pg-kanban-board-store") as typeof import("./db/pg-kanban-board-store");

  const db = getPostgresDatabase();
  const agentStore = new PgAgentStore(db);
  const conversationStore = new PgConversationStore(db);
  const taskStore = new PgTaskStore(db);
  const noteStore = new PgNoteStore(db);
  const workspaceStore = new PgWorkspaceStore(db);
  const codebaseStore = new PgCodebaseStore(db);
  const worktreeStore = new PgWorktreeStore(db);
  const backgroundTaskStore = new PgBackgroundTaskStore(db);
  const scheduleStore = new PgScheduleStore(db);
  // TODO: Implement PgWorkflowRunStore for persistent workflow state
  const workflowRunStore = new InMemoryWorkflowRunStore();
  const kanbanBoardStore = new PgKanbanBoardStore(db);
  const artifactStore = new PgArtifactStore(db);
  const permissionStore = new PermissionStore();

  // CRDT manager and broadcaster still used for real-time collab
  const noteBroadcaster = getNoteEventBroadcaster();
  const crdtManager = new CRDTDocumentManager();

  const eventBus = new EventBus();
  const tools = new AgentTools(agentStore, conversationStore, taskStore, eventBus);
  // PgNoteStore doesn't broadcast on save — pass the broadcaster so NoteTools can notify the
  // real-time sidebar whenever set_note_content / create_note / append_to_note are called.
  const noteTools = new NoteTools(noteStore, taskStore, noteBroadcaster);
  const workspaceTools = new WorkspaceTools(agentStore, taskStore, noteStore);

  // Wire workspace store and event bus
  workspaceTools.setWorkspaceStore(workspaceStore);
  workspaceTools.setEventBus(eventBus);

  // Wire artifact store for artifact-related tools
  tools.setArtifactStore(artifactStore);
  tools.setKanbanBoardStore(kanbanBoardStore);
  tools.setPermissionStore(permissionStore);

  return {
    agentStore,
    conversationStore,
    taskStore,
    noteStore,
    workspaceStore,
    codebaseStore,
    worktreeStore,
    backgroundTaskStore,
    scheduleStore,
    workflowRunStore,
    kanbanBoardStore,
    artifactStore,
    permissionStore,
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
 * Used by the local Node.js backend during development.
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
  let codebaseStore: CodebaseStore;
  let worktreeStore: WorktreeStore;
  let backgroundTaskStore: BackgroundTaskStore;
  let scheduleStore: ScheduleStore;
  let kanbanBoardStore: KanbanBoardStore;
  // TODO: Implement SqliteWorkflowRunStore for persistent workflow state
  const workflowRunStore = new InMemoryWorkflowRunStore();
  let artifactStore: ArtifactStore;
  const permissionStore = new PermissionStore();
  // True when noteStore doesn't broadcast on save (SqliteNoteStore); NoteTools will broadcast.
  // False when CRDTNoteStore is used as fallback (it already broadcasts internally).
  let noteToolsBroadcast = false;

  try {
    // better-sqlite3 is listed in serverExternalPackages (next.config.ts),
    // so webpack leaves the native addon as a runtime require.
    const {
      getSqliteDatabase,
      ensureSqliteDefaultWorkspace,
    } = require("./db/sqlite") as typeof import("./db/sqlite");
    const {
      SqliteAgentStore,
      SqliteConversationStore,
      SqliteTaskStore,
      SqliteNoteStore,
      SqliteWorkspaceStore,
      SqliteCodebaseStore,
      SqliteWorktreeStore,
      SqliteBackgroundTaskStore,
      SqliteScheduleStore,
      SqliteKanbanBoardStore,
      SqliteArtifactStore,
    } = require("./db/sqlite-stores") as typeof import("./db/sqlite-stores");

    const db = getSqliteDatabase();
    ensureSqliteDefaultWorkspace();
    agentStore = new SqliteAgentStore(db);
    conversationStore = new SqliteConversationStore(db);
    taskStore = new SqliteTaskStore(db);
    noteStore = new SqliteNoteStore(db);
    workspaceStore = new SqliteWorkspaceStore(db);
    codebaseStore = new SqliteCodebaseStore(db);
    worktreeStore = new SqliteWorktreeStore(db);
    backgroundTaskStore = new SqliteBackgroundTaskStore(db);
    scheduleStore = new SqliteScheduleStore(db);
    kanbanBoardStore = new SqliteKanbanBoardStore(db);
    artifactStore = new SqliteArtifactStore(db);
    noteToolsBroadcast = true; // SqliteNoteStore doesn't broadcast — NoteTools must
  } catch (err) {
    // Some builds may not include sqlite native modules.
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
    codebaseStore = new InMemoryCodebaseStore();
    worktreeStore = new InMemoryWorktreeStore();
    backgroundTaskStore = new InMemoryBackgroundTaskStore();
    scheduleStore = new InMemoryScheduleStore();
    kanbanBoardStore = new InMemoryKanbanBoardStore();
    artifactStore = new InMemoryArtifactStore();
  }

  const eventBus = new EventBus();
  const tools = new AgentTools(agentStore, conversationStore, taskStore, eventBus);
  // Pass broadcaster only when noteStore doesn't broadcast on its own (SqliteNoteStore case).
  const noteTools = new NoteTools(noteStore, taskStore, noteToolsBroadcast ? noteBroadcaster : undefined);
  const workspaceTools = new WorkspaceTools(agentStore, taskStore, noteStore);

  workspaceTools.setWorkspaceStore(workspaceStore);
  workspaceTools.setEventBus(eventBus);

  // Wire artifact store for artifact-related tools
  tools.setArtifactStore(artifactStore);
  tools.setKanbanBoardStore(kanbanBoardStore);
  tools.setPermissionStore(permissionStore);

  return {
    agentStore,
    conversationStore,
    taskStore,
    noteStore,
    workspaceStore,
    codebaseStore,
    worktreeStore,
    backgroundTaskStore,
    scheduleStore,
    workflowRunStore,
    kanbanBoardStore,
    artifactStore,
    permissionStore,
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
        console.log("[RoutaSystem] Initializing with SQLite stores (local Node.js)");
        g[GLOBAL_KEY] = createSqliteSystem();
        break;
      default:
        console.log("[RoutaSystem] Initializing with InMemory stores (no database)");
        g[GLOBAL_KEY] = createInMemorySystem();
        break;
    }

    // Start the workflow orchestrator to listen for column transitions
    const system = g[GLOBAL_KEY] as RoutaSystem;
    startWorkflowOrchestrator(system);

    // Set up EventBus → KanbanEventBroadcaster bridge for file changes
    setupFileChangeBridge(system);
  }
  return g[GLOBAL_KEY] as RoutaSystem;
}

// ─── File Change Bridge ────────────────────────────────────────────────

/**
 * Bridge EventBus FILE_CHANGES events to KanbanEventBroadcaster
 * so that the Kanban UI can refresh the Changes column in real-time.
 */
function setupFileChangeBridge(system: RoutaSystem): void {
  const kanbanBroadcaster = getKanbanEventBroadcaster();

  system.eventBus.on("file-change-bridge", (event) => {
    if (event.type === AgentEventType.FILE_CHANGES && event.workspaceId) {
      // Notify the Kanban SSE clients that files have changed
      kanbanBroadcaster.notify({
        workspaceId: event.workspaceId,
        entity: "task",
        action: "updated",
        resourceId: typeof event.data?.taskId === "string" ? event.data.taskId : undefined,
        source: "agent",
      });
    }
  });
}
