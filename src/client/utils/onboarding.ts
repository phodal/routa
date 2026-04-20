"use client";

import type {
  DefaultProviderSettings,
  ProviderConnectionsStorage,
} from "../components/settings-panel-shared";

export const ONBOARDING_COMPLETED_KEY = "routa.onboarding.completed";
export const ONBOARDING_MODE_KEY = "routa.onboarding.mode";

export type OnboardingMode = "SESSION" | "KANBAN" | "TEAM";

export function parseOnboardingMode(value: string | null): OnboardingMode | null {
  if (value === "SESSION" || value === "KANBAN" || value === "TEAM") {
    return value;
  }

  // Migrate older agent-mode onboarding preferences to the current surface model.
  if (value === "CRAFTER") return "SESSION";
  if (value === "ROUTA") return "KANBAN";

  return null;
}

export function hasSavedProviderConfiguration(
  defaults: DefaultProviderSettings,
  connections: ProviderConnectionsStorage,
  options?: {
    dockerOpencodeAuthJson?: string;
    customProviderCount?: number;
    runtimeProviderCount?: number;
  },
): boolean {
  for (const config of Object.values(defaults)) {
    if (config?.provider || config?.model) {
      return true;
    }
  }

  for (const connection of Object.values(connections)) {
    if (connection?.baseUrl || connection?.apiKey || connection?.model) {
      return true;
    }
  }

  if (options?.dockerOpencodeAuthJson?.trim()) {
    return true;
  }

  if ((options?.customProviderCount ?? 0) > 0) {
    return true;
  }

  if ((options?.runtimeProviderCount ?? 0) > 0) {
    return true;
  }

  return false;
}

export function clearOnboardingState(storage: Storage): void {
  storage.removeItem(ONBOARDING_COMPLETED_KEY);
  storage.removeItem(ONBOARDING_MODE_KEY);
}
