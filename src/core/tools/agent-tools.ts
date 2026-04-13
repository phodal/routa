/**
 * AgentTools - port of routa-core AgentTools.kt
 *
 * Provides 12 coordination tools for multi-agent collaboration:
 *
 * Core tools (6):
 *   1. listAgents        - List agents in a workspace
 *   2. readAgentConversation - Read another agent's conversation
 *   3. createAgent       - Create ROUTA/CRAFTER/GATE agents
 *   4. delegate          - Assign task to agent
 *   5. messageAgent      - Inter-agent messaging
 *   6. reportToParent    - Completion report to parent
 *
 * Task-agent lifecycle (4):
 *   7. wakeOrCreateTaskAgent    - Wake or create agent for task
 *   8. sendMessageToTaskAgent   - Message to task's assigned agent
 *   9. getAgentStatus           - Agent status
 *  10. getAgentSummary          - Agent summary
 *
 * Event subscription (2):
 *  11. subscribeToEvents        - Subscribe to workspace events
 *  12. unsubscribeFromEvents    - Unsubscribe
 */

import { v4 as uuidv4 } from "uuid";
import {
  AgentRole,
  AgentStatus,
  ModelTier,
  createAgent as createAgentModel,
} from "../models/agent";
import { Task, TaskStatus, createTask as createTaskModel } from "../models/task";
import type { KanbanBoardStore } from "../store/kanban-board-store";
import { MessageRole, createMessage, CompletionReport } from "../models/message";
import {
  ArtifactType,
  createArtifact,
  createArtifactRequest,
} from "../models/artifact";
import { AgentStore } from "../store/agent-store";
import { ConversationStore } from "../store/conversation-store";
import { TaskStore } from "../store/task-store";
import { ArtifactStore } from "../store/artifact-store";
import { EventBus, AgentEventType } from "../events/event-bus";
import { getKanbanEventBroadcaster } from "../kanban/kanban-event-broadcaster";
import type { TaskCreationSource } from "../kanban/task-creation-policy";
import { ToolResult, successResult, errorResult } from './tool-result';
import { applySandboxPermissionConstraints, SandboxPermissionConstraints } from "../sandbox";
import { columnIdToTaskStatus } from "../models/kanban";
import { resolveReviewLaneConvergenceTarget } from "../kanban/review-lane-convergence";
import {
  PermissionStore,
  PermissionRequest,
  PermissionRequestOptions,
  PermissionUrgency,
} from './permission-store';
import { getTaskLaneSession } from "../kanban/task-lane-history";

function extractSandboxId(options?: PermissionRequestOptions): string | undefined {
  const sandboxId = options?.sandboxId;
  return typeof sandboxId === "string" && sandboxId.trim().length > 0
    ? sandboxId.trim()
    : undefined;
}

function stripAnsiEscapeCodes(value?: string): string {
  if (!value) return "";
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    const nextChar = value[index + 1];
    if (charCode === 27 && nextChar === "[") {
      index += 2;
      while (index < value.length) {
        const commandCode = value.charCodeAt(index);
        if (commandCode >= 64 && commandCode <= 126) {
          break;
        }
        index += 1;
      }
      continue;
    }
    result += value[index];
  }
  return result;
}

