/**
 * Workspace Agent Adapter
 *
 * Native LLM-powered agent using Vercel AI SDK for the agentic loop.
 * Emits the same JSON-RPC session/update notifications as ClaudeCodeSdkAdapter,
 * so the existing UI, AgentEventBridge, and TraceRecorder work unchanged.
 *
 * Uses generateText (not streamText) for maximum provider compatibility —
 * many Anthropic-compatible endpoints (BigModel, etc.) have incomplete SSE
 * streaming support, but generateText works reliably across all providers.
 */

import { generateText, stepCountIs } from "ai";
import type { NotificationHandler, JsonRpcMessage } from "@/core/acp/protocol-types";
import type { AgentTools } from "@/core/tools/agent-tools";
import { WorkspaceAgentStateMachine } from "./workspace-agent-state";
import { createCodingTools, createAgentManagementTools } from "./workspace-agent-tools";
import {
  resolveWorkspaceAgentConfig,
  createLanguageModel,
  type WorkspaceAgentConfig,
} from "./workspace-agent-config";
import { LifecycleNotifier } from "../lifecycle-notifier";
import { AgentEventType } from "@/core/events/event-bus";

function createNotification(method: string, params: Record<string, unknown>): JsonRpcMessage {
  return { jsonrpc: "2.0", method, params };
}

export interface WorkspaceAgentAdapterOptions {
  agentTools?: AgentTools;
  workspaceId?: string;
  agentId?: string;
  sandboxId?: string;
  config?: Partial<WorkspaceAgentConfig>;
  lifecycleNotifier?: LifecycleNotifier;
}

export class WorkspaceAgentAdapter {
  private sessionId: string | null = null;
  private onNotification: NotificationHandler;
  private cwd: string;
  private _alive = false;
  private abortController: AbortController | null = null;
  private config: WorkspaceAgentConfig;
  private agentTools?: AgentTools;
  private workspaceId?: string;
  private agentId?: string;
  private sandboxId?: string;
  private lifecycleNotifier?: LifecycleNotifier;
  /** Conversation history for multi-turn */
  private messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

  constructor(
    cwd: string,
    onNotification: NotificationHandler,
    options?: WorkspaceAgentAdapterOptions,
  ) {
    this.cwd = cwd;
    this.onNotification = onNotification;
    this.agentTools = options?.agentTools;
    this.workspaceId = options?.workspaceId;
    this.agentId = options?.agentId;
    this.sandboxId = options?.sandboxId;
    this.config = resolveWorkspaceAgentConfig(options?.config);
    this.lifecycleNotifier = options?.lifecycleNotifier;
  }

  get alive(): boolean {
    return this._alive;
  }

  get acpSessionId(): string | null {
    return this.sessionId;
  }

