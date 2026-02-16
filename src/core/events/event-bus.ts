/**
 * EventBus — Enhanced publish/subscribe event system for inter-agent communication.
 *
 * Upgrade from the basic version:
 *   - One-shot subscriptions: auto-remove after first matching event
 *   - Priority ordering: higher priority subscribers get notified first
 *   - Wait-group support: group multiple subscriptions for after_all semantics
 *   - Pre-subscribe: subscribe before the triggering action (onBeforeStart)
 */

export enum AgentEventType {
  AGENT_CREATED = "AGENT_CREATED",
  AGENT_ACTIVATED = "AGENT_ACTIVATED",
  AGENT_COMPLETED = "AGENT_COMPLETED",
  AGENT_ERROR = "AGENT_ERROR",
  TASK_ASSIGNED = "TASK_ASSIGNED",
  TASK_COMPLETED = "TASK_COMPLETED",
  TASK_FAILED = "TASK_FAILED",
  TASK_STATUS_CHANGED = "TASK_STATUS_CHANGED",
  MESSAGE_SENT = "MESSAGE_SENT",
  REPORT_SUBMITTED = "REPORT_SUBMITTED",
  WORKSPACE_UPDATED = "WORKSPACE_UPDATED",
}

export interface AgentEvent {
  type: AgentEventType;
  agentId: string;
  workspaceId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

export interface EventSubscription {
  id: string;
  agentId: string;
  agentName: string;
  eventTypes: AgentEventType[];
  excludeSelf: boolean;
  /** If true, auto-remove after first matching event delivery */
  oneShot?: boolean;
  /** Group ID for wait-all semantics */
  waitGroupId?: string;
  /** Higher priority subscriptions are notified first (default: 0) */
  priority?: number;
}

/**
 * Wait group tracks multiple agents completing a set of tasks.
 */
export interface WaitGroup {
  id: string;
  parentAgentId: string;
  expectedAgentIds: string[];
  completedAgentIds: Set<string>;
  onComplete?: (group: WaitGroup) => void;
}

type EventHandler = (event: AgentEvent) => void;

export class EventBus {
  private handlers = new Map<string, EventHandler>();
  private subscriptions = new Map<string, EventSubscription>();
  private pendingEvents = new Map<string, AgentEvent[]>();
  private waitGroups = new Map<string, WaitGroup>();

  // ─── Direct handlers ────────────────────────────────────────────────

  /**
   * Subscribe to events with a handler function
   */
  on(key: string, handler: EventHandler): void {
    this.handlers.set(key, handler);
  }

  /**
   * Unsubscribe a handler
   */
  off(key: string): void {
    this.handlers.delete(key);
  }

  // ─── Publish ────────────────────────────────────────────────────────

  /**
   * Publish an event to all subscribed handlers and agent subscriptions.
   */
  emit(event: AgentEvent): void {
    // 1. Deliver to direct handlers
    for (const handler of this.handlers.values()) {
      try {
        handler(event);
      } catch (err) {
        console.error("[EventBus] Handler error:", err);
      }
    }

    // 2. Buffer for agent subscriptions, sorted by priority (descending)
    const sortedSubs = Array.from(this.subscriptions.values()).sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );

    const oneShotToRemove: string[] = [];

    for (const sub of sortedSubs) {
      if (sub.excludeSelf && event.agentId === sub.agentId) continue;
      if (!sub.eventTypes.includes(event.type)) continue;

      const pending = this.pendingEvents.get(sub.agentId) ?? [];
      pending.push(event);
      this.pendingEvents.set(sub.agentId, pending);

      // Track one-shot for removal
      if (sub.oneShot) {
        oneShotToRemove.push(sub.id);
      }
    }

    // Remove one-shot subscriptions that were triggered
    for (const subId of oneShotToRemove) {
      this.subscriptions.delete(subId);
    }

    // 3. Check wait groups
    if (
      event.type === AgentEventType.AGENT_COMPLETED ||
      event.type === AgentEventType.REPORT_SUBMITTED
    ) {
      this.checkWaitGroups(event.agentId);
    }
  }

  // ─── Agent subscriptions ────────────────────────────────────────────

