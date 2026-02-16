/**
 * RoutaOrchestrator
 *
 * The core orchestration engine that bridges MCP tool calls with actual
 * ACP process spawning. When a coordinator delegates a task, the orchestrator:
 *
 * 1. Creates a child agent record
 * 2. Spawns a real ACP process for the child agent
 * 3. Sends the task as the initial prompt
 * 4. Subscribes for completion events
 * 5. When the child reports back, wakes the parent agent
 *
 * This enables the full Coordinator → Implementor → Verifier lifecycle.
 */

import { v4 as uuidv4 } from "uuid";
import { AgentRole, AgentStatus, ModelTier } from "../models/agent";
import { TaskStatus, VerificationVerdict } from "../models/task";
import { AgentEventType } from "../events/event-bus";
import { ToolResult, successResult, errorResult } from "../tools/tool-result";
import {
  getSpecialistByRole,
  getSpecialistById,
  buildDelegationPrompt,
  type SpecialistConfig,
} from "./specialist-prompts";
import type { RoutaSystem } from "../routa-system";
import type { AcpProcessManager } from "../acp/acp-process-manager";
import type { NotificationHandler } from "../acp/processer";

export interface DelegateWithSpawnParams {
  /** Task ID to delegate */
  taskId: string;
  /** Calling agent's ID */
  callerAgentId: string;
  /** Calling agent's session ID (for wake-up) */
  callerSessionId: string;
  /** Workspace ID */
  workspaceId: string;
  /** Specialist role: "CRAFTER", "GATE", "DEVELOPER" (or specialist ID like "crafter", "gate", "developer") */
  specialist: string;
  /** ACP provider to use for the child (e.g., "claude", "copilot", "opencode") */
  provider?: string;
  /** Working directory for the child agent */
  cwd?: string;
  /** Additional instructions beyond the task content */
  additionalInstructions?: string;
  /** Wait mode: "immediate" or "after_all" */
  waitMode?: "immediate" | "after_all";
}

export interface OrchestratorConfig {
  /** Default ACP provider for CRAFTER agents */
  defaultCrafterProvider: string;
  /** Default ACP provider for GATE agents */
  defaultGateProvider: string;
  /** Default working directory */
  defaultCwd: string;
  /** Server port for MCP URL */
  serverPort?: string;
}

/**
 * Tracks a spawned child agent and its relationship to a parent.
 */
interface ChildAgentRecord {
  agentId: string;
  sessionId: string;
  parentAgentId: string;
  parentSessionId: string;
  taskId: string;
  role: AgentRole;
  provider: string;
}

/**
 * Delegation group for wait_mode="after_all"
 */
interface DelegationGroup {
  groupId: string;
  parentAgentId: string;
  parentSessionId: string;
  childAgentIds: string[];
  completedAgentIds: Set<string>;
}

export class RoutaOrchestrator {
  private system: RoutaSystem;
  private processManager: AcpProcessManager;
  private config: OrchestratorConfig;

  /** Map: agentId → ChildAgentRecord */
  private childAgents = new Map<string, ChildAgentRecord>();
  /** Map: agentId → sessionId */
  private agentSessionMap = new Map<string, string>();
  /** Map: groupId → DelegationGroup */
  private delegationGroups = new Map<string, DelegationGroup>();
  /** Map: callerAgentId → current groupId (for after_all mode) */
  private activeGroupByAgent = new Map<string, string>();
  /** SSE notification handler for sending updates to the frontend */
  private notificationHandler?: (sessionId: string, data: unknown) => void;

  constructor(
    system: RoutaSystem,
    processManager: AcpProcessManager,
    config: OrchestratorConfig
  ) {
    this.system = system;
    this.processManager = processManager;
    this.config = config;

    // Listen for report_submitted events to wake parent agents
    this.system.eventBus.on("orchestrator-report-handler", (event) => {
      if (event.type === AgentEventType.REPORT_SUBMITTED) {
        this.handleReportSubmitted(event.agentId, event.data).catch((err) => {
          console.error("[Orchestrator] Error handling report:", err);
        });
      }
    });
  }

  /**
   * Register the mapping between an agent ID and its ACP session ID.
   * Called when a new session is created (e.g., the coordinator's session).
   */
  registerAgentSession(agentId: string, sessionId: string): void {
    this.agentSessionMap.set(agentId, sessionId);
    console.log(
      `[Orchestrator] Registered agent session: ${agentId} → ${sessionId}`
    );
  }

  /**
   * Set the notification handler for forwarding SSE updates.
   */
  setNotificationHandler(
    handler: (sessionId: string, data: unknown) => void
  ): void {
    this.notificationHandler = handler;
  }

