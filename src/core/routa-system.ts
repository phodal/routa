/**
 * RoutaSystem - port of routa-core RoutaFactory / RoutaSystem
 *
 * Central system object that holds all stores, event bus, and tools.
 * Equivalent to Kotlin's RoutaSystem + RoutaFactory.createInMemory().
 */

import { InMemoryAgentStore, AgentStore } from "./store/agent-store";
import { InMemoryConversationStore, ConversationStore } from "./store/conversation-store";
import { InMemoryTaskStore, TaskStore } from "./store/task-store";
import { InMemoryNoteStore, NoteStore } from "./store/note-store";
import { EventBus } from "./events/event-bus";
import { AgentTools } from "./tools/agent-tools";
import { NoteTools } from "./tools/note-tools";

export interface RoutaSystem {
  agentStore: AgentStore;
  conversationStore: ConversationStore;
  taskStore: TaskStore;
  noteStore: NoteStore;
  eventBus: EventBus;
  tools: AgentTools;
  noteTools: NoteTools;
}

/**
 * Create an in-memory RoutaSystem (equivalent to RoutaFactory.createInMemory)
 */
export function createInMemorySystem(): RoutaSystem {
  const agentStore = new InMemoryAgentStore();
  const conversationStore = new InMemoryConversationStore();
  const taskStore = new InMemoryTaskStore();
  const noteStore = new InMemoryNoteStore();
  const eventBus = new EventBus();
  const tools = new AgentTools(agentStore, conversationStore, taskStore, eventBus);
  const noteTools = new NoteTools(noteStore, taskStore);

  return {
    agentStore,
    conversationStore,
    taskStore,
    noteStore,
    eventBus,
    tools,
    noteTools,
  };
}

// ─── Singleton for Next.js server ──────────────────────────────────────
// Use globalThis to survive HMR in Next.js dev mode.
// Module-level variables are lost when routes are recompiled independently.

const GLOBAL_KEY = "__routa_system__";

export function getRoutaSystem(): RoutaSystem {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createInMemorySystem();
  }
  return g[GLOBAL_KEY] as RoutaSystem;
}
