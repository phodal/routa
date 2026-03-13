/**
 * HttpSessionStore - In-memory store for ACP sessions and SSE delivery.
 *
 * Tracks sessions for UI listing and delivers `session/update` notifications
 * from opencode processes to the browser via Server-Sent Events.
 *
 * - Buffers notifications until SSE connects (avoids losing early updates)
 * - Supports multiple concurrent sessions with independent SSE streams
 * - Stores user messages for history preservation
 * - Consolidates consecutive agent_message_chunk notifications for efficient storage
 * - Records Agent Trace with file ranges and VCS context
 * - Uses Provider Adapters to normalize different provider message formats
 */

import { getProviderAdapter } from "./provider-adapter";
import { TraceRecorder } from "./provider-adapter/trace-recorder";
import { hydrateSessionsFromDb } from "./session-db-persister";
import { AgentEventBridge, makeStartedEvent } from "./agent-event-bridge";
import type { WorkspaceAgentEvent } from "./agent-event-bridge";
import type { NormalizedSessionUpdate } from "./provider-adapter/types";
import { getRoutaSystem } from "../routa-system";

export type AcpSessionStatus = "connecting" | "ready" | "error";

export interface RoutaSessionRecord {
  sessionId: string;
  /** User-editable display name */
  name?: string;
  cwd: string;
  /** Git branch the session is scoped to (optional) */
  branch?: string;
  workspaceId: string;
  routaAgentId?: string;
  provider?: string;
  role?: string;
  toolMode?: "essential" | "full";
  modeId?: string;
  /** Model used for this session (e.g. "claude-sonnet-4-20250514") */
  model?: string;
  createdAt: string;
  /** Whether the first prompt has been sent (for coordinator prompt injection) */
  firstPromptSent?: boolean;
  /** Parent session ID for crafter subtasks */
  parentSessionId?: string;
  /** The custom specialist ID used for this session (if any) */
  specialistId?: string;
  /** Pre-built system prompt header for the specialist (systemPrompt + roleReminder) */
  specialistSystemPrompt?: string;
  /** ACP process lifecycle status: connecting → ready | error */
  acpStatus?: AcpSessionStatus;
  /** Error message when acpStatus is "error" */
  acpError?: string;
}

type Controller = ReadableStreamDefaultController<Uint8Array>;

export interface SessionUpdateNotification {
  sessionId: string;
  update?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Consolidates consecutive agent_message_chunk notifications into a single message.
 * This reduces storage overhead from hundreds of small chunks to a single entry.
 */
export function consolidateMessageHistory(
  notifications: SessionUpdateNotification[]
): SessionUpdateNotification[] {
  if (notifications.length === 0) return [];

  const result: SessionUpdateNotification[] = [];
  let currentChunks: string[] = [];
  let currentSessionId: string | null = null;

  const flushChunks = () => {
    if (currentChunks.length > 0 && currentSessionId) {
      // Create a consolidated agent_message notification
      result.push({
        sessionId: currentSessionId,
        update: {
          sessionUpdate: "agent_message",
          content: { type: "text", text: currentChunks.join("") },
        },
      });
      currentChunks = [];
    }
  };

  for (const notification of notifications) {
    const update = notification.update as Record<string, unknown> | undefined;
    const sessionUpdate = update?.sessionUpdate;

    if (sessionUpdate === "agent_message_chunk") {
      // Accumulate chunks
      const content = update?.content as { type?: string; text?: string } | undefined;
      if (content?.text) {
        if (currentSessionId !== notification.sessionId) {
          flushChunks();
          currentSessionId = notification.sessionId;
        }
        currentChunks.push(content.text);
      }
    } else {
      // Non-chunk notification - flush any pending chunks first
      flushChunks();
      currentSessionId = notification.sessionId;
      result.push(notification);
    }
  }

  // Flush any remaining chunks
  flushChunks();

  return result;
}

/**
 * HttpSessionStore uses Provider Adapters to handle different provider behaviors.
 * Trace recording is delegated to TraceRecorder which handles deferred input patterns.
 *
 * Memory-aware cleanup for Vercel serverless:
 * - Limits message history size per session (max 500 messages)
 * - Removes stale sessions (inactive for > 1 hour)
 * - Provides cleanup methods for memory pressure situations
 */
class HttpSessionStore {
  private sessions = new Map<string, RoutaSessionRecord>();
  private sseControllers = new Map<string, Controller>();
  private pendingNotifications = new Map<string, SessionUpdateNotification[]>();
  /** Store all notifications per session for history replay */
  private messageHistory = new Map<string, SessionUpdateNotification[]>();
  /** TraceRecorder handles all trace recording with provider-specific normalization */
  private traceRecorder = new TraceRecorder();
  /** AgentEventBridge instances per session for semantic event conversion */
  private agentEventBridges = new Map<string, AgentEventBridge>();
  /** Subscribers for WorkspaceAgentEvents per session */
  private agentEventSubscribers = new Map<string, Set<(event: WorkspaceAgentEvent) => void>>();
  /** AG-UI notification interceptors per session (for protocol bridging) */
  private notificationInterceptors = new Map<string, Set<(n: SessionUpdateNotification) => void>>();
  /**
   * Sessions currently streaming a prompt response via their own SSE body.
   * While in streaming mode, pushNotification() stores to history/trace but
   * does NOT forward to the persistent EventSource SSE controller — that would
   * cause the same event to appear twice in the browser (once via the prompt
   * response stream and once via the EventSource GET stream).
   */
  private streamingSessionIds = new Set<string>();

