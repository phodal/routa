import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

export type RuntimePhase = "submodule" | "fitness" | "fitness-fast" | "review";

export const DEFAULT_PRE_PUSH_METRICS = [
  "eslint_pass",
  "ts_typecheck_pass",
  "ts_test_pass_full",
  "clippy_pass",
  "rust_test_pass",
  "graph_test_mapping_probe",
] as const;

export const DEFAULT_PRE_COMMIT_METRICS = ["eslint_pass"] as const;
export const DEFAULT_LOCAL_VALIDATE_METRICS = [...DEFAULT_PRE_PUSH_METRICS] as const;

export type HookProfileName = "pre-push" | "pre-commit" | "local-validate";

export const HOOK_PROFILE_PRE_PUSH: HookProfileName = "pre-push";
export const HOOK_PROFILE_PRE_COMMIT: HookProfileName = "pre-commit";
export const HOOK_PROFILE_LOCAL_VALIDATE: HookProfileName = "local-validate";

export const PROFILE_DEFAULT: HookProfileName = HOOK_PROFILE_PRE_PUSH;

export type HookRuntimeProfileConfig = {
  name: HookProfileName;
  phases: readonly RuntimePhase[];
  fallbackMetrics: readonly string[];
};

type HookRuntimeConfigFile = {
  schema?: string;
  profiles?: Record<string, {
    phases?: unknown;
    metrics?: unknown;
  }>;
};

const DEFAULT_RUNTIME_PROFILES: Record<HookProfileName, HookRuntimeProfileConfig> = {
  "pre-push": {
    name: HOOK_PROFILE_PRE_PUSH,
    phases: ["submodule", "fitness", "review"],
    fallbackMetrics: DEFAULT_PRE_PUSH_METRICS,
  },
  "pre-commit": {
    name: HOOK_PROFILE_PRE_COMMIT,
    phases: ["fitness-fast"],
    fallbackMetrics: DEFAULT_PRE_COMMIT_METRICS,
  },
  "local-validate": {
    name: HOOK_PROFILE_LOCAL_VALIDATE,
    phases: ["fitness", "review"],
    fallbackMetrics: DEFAULT_LOCAL_VALIDATE_METRICS,
  },
};

let cachedRuntimeProfiles: Record<HookProfileName, HookRuntimeProfileConfig> | null = null;

export function isHookProfileName(value: string | undefined): value is HookProfileName {
  return value === HOOK_PROFILE_PRE_PUSH || value === HOOK_PROFILE_PRE_COMMIT || value === HOOK_PROFILE_LOCAL_VALIDATE;
}

export function isRuntimePhase(value: unknown): value is RuntimePhase {
  return value === "submodule" || value === "fitness" || value === "fitness-fast" || value === "review";
}

function getHookRuntimeConfigPath(cwd = process.cwd()): string {
  return path.join(cwd, "docs", "fitness", "runtime", "hooks.yaml");
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function loadConfiguredRuntimeProfilesSync(cwd = process.cwd()): Record<HookProfileName, HookRuntimeProfileConfig> {
  const configPath = getHookRuntimeConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    return DEFAULT_RUNTIME_PROFILES;
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = (yaml.load(raw) ?? {}) as HookRuntimeConfigFile;
  const configuredProfiles = parsed.profiles ?? {};

  const profiles = { ...DEFAULT_RUNTIME_PROFILES };
  for (const profileName of Object.keys(DEFAULT_RUNTIME_PROFILES) as HookProfileName[]) {
    const configured = configuredProfiles[profileName];
    if (!configured) {
      continue;
    }

    const phases = Array.isArray(configured.phases)
      ? configured.phases.filter(isRuntimePhase)
      : [...DEFAULT_RUNTIME_PROFILES[profileName].phases];
    const metrics = normalizeStringList(configured.metrics);

    profiles[profileName] = {
      name: profileName,
      phases: phases.length > 0 ? phases : [...DEFAULT_RUNTIME_PROFILES[profileName].phases],
      fallbackMetrics: metrics.length > 0 ? metrics : [...DEFAULT_RUNTIME_PROFILES[profileName].fallbackMetrics],
    };
  }

  return profiles;
}

export function getRuntimeProfiles(): Record<HookProfileName, HookRuntimeProfileConfig> {
  cachedRuntimeProfiles ??= loadConfiguredRuntimeProfilesSync();
  return cachedRuntimeProfiles;
}

export function resetRuntimeProfilesCache(): void {
  cachedRuntimeProfiles = null;
}

export function resolveProfileDefaults(profile: HookProfileName): readonly string[] {
  return [...getRuntimeProfiles()[profile].fallbackMetrics];
}

export function resolveRuntimeProfileConfig(profile: HookProfileName): HookRuntimeProfileConfig {
  return getRuntimeProfiles()[profile];
}

export const DEFAULT_PARALLEL_JOBS = 2;
export const DEFAULT_TAIL_LINES = 10;

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return value;
}

export function parseMetricNames(
  raw: string | undefined,
  fallback: readonly string[] = DEFAULT_PRE_PUSH_METRICS,
): string[] {
  if (!raw) {
    return [...fallback];
  }

  const metrics = raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return metrics.length > 0 ? metrics : [...fallback];
}
