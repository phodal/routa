/**
 * AG-UI Protocol API Route — /api/ag-ui
 *
 * Implements the AG-UI protocol (https://docs.ag-ui.com) for Routa.
 * Accepts RunAgentInput as POST body and returns an SSE stream of AG-UI events.
 *
 * Under the hood, this bridges to the existing ACP session infrastructure:
 *   1. Creates or reuses an ACP session based on threadId
 *   2. Sends the user prompt via the ACP pipeline
 *   3. Converts ACP session/update notifications → AG-UI events in real-time
 *
 * POST /api/ag-ui
 *   Content-Type: application/json
 *   Accept: text/event-stream
 *   Body: RunAgentInput { threadId, runId, messages, tools, context, state, forwardedProps }
 *   Response: text/event-stream with AG-UI events
 */

import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { RoutaToAGUIAdapter } from "@/core/ag-ui/event-adapter";
import { getAcpProcessManager } from "@/core/acp/processer";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import type { SessionUpdateNotification } from "@/core/acp/http-session-store";
import { isServerlessEnvironment } from "@/core/acp/api-based-providers";
import { isClaudeCodeSdkConfigured } from "@/core/acp/claude-code-sdk-adapter";
import { isOpencodeServerConfigured } from "@/core/acp/opencode-sdk-adapter";
import { persistSessionToDb, saveHistoryToDb } from "@/core/acp/session-db-persister";

export const dynamic = "force-dynamic";

// ─── Types ─────────────────────────────────────────────────────────────────

interface RunAgentInput {
  threadId: string;
  runId: string;
  parentRunId?: string;
  state?: unknown;
  messages?: Array<{
    id: string;
    role: string;
    content?: string | Array<{ type: string; text?: string }>;
    toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    toolCallId?: string;
  }>;
  tools?: Array<{ name: string; description: string; parameters?: unknown }>;
  context?: Array<{ description: string; value: string }>;
  forwardedProps?: Record<string, unknown>;
}

// ─── Session mapping ───────────────────────────────────────────────────────
// Maps AG-UI threadId → ACP sessionId for session reuse
const threadSessionMap = new Map<string, string>();

/**
 * Encode an AG-UI event as an SSE `data:` line.
 */
function encodeSSE(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Extract the last user message text from RunAgentInput.messages.
 */
function extractPromptText(input: RunAgentInput): string {
  if (!input.messages || input.messages.length === 0) return "";

  // Find the last user message
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const msg = input.messages[i];
    if (msg.role === "user") {
      if (typeof msg.content === "string") return msg.content;
      if (Array.isArray(msg.content)) {
        return msg.content
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");
      }
    }
  }

  return "";
}

// ─── POST: Accept RunAgentInput, return AG-UI SSE stream ───────────────

