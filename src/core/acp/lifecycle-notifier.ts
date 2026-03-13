/**
 * LifecycleNotifier
 *
 * Emits automatic agent lifecycle events onto the EventBus when an agent
 * session ends (completed, failed, idle, timeout). Equivalent to Claude Code
 * Stop-hook idle notifications — the coordinator never needs to poll.
 */

import { v4 as uuidv4 } from "uuid";
import { EventBus, AgentEventType } from "../events/event-bus";
import { AgentStore } from "../store/agent-store";
import { AgentStatus } from "../models/agent";
import { ConversationStore } from "../store/conversation-store";
import { MessageRole, createMessage } from "../models/message";

export interface LifecycleNotifierOptions {
  agentId: string;
  workspaceId: string;
  parentId?: string;
  agentName?: string;
}

export class LifecycleNotifier {
  constructor(
    private readonly eventBus: EventBus,
    private readonly agentStore: AgentStore,
    private readonly conversationStore: ConversationStore,
    private readonly opts: LifecycleNotifierOptions
  ) {}

  /** Emits AGENT_IDLE when an agent turn completes with no pending work. */
  async notifyIdle(summary?: string): Promise<void> {
    const { agentId, workspaceId, parentId, agentName } = this.opts;
    await this.agentStore.updateStatus(agentId, AgentStatus.ACTIVE);
    this.eventBus.emit({
      type: AgentEventType.AGENT_IDLE,
      agentId,
      workspaceId,
      data: { summary: summary ?? "Agent is idle, awaiting new work." },
      timestamp: new Date(),
    });
    if (parentId) {
      const label = agentName ?? agentId;
      const msg = "[Lifecycle: IDLE] Agent " + label + " has finished its current turn and is idle."
        + (summary ? "\nSummary: " + summary : "");
      await this.deliverToParent(parentId, msg);
    }
  }

  /** Emits AGENT_COMPLETED when an agent finishes all assigned work. */
  async notifyCompleted(summary?: string, filesModified?: string[]): Promise<void> {
    const { agentId, workspaceId, parentId, agentName } = this.opts;
    await this.agentStore.updateStatus(agentId, AgentStatus.COMPLETED);
    this.eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId,
      workspaceId,
      data: { summary: summary ?? "Agent completed successfully.", filesModified: filesModified ?? [] },
      timestamp: new Date(),
    });
    if (parentId) {
      const label = agentName ?? agentId;
      const msg = "[Lifecycle: COMPLETED] Agent " + label + " has completed all work."
        + (summary ? "\nSummary: " + summary : "")
        + (filesModified?.length ? "\nFiles modified: " + filesModified.join(", ") : "");
      await this.deliverToParent(parentId, msg);
    }
  }

  /** Emits AGENT_FAILED when an agent crashes or hits an unrecoverable error. */
  async notifyFailed(error: string, pendingWork?: string): Promise<void> {
    const { agentId, workspaceId, parentId, agentName } = this.opts;
    await this.agentStore.updateStatus(agentId, AgentStatus.ERROR);
    this.eventBus.emit({
      type: AgentEventType.AGENT_FAILED,
      agentId,
      workspaceId,
      data: { error, pendingWork: pendingWork ?? "" },
      timestamp: new Date(),
    });
    if (parentId) {
      const label = agentName ?? agentId;
      const msg = "[Lifecycle: FAILED] Agent " + label + " has failed."
        + "\nError: " + error
        + (pendingWork ? "\nPending work: " + pendingWork : "");
      await this.deliverToParent(parentId, msg);
    }
  }

  /** Emits AGENT_TIMEOUT when an agent exceeds its time or token budget. */
  async notifyTimeout(reason: string, pendingWork?: string): Promise<void> {
    const { agentId, workspaceId, parentId, agentName } = this.opts;
    await this.agentStore.updateStatus(agentId, AgentStatus.ERROR);
    this.eventBus.emit({
      type: AgentEventType.AGENT_TIMEOUT,
      agentId,
      workspaceId,
      data: { reason, pendingWork: pendingWork ?? "" },
      timestamp: new Date(),
    });
    if (parentId) {
      const label = agentName ?? agentId;
      const msg = "[Lifecycle: TIMEOUT] Agent " + label + " timed out."
        + "\nReason: " + reason
        + (pendingWork ? "\nPending work: " + pendingWork : "");
      await this.deliverToParent(parentId, msg);
    }
  }

  private async deliverToParent(parentId: string, content: string): Promise<void> {
    try {
      await this.conversationStore.append(
        createMessage({ id: uuidv4(), agentId: parentId, role: MessageRole.USER, content })
      );
    } catch (err) {
      console.error("[LifecycleNotifier] Failed to deliver message to parent:", err);
    }
  }
}