  // ─── Memory-aware limits ─────────────────────────────────────────────────
  private static readonly MAX_HISTORY_PER_SESSION = 500; // Max messages per session
  private static readonly MAX_PENDING_NOTIFICATIONS = 100; // Max buffered notifications
  private static readonly STALE_SESSION_MS = 60 * 60 * 1000; // 1 hour
  private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private lastCleanupTime = 0;
  private lastAccessTime = new Map<string, number>();

  enterStreamingMode(sessionId: string): void {
    this.streamingSessionIds.add(sessionId);
    this.updateAccessTime(sessionId);
  }

  exitStreamingMode(sessionId: string): void {
    this.streamingSessionIds.delete(sessionId);
    this.updateAccessTime(sessionId);
  }

  /** Returns true while the session's prompt response is actively streaming. */
  isSessionStreaming(sessionId: string): boolean {
    return this.streamingSessionIds.has(sessionId);
  }

  private updateAccessTime(sessionId: string): void {
    this.lastAccessTime.set(sessionId, Date.now());
  }

  upsertSession(record: RoutaSessionRecord) {
    const existing = this.sessions.get(record.sessionId);
    if (existing?.name && !record.name) {
      this.sessions.set(record.sessionId, {
        ...record,
        name: existing.name,
      });
      this.updateAccessTime(record.sessionId);
      return;
    }
    this.sessions.set(record.sessionId, record);
    this.updateAccessTime(record.sessionId);

    // Initialize AgentEventBridge for new sessions
    if (!this.agentEventBridges.has(record.sessionId)) {
      const bridge = new AgentEventBridge(record.sessionId);
      this.agentEventBridges.set(record.sessionId, bridge);
      // Emit agent_started event
      const startedEvent = makeStartedEvent(record.sessionId, record.provider ?? "unknown");
      this.dispatchAgentEvent(record.sessionId, startedEvent);
    }

    // Periodic cleanup check (runs every 5 minutes)
    this.maybeCleanup();
  }