  /**
   * Register an agent event subscription.
   * Supports one-shot, priority, and wait-group options.
   */
  subscribe(subscription: EventSubscription): void {
    this.subscriptions.set(subscription.id, subscription);
  }

  /**
   * Remove an agent event subscription
   */
  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  /**
   * Drain all pending events for an agent
   */
  drainPendingEvents(agentId: string): AgentEvent[] {
    const events = this.pendingEvents.get(agentId) ?? [];
    this.pendingEvents.delete(agentId);
    return events;
  }

  // ─── Wait groups ────────────────────────────────────────────────────

  /**
   * Create a wait group for after_all semantics.
   * The onComplete callback is invoked when all expected agents have completed.
   */
  createWaitGroup(params: {
    id: string;
    parentAgentId: string;
    expectedAgentIds: string[];
    onComplete?: (group: WaitGroup) => void;
  }): void {
    this.waitGroups.set(params.id, {
      id: params.id,
      parentAgentId: params.parentAgentId,
      expectedAgentIds: params.expectedAgentIds,
      completedAgentIds: new Set(),
      onComplete: params.onComplete,
    });
  }

  /**
   * Add an agent to an existing wait group.
   */
  addToWaitGroup(groupId: string, agentId: string): void {
    const group = this.waitGroups.get(groupId);
    if (group && !group.expectedAgentIds.includes(agentId)) {
      group.expectedAgentIds.push(agentId);
    }
  }

  /**
   * Get a wait group by ID.
   */
  getWaitGroup(groupId: string): WaitGroup | undefined {
    return this.waitGroups.get(groupId);
  }

  /**
   * Remove a wait group.
   */
  removeWaitGroup(groupId: string): void {
    this.waitGroups.delete(groupId);
  }

  /**
   * Check if any wait group should be triggered.
   */
  private checkWaitGroups(completedAgentId: string): void {
    for (const [groupId, group] of this.waitGroups.entries()) {
      if (group.expectedAgentIds.includes(completedAgentId)) {
        group.completedAgentIds.add(completedAgentId);

        console.log(
          `[EventBus] Wait group ${groupId}: ${group.completedAgentIds.size}/${group.expectedAgentIds.length} completed`
        );

        if (group.completedAgentIds.size >= group.expectedAgentIds.length) {
          console.log(
            `[EventBus] Wait group ${groupId} complete, triggering callback`
          );
          if (group.onComplete) {
            try {
              group.onComplete(group);
            } catch (err) {
              console.error("[EventBus] Wait group onComplete error:", err);
            }
          }
          this.waitGroups.delete(groupId);
        }
      }
    }
  }

  // ─── Pre-subscribe utility ──────────────────────────────────────────

  /**
   * Pre-subscribe: set up a subscription BEFORE the triggering action.
   * Returns a dispose function and a promise that resolves when the
   * first matching event arrives (useful for one-shot scenarios).
   */
  preSubscribe(params: {
    id: string;
    agentId: string;
    agentName: string;
    eventTypes: AgentEventType[];
    excludeSelf?: boolean;
    priority?: number;
  }): { dispose: () => void; promise: Promise<AgentEvent> } {
    let resolvePromise: (event: AgentEvent) => void;
    const promise = new Promise<AgentEvent>((resolve) => {
      resolvePromise = resolve;
    });

    const handlerKey = `pre-subscribe-${params.id}`;

    // Set up a direct handler that resolves on first match
    const handler: EventHandler = (event) => {
      if (params.excludeSelf !== false && event.agentId === params.agentId) return;
      if (!params.eventTypes.includes(event.type)) return;

      resolvePromise(event);
      this.off(handlerKey);
    };

    this.on(handlerKey, handler);

    // Also register the subscription for buffering
    this.subscribe({
      id: params.id,
      agentId: params.agentId,
      agentName: params.agentName,
      eventTypes: params.eventTypes,
      excludeSelf: params.excludeSelf ?? true,
      oneShot: true,
      priority: params.priority ?? 10,
    });

    const dispose = () => {
      this.off(handlerKey);
      this.unsubscribe(params.id);
    };

    return { dispose, promise };
  }
}
