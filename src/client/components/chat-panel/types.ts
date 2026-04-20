/**
 * Shared types for ChatPanel components
 */

import type { AcpProviderInfo } from "../../acp-client";
import type { ChatMessage, MessageRole, PlanEntry, UsageInfo } from "@/core/chat-message";
import type { WorkspaceData } from "../../hooks/use-workspaces";
import type { RepoSelection } from "../repo-picker";

// ─── Message Types ─────────────────────────────────────────────────────
export type { ChatMessage, MessageRole, PlanEntry, UsageInfo };

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
  onWorkspaceCreate?: (title: string) => Promise<void> | void;
  repoSelection: RepoSelection | null;
  onRepoChange: (selection: RepoSelection | null) => void;

  // Agent role
  agentRole?: string;
  onAgentRoleChange?: (role: string) => void;
}
