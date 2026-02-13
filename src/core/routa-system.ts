/**
 * RoutaSystem - port of routa-core RoutaFactory / RoutaSystem
 *
 * Central system object that holds all stores, event bus, and tools.
 * Equivalent to Kotlin's RoutaSystem + RoutaFactory.createInMemory().
 */

import { InMemoryAgentStore, AgentStore } from "./store/agent-store";
import { InMemoryConversationStore, ConversationStore } from "./store/conversation-store";
import { InMemoryTaskStore, TaskStore } from "./store/task-store";
import { EventBus } from "./events/event-bus";
import { AgentTools } from "./tools/agent-tools";

export interface RoutaSystem {
  agentStore: AgentStore;
  conversationStore: ConversationStore;
  taskStore: TaskStore;
  eventBus: EventBus;
  tools: AgentTools;
}

/**
 * Create an in-memory RoutaSystem (equivalent to RoutaFactory.createInMemory)
 */
export function createInMemorySystem(): RoutaSystem {
  const agentStore = new InMemoryAgentStore();
  const conversationStore = new InMemoryConversationStore();
  const taskStore = new InMemoryTaskStore();
  const eventBus = new EventBus();
  const tools = new AgentTools(agentStore, conversationStore, taskStore, eventBus);

  return {
    agentStore,
    conversationStore,
    taskStore,
    eventBus,
    tools,
  };
}

// ─── Singleton for Next.js server ──────────────────────────────────────

let _instance: RoutaSystem | undefined;

export function getRoutaSystem(): RoutaSystem {
  if (!_instance) {
    _instance = createInMemorySystem();
  }
  return _instance;
}
