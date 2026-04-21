import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import { minimatch } from "minimatch";
import yaml from "js-yaml";

export type ReviewTriggerBoundary = {
  name: string;
  paths: string[];
};

export type ReviewTriggerReviewLayer = {
  confidenceThreshold: number | null;
  specialistId: string | null;
  provider: string | null;
  model: string | null;
  context: string[];
};

export type ReviewTriggerAction =
  | "advisory"
  | "block"
  | "require_human_review"
  | "staged";

export type ReviewTriggerRule = {
  name: string;
  type: string;
  severity: string;
  action: ReviewTriggerAction;
  paths: string[];
  evidencePaths: string[];
  boundaries: ReviewTriggerBoundary[];
  directories: string[];
  minBoundaries: number | null;
  maxFiles: number | null;
  maxAddedLines: number | null;
  maxDeletedLines: number | null;
  confidenceThreshold: number | null;
  fallbackAction: ReviewTriggerAction | null;
  specialistId: string | null;
  provider: string | null;
  model: string | null;
  context: string[];
  reviewLayers: ReviewTriggerReviewLayer[];
};

export type ReviewTriggerDiffStats = {
  fileCount: number;
  addedLines: number;
  deletedLines: number;
};

export type ReviewTriggerMatch = {
  name: string;
  severity: string;
  action: ReviewTriggerAction;
  confidenceThreshold: number | null;
  fallbackAction: ReviewTriggerAction | null;
  specialistId: string | null;
  provider: string | null;
  model: string | null;
  context: string[];
  reviewLayers: ReviewTriggerReviewLayer[];
  reasons: string[];
};

export type ReviewTriggerReport = {
  blocked: boolean;
  humanReviewRequired: boolean;
  advisoryOnly: boolean;
  stagedReviewRequired: boolean;
  base: string;
  changedFiles: string[];
  diffStats: ReviewTriggerDiffStats;
  triggers: ReviewTriggerMatch[];
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

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeConfidenceThreshold(value: unknown): number | null {
  const parsed = normalizeInteger(value);
  if (parsed === null) {
    return null;
  }

  return Math.min(10, Math.max(1, parsed));
}

function normalizeReviewTriggerReviewLayers(value: unknown): ReviewTriggerReviewLayer[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    .map((entry) => ({
      confidenceThreshold: normalizeConfidenceThreshold(entry.confidence_threshold),
      specialistId: normalizeOptionalString(entry.specialist_id),
      provider: normalizeOptionalString(entry.provider),
      model: normalizeOptionalString(entry.model),
      context: normalizeStringList(entry.context),
    }));
}

export function normalizeReviewTriggerAction(
  value: unknown,
  fallback: ReviewTriggerAction = "require_human_review",
): ReviewTriggerAction {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "advisory":
    case "warn":
      return "advisory";
    case "block":
    case "block_push":
      return "block";
    case "review":
    case "auto_review":
    case "staged":
      return "staged";
    case "require_human_review":
    case "human_review":
      return "require_human_review";
    default:
      return fallback;
  }
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
  return rawRules.map((rule) => {
    const action = normalizeReviewTriggerAction(rule.action);
    const fallbackAction = normalizeOptionalString(rule.fallback_action)
      ? normalizeReviewTriggerAction(rule.fallback_action, "require_human_review")
      : null;

    return {
      name: typeof rule.name === "string" && rule.name.trim().length > 0 ? rule.name : "unknown",
      type: typeof rule.type === "string" && rule.type.trim().length > 0 ? rule.type : "unknown",
      severity: typeof rule.severity === "string" && rule.severity.trim().length > 0 ? rule.severity : "medium",
      action,
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
      confidenceThreshold: normalizeConfidenceThreshold(rule.confidence_threshold),
      fallbackAction: action === "staged" ? (fallbackAction ?? "require_human_review") : fallbackAction,
      specialistId: normalizeOptionalString(rule.specialist_id),
      provider: normalizeOptionalString(rule.provider),
      model: normalizeOptionalString(rule.model),
      context: normalizeStringList(rule.context),
      reviewLayers: normalizeReviewTriggerReviewLayers(rule.review_layers),
    };
  });
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

function countDirectFiles(repoRoot: string, directory: string): number {
  const target = path.join(repoRoot, directory);
  try {
    return fs.readdirSync(target, { withFileTypes: true }).filter((entry) => entry.isFile()).length;
  } catch {
    return 0;
  }
}

function changedFilesInDirectory(filePaths: string[], directory: string): string[] {
  const normalized = directory.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return [];
  }

  return filePaths.filter((filePath) => directoryMatchesFile(filePath, normalized));
}

