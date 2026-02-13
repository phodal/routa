/**
 * Message model - port of routa-core Message.kt
 *
 * Represents a message in an agent's conversation history.
 */

export enum MessageRole {
  SYSTEM = "SYSTEM",
  USER = "USER",
  ASSISTANT = "ASSISTANT",
  TOOL = "TOOL",
}

export interface Message {
  id: string;
  agentId: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  toolName?: string;
  toolArgs?: string;
  turn?: number;
}

export function createMessage(params: {
  id: string;
  agentId: string;
  role: MessageRole;
  content: string;
  toolName?: string;
  toolArgs?: string;
  turn?: number;
}): Message {
  return {
    id: params.id,
    agentId: params.agentId,
    role: params.role,
    content: params.content,
    timestamp: new Date(),
    toolName: params.toolName,
    toolArgs: params.toolArgs,
    turn: params.turn,
  };
}

/**
 * Delegation / completion types used in AgentTools
 */
export enum WaitMode {
  AFTER_ALL = "AFTER_ALL",
  AFTER_ANY = "AFTER_ANY",
}

export interface DelegationRequest {
  taskId: string;
  role: AgentRole;
  modelTier?: ModelTier;
  agentName?: string;
  waitMode?: WaitMode;
}

export interface CompletionReport {
  agentId: string;
  taskId: string;
  summary: string;
  filesModified?: string[];
  verificationResults?: string;
  success: boolean;
}

// Re-export for convenience
import { AgentRole, ModelTier } from "./agent";
