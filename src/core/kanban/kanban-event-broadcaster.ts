import type { RuntimeFitnessEventStatus } from "@/core/fitness/runtime-status-types";

export type KanbanWorkspaceChangedEvent = {
  type: "kanban:changed";
  workspaceId: string;
  entity: "task" | "board" | "column" | "queue";
  action: "created" | "updated" | "deleted" | "moved" | "refreshed";
  resourceId?: string;
  source: "agent" | "user" | "system";
  timestamp: string;
};

export type KanbanFitnessChangedEvent = {
  type: "fitness:changed";
  workspaceId: string;
  source: "agent" | "user" | "system";
  timestamp: string;
  codebaseId?: string;
  repoPath?: string;
  status?: RuntimeFitnessEventStatus;
};

export type KanbanWorkspaceEvent = KanbanWorkspaceChangedEvent | KanbanFitnessChangedEvent;

type SSEController = ReadableStreamDefaultController<Uint8Array>;

export class KanbanEventBroadcaster {
  private controllers = new Map<string, { controller: SSEController; workspaceId: string }>();
  private connectionCounter = 0;

  attach(workspaceId: string, controller: SSEController): string {
    const connId = `kanban-sse-${++this.connectionCounter}`;
    this.controllers.set(connId, { controller, workspaceId });

    this.writeSse(controller, {
      type: "connected",
      connectionId: connId,
      workspaceId,
      timestamp: new Date().toISOString(),
    });

    return connId;
  }

  detach(connId: string): void {
    this.controllers.delete(connId);
  }

  broadcast(event: KanbanWorkspaceEvent): void {
    for (const [connId, { controller, workspaceId }] of this.controllers) {
      if (workspaceId !== event.workspaceId && workspaceId !== "*") continue;
      try {
        this.writeSse(controller, event);
      } catch {
        this.controllers.delete(connId);
      }
    }
  }

  notify(event: Omit<KanbanWorkspaceChangedEvent, "type" | "timestamp">): void {
    this.broadcast({
      ...event,
      type: "kanban:changed",
      timestamp: new Date().toISOString(),
    });
  }

  notifyFitness(event: Omit<KanbanFitnessChangedEvent, "type" | "timestamp">): void {
    this.broadcast({
      ...event,
      type: "fitness:changed",
      timestamp: new Date().toISOString(),
    });
  }

  get connectionCount(): number {
    return this.controllers.size;
  }

  private writeSse(controller: SSEController, payload: unknown): void {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  }
}

const GLOBAL_KEY = "__kanban_event_broadcaster__";

export function getKanbanEventBroadcaster(): KanbanEventBroadcaster {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new KanbanEventBroadcaster();
  }
  return g[GLOBAL_KEY] as KanbanEventBroadcaster;
}
