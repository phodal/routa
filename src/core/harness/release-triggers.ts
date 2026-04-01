import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import yaml from "js-yaml";

export type ReleaseTriggerRule = {
  name: string;
  type: string;
  severity: string;
  action: string;
  patterns: string[];
  applyTo: string[];
  paths: string[];
  groupBy: string[];
  baseline: string | null;
  maxGrowthPercent: number | null;
  minGrowthBytes: number | null;
};

type ReleaseTriggerConfigFile = {
  release_triggers?: Array<Record<string, unknown>>;
};

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseReleaseTriggerConfig(source: string): ReleaseTriggerRule[] {
  const parsed = (yaml.load(source) ?? {}) as ReleaseTriggerConfigFile;
  const rawRules = Array.isArray(parsed.release_triggers) ? parsed.release_triggers : [];
  return rawRules.map((rule) => ({
    name: typeof rule.name === "string" && rule.name.trim().length > 0 ? rule.name : "unknown",
    type: typeof rule.type === "string" && rule.type.trim().length > 0 ? rule.type : "unknown",
    severity: typeof rule.severity === "string" && rule.severity.trim().length > 0 ? rule.severity : "medium",
    action: typeof rule.action === "string" && rule.action.trim().length > 0 ? rule.action : "require_human_review",
    patterns: normalizeStringList(rule.patterns),
    applyTo: normalizeStringList(rule.apply_to),
    paths: normalizeStringList(rule.paths),
    groupBy: normalizeStringList(rule.group_by),
    baseline: typeof rule.baseline === "string" && rule.baseline.trim().length > 0 ? rule.baseline : null,
    maxGrowthPercent: normalizeNumber(rule.max_growth_percent),
    minGrowthBytes: normalizeNumber(rule.min_growth_bytes),
  }));
}

export async function loadReleaseTriggerRules(repoRoot: string): Promise<{
  relativePath: string | null;
  rules: ReleaseTriggerRule[];
}> {
  const relativePath = path.posix.join("docs", "fitness", "release-triggers.yaml");
  const fullPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    return {
      relativePath: null,
      rules: [],
    };
  }

  const source = await fsp.readFile(fullPath, "utf-8");
  return {
    relativePath,
    rules: parseReleaseTriggerConfig(source),
  };
}
