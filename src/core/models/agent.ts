/**
 * Agent model - port of routa-core Agent.kt
 *
 * Represents an AI coding agent within the Routa multi-agent system.
 */

export enum AgentRole {
  /** Coordinator agent - plans, delegates, and orchestrates */
  ROUTA = "ROUTA",
  /** Implementation agent - writes code and makes changes */
  CRAFTER = "CRAFTER",
  /** Verification agent - reviews and validates work */
  GATE = "GATE",
}

export enum ModelTier {
  /** High-capability model (e.g., Claude Opus, GPT-4) */
  SMART = "SMART",
  /** Fast, cost-effective model (e.g., Claude Haiku, GPT-4-mini) */
  FAST = "FAST",
}

export enum AgentStatus {
  PENDING = "PENDING",
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  ERROR = "ERROR",
  CANCELLED = "CANCELLED",
}

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  modelTier: ModelTier;
  workspaceId: string;
  parentId?: string;
  status: AgentStatus;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, string>;
}

export function createAgent(params: {
  id: string;
  name: string;
  role: AgentRole;
  workspaceId: string;
  parentId?: string;
  modelTier?: ModelTier;
  metadata?: Record<string, string>;
}): Agent {
  const now = new Date();
  return {
    id: params.id,
    name: params.name,
    role: params.role,
    modelTier: params.modelTier ?? ModelTier.SMART,
    workspaceId: params.workspaceId,
    parentId: params.parentId,
    status: AgentStatus.PENDING,
    createdAt: now,
    updatedAt: now,
    metadata: params.metadata ?? {},
  };
}