  listSessions(): RoutaSessionRecord[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getSession(sessionId: string): RoutaSessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  deleteSession(sessionId: string): boolean {
    // Clean up TraceRecorder buffers for this session
    this.traceRecorder.cleanupSession(sessionId);
    this.messageHistory.delete(sessionId);
    this.pendingNotifications.delete(sessionId);
    // Clean up AgentEventBridge
    this.agentEventBridges.get(sessionId)?.cleanup();
    this.agentEventBridges.delete(sessionId);
    this.agentEventSubscribers.delete(sessionId);
    // Detach SSE if connected
    this.sseControllers.delete(sessionId);
    return this.sessions.delete(sessionId);
  }

  /**
   * Subscribe to WorkspaceAgentEvents for a session.
   * Returns an unsubscribe function.
   */
  subscribeToAgentEvents(
    sessionId: string,
    handler: (event: WorkspaceAgentEvent) => void
  ): () => void {
    let subscribers = this.agentEventSubscribers.get(sessionId);
    if (!subscribers) {
      subscribers = new Set();
      this.agentEventSubscribers.set(sessionId, subscribers);
    }
    subscribers.add(handler);
    return () => subscribers!.delete(handler);
  }

  /**
   * Add a notification interceptor for AG-UI protocol bridging.
   * The interceptor receives a copy of every notification for the given session.
   */
  addNotificationInterceptor(
    sessionId: string,
    handler: (n: SessionUpdateNotification) => void
  ): void {
    let interceptors = this.notificationInterceptors.get(sessionId);
    if (!interceptors) {
      interceptors = new Set();
      this.notificationInterceptors.set(sessionId, interceptors);
    }
    interceptors.add(handler);
  }

  /**
   * Remove a previously registered notification interceptor.
   */
  removeNotificationInterceptor(
    sessionId: string,
    handler: (n: SessionUpdateNotification) => void
  ): void {
    const interceptors = this.notificationInterceptors.get(sessionId);
    if (interceptors) {
      interceptors.delete(handler);
      if (interceptors.size === 0) {
        this.notificationInterceptors.delete(sessionId);
      }
    }
  }

  /**
   * Flush and trace any remaining buffered agent message/thought content.
   * Call this when a prompt completes or session ends.
   */
  flushAgentBuffer(sessionId: string): void {
    const sessionRecord = this.sessions.get(sessionId);
    const cwd = sessionRecord?.cwd ?? process.cwd();
    const provider = sessionRecord?.provider ?? "unknown";
    this.traceRecorder.flushSession(sessionId, cwd, provider);
  }

  renameSession(sessionId: string, name: string): boolean {
    const existing = this.sessions.get(sessionId);
    if (!existing) return false;
    existing.name = name;
    return true;
  }

  markFirstPromptSent(sessionId: string) {
    const existing = this.sessions.get(sessionId);
    if (!existing) return;
    this.sessions.set(sessionId, {
      ...existing,
      firstPromptSent: true,
    });
  }

  updateSessionMode(sessionId: string, modeId: string) {
    const existing = this.sessions.get(sessionId);
    if (!existing) return;
    this.sessions.set(sessionId, {
      ...existing,
      modeId,
    });
  }

  /**
   * Update the ACP process lifecycle status for a session.
   * Sends an SSE notification so the client can react (e.g. show spinner → ready).
   */
  updateSessionAcpStatus(sessionId: string, status: AcpSessionStatus, error?: string) {
    const existing = this.sessions.get(sessionId);
    if (!existing) return;
    this.sessions.set(sessionId, {
      ...existing,
      acpStatus: status,
      acpError: error,
    });

    // Push a synthetic notification so the client knows the status changed
    this.pushNotification({
      sessionId,
      update: {
        sessionUpdate: "acp_status",
        status,
        error,
      },
    } as SessionUpdateNotification);
  }

  attachSse(sessionId: string, controller: Controller) {
    this.sseControllers.set(sessionId, controller);
    this.flushPending(sessionId);
  }

  detachSse(sessionId: string) {
    this.sseControllers.delete(sessionId);
  }

  /**
   * Push a notification directly into history without SSE delivery or trace recording.
   * Used when restoring history from DB on cold start.
   */
  pushNotificationToHistory(sessionId: string, notification: SessionUpdateNotification) {
    const history = this.messageHistory.get(sessionId) ?? [];
    history.push(notification);
    this.messageHistory.set(sessionId, history);
    this.limitHistorySize(sessionId);
  }

  /**
   * Store a user message in history. This is called when user sends a prompt.
   * User messages are stored with sessionUpdate: "user_message" for easy identification.
   */
  pushUserMessage(sessionId: string, prompt: string) {
    const notification: SessionUpdateNotification = {
      sessionId,
      update: {
        sessionUpdate: "user_message",
        content: { type: "text", text: prompt },
      },
    };
    const history = this.messageHistory.get(sessionId) ?? [];
    history.push(notification);
    this.messageHistory.set(sessionId, history);
    this.limitHistorySize(sessionId);

    // ── Trace: user_message using Provider Adapter ──
    const sessionRecord = this.sessions.get(sessionId);
    const cwd = sessionRecord?.cwd ?? process.cwd();
    const provider = sessionRecord?.provider ?? "unknown";

    // Normalize and record trace using adapter
    const adapter = getProviderAdapter(provider);
    const normalized = adapter.normalize(sessionId, notification);
    if (normalized) {
      const updates = Array.isArray(normalized) ? normalized : [normalized];
      for (const update of updates) {
        this.traceRecorder.recordFromUpdate(update, cwd);
      }
    }
  }

  /**
   * Push a session/update notification. If SSE isn't connected yet, buffer it.
   *
   * Accepts the raw notification params from opencode (which may have different shapes).
   * Uses Provider Adapters to normalize messages and handle provider-specific behaviors.
   */
  pushNotification(notification: SessionUpdateNotification) {
    const sessionId = notification.sessionId;

    // Child agent notifications (with childAgentId) are forwarded to the parent
    // session's SSE for real-time CRAFTER progress but should NOT be stored in
    // the parent's messageHistory — they would flood out the ROUTA coordinator's
    // own messages due to the 500-entry limit.  Child agent messages are already
    // persisted in their own child session's history.
    const isChildAgentNotification = !!(notification as Record<string, unknown>).childAgentId;

    if (!isChildAgentNotification) {
      // Only store non-child-agent notifications in history
      const history = this.messageHistory.get(sessionId) ?? [];
      history.push(notification);
      this.messageHistory.set(sessionId, history);
      this.limitHistorySize(sessionId); // Apply memory limit
    }

    // ── Notify AG-UI interceptors (protocol bridging) ──
    const interceptors = this.notificationInterceptors.get(sessionId);
    if (interceptors && interceptors.size > 0) {
      for (const handler of interceptors) {
        try {
          handler(notification);
        } catch {
          // interceptor errors must not break the notification pipeline
        }
      }
    }

    // ── Trace recording using Provider Adapter pattern ──
    const sessionRecord = this.sessions.get(sessionId);
    const cwd = sessionRecord?.cwd ?? process.cwd();
    const provider = sessionRecord?.provider ?? "unknown";

    // Get the appropriate adapter for this provider
    const adapter = getProviderAdapter(provider);

    // Normalize the raw notification using the provider adapter
    const normalized = adapter.normalize(sessionId, notification);

    // Record traces and dispatch semantic events from normalized messages
    if (normalized) {
      const updates = Array.isArray(normalized) ? normalized : [normalized];
      const bridge = this.agentEventBridges.get(sessionId);
      for (const update of updates) {
        this.traceRecorder.recordFromUpdate(update, cwd);
        // Convert to semantic WorkspaceAgentEvents and dispatch to subscribers
        if (bridge) {
          const agentEvents = bridge.process(update);
          for (const agentEvent of agentEvents) {
            this.dispatchAgentEvent(sessionId, agentEvent);
          }
        }
      }
      // Update BackgroundTask progress if this session is linked to one
      void this.updateBackgroundTaskProgress(sessionId, updates);
    }

    // Skip SSE push while a prompt stream is actively delivering events via
    // its own HTTP response body — prevents each event being dispatched twice.
    // Exception: child agent notifications (with childAgentId) are NOT part of
    // the prompt response stream — they arrive only via pushNotification(), so
    // they must always be forwarded to the SSE controller to enable real-time
    // CRAFTER progress in the UI.
    const isChildAgentUpdate = !!(notification as Record<string, unknown>).childAgentId;
    if (this.streamingSessionIds.has(sessionId) && !isChildAgentUpdate) {
      return;
    }

    const controller = this.sseControllers.get(sessionId);

    if (controller) {
      this.writeSse(controller, {
        jsonrpc: "2.0",
        method: "session/update",
        params: notification,
      });
      return;
    }

    const pending = this.pendingNotifications.get(sessionId) ?? [];
    pending.push(notification);
    this.pendingNotifications.set(sessionId, pending);
    this.limitPendingSize(sessionId); // Apply memory limit
  }

  /**
   * Get message history for a session (used when switching sessions).
   * Returns raw history without consolidation (for streaming playback).
   */
  getHistory(sessionId: string): SessionUpdateNotification[] {
    return this.messageHistory.get(sessionId) ?? [];
  }

  /**
   * Get consolidated message history for storage.
   * Merges consecutive agent_message_chunk notifications into single messages.
   */
  getConsolidatedHistory(sessionId: string): SessionUpdateNotification[] {
    const history = this.messageHistory.get(sessionId) ?? [];
    return consolidateMessageHistory(history);
  }

  /**
   * Send a one-off "connected" event (useful for UI).
   */
  pushConnected(sessionId: string) {
    const controller = this.sseControllers.get(sessionId);
    if (!controller) return;
    this.writeSse(controller, {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "acp_status",
          content: { type: "text", text: "Connected to ACP session." },
        },
      },
    });
  }

