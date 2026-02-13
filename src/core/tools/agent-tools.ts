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
  Agent,
  AgentRole,
  AgentStatus,
  ModelTier,
  createAgent as createAgentModel,
} from "../models/agent";
import { TaskStatus } from "../models/task";
import { MessageRole, createMessage, CompletionReport } from "../models/message";
import { AgentStore } from "../store/agent-store";
import { ConversationStore } from "../store/conversation-store";
import { TaskStore } from "../store/task-store";
import { EventBus, AgentEventType } from "../events/event-bus";
import { ToolResult, successResult, errorResult } from "./tool-result";

export class AgentTools {
  constructor(
    private agentStore: AgentStore,
    private conversationStore: ConversationStore,
    private taskStore: TaskStore,
    private eventBus: EventBus
  ) {}

  // ─── Tool 1: List Agents ─────────────────────────────────────────────

  async listAgents(workspaceId: string): Promise<ToolResult> {
    const agents = await this.agentStore.listByWorkspace(workspaceId);
    const summary = agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status,
      parentId: a.parentId,
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
    });

    await this.agentStore.save(agent);

    this.eventBus.emit({
      type: AgentEventType.AGENT_CREATED,
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      data: { name: agent.name, role: agent.role },
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
      return errorResult(`Task not found: ${taskId}`);
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
  }): Promise<ToolResult> {
    const { agentId, agentName, eventTypes, excludeSelf = true } = params;

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
    });

    return successResult({
      subscriptionId,
      eventTypes: validTypes,
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
}
