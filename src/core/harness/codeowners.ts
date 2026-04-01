import { execSync } from "child_process";
import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import { minimatch } from "minimatch";
import type {
  CodeownersCorrelationReport,
  CodeownersOwner,
  CodeownersResponse,
  CodeownersRule,
  OwnerGroupSummary,
  OwnerKind,
  OwnershipRoutingContext,
  OwnershipMatch,
  TriggerOwnershipCorrelation,
} from "./codeowners-types";
import {
  loadReviewTriggerRules,
  matchFilesForReviewTrigger,
  type ReviewTriggerRule,
} from "./review-triggers";

const CODEOWNERS_CANDIDATES = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

const SENSITIVE_PATH_PREFIXES = [
  "src/core/acp/",
  "src/core/orchestration/",
  "crates/routa-server/src/api/",
];

const SENSITIVE_FILES = [
  "api-contract.yaml",
  "docs/fitness/manifest.yaml",
  "docs/fitness/review-triggers.yaml",
  ".github/workflows/defense.yaml",
];

function classifyOwner(raw: string): CodeownersOwner {
  const trimmed = raw.trim();
  let kind: OwnerKind;
  if (trimmed.includes("@") && trimmed.includes("/")) {
    kind = "team";
  } else if (trimmed.includes("@") && trimmed.includes(".")) {
    kind = "email";
  } else {
    kind = "user";
  }
  return { name: trimmed, kind };
}

export function parseCodeownersContent(content: string): { rules: CodeownersRule[]; warnings: string[] } {
  const rules: CodeownersRule[] = [];
  const warnings: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("#")) continue;

    const tokens = line.split(/\s+/);
    if (tokens.length < 2) {
      warnings.push(`Line ${i + 1}: pattern without owners — "${line}"`);
      continue;
    }

    const [pattern, ...ownerTokens] = tokens;
    const owners = ownerTokens.map(classifyOwner);

    rules.push({
      pattern,
      owners,
      line: i + 1,
      precedence: rules.length,
    });
  }

  return { rules, warnings };
}

function normalizePattern(pattern: string): { normalized: string; anchoredToRoot: boolean } {
  const anchoredToRoot = pattern.startsWith("/");
  const normalized = anchoredToRoot ? pattern.slice(1) : pattern;
  if (!anchoredToRoot && !normalized.includes("/")) {
    return { normalized: `**/${normalized}`, anchoredToRoot };
  }
  return { normalized, anchoredToRoot };
}

function matchesPattern(filePath: string, pattern: string): boolean {
  const { normalized, anchoredToRoot } = normalizePattern(pattern);
  const isDir = pattern.endsWith("/");
  const matchPattern = isDir ? `${normalized}**` : normalized;
  const requiresRootMatch = anchoredToRoot && !normalized.includes("/");
  if (requiresRootMatch && filePath.includes("/")) {
    return false;
  }
  return minimatch(filePath, matchPattern, { dot: true, matchBase: false });
}

export function matchFileToRule(filePath: string, rules: CodeownersRule[]): CodeownersRule | null {
  let bestMatch: CodeownersRule | null = null;
  for (const rule of rules) {
    if (matchesPattern(filePath, rule.pattern)) {
      if (!bestMatch || rule.precedence > bestMatch.precedence) {
        bestMatch = rule;
      }
    }
  }
  return bestMatch;
}

function findAllMatchingRules(filePath: string, rules: CodeownersRule[]): CodeownersRule[] {
  return rules.filter((rule) => matchesPattern(filePath, rule.pattern));
}

export function resolveOwnership(filePaths: string[], rules: CodeownersRule[]): OwnershipMatch[] {
  return filePaths.map((filePath) => {
    const matchingRules = findAllMatchingRules(filePath, rules);
    const bestRule = matchFileToRule(filePath, rules);
    const overlap = matchingRules.length > 1;

    return {
      filePath,
      owners: bestRule?.owners ?? [],
      matchedRule: bestRule,
      overlap,
      covered: bestRule !== null,
    };
  });
}

function isSensitivePath(filePath: string): boolean {
  return (
    SENSITIVE_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix)) ||
    SENSITIVE_FILES.includes(filePath)
  );
}