function extractScreenshotPath(output: string): string | undefined {
  const pathMatch = output.match(/((?:[A-Za-z]:)?(?:[\\/]|~\/)[^\s"]+?\.png)\b/i);
  return pathMatch?.[1];
}

function notifyKanbanArtifactChanged(workspaceId: string, taskId: string): void {
  getKanbanEventBroadcaster().notify({
    workspaceId,
    entity: "task",
    action: "updated",
    resourceId: taskId,
    source: "agent",
  });
}

function resolveSyntheticCompletionLaneSession(
  task: Task,
  agentId: string,
  targetColumnId: string | undefined,
) {
  const sessionCandidates = [agentId, task.triggerSessionId].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  for (const candidate of sessionCandidates) {
    const session = getTaskLaneSession(task, candidate);
    if (session && session.columnId === targetColumnId && session.status === "running") {
      return session;
    }
  }

  for (const candidate of sessionCandidates) {
    const session = getTaskLaneSession(task, candidate);
    if (session?.status === "running") {
      return session;
    }
  }

  const runningSessions = [...(task.laneSessions ?? [])]
    .reverse()
    .filter((session) => session.status === "running");

  return runningSessions.find((session) => session.columnId === targetColumnId)
    ?? runningSessions[0];
}

function shouldEmitSyntheticCompletion(params: {
  task: Task;
  agentId: string;
  targetColumnId: string | undefined;
}) {
  const { task, agentId, targetColumnId } = params;
  const laneSession = resolveSyntheticCompletionLaneSession(task, agentId, targetColumnId);
  if (!laneSession) {
    return undefined;
  }

  if (
    laneSession.completionRequirement === "completion_summary"
    && task.completionSummary?.trim()
  ) {
    return {
      sessionId: laneSession.sessionId,
      trigger: "completion_summary" as const,
    };
  }

  if (
    laneSession.columnId === "review"
    && laneSession.role === "GATE"
    && task.verificationVerdict
    && task.verificationReport?.trim()
  ) {
    return {
      sessionId: laneSession.sessionId,
      trigger: "verification_report" as const,
    };
  }

  if (
    laneSession.completionRequirement === "verification_report"
    && task.verificationReport?.trim()
  ) {
    return {
      sessionId: laneSession.sessionId,
      trigger: "verification_report" as const,
    };
  }

  return undefined;
}

export class AgentTools {
  private artifactStore?: ArtifactStore;
  private permissionStore?: PermissionStore;
  private kanbanBoardStore?: Pick<KanbanBoardStore, "get">;

  constructor(
    private agentStore: AgentStore,
    private conversationStore: ConversationStore,
    private taskStore: TaskStore,
    private eventBus: EventBus
  ) {}

  /**
   * Set artifact store for artifact-related tools.
   * Optional to maintain backward compatibility.
   */
  setArtifactStore(store: ArtifactStore): void {
    this.artifactStore = store;
  }

  setPermissionStore(store: PermissionStore): void {
    this.permissionStore = store;
  }

  setKanbanBoardStore(store: Pick<KanbanBoardStore, "get">): void {
    this.kanbanBoardStore = store;
  }

  // ─── EventBus Access ─────────────────────────────────────────────────

  getEventBus() {
    return this.eventBus;
  }

  // ─── Tool 0: Create Task ────────────────────────────────────────────

  async createTask(params: {
    title: string;
    objective: string;
    workspaceId: string;
    scope?: string;
    acceptanceCriteria?: string[];
    verificationCommands?: string[];
    testCases?: string[];
    dependencies?: string[];
    parallelGroup?: string;
    creationSource?: TaskCreationSource;
  }): Promise<ToolResult> {
    const task = createTaskModel({
      id: uuidv4(),
      title: params.title,
      objective: params.objective,
      workspaceId: params.workspaceId,
      scope: params.scope,
      acceptanceCriteria: params.acceptanceCriteria,
      verificationCommands: params.verificationCommands,
      testCases: params.testCases,
      dependencies: params.dependencies,
      parallelGroup: params.parallelGroup,
      creationSource: params.creationSource,
    });

    await this.taskStore.save(task);

    return successResult({
      taskId: task.id,
      title: task.title,
      status: task.status,
    });
  }

  // ─── Get Task ─────────────────────────────────────────────────────────

  async getTask(taskId: string): Promise<ToolResult> {
    const task = await this.taskStore.get(taskId);
    if (!task) {
      return errorResult(`Task not found: ${taskId}`);
    }
    return successResult(task);
  }

  // ─── List Tasks ───────────────────────────────────────────────────────

  async listTasks(workspaceId: string): Promise<ToolResult> {
    const tasks = await this.taskStore.listByWorkspace(workspaceId);
    return successResult(
      tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assignedTo: t.assignedTo,
        verificationVerdict: t.verificationVerdict,
      }))
    );
  }

  // ─── Tool 1: List Agents ─────────────────────────────────────────────

  async listAgents(workspaceId: string): Promise<ToolResult> {
    const agents = await this.agentStore.listByWorkspace(workspaceId);
    const summary = agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      modelTier: a.modelTier,
      workspaceId: a.workspaceId,
      status: a.status,
      parentId: a.parentId,
      metadata: a.metadata ?? {},
      createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
      updatedAt: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : a.updatedAt,
    }));
    return successResult(summary);
  }

  // ─── Tool 2: Read Agent Conversation ─────────────────────────────────

  async readAgentConversation(params: {
    agentId: string;
    lastN?: number;
    startTurn?: number;
    endTurn?: number;
    includeToolCalls?: boolean;
  }): Promise<ToolResult> {
    const { agentId, lastN, startTurn, endTurn, includeToolCalls = false } = params;

    const agent = await this.agentStore.get(agentId);
    if (!agent) {
      return errorResult(`Agent not found: ${agentId}`);
    }

    let messages;
    if (lastN !== undefined) {
      messages = await this.conversationStore.getLastN(agentId, lastN);
    } else if (startTurn !== undefined && endTurn !== undefined) {
      messages = await this.conversationStore.getByTurnRange(agentId, startTurn, endTurn);
    } else {
      messages = await this.conversationStore.getConversation(agentId);
    }

    if (!includeToolCalls) {
      messages = messages.filter((m) => m.role !== MessageRole.TOOL);
    }

    return successResult({
      agentId,
      agentName: agent.name,
      messageCount: messages.length,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        turn: m.turn,
        toolName: m.toolName,
        timestamp: m.timestamp.toISOString(),
      })),
    });
  }

  // ─── Tool 3: Create Agent ────────────────────────────────────────────

  async createAgent(params: {
    name: string;
    role: string;
    workspaceId: string;
    parentId?: string;
    modelTier?: string;
    metadata?: Record<string, string>;
  }): Promise<ToolResult> {
    const role = params.role.toUpperCase() as AgentRole;
    if (!Object.values(AgentRole).includes(role)) {
      return errorResult(
        `Invalid role: ${params.role}. Must be one of: ${Object.values(AgentRole).join(", ")}`
      );
    }

    const modelTier = params.modelTier
      ? (params.modelTier.toUpperCase() as ModelTier)
      : ModelTier.SMART;

    const agent = createAgentModel({
      id: uuidv4(),
      name: params.name,
      role,
      workspaceId: params.workspaceId,
      parentId: params.parentId,
      modelTier,
      metadata: params.metadata ?? {},
    });

    await this.agentStore.save(agent);

    this.eventBus.emit({
      type: AgentEventType.AGENT_CREATED,
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      data: {
        name: agent.name,
        role: agent.role,
        metadata: agent.metadata,
      },
      timestamp: new Date(),
    });

    return successResult({
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
    });
  }

  // ─── Tool 4: Delegate Task ──────────────────────────────────────────

  async delegate(params: {
    agentId: string;
    taskId: string;
    callerAgentId: string;
  }): Promise<ToolResult> {
    const { agentId, taskId, callerAgentId } = params;

    const agent = await this.agentStore.get(agentId);
    if (!agent) {
      return errorResult(`Agent not found: ${agentId}`);
    }

    const task = await this.taskStore.get(taskId);
    if (!task) {
      // Check if the taskId looks like a name instead of a UUID
      const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId);
      const hint = looksLikeUuid
        ? `Use list_tasks to see available tasks, or create_task to create a new one.`
        : `The taskId "${taskId}" looks like a task name, not a UUID. ` +
          `You must use the UUID returned by create_task. ` +
          `First call create_task to create tasks, then use the returned taskId (UUID format). ` +
          `Or use list_tasks to see existing tasks.`;
      return errorResult(`Task not found: ${taskId}. ${hint}`);
    }

    // Assign and activate
    task.assignedTo = agentId;
    task.status = TaskStatus.IN_PROGRESS;
    task.updatedAt = new Date();
    await this.taskStore.save(task);

    await this.agentStore.updateStatus(agentId, AgentStatus.ACTIVE);

    // Record delegation as a conversation message
    await this.conversationStore.append(
      createMessage({
        id: uuidv4(),
        agentId,
        role: MessageRole.USER,
        content: `Task delegated: ${task.title}\nObjective: ${task.objective}`,
      })
    );

    this.eventBus.emit({
      type: AgentEventType.TASK_ASSIGNED,
      agentId,
      workspaceId: agent.workspaceId,
      data: { taskId, callerAgentId, taskTitle: task.title },
      timestamp: new Date(),
    });

    return successResult({
      agentId,
      taskId,
      status: "delegated",
    });
  }

  // ─── Tool 5: Message Agent ──────────────────────────────────────────

  async messageAgent(params: {
    fromAgentId: string;
    toAgentId: string;
    message: string;
  }): Promise<ToolResult> {
    const { fromAgentId, toAgentId, message } = params;

    const toAgent = await this.agentStore.get(toAgentId);
    if (!toAgent) {
      return errorResult(`Target agent not found: ${toAgentId}`);
    }

    await this.conversationStore.append(
      createMessage({
        id: uuidv4(),
        agentId: toAgentId,
        role: MessageRole.USER,
        content: `[From agent ${fromAgentId}]: ${message}`,
      })
    );

    this.eventBus.emit({
      type: AgentEventType.MESSAGE_SENT,
      agentId: fromAgentId,
      workspaceId: toAgent.workspaceId,
      data: { fromAgentId, toAgentId, messagePreview: message.slice(0, 200) },
      timestamp: new Date(),
    });

    return successResult({
      delivered: true,
      toAgentId,
      fromAgentId,
    });
  }

  // ─── Tool 6: Report to Parent ───────────────────────────────────────

  async reportToParent(params: {
    agentId: string;
    report: CompletionReport;
  }): Promise<ToolResult> {
    const { agentId, report } = params;

    const agent = await this.agentStore.get(agentId);
    if (!agent) {
      return errorResult(`Agent not found: ${agentId}`);
    }

    if (!agent.parentId) {
      return errorResult(`Agent ${agentId} has no parent to report to`);
    }

    // Update task status
    if (report.taskId) {
      const task = await this.taskStore.get(report.taskId);
      if (task) {
        task.status = report.success ? TaskStatus.COMPLETED : TaskStatus.NEEDS_FIX;
        task.completionSummary = report.summary;
        task.updatedAt = new Date();
        await this.taskStore.save(task);
      }
    }

    // Mark agent completed
    await this.agentStore.updateStatus(agentId, AgentStatus.COMPLETED);

    // Deliver report as message to parent
    await this.conversationStore.append(
      createMessage({
        id: uuidv4(),
        agentId: agent.parentId,
        role: MessageRole.USER,
        content: `[Completion Report from ${agent.name} (${agentId})]\n` +
          `Task: ${report.taskId}\n` +
          `Success: ${report.success}\n` +
          `Summary: ${report.summary}\n` +
          (report.filesModified ? `Files Modified: ${report.filesModified.join(", ")}` : ""),
      })
    );

    this.eventBus.emit({
      type: AgentEventType.REPORT_SUBMITTED,
      agentId,
      workspaceId: agent.workspaceId,
      data: { parentId: agent.parentId, taskId: report.taskId, success: report.success },
      timestamp: new Date(),
    });

    return successResult({
      reported: true,
      parentId: agent.parentId,
      success: report.success,
    });
  }

  // ─── Tool 7: Wake or Create Task Agent ──────────────────────────────

  async wakeOrCreateTaskAgent(params: {
    taskId: string;
    contextMessage: string;
    callerAgentId: string;
    workspaceId: string;
    agentName?: string;
    modelTier?: string;
  }): Promise<ToolResult> {
    const { taskId, contextMessage, callerAgentId, workspaceId, agentName, modelTier } = params;

    const task = await this.taskStore.get(taskId);
    if (!task) {
      return errorResult(`Task not found: ${taskId}`);
    }

    // Check if agent already assigned
    if (task.assignedTo) {
      const existing = await this.agentStore.get(task.assignedTo);
      if (existing && existing.status !== AgentStatus.COMPLETED && existing.status !== AgentStatus.ERROR) {
        // Wake existing agent
        await this.agentStore.updateStatus(existing.id, AgentStatus.ACTIVE);
        await this.conversationStore.append(
          createMessage({
            id: uuidv4(),
            agentId: existing.id,
            role: MessageRole.USER,
            content: contextMessage,
          })
        );
        return successResult({
          agentId: existing.id,
          action: "woken",
          name: existing.name,
        });
      }
    }

    // Create new crafter agent
    const result = await this.createAgent({
      name: agentName ?? `crafter-${taskId.slice(0, 8)}`,
      role: AgentRole.CRAFTER,
      workspaceId,
      parentId: callerAgentId,
      modelTier,
    });

    if (!result.success || !result.data) {
      return result;
    }

    const newAgentId = (result.data as { agentId: string }).agentId;

    // Assign task
    await this.delegate({
      agentId: newAgentId,
      taskId,
      callerAgentId,
    });

    // Send context
    await this.conversationStore.append(
      createMessage({
        id: uuidv4(),
        agentId: newAgentId,
        role: MessageRole.USER,
        content: contextMessage,
      })
    );

    return successResult({
      agentId: newAgentId,
      action: "created",
      taskId,
    });
  }

  // ─── Tool 8: Send Message to Task Agent ─────────────────────────────

  async sendMessageToTaskAgent(params: {
    taskId: string;
    message: string;
    callerAgentId: string;
  }): Promise<ToolResult> {
    const { taskId, message, callerAgentId } = params;

    const task = await this.taskStore.get(taskId);
    if (!task) {
      return errorResult(`Task not found: ${taskId}`);
    }

    if (!task.assignedTo) {
      return errorResult(`Task ${taskId} has no assigned agent`);
    }

    return this.messageAgent({
      fromAgentId: callerAgentId,
      toAgentId: task.assignedTo,
      message,
    });
  }

  // ─── Tool 9: Get Agent Status ───────────────────────────────────────

  async getAgentStatus(agentId: string): Promise<ToolResult> {
    const agent = await this.agentStore.get(agentId);
    if (!agent) {
      return errorResult(`Agent not found: ${agentId}`);
    }

    const messageCount = await this.conversationStore.getMessageCount(agentId);
    const tasks = await this.taskStore.listByAssignee(agentId);

    return successResult({
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      modelTier: agent.modelTier,
      parentId: agent.parentId,
      messageCount,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
    });
  }

  // ─── Tool 10: Get Agent Summary ─────────────────────────────────────

  async getAgentSummary(agentId: string): Promise<ToolResult> {
    const agent = await this.agentStore.get(agentId);
    if (!agent) {
      return errorResult(`Agent not found: ${agentId}`);
    }

    const messageCount = await this.conversationStore.getMessageCount(agentId);
    const lastMessages = await this.conversationStore.getLastN(agentId, 3);
    const tasks = await this.taskStore.listByAssignee(agentId);

    const lastResponse = lastMessages
      .filter((m) => m.role === MessageRole.ASSISTANT)
      .pop();

    const toolCallCount = (await this.conversationStore.getConversation(agentId))
      .filter((m) => m.role === MessageRole.TOOL).length;

    return successResult({
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      messageCount,
      toolCallCount,
      lastResponse: lastResponse
        ? {
            content: lastResponse.content.slice(0, 500),
            timestamp: lastResponse.timestamp.toISOString(),
          }
        : null,
      activeTasks: tasks
        .filter((t) => t.status === TaskStatus.IN_PROGRESS)
        .map((t) => ({ id: t.id, title: t.title })),
    });
  }

  // ─── Tool 11: Subscribe to Events ───────────────────────────────────

  async subscribeToEvents(params: {
    agentId: string;
    agentName: string;
    eventTypes: string[];
    excludeSelf?: boolean;
    oneShot?: boolean;
    waitGroupId?: string;
    priority?: number;
  }): Promise<ToolResult> {
    const {
      agentId,
      agentName,
      eventTypes,
      excludeSelf = true,
      oneShot = false,
      waitGroupId,
      priority = 0,
    } = params;

    const validTypes = eventTypes
      .map((t) => t.toUpperCase())
      .filter((t) => Object.values(AgentEventType).includes(t as AgentEventType))
      .map((t) => t as AgentEventType);

    if (validTypes.length === 0) {
      return errorResult(
        `No valid event types. Available: ${Object.values(AgentEventType).join(", ")}`
      );
    }

    const subscriptionId = uuidv4();
    this.eventBus.subscribe({
      id: subscriptionId,
      agentId,
      agentName,
      eventTypes: validTypes,
      excludeSelf,
      oneShot,
      waitGroupId,
      priority,
    });

    return successResult({
      subscriptionId,
      eventTypes: validTypes,
      oneShot,
      waitGroupId,
      priority,
    });
  }

  // ─── Tool 12: Unsubscribe from Events ──────────────────────────────

  async unsubscribeFromEvents(subscriptionId: string): Promise<ToolResult> {
    const removed = this.eventBus.unsubscribe(subscriptionId);
    return successResult({
      unsubscribed: removed,
      subscriptionId,
    });
  }

  // ─── Tool 13: Update Task Status (Atomic) ────────────────────────────

  async updateTaskStatus(params: {
    taskId: string;
    status: string;
    agentId: string;
    summary?: string;
  }): Promise<ToolResult> {
    const { taskId, status: newStatus, agentId, summary } = params;

    const validStatuses = Object.values(TaskStatus);
    const statusUpper = newStatus.toUpperCase() as TaskStatus;
    if (!validStatuses.includes(statusUpper)) {
      return errorResult(
        `Invalid status: ${newStatus}. Must be one of: ${validStatuses.join(", ")}`
      );
    }

    const task = await this.taskStore.get(taskId);
    if (!task) {
      return errorResult(`Task not found: ${taskId}`);
    }

    const oldStatus = task.status;
    task.status = statusUpper;
    if (summary) {
      task.completionSummary = summary;
    }
    task.updatedAt = new Date();
    await this.taskStore.save(task);

    // Emit status change event
    this.eventBus.emit({
      type: AgentEventType.TASK_STATUS_CHANGED,
      agentId,
      workspaceId: task.workspaceId,
      data: { taskId, oldStatus, newStatus: statusUpper, summary },
      timestamp: new Date(),
    });

    // Also emit TASK_COMPLETED if applicable
    if (statusUpper === TaskStatus.COMPLETED) {
      this.eventBus.emit({
        type: AgentEventType.TASK_COMPLETED,
        agentId,
        workspaceId: task.workspaceId,
        data: { taskId, taskTitle: task.title, summary },
        timestamp: new Date(),
      });
    }

    return successResult({
      taskId,
      oldStatus,
      newStatus: statusUpper,
      updatedAt: task.updatedAt.toISOString(),
    });
  }

  // ─── Tool 14: Update Task (Atomic with optimistic locking) ──────────

  async updateTask(params: {
    taskId: string;
    expectedVersion?: number;
    updates: {
      title?: string;
      objective?: string;
      scope?: string;
      status?: string;
      completionSummary?: string;
      verificationVerdict?: string;
      verificationReport?: string;
      assignedTo?: string;
      acceptanceCriteria?: string[];
      verificationCommands?: string[];
      testCases?: string[];
    };
    agentId: string;
  }): Promise<ToolResult> {
    const { taskId, expectedVersion, updates, agentId } = params;

    const task = await this.taskStore.get(taskId);
    if (!task) {
      return errorResult(`Task not found: ${taskId}`);
    }

    // If expectedVersion is provided and the store supports atomicUpdate, use it
    // Otherwise, fall back to read-modify-write
    const currentVersion = (task as Task & { version?: number }).version ?? 1;
    if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
      return errorResult(
        `Version conflict: expected ${expectedVersion}, current ${currentVersion}. ` +
        `Re-read the task and retry with the latest version.`
      );
    }

    const oldStatus = task.status;
    const originalColumnId = task.columnId;
    if (updates.title) task.title = updates.title;
    if (updates.objective) task.objective = updates.objective;
    if (updates.scope !== undefined) task.scope = updates.scope;
    if (updates.status) {
      const statusUpper = updates.status.toUpperCase() as TaskStatus;
      task.status = statusUpper;
    }
    if (updates.completionSummary !== undefined) task.completionSummary = updates.completionSummary;
    if (updates.verificationVerdict !== undefined) {
      task.verificationVerdict = updates.verificationVerdict as import("../models/task").VerificationVerdict;
    }
    if (updates.verificationReport !== undefined) task.verificationReport = updates.verificationReport;
    if (updates.assignedTo !== undefined) task.assignedTo = updates.assignedTo;
    if (updates.acceptanceCriteria !== undefined) task.acceptanceCriteria = updates.acceptanceCriteria;
    if (updates.verificationCommands !== undefined) task.verificationCommands = updates.verificationCommands;
    if (updates.testCases !== undefined) task.testCases = updates.testCases;

    // Always check review lane convergence when verification verdict is updated
    // This ensures cards move out of review lane even when status is explicitly set
    if (updates.verificationVerdict !== undefined || updates.status === undefined) {
      const board = task.boardId && this.kanbanBoardStore
        ? await this.kanbanBoardStore.get(task.boardId)
        : undefined;
      const convergenceColumnId = resolveReviewLaneConvergenceTarget(task, board?.columns ?? []);
      if (convergenceColumnId && convergenceColumnId !== task.columnId) {
        task.columnId = convergenceColumnId;
        task.status = columnIdToTaskStatus(convergenceColumnId);
      }
    }

    task.updatedAt = new Date();

    await this.taskStore.save(task);

    getKanbanEventBroadcaster().notify({
      workspaceId: task.workspaceId,
      entity: "task",
      action: "updated",
      resourceId: taskId,
      source: "agent",
    });

    const syntheticCompletion = shouldEmitSyntheticCompletion({
      task,
      agentId,
      targetColumnId: originalColumnId,
    });
    if (syntheticCompletion) {
      this.eventBus.emit({
        type: AgentEventType.AGENT_COMPLETED,
        agentId: syntheticCompletion.sessionId,
        workspaceId: task.workspaceId,
        data: {
          sessionId: syntheticCompletion.sessionId,
          success: true,
          synthesizedBy: "updateTask",
          trigger: syntheticCompletion.trigger,
          taskId,
        },
        timestamp: new Date(),
      });
    }

    if (oldStatus !== task.status) {
      this.eventBus.emit({
        type: AgentEventType.TASK_STATUS_CHANGED,
        agentId,
        workspaceId: task.workspaceId,
        data: { taskId, oldStatus, newStatus: task.status },
        timestamp: new Date(),
      });
    }

    return successResult({
      taskId,
      version: currentVersion + 1,
      updatedFields: Object.keys(updates).filter(
        (k) => updates[k as keyof typeof updates] !== undefined
      ),
      updatedAt: task.updatedAt.toISOString(),
    });
  }

  // ─── Internal: Drain Pending Events ─────────────────────────────────

  drainPendingEvents(agentId: string): ToolResult {
    const events = this.eventBus.drainPendingEvents(agentId);
    return successResult({
      events: events.map((e) => ({
        type: e.type,
        agentId: e.agentId,
        data: e.data,
        timestamp: e.timestamp.toISOString(),
      })),
    });
  }

  // ─── Tool 13: Request Artifact ─────────────────────────────────────────

  /**
   * Request an artifact from another agent.
   * Used by verification agents (like Desk Check) to request evidence from implementation agents.
   */
  async requestArtifact(params: {
    fromAgentId: string;
    toAgentId: string;
    artifactType: ArtifactType;
    taskId: string;
    workspaceId: string;
    context?: string;
  }): Promise<ToolResult> {
    if (!this.artifactStore) {
      return errorResult("Artifact store not configured");
    }

    const { fromAgentId, toAgentId, artifactType, taskId, workspaceId, context } = params;

    // Validate target agent exists
    const toAgent = await this.agentStore.get(toAgentId);
    if (!toAgent) {
      return errorResult(`Target agent not found: ${toAgentId}`);
    }

    // Create artifact request
    const request = createArtifactRequest({
      id: uuidv4(),
      fromAgentId,
      toAgentId,
      artifactType,
      taskId,
      workspaceId,
      context,
    });

    await this.artifactStore.saveRequest(request);

    // Emit event to notify target agent
    this.eventBus.emit({
      type: AgentEventType.ARTIFACT_REQUESTED,
      agentId: toAgentId,
      workspaceId,
      data: {
        requestId: request.id,
        fromAgentId,
        artifactType,
        taskId,
        context,
      },
      timestamp: new Date(),
    });

    return successResult({
      requestId: request.id,
      status: "pending",
      artifactType,
      taskId,
      toAgentId,
    });
  }

  // ─── Tool 14: Provide Artifact ─────────────────────────────────────────

  /**
   * Provide an artifact (screenshot, test results, etc.).
   * Can be in response to a request or proactively provided.
   */
  async provideArtifact(params: {
    agentId: string;
    type: ArtifactType;
    taskId: string;
    workspaceId: string;
    content: string;
    context?: string;
    requestId?: string;
    metadata?: Record<string, string>;
  }): Promise<ToolResult> {
    if (!this.artifactStore) {
      return errorResult("Artifact store not configured");
    }

    const { agentId, type, taskId, workspaceId, content, context, requestId, metadata } = params;

    // Create artifact
    const artifact = createArtifact({
      id: uuidv4(),
      type,
      taskId,
      workspaceId,
      providedByAgentId: agentId,
      requestId,
      content,
      context,
      status: "provided",
      metadata,
    });

    await this.artifactStore.saveArtifact(artifact);

    // If fulfilling a request, update the request status
    if (requestId) {
      const request = await this.artifactStore.getRequest(requestId);
      if (request) {
        await this.artifactStore.updateRequestStatus(requestId, "fulfilled", artifact.id);
        artifact.requestedByAgentId = request.fromAgentId;
        await this.artifactStore.saveArtifact(artifact);
      }
    }

    // Emit event
    this.eventBus.emit({
      type: AgentEventType.ARTIFACT_PROVIDED,
      agentId,
      workspaceId,
      data: {
        artifactId: artifact.id,
        type,
        taskId,
        requestId,
        contentLength: content.length,
      },
      timestamp: new Date(),
    });
    notifyKanbanArtifactChanged(workspaceId, taskId);

    return successResult({
      artifactId: artifact.id,
      type,
      taskId,
      status: "provided",
    });
  }

  // ─── Tool 15: List Artifacts ─────────────────────────────────────────────

  /**
   * List artifacts for a task.
   */
  async listArtifacts(params: {
    taskId: string;
    type?: ArtifactType;
  }): Promise<ToolResult> {
    if (!this.artifactStore) {
      return errorResult("Artifact store not configured");
    }

    const { taskId, type } = params;

    const artifacts = type
      ? await this.artifactStore.listByTaskAndType(taskId, type)
      : await this.artifactStore.listByTask(taskId);

    return successResult({
      artifacts: artifacts.map((a) => ({
        id: a.id,
        type: a.type,
        taskId: a.taskId,
        providedByAgentId: a.providedByAgentId,
        status: a.status,
        context: a.context,
        contentLength: a.content?.length ?? 0,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  }

  // ─── Tool 16: Get Artifact ─────────────────────────────────────────────

  /**
   * Get a specific artifact by ID.
   */
  async getArtifact(artifactId: string): Promise<ToolResult> {
    if (!this.artifactStore) {
      return errorResult("Artifact store not configured");
    }

    const artifact = await this.artifactStore.getArtifact(artifactId);
    if (!artifact) {
      return errorResult(`Artifact not found: ${artifactId}`);
    }

    return successResult({
      id: artifact.id,
      type: artifact.type,
      taskId: artifact.taskId,
      providedByAgentId: artifact.providedByAgentId,
      requestedByAgentId: artifact.requestedByAgentId,
      status: artifact.status,
      content: artifact.content,
      context: artifact.context,
      metadata: artifact.metadata,
      createdAt: artifact.createdAt.toISOString(),
    });
  }

  // ─── Tool 17: List Pending Artifact Requests ─────────────────────────────

  /**
   * List pending artifact requests for an agent.
   */
  async listPendingArtifactRequests(agentId: string): Promise<ToolResult> {
    if (!this.artifactStore) {
      return errorResult("Artifact store not configured");
    }

    const requests = await this.artifactStore.listPendingRequests(agentId);

    return successResult({
      requests: requests.map((r) => ({
        id: r.id,
        fromAgentId: r.fromAgentId,
        artifactType: r.artifactType,
        taskId: r.taskId,
        context: r.context,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  }

  // ─── Tool 18: Capture Screenshot ────────────────────────────────────────────

  /**
   * Capture a screenshot using agent-browser and store it as an artifact.
   * This is a convenience tool that combines browser screenshot capture with artifact storage.
   */
  async captureScreenshot(params: {
    agentId: string;
    taskId: string;
    workspaceId: string;
    url?: string;
    fullPage?: boolean;
    annotate?: boolean;
    context?: string;
    outputPath?: string;
  }): Promise<ToolResult> {
    if (!this.artifactStore) {
      return errorResult("Artifact store not configured");
    }

    const { agentId, taskId, workspaceId, url, fullPage, annotate, context, outputPath } = params;

    try {
      // Build agent-browser command
      const commands: string[] = [];

      if (url) {
        commands.push(`agent-browser open "${url}"`);
        commands.push("agent-browser wait --load networkidle");
      }

      // Build screenshot command
      let screenshotCmd = "agent-browser screenshot";
      if (fullPage) {
        screenshotCmd += " --full";
      }
      if (annotate) {
        screenshotCmd += " --annotate";
      }
      if (outputPath) {
        screenshotCmd += ` "${outputPath}"`;
      }
      commands.push(screenshotCmd);

      const fullCommand = commands.join(" && ");

      // Execute via child_process
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      const result = await execAsync(fullCommand, {
        timeout: 60000, // 60 second timeout
        cwd: process.cwd(),
      });

      // Parse output to get screenshot path
      const output = stripAnsiEscapeCodes(result.stdout).trim();
      const stderrOutput = stripAnsiEscapeCodes(result.stderr).trim();

      // Read the screenshot file if path is available
      let screenshotContent = "";
      let screenshotPath = outputPath;

      // Try to extract path from output if not specified
      if (!screenshotPath) {
        screenshotPath = extractScreenshotPath(output);
      }

      // Read file and convert to base64 if we have a path
      if (screenshotPath) {
        try {
          const fs = await import("fs/promises");
          const buffer = await fs.readFile(screenshotPath);
          screenshotContent = buffer.toString("base64");
        } catch {
          screenshotContent = "";
        }
      }

      const artifactContent = screenshotContent
        || stderrOutput
        || output
        || (screenshotPath ? `Screenshot captured at: ${screenshotPath}` : "");

      const metadata: Record<string, string> = {
        url: url || "",
        fullPage: String(fullPage ?? false),
        annotate: String(annotate ?? false),
        path: screenshotPath || "",
      };
      if (screenshotContent) {
        metadata.mediaType = "image/png";
      } else if (screenshotPath) {
        metadata.captureError = "screenshot_file_unreadable";
      }

      // Store as artifact
      const artifact = createArtifact({
        id: uuidv4(),
        type: "screenshot",
        taskId,
        workspaceId,
        providedByAgentId: agentId,
        content: artifactContent,
        context: context || `Screenshot${url ? ` of ${url}` : ""}${fullPage ? " (full page)" : ""}`,
        status: "provided",
        metadata,
      });

      await this.artifactStore.saveArtifact(artifact);

      // Emit event
      this.eventBus.emit({
        type: AgentEventType.ARTIFACT_PROVIDED,
        agentId,
        workspaceId,
        data: {
          artifactId: artifact.id,
          type: "screenshot",
          taskId,
          url,
        },
        timestamp: new Date(),
      });
      notifyKanbanArtifactChanged(workspaceId, taskId);

      return successResult({
        artifactId: artifact.id,
        type: "screenshot",
        taskId,
        path: screenshotPath,
        output,
        stderr: stderrOutput || undefined,
      });
    } catch (err) {
      const error = err as Error;
      return errorResult(`Screenshot capture failed: ${error.message}`);
    }
  }
  // ─── Phase 2: Request Permission ────────────────────────────────────────────

  async requestPermission(params: {
    requestingAgentId: string;
    coordinatorAgentId: string;
    workspaceId: string;
    type: string;
    tool?: string;
    description: string;
    options?: PermissionRequestOptions;
    urgency?: string;
  }): Promise<ToolResult> {
    if (!this.permissionStore) {
      return errorResult('Permission store not configured');
    }
    const coordinator = await this.agentStore.get(params.coordinatorAgentId);
    if (!coordinator) {
      return errorResult('Coordinator agent not found: ' + params.coordinatorAgentId);
    }
    const request: PermissionRequest = {
      id: uuidv4(),
      requestingAgentId: params.requestingAgentId,
      coordinatorAgentId: params.coordinatorAgentId,
      workspaceId: params.workspaceId,
      type: params.type,
      tool: params.tool,
      description: params.description,
      options: params.options,
      urgency: (params.urgency as PermissionUrgency) ?? 'normal',
      decision: 'pending',
      createdAt: new Date(),
    };
    this.permissionStore.save(request);
    await this.conversationStore.append(
      createMessage({
        id: uuidv4(),
        agentId: params.coordinatorAgentId,
        role: MessageRole.USER,
        content:
          '[Permission Request] Agent ' + params.requestingAgentId + ' requests permission.' +
          '\nRequest ID: ' + request.id +
          '\nType: ' + params.type +
          (params.tool ? '\nTool: ' + params.tool : '') +
          (extractSandboxId(params.options) ? '\nSandbox ID: ' + extractSandboxId(params.options) : '') +
          '\nDescription: ' + params.description +
          '\nUrgency: ' + request.urgency +
          '\nCall respondToPermission to allow or deny.',
      })
    );
    this.eventBus.emit({
      type: AgentEventType.PERMISSION_REQUESTED,
      agentId: params.requestingAgentId,
      workspaceId: params.workspaceId,
      data: { requestId: request.id, coordinatorAgentId: params.coordinatorAgentId, type: params.type, tool: params.tool, description: params.description, urgency: request.urgency },
      timestamp: new Date(),
    });
    return successResult({ requestId: request.id, decision: 'pending', message: 'Permission request submitted. Await coordinator response.' });
  }

  // ─── Phase 2: Respond to Permission ─────────────────────────────────────────

  async respondToPermission(params: {
    requestId: string;
    coordinatorAgentId: string;
    decision: 'allow' | 'deny';
    feedback?: string;
    constraints?: SandboxPermissionConstraints;
  }): Promise<ToolResult> {
    if (!this.permissionStore) {
      return errorResult('Permission store not configured');
    }
    const request = this.permissionStore.get(params.requestId);
    if (!request) {
      return errorResult('Permission request not found: ' + params.requestId);
    }
    if (request.coordinatorAgentId !== params.coordinatorAgentId) {
      return errorResult('Only the designated coordinator can respond to this request');
    }
    let sandboxMutation: { sandboxId: string; applied: boolean; info?: unknown } | undefined;
    const sandboxId = extractSandboxId(request.options);
    if (params.decision === "allow" && sandboxId && params.constraints) {
      try {
        const info = await applySandboxPermissionConstraints(sandboxId, params.constraints);
        sandboxMutation = { sandboxId, applied: true, info };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Permission granted but sandbox policy mutation failed: ${message}`);
      }
    }
    const ok = this.permissionStore.respond(params.requestId, params.decision, params.feedback, params.constraints);
    if (!ok) {
      return errorResult('Permission request already resolved or not found');
    }
    await this.conversationStore.append(
      createMessage({
        id: uuidv4(),
        agentId: request.requestingAgentId,
        role: MessageRole.USER,
        content:
          '[Permission Response] Request ' + params.requestId + ' has been ' + params.decision + '.' +
          (params.feedback ? '\nFeedback: ' + params.feedback : '') +
          (params.constraints ? '\nConstraints: ' + JSON.stringify(params.constraints) : '') +
          (sandboxMutation?.applied ? '\nSandbox policy updated for: ' + sandboxMutation.sandboxId : ''),
      })
    );
    this.eventBus.emit({
      type: AgentEventType.PERMISSION_RESPONDED,
      agentId: params.coordinatorAgentId,
      workspaceId: request.workspaceId,
      data: { requestId: params.requestId, requestingAgentId: request.requestingAgentId, decision: params.decision, feedback: params.feedback },
      timestamp: new Date(),
    });
    return successResult({
      requestId: params.requestId,
      decision: params.decision,
      notified: request.requestingAgentId,
      sandboxMutation,
    });
  }

  // ─── Phase 2: List Pending Permissions ──────────────────────────────────────

  async listPendingPermissions(coordinatorAgentId: string): Promise<ToolResult> {
    if (!this.permissionStore) {
      return errorResult('Permission store not configured');
    }
    const pending = this.permissionStore.listPending(coordinatorAgentId);
    return successResult({
      count: pending.length,
      requests: pending.map((r) => ({
        id: r.id,
        requestingAgentId: r.requestingAgentId,
        type: r.type,
        tool: r.tool,
        description: r.description,
        urgency: r.urgency,
        sandboxId: extractSandboxId(r.options),
        createdAt: r.createdAt.toISOString(),
      })),
    });
  }

  // ─── Phase 3: Request Shutdown ───────────────────────────────────────────────

  async requestShutdown(params: {
    coordinatorAgentId: string;
    workspaceId: string;
    reason?: string;
    timeoutMs?: number;
  }): Promise<ToolResult> {
    const { coordinatorAgentId, workspaceId, reason, timeoutMs = 30000 } = params;
    const activeAgents = await this.agentStore.listByStatus(workspaceId, AgentStatus.ACTIVE);
    const children = activeAgents.filter((a) => a.parentId === coordinatorAgentId);
    if (children.length === 0) {
      return successResult({ message: 'No active child agents to shut down.', agentIds: [] });
    }
    const shutdownMessage =
      '[Shutdown Request] The coordinator has initiated a graceful shutdown.' +
      (reason ? '\nReason: ' + reason : '') +
      '\nFinish your current operation, save state, and call acknowledgeShutdown.';
    for (const agent of children) {
      await this.conversationStore.append(
        createMessage({ id: uuidv4(), agentId: agent.id, role: MessageRole.USER, content: shutdownMessage })
      );
      this.eventBus.emit({
        type: AgentEventType.SHUTDOWN_REQUESTED,
        agentId: coordinatorAgentId,
        workspaceId,
        data: { targetAgentId: agent.id, reason: reason ?? '', timeoutMs },
        timestamp: new Date(),
      });
    }
    return successResult({ message: 'Shutdown requested for ' + children.length + ' agent(s).', agentIds: children.map((a) => a.id), timeoutMs });
  }

  // ─── Phase 3: Acknowledge Shutdown ──────────────────────────────────────────

  async acknowledgeShutdown(params: {
    agentId: string;
    workspaceId: string;
    summary?: string;
  }): Promise<ToolResult> {
    const { agentId, workspaceId, summary } = params;
    const agent = await this.agentStore.get(agentId);
    if (!agent) {
      return errorResult('Agent not found: ' + agentId);
    }
    await this.agentStore.updateStatus(agentId, AgentStatus.COMPLETED);
    this.eventBus.emit({
      type: AgentEventType.SHUTDOWN_ACKNOWLEDGED,
      agentId,
      workspaceId,
      data: { summary: summary ?? 'Agent shut down gracefully.' },
      timestamp: new Date(),
    });
    if (agent.parentId) {
      await this.conversationStore.append(
        createMessage({
          id: uuidv4(),
          agentId: agent.parentId,
          role: MessageRole.USER,
          content:
            '[Shutdown Acknowledged] Agent ' + (agent.name ?? agentId) + ' has shut down.' +
            (summary ? '\nSummary: ' + summary : ''),
        })
      );
    }
    return successResult({ agentId, status: AgentStatus.COMPLETED, acknowledged: true });
  }

}
