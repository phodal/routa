import type { AgentRole, ModelTier } from "../models/agent";

export interface SpecialistConfig {
  id: string;
  name: string;
  description?: string;
  role: AgentRole;
  defaultModelTier: ModelTier;
  systemPrompt: string;
  roleReminder: string;
  source?: "user" | "bundled" | "hardcoded";
  locale?: string;
  /** Optional default ACP provider to use when this specialist is executed directly. */
  defaultProvider?: string;
  /** Optional adapter/runtime hint for non-ACP execution paths. */
  defaultAdapter?: string;
  /** Optional model override (e.g. "claude-3-5-haiku-20241022"). Takes precedence over tier-based selection. */
  model?: string;
  enabled?: boolean;
}