function pushTriggerIfAny(
  triggers: ReviewTriggerMatch[],
  rule: ReviewTriggerRule,
  reasons: string[],
) {
  if (reasons.length === 0) {
    return;
  }

  triggers.push({
    name: rule.name,
    severity: rule.severity,
    action: rule.action,
    confidenceThreshold: rule.confidenceThreshold,
    fallbackAction: rule.fallbackAction,
    specialistId: rule.specialistId,
    provider: rule.provider,
    model: rule.model,
    context: [...rule.context],
    reviewLayers: rule.reviewLayers.map((layer) => ({
      confidenceThreshold: layer.confidenceThreshold,
      specialistId: layer.specialistId,
      provider: layer.provider,
      model: layer.model,
      context: [...layer.context],
    })),
    reasons,
  });
}

export function evaluateReviewTriggers(params: {
  rules: ReviewTriggerRule[];
  changedFiles: string[];
  diffStats: ReviewTriggerDiffStats;
  base?: string;
  repoRoot?: string | null;
}): ReviewTriggerReport {
  const triggers: ReviewTriggerMatch[] = [];

  for (const rule of params.rules) {
    switch (rule.type) {
      case "changed_paths":
      case "sensitive_file_change": {
        const label = rule.type === "sensitive_file_change"
          ? "sensitive file changed"
          : "changed path";
        const reasons = params.changedFiles
          .filter((filePath) => rule.paths.some((pattern) => patternMatchesFile(filePath, pattern)))
          .map((filePath) => `${label}: ${filePath}`);
        pushTriggerIfAny(triggers, rule, reasons);
        break;
      }
      case "diff_size": {
        const reasons: string[] = [];
        if (rule.maxFiles !== null && params.diffStats.fileCount > rule.maxFiles) {
          reasons.push(`diff touched ${params.diffStats.fileCount} files (threshold: ${rule.maxFiles})`);
        }
        if (rule.maxAddedLines !== null && params.diffStats.addedLines > rule.maxAddedLines) {
          reasons.push(`diff added ${params.diffStats.addedLines} lines (threshold: ${rule.maxAddedLines})`);
        }
        if (rule.maxDeletedLines !== null && params.diffStats.deletedLines > rule.maxDeletedLines) {
          reasons.push(`diff deleted ${params.diffStats.deletedLines} lines (threshold: ${rule.maxDeletedLines})`);
        }
        pushTriggerIfAny(triggers, rule, reasons);
        break;
      }
      case "directory_file_count": {
        if (!params.repoRoot || rule.maxFiles === null) {
          break;
        }

        const reasons: string[] = [];
        for (const directory of rule.directories) {
          const touchedFiles = changedFilesInDirectory(params.changedFiles, directory);
          if (touchedFiles.length === 0) {
            continue;
          }

          const directFiles = countDirectFiles(params.repoRoot, directory);
          if (directFiles <= rule.maxFiles) {
            continue;
          }

          const changedSample = touchedFiles.slice(0, 3).join(", ");
          const suffix = touchedFiles.length > 3 ? ", ..." : "";
          reasons.push(
            `directory '${directory}' has ${directFiles} direct files (threshold: ${rule.maxFiles}); changed files: ${changedSample}${suffix}`,
          );
        }
        pushTriggerIfAny(triggers, rule, reasons);
        break;
      }
      case "evidence_gap": {
        const monitoredChanges = params.changedFiles.filter((filePath) =>
          rule.paths.some((pattern) => patternMatchesFile(filePath, pattern))
        );
        if (monitoredChanges.length === 0) {
          break;
        }

        const evidenceTouched = params.changedFiles.some((filePath) =>
          rule.evidencePaths.some((pattern) => patternMatchesFile(filePath, pattern))
        );
        if (evidenceTouched) {
          break;
        }

        const reasons = monitoredChanges.map(
          (filePath) => `changed code path without evidence update: ${filePath}`,
        );
        reasons.push(`expected evidence path patterns: ${rule.evidencePaths.join(", ")}`);
        pushTriggerIfAny(triggers, rule, reasons);
        break;
      }
      case "cross_boundary_change": {
        const boundaryHits = rule.boundaries
          .map((boundary) => ({
            name: boundary.name,
            matches: params.changedFiles.filter((filePath) =>
              boundary.paths.some((pattern) => patternMatchesFile(filePath, pattern))
            ),
          }))
          .filter((boundary) => boundary.matches.length > 0);

        if (boundaryHits.length < (rule.minBoundaries ?? 2)) {
          break;
        }

        const reasons = boundaryHits.map((boundary) =>
          `changed boundary '${boundary.name}': ${boundary.matches.join(", ")}`,
        );
        pushTriggerIfAny(triggers, rule, reasons);
        break;
      }
      default:
        break;
    }
  }

  return {
    blocked: triggers.some((trigger) => trigger.action === "block"),
    humanReviewRequired: triggers.some((trigger) => trigger.action === "require_human_review"),
    advisoryOnly: triggers.length > 0 && triggers.every((trigger) => trigger.action === "advisory"),
    stagedReviewRequired: triggers.some((trigger) => trigger.action === "staged"),
    base: params.base ?? "HEAD",
    changedFiles: [...params.changedFiles],
    diffStats: { ...params.diffStats },
    triggers,
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