  private flushPending(sessionId: string) {
    const controller = this.sseControllers.get(sessionId);
    if (!controller) return;

    const pending = this.pendingNotifications.get(sessionId);
    if (!pending || pending.length === 0) return;

    for (const n of pending) {
      this.writeSse(controller, {
        jsonrpc: "2.0",
        method: "session/update",
        params: n,
      });
    }
    this.pendingNotifications.delete(sessionId);
  }

  private dispatchAgentEvent(sessionId: string, event: WorkspaceAgentEvent): void {
    const subscribers = this.agentEventSubscribers.get(sessionId);
    if (!subscribers || subscribers.size === 0) return;
    for (const handler of subscribers) {
      try {
        handler(event);
      } catch {
        // subscriber errors must not break the notification pipeline
      }
    }
  }

  private writeSse(controller: Controller, payload: unknown) {
    const encoder = new TextEncoder();
    const event = `data: ${JSON.stringify(payload)}\n\n`;
    try {
      controller.enqueue(encoder.encode(event));
    } catch {
      // controller closed - drop silently
    }
  }

  // ─── Memory-aware cleanup methods ─────────────────────────────────────────

  /**
   * Limit message history size for a session.
   * Removes oldest entries if limit is exceeded.
   */
  private limitHistorySize(sessionId: string): void {
    const history = this.messageHistory.get(sessionId);
    if (history && history.length > HttpSessionStore.MAX_HISTORY_PER_SESSION) {
      const removed = history.length - HttpSessionStore.MAX_HISTORY_PER_SESSION;
      this.messageHistory.set(sessionId, history.slice(removed));
      if (removed > 10) {
        console.log(`[HttpSessionStore] Trimmed ${removed} messages from session ${sessionId}`);
      }
    }
  }

