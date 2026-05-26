"use client";

import type { AgentRole, ModelTier, SpecialistConfig } from "./specialist-manager";

export const AGENT_ROLES = ["ROUTA", "CRAFTER", "GATE", "DEVELOPER"] as const;
export type AgentRoleKey = (typeof AGENT_ROLES)[number];

export const ROLE_DESCRIPTIONS: Record<AgentRoleKey, string> = {
  ROUTA: "Coordinator – plans & delegates",
  CRAFTER: "Implementation – writes code",
  GATE: "Verification – reviews code",
  DEVELOPER: "Solo – plans, implements & verifies",
};

const STORAGE_KEY = "routa.defaultProviders";
const CONNECTIONS_STORAGE_KEY = "routa.providerConnections";
const MODEL_DEFINITIONS_KEY = "routa.modelDefinitions";

export const SETTINGS_PANEL_HEIGHT = "92vh";
export const SETTINGS_PANEL_BODY_MAX_HEIGHT = "calc(92vh - 148px)";

export interface MemoryStats {
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  rssMB: number;
  arrayBuffersMB: number;
  usagePercentage: number;
  level: "normal" | "warning" | "critical";
  timestamp: string;
}

export interface MemoryResponse {
  current: MemoryStats;
  peaks: {
    heapUsedMB: number;
    rssMB: number;
  };
  growthRateMBPerMinute: number;
  sessionStore: {
    sessionCount: number;
    activeSseCount: number;
    streamingCount: number;
    totalHistoryMessages: number;
    totalPendingNotifications: number;
    staleSessionCount: number;
  };
  recommendations: string[];
}

export interface AgentModelConfig {
  provider?: string;
  model?: string;
  maxTurns?: number;
}

export interface DefaultProviderSettings {
  ROUTA?: AgentModelConfig;
  CRAFTER?: AgentModelConfig;
  GATE?: AgentModelConfig;
  DEVELOPER?: AgentModelConfig;
}

export function loadDefaultProviders(): DefaultProviderSettings {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: Record<string, unknown> = JSON.parse(raw);
    const normalized: DefaultProviderSettings = {};
    for (const role of AGENT_ROLES) {
      const value = parsed[role];
      if (!value) continue;
      normalized[role] = typeof value === "string" ? { provider: value } : (value as AgentModelConfig);
    }
    return normalized;
  } catch {
    return {};
  }
}

export function saveDefaultProviders(settings: DefaultProviderSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export interface ProviderConnectionConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export type ProviderConnectionsStorage = Record<string, ProviderConnectionConfig>;

export function loadProviderConnections(): ProviderConnectionsStorage {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(CONNECTIONS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ProviderConnectionsStorage) : {};
  } catch {
    return {};
  }
}

export function loadProviderConnectionConfig(providerId: string): ProviderConnectionConfig {
  return loadProviderConnections()[providerId] ?? {};
}

export function saveProviderConnections(storage: ProviderConnectionsStorage): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONNECTIONS_STORAGE_KEY, JSON.stringify(storage));
}

export interface ModelDefinition {
  alias: string;
  modelName: string;
  baseUrl?: string;
  apiKey?: string;
}

export function loadModelDefinitions(): ModelDefinition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MODEL_DEFINITIONS_KEY);
    return raw ? (JSON.parse(raw) as ModelDefinition[]) : [];
  } catch {
    return [];
  }
}

export function saveModelDefinitions(defs: ModelDefinition[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MODEL_DEFINITIONS_KEY, JSON.stringify(defs));
}

export function getModelDefinitionByAlias(alias: string): ModelDefinition | undefined {
  if (!alias || typeof window === "undefined") return undefined;
  return loadModelDefinitions().find((definition) => definition.alias === alias);
}

export interface ProviderOption {
  id: string;
  name: string;
  status?: string;
  source?: "static" | "registry";
  command?: string;
}

export function isCustomProvider(provider: ProviderOption): boolean {
  return provider.id.startsWith("custom-");
}

export interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  providers: ProviderOption[];
  initialTab?: SettingsTab;
  onResetOnboarding?: () => void;
  variant?: "modal" | "page";
}

export type SettingsTab =
  | "providers"
  | "registry"
  | "roles"
  | "specialists"
  | "models"
  | "mcp"
  | "webhooks"
  | "schedules"
  | "workflows";

export const inputCls =
  "w-full text-xs px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#1e2130] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:outline-none";
export const labelCls = "text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider";
export const sectionHeadCls = "text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider";
export const settingsCardCls = "rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-[#1e2130]";

export const BASE_URL_SUGGESTIONS = [
  "https://open.bigmodel.cn/api/anthropic",
  "https://api.minimax.io/anthropic",
  "https://api.minimaxi.com/anthropic",
  "https://api.deepseek.com/anthropic",
  "https://api.moonshot.ai/anthropic",
  "https://api.openai.com/v1",
  "https://api.anthropic.com/v1",
  "https://generativelanguage.googleapis.com/v1beta/openai",
];

export const EMPTY_MODEL_FORM: ModelDefinition = { alias: "", modelName: "", baseUrl: "", apiKey: "" };

export const TIER_LABELS: Record<ModelTier, string> = { FAST: "Fast", BALANCED: "Balanced", SMART: "Smart" };
export const ROLE_CHIP: Record<AgentRole, string> = {
  ROUTA: "role-chip-routa",
  CRAFTER: "role-chip-crafter",
  GATE: "role-chip-gate",
  DEVELOPER: "role-chip-developer",
};

export interface SpecialistForm {
  id: string;
  name: string;
  description: string;
  role: AgentRole;
  defaultModelTier: ModelTier;
  systemPrompt: string;
  roleReminder: string;
  model: string;
}

export const EMPTY_SPECIALIST_FORM: SpecialistForm = {
  id: "",
  name: "",
  description: "",
  role: "CRAFTER",
  defaultModelTier: "BALANCED",
  systemPrompt: "",
  roleReminder: "",
  model: "",
};

export type SpecialistsTabProps = {
  modelDefs: ModelDefinition[];
};

export type GroupedSpecialists = {
  category: string;
  label: string;
  specialists: SpecialistConfig[];
};