export async function POST(request: NextRequest) {
  let input: RunAgentInput;
  try {
    input = await request.json();
  } catch {
    return new Response(
      encodeSSE({
        type: "RUN_ERROR",
        message: "Invalid JSON body",
        code: "INVALID_INPUT",
        timestamp: Date.now(),
      }),
      {
        status: 400,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  }

  const threadId = input.threadId || uuidv4();
  const runId = input.runId || uuidv4();
  const promptText = extractPromptText(input);

  if (!promptText) {
    return new Response(
      encodeSSE({
        type: "RUN_ERROR",
        message: "No user message found in messages array",
        code: "NO_PROMPT",
        timestamp: Date.now(),
      }),
      {
        status: 400,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  }

  // Determine provider from forwardedProps or default
  const provider =
    (input.forwardedProps?.provider as string) ??
    (isServerlessEnvironment() ? "claude-code-sdk" : "opencode");
  const workspaceId =
    (input.forwardedProps?.workspaceId as string) ?? "default";
  const cwd =
    (input.forwardedProps?.cwd as string) ?? process.cwd();
  const branch =
    (input.forwardedProps?.branch as string) || undefined;

  const manager = getAcpProcessManager();
  const store = getHttpSessionStore();
  const adapter = new RoutaToAGUIAdapter(threadId, runId);
  const encoder = new TextEncoder();

  // ─── Resolve or create ACP session ─────────────────────────────────────

  let sessionId = threadSessionMap.get(threadId);

  // Check if session is still alive
  if (sessionId) {
    const sessionExists =
      manager.getProcess(sessionId) !== undefined ||
      manager.getClaudeProcess(sessionId) !== undefined ||
      manager.isClaudeCodeSdkSession(sessionId) ||
      manager.isOpencodeAdapterSession(sessionId);

    if (!sessionExists) {
      threadSessionMap.delete(threadId);
      sessionId = undefined;
    }
  }

  // Create new session if needed
  if (!sessionId) {
    sessionId = uuidv4();
    threadSessionMap.set(threadId, sessionId);

    const forwardSessionUpdate = createSessionUpdateForwarder(store, sessionId);

    try {
      if (provider === "opencode-sdk" && isOpencodeServerConfigured()) {
        await manager.createOpencodeSdkSession(sessionId, forwardSessionUpdate);
      } else if (provider === "claude-code-sdk" && isClaudeCodeSdkConfigured()) {
        await manager.createClaudeCodeSdkSession(sessionId, cwd, forwardSessionUpdate, {
          provider: "claude-code-sdk",
          role: "CRAFTER",
        });
      } else {
        // Standard ACP session (opencode CLI)
        await manager.createSession(
          sessionId,
          cwd,
          forwardSessionUpdate,
          provider,
          undefined,
          undefined,
          undefined,
          workspaceId,
        );
      }

      // Persist session
      const now = new Date();
      store.upsertSession({
        sessionId,
        cwd,
        branch,
        workspaceId,
        provider,
        role: "CRAFTER",
        createdAt: now.toISOString(),
      });

      await persistSessionToDb({
        id: sessionId,
        cwd,
        branch,
        workspaceId,
        routaAgentId: sessionId,
        provider,
        role: "CRAFTER",
      });
    } catch (err) {
      return new Response(
        encodeSSE({
          type: "RUN_ERROR",
          message: `Failed to create session: ${err instanceof Error ? err.message : "Unknown error"}`,
          code: "SESSION_ERROR",
          timestamp: Date.now(),
        }),
        {
          status: 500,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    }
  }

  // ─── Build SSE response stream ──────────────────────────────────────────

  const stream = new ReadableStream({
    async start(controller) {
      const write = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Controller already closed
        }
      };

      // Emit RUN_STARTED
      write(
        encodeSSE({
          type: "RUN_STARTED",
          timestamp: Date.now(),
          threadId,
          runId,
        }),
      );

      // Set up an event collector — we intercept ACP notifications
      // and convert them to AG-UI events in real-time.
      const notificationBuffer: SessionUpdateNotification[] = [];
      let resolveWait: (() => void) | null = null;
      let isDone = false;

      const originalPush = store.pushNotification.bind(store);

      // Intercept notifications for this session
      const interceptor = (notification: SessionUpdateNotification) => {
        if (notification.sessionId !== sessionId) return;
        notificationBuffer.push(notification);
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      };

      store.addNotificationInterceptor(sessionId!, interceptor);

      // Store user message
      store.pushUserMessage(sessionId!, promptText);

      // Forward prompt to ACP
      try {
        // Use the streaming prompt for SDK sessions
        if (
          manager.isOpencodeAdapterSession(sessionId!) ||
          (await manager.isOpencodeSdkSessionAsync(sessionId!))
        ) {
          const opcAdapter = await manager.getOrRecreateOpencodeSdkAdapter(
            sessionId!,
            createSessionUpdateForwarder(store, sessionId!),
          );

          if (opcAdapter && opcAdapter.alive) {
            store.enterStreamingMode(sessionId!);
            for await (const event of opcAdapter.promptStream(promptText, sessionId!)) {
              // Parse ACP SSE event and convert to AG-UI
              const notifications = parseAcpSseEvent(event, sessionId!);
              for (const n of notifications) {
                const aguiEvents = adapter.convert(n);
                for (const e of aguiEvents) {
                  write(encodeSSE(e));
                }
              }
            }
            store.flushAgentBuffer(sessionId!);
            store.exitStreamingMode(sessionId!);
          }
        } else if (await manager.isClaudeCodeSdkSessionAsync(sessionId!)) {
          const claudeAdapter = await manager.getOrRecreateClaudeCodeSdkAdapter(
            sessionId!,
            createSessionUpdateForwarder(store, sessionId!),
          );

          if (claudeAdapter && claudeAdapter.alive) {
            store.enterStreamingMode(sessionId!);
            for await (const event of claudeAdapter.promptStream(promptText, sessionId!)) {
              const notifications = parseAcpSseEvent(event, sessionId!);
              for (const n of notifications) {
                const aguiEvents = adapter.convert(n);
                for (const e of aguiEvents) {
                  write(encodeSSE(e));
                }
              }
            }
            store.flushAgentBuffer(sessionId!);
            store.exitStreamingMode(sessionId!);
          }
        } else {
          // Standard ACP session — listen for intercepted notifications
          const proc = manager.getProcess(sessionId!);
          const acpSessionId = manager.getAcpSessionId(sessionId!);

          if (proc && acpSessionId) {
            // Send prompt via JSON-RPC to the process
            const promptResult = proc.prompt(acpSessionId, promptText);

            // Poll for intercepted updates while prompt is processing
            const pollNotifications = async () => {
              while (!isDone) {
                while (notificationBuffer.length > 0) {
                  const n = notificationBuffer.shift()!;
                  const aguiEvents = adapter.convert(n);
                  for (const e of aguiEvents) {
                    write(encodeSSE(e));
                  }

                  // Check for turn_complete
                  const updateType = n.update?.sessionUpdate;
                  if (updateType === "turn_complete" || updateType === "error") {
                    isDone = true;
                    return;
                  }
                }

                // Wait for more notifications
                await new Promise<void>((resolve) => {
                  resolveWait = resolve;
                  // Timeout to prevent hanging
                  setTimeout(resolve, 500);
                });
              }
            };

            // Run prompt and poll in parallel
            await Promise.race([
              promptResult.then(() => {
                // Give a small window for remaining events to arrive
                return new Promise<void>((resolve) => setTimeout(resolve, 1000));
              }),
              pollNotifications(),
            ]);

            // Drain any remaining notifications
            while (notificationBuffer.length > 0) {
              const n = notificationBuffer.shift()!;
              const aguiEvents = adapter.convert(n);
              for (const e of aguiEvents) {
                write(encodeSSE(e));
              }
            }
          }
        }
      } catch (err) {
        const errorEvents = adapter.flush();
        for (const e of errorEvents) {
          write(encodeSSE(e));
        }
        write(
          encodeSSE({
            type: "RUN_ERROR",
            timestamp: Date.now(),
            message: err instanceof Error ? err.message : "Prompt failed",
            code: "PROMPT_ERROR",
          }),
        );
      } finally {
        // Flush adapter and close
        const flushEvents = adapter.flush();
        for (const e of flushEvents) {
          write(encodeSSE(e));
        }

        // Remove interceptor
        store.removeNotificationInterceptor(sessionId!, interceptor);

        // Save history
        await saveHistoryToDb(sessionId!, store.getConsolidatedHistory(sessionId!));

        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },

    cancel() {
      // Client disconnected
      store.removeNotificationInterceptor(sessionId!, () => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Create a session-update forwarder compatible with the ACP process manager.
 * The manager expects a handler with shape: (msg: { method?: string; params?: Record<string, unknown> }) => void
 */
function createSessionUpdateForwarder(
  store: ReturnType<typeof getHttpSessionStore>,
  sessionId: string,
) {
  return (msg: { method?: string; params?: Record<string, unknown> }) => {
    if (msg.method !== "session/update" || !msg.params) return;

    const params = msg.params as Record<string, unknown>;
    const notification = {
      ...params,
      sessionId,
    } as SessionUpdateNotification;

    store.pushNotification(notification);
  };
}

/**
 * Parse an ACP SSE event string (e.g. `data: {...}\n\n`) into SessionUpdateNotification(s).
 */
function parseAcpSseEvent(
  raw: string,
  sessionId: string,
): SessionUpdateNotification[] {
  const results: SessionUpdateNotification[] = [];

  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const json = line.slice(6).trim();
    if (!json) continue;

    try {
      const parsed = JSON.parse(json);

      // ACP SSE wraps updates in JSON-RPC notification format
      if (parsed.method === "session/update" && parsed.params) {
        results.push({
          sessionId: parsed.params.sessionId ?? sessionId,
          update: parsed.params.update ?? parsed.params,
        });
      } else if (parsed.sessionUpdate) {
        // Direct update format
        results.push({ sessionId, update: parsed });
      } else if (parsed.type) {
        // Maybe already an event with a type field
        results.push({ sessionId, update: parsed });
      }
    } catch {
      // Skip unparseable lines
    }
  }

  return results;
}