  /**
   * Limit pending notifications buffer size.
   * Removes oldest entries if limit is exceeded.
   */
  private limitPendingSize(sessionId: string): void {
    const pending = this.pendingNotifications.get(sessionId);
    if (pending && pending.length > HttpSessionStore.MAX_PENDING_NOTIFICATIONS) {
      const removed = pending.length - HttpSessionStore.MAX_PENDING_NOTIFICATIONS;
      this.pendingNotifications.set(sessionId, pending.slice(removed));
      if (removed > 10) {
        console.log(`[HttpSessionStore] Trimmed ${removed} pending notifications for session ${sessionId}`);
      }
    }
  }

  /**
   * Periodic cleanup check. Runs automatically every 5 minutes.
   * - Removes stale sessions (inactive for > 1 hour)
   * - Limits history and pending notification sizes
   */
  private maybeCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanupTime < HttpSessionStore.CLEANUP_INTERVAL_MS) {
      return;
    }
    this.lastCleanupTime = now;

    const removed = this.forceCleanup();
    if (removed > 0) {
      console.log(`[HttpSessionStore] Periodic cleanup: removed ${removed} stale sessions`);
    }
  }

  /**
   * Force cleanup of stale sessions and oversized buffers.
   * Returns the number of sessions removed.
   *
   * Called automatically by maybeCleanup() but can also be triggered
   * manually when memory pressure is detected.
   */
  forceCleanup(options?: { aggressive?: boolean }): number {
    const now = Date.now();
    const staleThreshold = options?.aggressive
      ? HttpSessionStore.STALE_SESSION_MS / 2 // 30 minutes if aggressive
      : HttpSessionStore.STALE_SESSION_MS; // 1 hour normally

    let removedCount = 0;

    // Remove stale sessions
    for (const [_sessionId, lastAccess] of this.lastAccessTime.entries()) {
      const isStale = now - lastAccess > staleThreshold;
      const hasActiveSse = this.sseControllers.has(_sessionId);
      const isStreaming = this.streamingSessionIds.has(_sessionId);

      // Only remove if stale AND not actively used
      if (isStale && !hasActiveSse && !isStreaming) {
        const session = this.sessions.get(_sessionId);

        // Protect child sessions whose parent is still active
        const isChildSession = !!session?.parentSessionId;
        const parentStillActive = isChildSession && this.sessions.has(session!.parentSessionId!);
        if (parentStillActive) {
          // Refresh access time so child stays alive while parent exists
          this.lastAccessTime.set(_sessionId, now);
          continue;
        }

        // Protect ROUTA orchestrator sessions — they are long-running and must not
        // be evicted while child CRAFTERs / GATEs could still be running.
        if (session?.role === "ROUTA") {
          this.lastAccessTime.set(_sessionId, now);
          continue;
        }

        this.deleteSession(_sessionId);
        this.lastAccessTime.delete(_sessionId);
        removedCount++;
      }
    }

    // Limit buffer sizes for remaining sessions
    for (const sessionId of this.sessions.keys()) {
      this.limitHistorySize(sessionId);
      this.limitPendingSize(sessionId);
    }

    return removedCount;
  }

  /**
   * Get memory usage statistics for monitoring.
   * Returns counts of stored items and buffer sizes.
   */
  getMemoryUsage(): {
    sessionCount: number;
    activeSseCount: number;
    streamingCount: number;
    totalHistoryMessages: number;
    totalPendingNotifications: number;
    historyBySession: Record<string, number>;
    staleSessionCount: number;
  } {
    const historyBySession: Record<string, number> = {};
    let totalHistoryMessages = 0;
    let totalPendingNotifications = 0;
    const now = Date.now();
    let staleSessionCount = 0;

    for (const [sessionId, history] of this.messageHistory.entries()) {
      historyBySession[sessionId] = history.length;
      totalHistoryMessages += history.length;
    }

    for (const pending of this.pendingNotifications.values()) {
      totalPendingNotifications += pending.length;
    }

    for (const [_sessionId, lastAccess] of this.lastAccessTime.entries()) {
      if (now - lastAccess > HttpSessionStore.STALE_SESSION_MS) {
        staleSessionCount++;
      }
    }

    return {
      sessionCount: this.sessions.size,
      activeSseCount: this.sseControllers.size,
      streamingCount: this.streamingSessionIds.size,
      totalHistoryMessages,
      totalPendingNotifications,
      historyBySession,
      staleSessionCount,
    };
  }

  /** Whether DB hydration has been performed */
  private hydrated = false;

  /**
   * Load sessions from the database into the in-memory store.
   * Only runs once per process lifecycle (idempotent).
   */
  async hydrateFromDb(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;

    const dbSessions = await hydrateSessionsFromDb();
    for (const s of dbSessions) {
      if (!this.sessions.has(s.id)) {
        this.upsertSession({
          sessionId: s.id,
          name: s.name,
          cwd: s.cwd,
          branch: s.branch,
          workspaceId: s.workspaceId,
          routaAgentId: s.routaAgentId,
          provider: s.provider,
          role: s.role,
          modeId: s.modeId,
          parentSessionId: s.parentSessionId,
          createdAt: s.createdAt?.toISOString() ?? new Date().toISOString(),
        });
      }
    }
    if (dbSessions.length > 0) {
      console.log(`[HttpSessionStore] Hydrated ${dbSessions.length} sessions from database`);
    }
  }

  /**
   * Update BackgroundTask progress from ACP session notifications.
   * Called from pushNotification when normalized updates are available.
   */
  private async updateBackgroundTaskProgress(
    sessionId: string,
    updates: NormalizedSessionUpdate[]
  ): Promise<void> {
    try {
      const system = getRoutaSystem();
      const task = await system.backgroundTaskStore.findBySessionId(sessionId);
      if (!task) return; // Not a background task session

      let toolCallCount = task.toolCallCount ?? 0;
      let inputTokens = task.inputTokens ?? 0;
      let outputTokens = task.outputTokens ?? 0;
      let currentActivity: string | undefined;

      for (const update of updates) {
        // Count tool calls
        if (update.toolCall && update.eventType === "tool_call") {
          toolCallCount++;
          currentActivity = `Running: ${update.toolCall.title ?? update.toolCall.name}`;
        }

        // Update activity based on tool status
        if (update.toolCall && update.eventType === "tool_call_update") {
          if (update.toolCall.status === "running") {
            currentActivity = `Running: ${update.toolCall.title ?? update.toolCall.name}`;
          } else if (update.toolCall.status === "completed") {
            currentActivity = `Completed: ${update.toolCall.title ?? update.toolCall.name}`;
          }
        }

        // Extract token usage from turn_complete
        if (update.turnComplete?.usage) {
          inputTokens += update.turnComplete.usage.inputTokens ?? 0;
          outputTokens += update.turnComplete.usage.outputTokens ?? 0;
        }

        // Mark task COMPLETED when the agent's turn finishes
        if (update.eventType === "turn_complete" || update.turnComplete) {
          try {
            await system.backgroundTaskStore.updateStatus(task.id, "COMPLETED", {
              completedAt: new Date(),
              resultSessionId: sessionId,
            });
            console.log(`[BGWorker] Task ${task.id} COMPLETED via turn_complete event.`);
          } catch {
            // best-effort
          }
        }
      }

      // Update progress in the store
      await system.backgroundTaskStore.updateProgress(task.id, {
        lastActivity: new Date(),
        currentActivity,
        toolCallCount,
        inputTokens,
        outputTokens,
      });
    } catch {
      // Ignore errors - progress tracking is best-effort
    }
  }
}

// Use globalThis to survive HMR in Next.js dev mode
const GLOBAL_KEY = "__http_session_store__";

export function getHttpSessionStore(): HttpSessionStore {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new HttpSessionStore();
  }
  return g[GLOBAL_KEY] as HttpSessionStore;
}

/**
 * Get memory usage statistics from the session store for monitoring.
 * This can be called by the memory monitoring API to include session store stats.
 */
export function getSessionStoreMemoryUsage(): ReturnType<HttpSessionStore["getMemoryUsage"]> {
  return getHttpSessionStore().getMemoryUsage();
}

/**
 * Force cleanup of the session store.
 * Can be called when memory pressure is detected.
 */
export function cleanupSessionStore(options?: { aggressive?: boolean }): number {
  return getHttpSessionStore().forceCleanup(options);
}