  /**
   * Delegate a task to a new agent by spawning a real ACP process.
   * This is the enhanced version of delegate_task that actually creates a running agent.
   */
  async delegateTaskWithSpawn(
    params: DelegateWithSpawnParams
  ): Promise<ToolResult> {
    const {
      taskId,
      callerAgentId,
      callerSessionId,
      workspaceId,
      specialist: specialistInput,
      additionalInstructions,
      waitMode = "immediate",
    } = params;

    // 1. Resolve specialist config
    const specialistConfig = this.resolveSpecialist(specialistInput);
    if (!specialistConfig) {
      return errorResult(
        `Unknown specialist: ${specialistInput}. Use "CRAFTER", "GATE", "crafter", or "gate".`
      );
    }

    // 2. Get the task
    const task = await this.system.taskStore.get(taskId);
    if (!task) {
      return errorResult(`Task not found: ${taskId}`);
    }

    // 3. Determine provider
    const provider =
      params.provider ??
      (specialistConfig.role === AgentRole.CRAFTER
        ? this.config.defaultCrafterProvider
        : this.config.defaultGateProvider);

    const cwd = params.cwd ?? this.config.defaultCwd;

    // 4. Create agent record
    const agentName = `${specialistConfig.id}-${task.title
      .slice(0, 30)
      .replace(/\s+/g, "-")
      .toLowerCase()}`;
    const agentResult = await this.system.tools.createAgent({
      name: agentName,
      role: specialistConfig.role,
      workspaceId,
      parentId: callerAgentId,
      modelTier: specialistConfig.defaultModelTier,
    });

    if (!agentResult.success || !agentResult.data) {
      return errorResult(`Failed to create agent: ${agentResult.error}`);
    }

    const agentId = (agentResult.data as { agentId: string }).agentId;

    // 5. Build the delegation prompt
    const delegationPrompt = buildDelegationPrompt({
      specialist: specialistConfig,
      agentId,
      taskId,
      taskTitle: task.title,
      taskContent:
        `## Objective\n${task.objective}\n` +
        (task.scope ? `\n## Scope\n${task.scope}\n` : "") +
        (task.acceptanceCriteria
          ? `\n## Definition of Done\n${task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}\n`
          : "") +
        (task.verificationCommands
          ? `\n## Verification\n${task.verificationCommands.map((c) => `- \`${c}\``).join("\n")}\n`
          : ""),
      parentAgentId: callerAgentId,
      additionalContext: additionalInstructions,
    });

    // 6. Assign task to agent
    task.assignedTo = agentId;
    task.status = TaskStatus.IN_PROGRESS;
    task.updatedAt = new Date();
    await this.system.taskStore.save(task);
    await this.system.agentStore.updateStatus(agentId, AgentStatus.ACTIVE);

    // 7. Spawn the ACP process
    const childSessionId = uuidv4();
    try {
      await this.spawnChildAgent(
        childSessionId,
        agentId,
        provider,
        cwd,
        delegationPrompt,
        callerSessionId
      );
    } catch (err) {
      // Clean up on spawn failure
      await this.system.agentStore.updateStatus(agentId, AgentStatus.ERROR);
      task.status = TaskStatus.BLOCKED;
      task.updatedAt = new Date();
      await this.system.taskStore.save(task);
      return errorResult(
        `Failed to spawn agent process: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 8. Track the child agent
    const record: ChildAgentRecord = {
      agentId,
      sessionId: childSessionId,
      parentAgentId: callerAgentId,
      parentSessionId: callerSessionId,
      taskId,
      role: specialistConfig.role,
      provider,
    };
    this.childAgents.set(agentId, record);
    this.agentSessionMap.set(agentId, childSessionId);

    // 9. Handle wait mode
    if (waitMode === "after_all") {
      let groupId = this.activeGroupByAgent.get(callerAgentId);
      if (!groupId) {
        groupId = `delegation-group-${uuidv4()}`;
        this.activeGroupByAgent.set(callerAgentId, groupId);
        this.delegationGroups.set(groupId, {
          groupId,
          parentAgentId: callerAgentId,
          parentSessionId: callerSessionId,
          childAgentIds: [],
          completedAgentIds: new Set(),
        });
      }
      const group = this.delegationGroups.get(groupId)!;
      group.childAgentIds.push(agentId);
    }

    // 10. Emit event
    this.system.eventBus.emit({
      type: AgentEventType.TASK_ASSIGNED,
      agentId,
      workspaceId,
      data: {
        taskId,
        callerAgentId,
        taskTitle: task.title,
        provider,
        specialist: specialistConfig.id,
      },
      timestamp: new Date(),
    });

    const waitMessage =
      waitMode === "after_all"
        ? "You will be notified when ALL delegated agents in this group complete."
        : "You will be notified when this agent completes.";

    console.log(
      `[Orchestrator] Delegated task "${task.title}" to ${specialistConfig.name} agent ${agentId} (provider: ${provider})`
    );

    return successResult({
      agentId,
      taskId,
      agentName,
      specialist: specialistConfig.id,
      provider,
      sessionId: childSessionId,
      waitMode,
      message: `Task "${task.title}" delegated to ${specialistConfig.name} agent. ${waitMessage}`,
    });
  }

  /**
   * Spawn a child ACP agent process and send the initial prompt.
   */
  private async spawnChildAgent(
    sessionId: string,
    agentId: string,
    provider: string,
    cwd: string,
    initialPrompt: string,
    parentSessionId: string
  ): Promise<void> {
    const isClaudeCode = provider === "claude";

    const notificationHandler: NotificationHandler = (msg) => {
      if (msg.method === "session/update" && msg.params) {
        const params = msg.params as Record<string, unknown>;

        // Check for completion signals in the update
        this.checkForCompletion(agentId, params);

        // Forward notifications to the parent session's SSE
        if (this.notificationHandler) {
          this.notificationHandler(parentSessionId, {
            ...params,
            sessionId: parentSessionId,
            childAgentId: agentId,
            childSessionId: sessionId,
          });
        }
      }
    };

    // Detect the actual server port dynamically
    const port = this.detectServerPort();
    const host = process.env.HOST ?? "localhost";
    const mcpUrl = `http://${host}:${port}/api/mcp`;

    let acpSessionId: string;

    if (isClaudeCode) {
      const mcpConfigJson = JSON.stringify({
        mcpServers: {
          routa: { url: mcpUrl, type: "sse" },
        },
      });

      acpSessionId = await this.processManager.createClaudeSession(
        sessionId,
        cwd,
        notificationHandler,
        [mcpConfigJson]
      );

      // Send the initial prompt and handle completion
      const claudeProc = this.processManager.getClaudeProcess(sessionId);
      if (claudeProc) {
        // Await the prompt so we can detect when the child finishes
        claudeProc.prompt(acpSessionId, initialPrompt)
          .then((result) => {
            console.log(
              `[Orchestrator] Child agent ${agentId} prompt completed:`,
              JSON.stringify(result).slice(0, 200)
            );
            // Auto-report if the agent hasn't called report_to_parent
            this.autoReportIfNeeded(agentId);
          })
          .catch((err) => {
            console.error(
              `[Orchestrator] Child agent ${agentId} prompt failed:`,
              err
            );
            this.handleChildError(agentId, err);
          });
      }
    } else {
      acpSessionId = await this.processManager.createSession(
        sessionId,
        cwd,
        notificationHandler,
        provider
      );

      // Send the initial prompt and handle completion
      const proc = this.processManager.getProcess(sessionId);
      if (proc) {
        proc.prompt(acpSessionId, initialPrompt)
          .then((result) => {
            console.log(
              `[Orchestrator] Child agent ${agentId} prompt completed:`,
              JSON.stringify(result).slice(0, 200)
            );
            this.autoReportIfNeeded(agentId);
          })
          .catch((err) => {
            console.error(
              `[Orchestrator] Child agent ${agentId} prompt failed:`,
              err
            );
            this.handleChildError(agentId, err);
          });
      }
    }

    console.log(
      `[Orchestrator] Spawned ${provider} process for agent ${agentId} (session: ${sessionId}, mcpUrl: ${mcpUrl})`
    );
  }

  /**
   * Auto-report to parent if the child agent finished without calling report_to_parent.
   * This is a fallback mechanism for agents that complete their work but forget to report.
   */
  private async autoReportIfNeeded(childAgentId: string): Promise<void> {
    // Wait a short time to allow report_to_parent to be processed first
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const agent = await this.system.agentStore.get(childAgentId);
    if (!agent) return;

    // If the agent is already completed (report_to_parent was called), skip
    if (agent.status === AgentStatus.COMPLETED) {
      console.log(
        `[Orchestrator] Agent ${childAgentId} already completed, skipping auto-report`
      );
      return;
    }

    const record = this.childAgents.get(childAgentId);
    if (!record) return;

    console.log(
      `[Orchestrator] Agent ${childAgentId} finished without calling report_to_parent, auto-reporting`
    );

    // Auto-report success (the prompt completed without error)
    await this.system.tools.reportToParent({
      agentId: childAgentId,
      report: {
        agentId: childAgentId,
        taskId: record.taskId,
        summary: "Agent completed its work (auto-reported by orchestrator).",
        success: true,
      },
    });

    // Trigger completion handling
    await this.handleChildCompletion(childAgentId, record);
  }

  /**
   * Detect the actual server port.
   */
  private detectServerPort(): string {
    if (this.config.serverPort) return this.config.serverPort;
    if (process.env.PORT) return process.env.PORT;
    return "3000";
  }

  /**
   * Check session/update notifications for signs of agent completion.
   * This is a fallback in case the agent doesn't call report_to_parent.
   */
  private checkForCompletion(
    agentId: string,
    params: Record<string, unknown>
  ): void {
    // Check if the session has ended (provider signals completion)
    const update = params.update as Record<string, unknown> | undefined;
    if (update?.sessionUpdate === "completed" || update?.sessionUpdate === "ended") {
      console.log(
        `[Orchestrator] Detected session completion for agent ${agentId}`
      );
      // The agent's session ended without calling report_to_parent
      // Treat as a successful completion with no formal report
      const record = this.childAgents.get(agentId);
      if (record) {
        this.handleChildCompletion(agentId, record).catch((err) => {
          console.error("[Orchestrator] Error handling completion:", err);
        });
      }
    }
  }

  /**
   * Handle a report_submitted event from a child agent.
   * This is triggered when the child calls report_to_parent via MCP.
   */
  private async handleReportSubmitted(
    childAgentId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const record = this.childAgents.get(childAgentId);
    if (!record) {
      console.log(
        `[Orchestrator] Report from unknown child agent ${childAgentId}, ignoring`
      );
      return;
    }

    await this.handleChildCompletion(childAgentId, record);
  }

  /**
   * Handle child agent completion: check groups or immediately wake parent.
   */
  private async handleChildCompletion(
    childAgentId: string,
    record: ChildAgentRecord
  ): Promise<void> {
    // Check if this child is part of an after_all group
    for (const [groupId, group] of this.delegationGroups.entries()) {
      if (group.childAgentIds.includes(childAgentId)) {
        group.completedAgentIds.add(childAgentId);
        console.log(
          `[Orchestrator] Agent ${childAgentId} completed in group ${groupId} ` +
            `(${group.completedAgentIds.size}/${group.childAgentIds.length})`
        );

        // Check if all agents in the group are done
        if (group.completedAgentIds.size >= group.childAgentIds.length) {
          console.log(
            `[Orchestrator] All agents in group ${groupId} completed, waking parent`
          );
          await this.wakeParent(record, groupId);
          this.delegationGroups.delete(groupId);
          this.activeGroupByAgent.delete(record.parentAgentId);
        }
        return;
      }
    }

    // Immediate mode: wake parent right away
    console.log(
      `[Orchestrator] Child agent ${childAgentId} completed, waking parent ${record.parentAgentId}`
    );
    await this.wakeParent(record);
  }

  /**
   * Wake a parent agent by sending a completion prompt to its session.
   */
  private async wakeParent(
    record: ChildAgentRecord,
    groupId?: string
  ): Promise<void> {
    const { parentAgentId, parentSessionId, taskId } = record;

    // Build a wake-up message with completion details
    let wakeMessage: string;

    if (groupId) {
      const group = this.delegationGroups.get(groupId);
      const reports = [];
      if (group) {
        for (const childId of group.childAgentIds) {
          const childRecord = this.childAgents.get(childId);
          if (childRecord) {
            const agent = await this.system.agentStore.get(childId);
            const task = await this.system.taskStore.get(childRecord.taskId);
            reports.push(
              `- **${agent?.name ?? childId}** (${childRecord.role}): ` +
                `Task "${task?.title ?? childRecord.taskId}" → ` +
                `${task?.status ?? "unknown"}`
            );
            // Include completion summary if available
            if (task?.completionSummary) {
              reports.push(`  Summary: ${task.completionSummary}`);
            }
          }
        }
      }
      wakeMessage =
        `## Delegation Group Complete\n\n` +
        `All ${group?.childAgentIds.length ?? 0} delegated agents have completed:\n\n` +
        reports.join("\n") +
        `\n\nReview the results and decide next steps. ` +
        `You may want to delegate a GATE (verifier) agent to validate the work.`;
    } else {
      const agent = await this.system.agentStore.get(record.agentId);
      const task = await this.system.taskStore.get(taskId);
      wakeMessage =
        `## Agent Completion Report\n\n` +
        `**Agent:** ${agent?.name ?? record.agentId} (${record.role})\n` +
        `**Task:** ${task?.title ?? taskId}\n` +
        `**Status:** ${task?.status ?? "unknown"}\n` +
        (task?.completionSummary
          ? `**Summary:** ${task.completionSummary}\n`
          : "") +
        (task?.verificationVerdict
          ? `**Verification:** ${task.verificationVerdict}\n`
          : "") +
        (task?.verificationReport
          ? `**Report:**\n${task.verificationReport}\n`
          : "") +
        `\nReview the results and decide next steps.`;
    }

    // Send the wake-up message as a new prompt to the parent's session
    await this.sendPromptToSession(parentSessionId, wakeMessage);

    console.log(
      `[Orchestrator] Woke parent agent ${parentAgentId} with completion report`
    );
  }

  /**
   * Send a prompt to an existing ACP session.
   */
  private async sendPromptToSession(
    sessionId: string,
    prompt: string
  ): Promise<void> {
    const manager = this.processManager;

    if (manager.isClaudeSession(sessionId)) {
      const claudeProc = manager.getClaudeProcess(sessionId);
      if (claudeProc && claudeProc.alive) {
        await claudeProc.prompt(sessionId, prompt);
      } else {
        console.error(
          `[Orchestrator] Claude process not available for session ${sessionId}`
        );
      }
    } else if (manager.isOpencodeAdapterSession(sessionId)) {
      const adapter = manager.getOpencodeAdapter(sessionId);
      if (adapter && adapter.alive) {
        const acpSessionId = manager.getAcpSessionId(sessionId);
        if (acpSessionId) {
          // Use the adapter's prompt method
          await (adapter as unknown as { prompt: (s: string, t: string) => Promise<unknown> }).prompt(
            acpSessionId,
            prompt
          );
        }
      }
    } else {
      const proc = manager.getProcess(sessionId);
      const acpSessionId = manager.getAcpSessionId(sessionId);
      if (proc && acpSessionId && proc.alive) {
        await proc.prompt(acpSessionId, prompt);
      } else {
        console.error(
          `[Orchestrator] ACP process not available for session ${sessionId}`
        );
      }
    }
  }

  /**
   * Handle a child agent error.
   */
  private async handleChildError(
    agentId: string,
    error: unknown
  ): Promise<void> {
    const record = this.childAgents.get(agentId);
    if (!record) return;

    await this.system.agentStore.updateStatus(agentId, AgentStatus.ERROR);
    const task = await this.system.taskStore.get(record.taskId);
    if (task) {
      task.status = TaskStatus.NEEDS_FIX;
      task.completionSummary = `Error: ${error instanceof Error ? error.message : String(error)}`;
      task.updatedAt = new Date();
      await this.system.taskStore.save(task);
    }

    // Emit error event
    this.system.eventBus.emit({
      type: AgentEventType.AGENT_ERROR,
      agentId,
      workspaceId: record.taskId, // Workspace from task
      data: {
        parentAgentId: record.parentAgentId,
        error: error instanceof Error ? error.message : String(error),
      },
      timestamp: new Date(),
    });

    // Wake parent with error report
    await this.handleChildCompletion(agentId, record);
  }

  /**
   * Resolve specialist config from a string (role name or specialist ID).
   */
  private resolveSpecialist(input: string): SpecialistConfig | undefined {
    // Try by role name (e.g., "CRAFTER", "GATE")
    const role = input.toUpperCase() as AgentRole;
    if (Object.values(AgentRole).includes(role)) {
      return getSpecialistByRole(role);
    }
    // Try by specialist ID (e.g., "crafter", "gate")
    return getSpecialistById(input);
  }

  /**
   * Get the session ID for an agent.
   */
  getSessionForAgent(agentId: string): string | undefined {
    return this.agentSessionMap.get(agentId);
  }

  /**
   * Get all child agent records for a parent.
   */
  getChildAgents(parentAgentId: string): ChildAgentRecord[] {
    return Array.from(this.childAgents.values()).filter(
      (r) => r.parentAgentId === parentAgentId
    );
  }

  /**
   * Clean up resources for a session.
   */
  cleanup(sessionId: string): void {
    // Find and clean up child agents
    for (const [agentId, record] of this.childAgents.entries()) {
      if (
        record.parentSessionId === sessionId ||
        record.sessionId === sessionId
      ) {
        this.processManager.killSession(record.sessionId);
        this.childAgents.delete(agentId);
        this.agentSessionMap.delete(agentId);
      }
    }
  }
}