function collectTrackedFiles(repoRoot: string, warnings: string[]): string[] {
  try {
    const output = execSync("git ls-files", { cwd: repoRoot, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
    return output.trim().split("\n").filter((line: string) => line.length > 0);
  } catch {
    warnings.push("Failed to list git-tracked files. Coverage analysis may be incomplete.");
    return [];
  }
}

export async function loadCodeownersRules(repoRoot: string): Promise<{
  codeownersFile: string | null;
  rules: CodeownersRule[];
  warnings: string[];
}> {
  const codeownersFile = CODEOWNERS_CANDIDATES.find((candidate) =>
    fs.existsSync(path.join(repoRoot, candidate)),
  ) ?? null;

  if (!codeownersFile) {
    return {
      codeownersFile: null,
      rules: [],
      warnings: ["No CODEOWNERS file found. Checked: " + CODEOWNERS_CANDIDATES.join(", ")],
    };
  }

  const content = await fsp.readFile(path.join(repoRoot, codeownersFile), "utf-8");
  const { rules, warnings } = parseCodeownersContent(content);
  return {
    codeownersFile,
    rules,
    warnings,
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function getHighRiskUnownedFiles(files: string[]): string[] {
  return uniqueSorted(files.filter(isSensitivePath));
}

export function buildOwnershipRoutingContext(params: {
  changedFiles: string[];
  matches: OwnershipMatch[];
  triggerRules: ReviewTriggerRule[];
  matchedTriggerNames?: string[];
}): OwnershipRoutingContext {
  const changedFiles = uniqueSorted(params.changedFiles);
  const matchesByFile = new Map(params.matches.map((match) => [match.filePath, match]));
  const matchedTriggerNameSet = params.matchedTriggerNames ? new Set(params.matchedTriggerNames) : null;
  const relevantTriggerRules = params.triggerRules.filter((rule) => (
    matchedTriggerNameSet ? matchedTriggerNameSet.has(rule.name) : true
  ));

  const touchedOwners = uniqueSorted(
    params.matches.flatMap((match) => match.owners.map((owner) => owner.name)),
  );
  const unownedChangedFiles = uniqueSorted(
    params.matches.filter((match) => !match.covered).map((match) => match.filePath),
  );
  const overlappingChangedFiles = uniqueSorted(
    params.matches.filter((match) => match.overlap).map((match) => match.filePath),
  );

  const triggerCorrelations: TriggerOwnershipCorrelation[] = relevantTriggerRules
    .map((rule) => {
      const touchedFiles = matchFilesForReviewTrigger(rule, changedFiles);
      const relevantMatches = touchedFiles
        .map((filePath) => matchesByFile.get(filePath))
        .filter((value): value is OwnershipMatch => Boolean(value));
      const ownerGroups = uniqueSorted(
        relevantMatches.flatMap((match) => match.owners.map((owner) => owner.name)),
      );
      const unownedPaths = uniqueSorted(
        relevantMatches.filter((match) => !match.covered).map((match) => match.filePath),
      );
      const overlappingPaths = uniqueSorted(
        relevantMatches.filter((match) => match.overlap).map((match) => match.filePath),
      );

      return {
        triggerName: rule.name,
        severity: rule.severity,
        action: rule.action,
        ownerGroups,
        ownerGroupCount: ownerGroups.length,
        touchedFileCount: touchedFiles.length,
        unownedPaths,
        overlappingPaths,
        spansMultipleOwnerGroups: ownerGroups.length > 1,
        hasOwnershipGap: unownedPaths.length > 0,
      } satisfies TriggerOwnershipCorrelation;
    })
    .filter((correlation) => correlation.touchedFileCount > 0);

  return {
    changedFiles,
    touchedOwners,
    touchedOwnerGroupsCount: touchedOwners.length,
    unownedChangedFiles,
    overlappingChangedFiles,
    highRiskUnownedFiles: getHighRiskUnownedFiles(unownedChangedFiles),
    crossOwnerTriggers: uniqueSorted(
      triggerCorrelations
        .filter((correlation) => correlation.spansMultipleOwnerGroups)
        .map((correlation) => correlation.triggerName),
    ),
    triggerCorrelations,
  };
}

function buildCodeownersCorrelationReport(params: {
  trackedFiles: string[];
  matches: OwnershipMatch[];
  reviewTriggerFile: string | null;
  triggerRules: ReviewTriggerRule[];
}): CodeownersCorrelationReport {
  const routing = buildOwnershipRoutingContext({
    changedFiles: params.trackedFiles,
    matches: params.matches,
    triggerRules: params.triggerRules,
  });

  const hotspots = routing.triggerCorrelations.flatMap((correlation) => {
    const entries: CodeownersCorrelationReport["hotspots"] = [];
    if (correlation.hasOwnershipGap) {
      entries.push({
        triggerName: correlation.triggerName,
        reason: "Trigger-covered paths have no explicit owner coverage.",
        samplePaths: correlation.unownedPaths.slice(0, 5),
      });
    }
    if (correlation.spansMultipleOwnerGroups) {
      entries.push({
        triggerName: correlation.triggerName,
        reason: "Trigger spans multiple owner groups and may need cross-team review routing.",
        samplePaths: correlation.overlappingPaths.slice(0, 5),
      });
    }
    if (correlation.overlappingPaths.length > 0) {
      entries.push({
        triggerName: correlation.triggerName,
        reason: "Trigger touches overlapping ownership rules that should be shown explicitly.",
        samplePaths: correlation.overlappingPaths.slice(0, 5),
      });
    }
    return entries;
  });

  return {
    reviewTriggerFile: params.reviewTriggerFile,
    triggerCorrelations: routing.triggerCorrelations,
    hotspots,
  };
}

export async function detectCodeowners(repoRoot: string): Promise<CodeownersResponse> {
  const warnings: string[] = [];
  const { codeownersFile, rules, warnings: parseWarnings } = await loadCodeownersRules(repoRoot);

  if (!codeownersFile) {
    return {
      generatedAt: new Date().toISOString(),
      repoRoot,
      codeownersFile: null,
      owners: [],
      rules: [],
      coverage: {
        unownedFiles: [],
        overlappingFiles: [],
        sensitiveUnownedFiles: [],
      },
      correlation: {
        reviewTriggerFile: null,
        triggerCorrelations: [],
        hotspots: [],
      },
      warnings: parseWarnings,
    };
  }
  warnings.push(...parseWarnings);

  const trackedFiles = collectTrackedFiles(repoRoot, warnings);
  const matches = resolveOwnership(trackedFiles, rules);
  const { relativePath: reviewTriggerFile, rules: reviewTriggerRules } = await loadReviewTriggerRules(repoRoot);

  const ownerCounts = new Map<string, { kind: OwnerKind; count: number }>();
  for (const match of matches) {
    for (const owner of match.owners) {
      const existing = ownerCounts.get(owner.name);
      if (existing) {
        existing.count++;
      } else {
        ownerCounts.set(owner.name, { kind: owner.kind, count: 1 });
      }
    }
  }

  const ownerGroups: OwnerGroupSummary[] = [...ownerCounts.entries()]
    .map(([name, { kind, count }]) => ({ name, kind, matchedFileCount: count }))
    .sort((a, b) => b.matchedFileCount - a.matchedFileCount);

  const unownedFiles = matches
    .filter((m) => !m.covered)
    .map((m) => m.filePath);

  const overlappingFiles = matches
    .filter((m) => m.overlap)
    .map((m) => m.filePath);

  const sensitiveUnownedFiles = unownedFiles.filter(isSensitivePath);

  const MAX_REPORT_FILES = 50;
  const correlation = buildCodeownersCorrelationReport({
    trackedFiles,
    matches,
    reviewTriggerFile,
    triggerRules: reviewTriggerRules,
  });

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    codeownersFile,
    owners: ownerGroups,
    rules: rules.map((r) => ({
      pattern: r.pattern,
      owners: r.owners.map((o) => o.name),
      line: r.line,
      precedence: r.precedence,
    })),
    coverage: {
      unownedFiles: unownedFiles.slice(0, MAX_REPORT_FILES),
      overlappingFiles: overlappingFiles.slice(0, MAX_REPORT_FILES),
      sensitiveUnownedFiles,
    },
    correlation,
    warnings,
  };
}
