import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import { minimatch } from "minimatch";
import yaml from "js-yaml";

export type ReviewTriggerBoundary = {
  name: string;
  paths: string[];
};

export type ReviewTriggerRule = {
  name: string;
  type: string;
  severity: string;
  action: string;
  paths: string[];
  evidencePaths: string[];
  boundaries: ReviewTriggerBoundary[];
  directories: string[];
  minBoundaries: number | null;
  maxFiles: number | null;
  maxAddedLines: number | null;
  maxDeletedLines: number | null;
};

type ReviewTriggerConfigFile = {
  review_triggers?: Array<Record<string, unknown>>;
};

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function patternMatchesFile(filePath: string, pattern: string): boolean {
  if (!pattern) {
    return false;
  }
  if (pattern.endsWith("/")) {
    return filePath === pattern.slice(0, -1) || filePath.startsWith(pattern);
  }
  return minimatch(filePath, pattern, { dot: true });
}

function directoryMatchesFile(filePath: string, directory: string): boolean {
  if (!directory) {
    return false;
  }
  return filePath === directory || filePath.startsWith(`${directory}/`);
}

export function parseReviewTriggerConfig(source: string): ReviewTriggerRule[] {
  const parsed = (yaml.load(source) ?? {}) as ReviewTriggerConfigFile;
  const rawRules = Array.isArray(parsed.review_triggers) ? parsed.review_triggers : [];
  return rawRules.map((rule) => ({
    name: typeof rule.name === "string" && rule.name.trim().length > 0 ? rule.name : "unknown",
    type: typeof rule.type === "string" && rule.type.trim().length > 0 ? rule.type : "unknown",
    severity: typeof rule.severity === "string" && rule.severity.trim().length > 0 ? rule.severity : "medium",
    action: typeof rule.action === "string" && rule.action.trim().length > 0 ? rule.action : "require_human_review",
    paths: normalizeStringList(rule.paths),
    evidencePaths: normalizeStringList(rule.evidence_paths),
    boundaries: rule.boundaries && typeof rule.boundaries === "object"
      ? Object.entries(rule.boundaries as Record<string, unknown>)
        .filter(([name]) => typeof name === "string" && name.trim().length > 0)
        .map(([name, value]) => ({
          name,
          paths: normalizeStringList(value),
        }))
      : [],
    directories: normalizeStringList(rule.directories),
    minBoundaries: normalizeInteger(rule.min_boundaries),
    maxFiles: normalizeInteger(rule.max_files),
    maxAddedLines: normalizeInteger(rule.max_added_lines),
    maxDeletedLines: normalizeInteger(rule.max_deleted_lines),
  }));
}

export async function loadReviewTriggerRules(repoRoot: string): Promise<{
  relativePath: string | null;
  rules: ReviewTriggerRule[];
}> {
  const relativePath = path.posix.join("docs", "fitness", "review-triggers.yaml");
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
    rules: parseReviewTriggerConfig(source),
  };
}

export function matchFilesForReviewTrigger(rule: ReviewTriggerRule, filePaths: string[]): string[] {
  const matched = new Set<string>();
  const pathPatterns = [
    ...rule.paths,
    ...rule.boundaries.flatMap((boundary) => boundary.paths),
  ];

  for (const filePath of filePaths) {
    if (pathPatterns.some((pattern) => patternMatchesFile(filePath, pattern))) {
      matched.add(filePath);
      continue;
    }
    if (rule.directories.some((directory) => directoryMatchesFile(filePath, directory))) {
      matched.add(filePath);
    }
  }

  return [...matched];
}
