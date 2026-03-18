/**
 * BackgroundTaskWorker — polls the background_tasks queue and dispatches
 * ACP sessions for PENDING tasks.
 *
 * Design (Next.js compatible):
 *   - Internally calls `/api/acp` with `session/new` + `session/prompt`
 *     to reuse all existing session-creation logic without duplication.
 *   - The base URL is read from the NEXTAUTH_URL / VERCEL_URL env var, or
 *     defaults to http://localhost:PORT for local dev.
 *   - Runs as a singleton via globalThis to survive HMR.
 *   - In production (Vercel) schedule via a Vercel Cron Job that POST
 *     to `/api/background-tasks/process` instead of long-running interval.
 */

import { getRoutaSystem } from "../routa-system";
import type { BackgroundTask } from "../models/background-task";

// ─── Constants ──────────────────────────────────────────────────────────────

const DISPATCH_INTERVAL_MS = 5_000;
const COMPLETION_INTERVAL_MS = 15_000;
const WORKER_GLOBAL_KEY = "__routa_bg_worker__";
const WORKER_STARTED_KEY = "__routa_bg_worker_started__";
/** Maximum number of concurrent background tasks */
const MAX_CONCURRENT_TASKS = 2;

// ─── Internal URL helper ─────────────────────────────────────────────────────

function getInternalBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  const port = process.env.PORT ?? "3000";
  return `http://localhost:${port}`;
}

// ─── Worker ──────────────────────────────────────────────────────────────────

export class BackgroundTaskWorker {
  private dispatchTimer: ReturnType<typeof setInterval> | null = null;
  private completionTimer: ReturnType<typeof setInterval> | null = null;
  /** sessionId → backgroundTaskId */
  private sessionToTask = new Map<string, string>();

  start(): void {
    if (this.dispatchTimer) return; // already running
    this.dispatchTimer = setInterval(() => { void this.dispatchPending(); }, DISPATCH_INTERVAL_MS);
    this.completionTimer = setInterval(() => { void this.checkCompletions(); }, COMPLETION_INTERVAL_MS);
    console.log("[BGWorker] Started polling for background tasks.");
  }

  stop(): void {
    if (this.dispatchTimer) { clearInterval(this.dispatchTimer); this.dispatchTimer = null; }
    if (this.completionTimer) { clearInterval(this.completionTimer); this.completionTimer = null; }
    console.log("[BGWorker] Stopped.");
  }

  // ─── Dispatch pending tasks ───────────────────────────────────────────────

  /**
   * Dispatch pending tasks with concurrency control.
   * Only runs up to MAX_CONCURRENT_TASKS at a time.
   */
  async dispatchPending(): Promise<void> {
    const system = getRoutaSystem();

    // Check current running count
    let running: BackgroundTask[];
    try {
      running = await system.backgroundTaskStore.listRunning();
    } catch {
      return; // DB not ready yet (cold start)
    }

    // Skip if already at max concurrency
    if (running.length >= MAX_CONCURRENT_TASKS) {
      return;
    }

    const slotsAvailable = MAX_CONCURRENT_TASKS - running.length;

    // Use listReadyToRun() to support workflow task dependencies
    // This returns PENDING tasks whose dependencies (if any) are all COMPLETED
    let readyTasks: BackgroundTask[];
    try {
      readyTasks = await system.backgroundTaskStore.listReadyToRun();
    } catch {
      return;
    }

    // Only dispatch as many as we have slots for
    const toDispatch = readyTasks.slice(0, slotsAvailable);
    for (const task of toDispatch) {
      await this.dispatchTask(task);
    }
  }

  async dispatchTask(task: BackgroundTask): Promise<void> {
    const system = getRoutaSystem();

    // Resolve workflow step dependencies before dispatch, injecting prior step outputs
    // into the prompt placeholders (e.g., ${steps.Analyze.output}).
    const prompt = await this.resolveTaskPrompt(task);

    // Optimistically mark RUNNING to prevent re-dispatch
    await system.backgroundTaskStore.updateStatus(task.id, "RUNNING", { startedAt: new Date() });

    try {
      const sessionId = await this.createAndSendPrompt(task, prompt);
      await system.backgroundTaskStore.updateStatus(task.id, "RUNNING", {
        startedAt: task.startedAt ?? new Date(),
        resultSessionId: sessionId,
      });
      this.sessionToTask.set(sessionId, task.id);
      console.log(`[BGWorker] Task ${task.id} → session ${sessionId}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[BGWorker] Task ${task.id} dispatch failed:`, err);
      await system.backgroundTaskStore.updateStatus(task.id, "FAILED", {
        errorMessage,
        completedAt: new Date(),
      });
    }
  }