  async connect(): Promise<void> {
    if (this.config.provider === "anthropic") {
      if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
        throw new Error("Workspace agent (anthropic) requires ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN");
      }
    } else if (this.config.provider === "openai") {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("Workspace agent (openai) requires OPENAI_API_KEY");
      }
    }
    this._alive = true;
    console.log(
      `[WorkspaceAgentAdapter] Initialized: provider=${this.config.provider}, model=${this.config.modelId}, maxSteps=${this.config.maxSteps}`,
    );
  }

  async createSession(title?: string): Promise<string> {
    if (!this._alive) {
      throw new Error("Adapter not connected");
    }
    this.sessionId = `workspace-${Date.now()}`;
    this.messages = [];
    console.log(`[WorkspaceAgentAdapter] Session created: ${this.sessionId} (${title || "untitled"})`);
    return this.sessionId;
  }

  /**
   * Send a prompt and return a streaming async generator of SSE events.
   * Each yielded string is a complete SSE event (data: JSON\n\n format).
   *
   * Uses Vercel AI SDK's generateText with maxSteps for the full agentic loop.
   * generateText is used instead of streamText for maximum provider compatibility —
   * many Anthropic-compatible endpoints have incomplete SSE streaming support.
   * Notifications are emitted after each step completes.
   */
  async *promptStream(
    text: string,
    acpSessionId?: string,
    systemPrompt?: string,
  ): AsyncGenerator<string, void, unknown> {
    if (!this._alive || !this.sessionId) {
      throw new Error("No active session");
    }

    const sessionId = acpSessionId ?? this.sessionId;
    const model = await createLanguageModel(this.config);
    this.abortController = new AbortController();

    const stateMachine = new WorkspaceAgentStateMachine(
      this.config.maxSteps,
      this.config.totalTimeoutMs,
    );
    stateMachine.transition("ACTING");

    // Build tools with file change callback
    const codingTools = createCodingTools(this.cwd, {
      workspaceId: this.workspaceId,
      taskId: undefined, // TODO: Extract from context if available
      agentId: this.agentId,
      onFileChange: (params) => {
        // Emit FILE_CHANGES event to EventBus
        if (this.agentTools && params.workspaceId && params.agentId) {
          this.agentTools.getEventBus().emit({
            type: AgentEventType.FILE_CHANGES,
            agentId: params.agentId,
            workspaceId: params.workspaceId,
            data: {
              filePath: params.filePath,
              operation: params.operation,
              taskId: params.taskId,
            },
            timestamp: new Date(),
          });
        }
      },
    });
    const mgmtTools =
      this.agentTools && this.workspaceId && this.agentId
        ? createAgentManagementTools(this.agentTools, this.workspaceId, this.agentId, {
            defaultSandboxId: this.sandboxId,
          })
        : {};
    const allTools = { ...codingTools, ...mgmtTools };

    // Build messages array for multi-turn
    if (systemPrompt && this.messages.length === 0) {
      this.messages.push({ role: "system", content: systemPrompt });
    }
    this.messages.push({ role: "user", content: text });

    let inputTokens = 0;
    let outputTokens = 0;

    const formatSse = (n: JsonRpcMessage): string => `data: ${JSON.stringify(n)}\n\n`;

    try {
      const result = await generateText({
        model,
        messages: this.messages,
        tools: allTools,
        stopWhen: stepCountIs(this.config.maxSteps),
        maxOutputTokens: this.config.maxTokens,
        abortSignal: this.abortController.signal,
        onStepFinish: ({ usage }) => {
          stateMachine.incrementStep();
          if (usage) {
            inputTokens += usage.inputTokens ?? 0;
            outputTokens += usage.outputTokens ?? 0;
          }
        },
      });

      // Emit notifications for each step
      for (const step of result.steps) {
        // Emit tool calls and results
        for (const toolCall of step.toolCalls) {
          const startNotif = createNotification("session/update", {
            sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: toolCall.toolCallId,
              title: toolCall.toolName,
              rawInput: (toolCall as any).input ?? (toolCall as any).args ?? {},
              status: "running",
            },
          });
          this.onNotification(startNotif);
          yield formatSse(startNotif);
        }

        for (const toolResult of step.toolResults) {
          const doneNotif = createNotification("session/update", {
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: toolResult.toolCallId,
              title: toolResult.toolName,
              status: "completed",
              rawOutput: (toolResult as any).output ?? (toolResult as any).result,
            },
          });
          this.onNotification(doneNotif);
          yield formatSse(doneNotif);
        }

        // Emit text as a single message chunk
        if (step.text) {
          const textNotif = createNotification("session/update", {
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: step.text },
            },
          });
          this.onNotification(textNotif);
          yield formatSse(textNotif);
        }

        // Emit reasoning if present
        if (step.reasoning) {
          const thoughtNotif = createNotification("session/update", {
            sessionId,
            update: {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: step.reasoning },
            },
          });
          this.onNotification(thoughtNotif);
          yield formatSse(thoughtNotif);
        }
      }

      // Append assistant response to conversation history for multi-turn
      if (result.text) {
        this.messages.push({ role: "assistant", content: result.text });
      }

      stateMachine.transition("DONE");

      // Emit turn_complete
      const completeNotif = createNotification("session/update", {
        sessionId,
        update: {
          sessionUpdate: "turn_complete",
          stopReason: result.finishReason === "stop" ? "end_turn" : result.finishReason,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        },
      });
      this.onNotification(completeNotif);
      yield formatSse(completeNotif);

      // Auto-notify lifecycle: agent is idle after completing its turn
      if (this.lifecycleNotifier) {
        await this.lifecycleNotifier.notifyIdle(result.text?.slice(0, 200));
      }
    } catch (error) {
      stateMachine.transition("FAILED");
      const msg = error instanceof Error ? error.message : String(error);
      if (!this.abortController?.signal.aborted) {
        console.error("[WorkspaceAgentAdapter] promptStream failed:", msg);
        const errNotif = createNotification("session/update", {
          sessionId,
          type: "error",
          error: { message: msg },
        });
        this.onNotification(errNotif);
        yield formatSse(errNotif);
      }
      // Auto-notify lifecycle: agent failed
      if (this.lifecycleNotifier && !this.abortController?.signal.aborted) {
        await this.lifecycleNotifier.notifyFailed(msg);
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async close(): Promise<void> {
    this.cancel();
    this.sessionId = null;
    this.messages = [];
    this._alive = false;
  }

  kill(): void {
    this.close().catch(() => {});
  }
}
