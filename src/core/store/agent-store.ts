/**
 * AgentStore - port of routa-core AgentStore.kt
 *
 * In-memory storage for agents with full CRUD operations.
 */

import { Agent, AgentRole, AgentStatus } from "../models/agent";

export interface AgentStore {
  save(agent: Agent): Promise<void>;
  get(agentId: string): Promise<Agent | undefined>;
  listByWorkspace(workspaceId: string): Promise<Agent[]>;
  listByParent(parentId: string): Promise<Agent[]>;
  listByRole(workspaceId: string, role: AgentRole): Promise<Agent[]>;
  listByStatus(workspaceId: string, status: AgentStatus): Promise<Agent[]>;
  delete(agentId: string): Promise<void>;
  updateStatus(agentId: string, status: AgentStatus): Promise<void>;
}

export class InMemoryAgentStore implements AgentStore {
  private agents = new Map<string, Agent>();

  async save(agent: Agent): Promise<void> {
    this.agents.set(agent.id, { ...agent });
  }

  async get(agentId: string): Promise<Agent | undefined> {
    const agent = this.agents.get(agentId);
    return agent ? { ...agent } : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Agent[]> {
    return Array.from(this.agents.values()).filter(
      (a) => a.workspaceId === workspaceId
    );
  }

  async listByParent(parentId: string): Promise<Agent[]> {
    return Array.from(this.agents.values()).filter(
      (a) => a.parentId === parentId
    );
  }

  async listByRole(workspaceId: string, role: AgentRole): Promise<Agent[]> {
    return Array.from(this.agents.values()).filter(
      (a) => a.workspaceId === workspaceId && a.role === role
    );
  }

  async listByStatus(
    workspaceId: string,
    status: AgentStatus
  ): Promise<Agent[]> {
    return Array.from(this.agents.values()).filter(
      (a) => a.workspaceId === workspaceId && a.status === status
    );
  }

  async delete(agentId: string): Promise<void> {
    this.agents.delete(agentId);
  }

  async updateStatus(agentId: string, status: AgentStatus): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      agent.updatedAt = new Date();
    }
  }
}