  private async resolveTaskPrompt(task: BackgroundTask): Promise<string> {
    if (!task.workflowRunId) return task.prompt;

    const system = getRoutaSystem();
    const run = await system.workflowRunStore.get(task.workflowRunId);
    if (!run) return task.prompt;

    const stepOutputs = { ...(run.stepOutputs ?? {}) };
    const dependentTasks = await system.backgroundTaskStore.listByWorkflowRunId(task.workflowRunId);
    for (const depTask of dependentTasks) {
      if (!depTask.workflowStepName || depTask.taskOutput === undefined) continue;
      stepOutputs[depTask.workflowStepName] = depTask.taskOutput;
    }

    const unresolvedRefs: string[] = [];
    const resolvedPrompt = task.prompt.replace(
      /\$\{steps\.([^}]+)\.output\}/g,
      (match, stepRef: string) => {
        if (stepOutputs[stepRef] === undefined) {
          unresolvedRefs.push(stepRef);
          return match;
        }
        return stepOutputs[stepRef];
      },
    );

    if (unresolvedRefs.length > 0) {
      throw new Error(
        `Task ${task.id} could not resolve dependencies for placeholders: ${unresolvedRefs.join(", ")}.`,
      );
    }

    return resolvedPrompt;
  }

  private async persistCompletedTaskOutput(task: BackgroundTask): Promise<void> {
    if (!task.workflowRunId || !task.workflowStepName || !task.taskOutput) {
      return;
    }

    const trimmedOutput = task.taskOutput.trim();
    if (!trimmedOutput) return;

    const system = getRoutaSystem();
    try {
      const run = await system.workflowRunStore.get(task.workflowRunId);
      const existingOutput = run?.stepOutputs?.[task.workflowStepName];
      if (existingOutput !== undefined && existingOutput !== "") {
        return;
      }

      await system.workflowRunStore.updateStepOutput(task.workflowRunId, task.workflowStepName, trimmedOutput);
    } catch {
      // best-effort
    }
  }

  /**
   * Create an ACP session and fire the prompt via the internal `/api/acp` endpoint.
   * Returns the session ID.
   */
  private async createAndSendPrompt(task: BackgroundTask, prompt?: string): Promise<string> {
    const base = getInternalBaseUrl();

    // Known ACP providers — everything else is treated as a specialist ID
    const KNOWN_PROVIDERS = new Set([
      "opencode",
      "gemini",
      "codex",
      "copilot",
      "auggie",
      "kimi",
      "kiro",
      "claude",
      "claude-code-sdk",
      "workspace",
      "workspace-agent",
      "routa-native",
    ]);

    // Determine provider and specialistId based on task.agentId
    const isKnownProvider = KNOWN_PROVIDERS.has(task.agentId);
    // Use default provider if agentId is not a known provider (it's a specialist)
    const provider = isKnownProvider ? task.agentId : undefined; // Let API use default
    const specialistId = isKnownProvider ? undefined : task.agentId;

    // 1. Create session
    const newRes = await fetch(`${base}/api/acp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "session/new",
        params: {
          provider,
          specialistId,
          workspaceId: task.workspaceId,
          cwd: process.cwd(),
          role: "CRAFTER",
          sandboxId: task.sandboxId,
        },
      }),
    });

    if (!newRes.ok) throw new Error(`session/new HTTP ${newRes.status}`);

    const newBody = (await newRes.json()) as {
      result?: { sessionId?: string };
      error?: { message: string };
    };
    if (newBody.error) throw new Error(newBody.error.message);
    const sessionId = newBody.result?.sessionId;
    if (!sessionId) throw new Error("No sessionId returned from session/new");

    // 2. Send prompt (fire-and-forget — SSE may block; we don't await)
    void fetch(`${base}/api/acp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "session/prompt",
        params: { sessionId, prompt: prompt ?? task.prompt, workspaceId: task.workspaceId },
      }),
    }).catch((err) => {
      console.warn(`[BGWorker] session/prompt fire-and-forget error:`, err);
    });

    return sessionId;
  }

  // ─── Check completed sessions ─────────────────────────────────────────────

  /**
   * Check for completed sessions and mark tasks as COMPLETED.
   *
   * Uses two strategies:
   * 1. In-memory Map (fast path for tasks dispatched in this process)
   * 2. Database query (robust path for tasks that survived HMR/restart)
   */
  async checkCompletions(): Promise<void> {
    const system = getRoutaSystem();
    const { getHttpSessionStore } = await import("../acp/http-session-store");
    const store = getHttpSessionStore();
    const activeSessions = new Set(store.listSessions().map((s) => s.sessionId));

    // Strategy 1: Check in-memory Map (for tasks dispatched in this process)
    for (const [sessionId, taskId] of [...this.sessionToTask.entries()]) {
      if (!activeSessions.has(sessionId)) {
        const task = await system.backgroundTaskStore.get(taskId);
        if (task) {
          await this.persistCompletedTaskOutput(task);
        }
        await system.backgroundTaskStore.updateStatus(taskId, "COMPLETED", {
          completedAt: new Date(),
          resultSessionId: sessionId,
        });
        this.sessionToTask.delete(sessionId);
        console.log(`[BGWorker] Task ${taskId} completed (session removed).`);
      }
    }

    // Strategy 2: Query database for RUNNING tasks with resultSessionId
    // This handles tasks that survived HMR or server restart
    try {
      const runningTasks = await system.backgroundTaskStore.listRunning();
      for (const task of runningTasks) {
        if (!task.resultSessionId) continue;
        const sessionGone = !activeSessions.has(task.resultSessionId);
        // Session exists but is idle (not streaming) and task has been running > 2 min
        const sessionIdleAndDone = activeSessions.has(task.resultSessionId)
          && !store.isSessionStreaming(task.resultSessionId)
          && task.startedAt != null
          && (Date.now() - new Date(task.startedAt).getTime()) > 2 * 60 * 1000;

        if (sessionGone || sessionIdleAndDone) {
          await this.persistCompletedTaskOutput(task);
          await system.backgroundTaskStore.updateStatus(task.id, "COMPLETED", {
            completedAt: new Date(),
            resultSessionId: task.resultSessionId,
          });
          console.log(`[BGWorker] Task ${task.id} completed (DB recovery, session ${task.resultSessionId}, gone=${sessionGone}, idle=${sessionIdleAndDone}).`);
        }
      }
    } catch (err) {
      // DB not ready or query failed — skip this cycle
      console.warn("[BGWorker] Failed to query running tasks:", err);
    }

    // Strategy 3: Handle orphaned tasks (RUNNING but no session, stuck for > 5 min)
    // These tasks were marked RUNNING but createAndSendPrompt failed silently
    try {
      const orphanedTasks = await system.backgroundTaskStore.listOrphaned(5);
      for (const task of orphanedTasks) {
        // Mark as FAILED so they can be retried or investigated
        await system.backgroundTaskStore.updateStatus(task.id, "FAILED", {
          completedAt: new Date(),
          errorMessage: "Orphaned task: dispatch failed without creating a session",
        });
        console.log(`[BGWorker] Task ${task.id} marked FAILED (orphaned, no session after 5 min).`);
      }
    } catch {
      // DB not ready — skip
    }

    // Strategy 4: Detect stale RUNNING tasks whose sessions have been alive too long
    // Sessions can stay in memory indefinitely; tasks running > 2 hours are considered stale
    try {
      const staleThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours
      const runningTasks = await system.backgroundTaskStore.listRunning();
      for (const task of runningTasks) {
        if (!task.resultSessionId) continue;
        if (!task.startedAt || task.startedAt > staleThreshold) continue;
        // Task has been RUNNING for > 2 hours — mark as FAILED (session is effectively dead)
        await system.backgroundTaskStore.updateStatus(task.id, "FAILED", {
          completedAt: new Date(),
          errorMessage: `Stale task: been running > 2 hours (session: ${task.resultSessionId})`,
        });
        this.sessionToTask.delete(task.resultSessionId);
        console.log(`[BGWorker] Task ${task.id} marked FAILED (stale, running > 2h).`);
      }
    } catch {
      // skip
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export function getBackgroundWorker(): BackgroundTaskWorker {
  const g = globalThis as Record<string, unknown>;
  if (!g[WORKER_GLOBAL_KEY]) g[WORKER_GLOBAL_KEY] = new BackgroundTaskWorker();
  return g[WORKER_GLOBAL_KEY] as BackgroundTaskWorker;
}

/**
 * Start the background worker singleton. Idempotent across HMR restarts.
 */
export function startBackgroundWorker(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[WORKER_STARTED_KEY]) return;
  g[WORKER_STARTED_KEY] = true;
  getBackgroundWorker().start();
}
