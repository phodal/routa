/**
 * Shared types for ChatPanel components
 */

import type { AcpProviderInfo } from "../../acp-client";
import type { WorkspaceData } from "../../hooks/use-workspaces";
import type { RepoSelection } from "../repo-picker";

// ─── Message Types ─────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "thought" | "tool" | "plan" | "info" | "terminal";

export interface PlanEntry {
  content: string;
  priority?: "high" | "medium" | "low";
  status?: "pending" | "in_progress" | "completed";
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  toolName?: string;
  toolStatus?: string;
  toolCallId?: string;
  toolKind?: string;
  /** Raw input parameters for tool calls */
  toolRawInput?: Record<string, unknown>;
  /** Task ID for delegated tasks (delegate_task_to_agent) */
  delegatedTaskId?: string;
  /** Completion summary when a delegated task completes */
  completionSummary?: string;
  /** Raw update payload for debug/info display */
  rawData?: Record<string, unknown>;
  planEntries?: PlanEntry[];
  usageUsed?: number;
  usageSize?: number;
  costAmount?: number;
  costCurrency?: string;
  // Terminal fields
  terminalId?: string;
  terminalCommand?: string;
  terminalArgs?: string[];
  terminalExited?: boolean;
  terminalExitCode?: number | null;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ─── SetupView Props ───────────────────────────────────────────────────

export interface SetupViewProps {
  // Input state
  setupInput: string;
  onSetupInputChange: (value: string) => void;
  onStartSession: () => void;
  connected: boolean;

  // Provider selection
  providers: AcpProviderInfo[];
  selectedProvider: string;
  onProviderChange: (provider: string) => void;

  // Model selection
  onFetchModels: (provider: string) => Promise<string[]>;

  // Workspace & Repository
  workspaces: WorkspaceData[];
  activeWorkspaceId: string | null;
  onWorkspaceChange: (id: string) => void;
  repoSelection: RepoSelection | null;
  onRepoChange: (selection: RepoSelection | null) => void;

  // Agent role
  agentRole?: string;
  onAgentRoleChange?: (role: string) => void;
}

