import * as fs from "fs";
import { promises as fsp } from "fs";
import matter from "gray-matter";
import yaml from "js-yaml";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  parseContext,
  resolveRepoRoot,
  isContextError,
  type HookProfileName,
  type RuntimePhase,
} from "./shared";

type HookMetricSummary = {
  name: string;
  command: string;
  description: string;
  hardGate: boolean;
  resolved: boolean;
  sourceFile?: string;
};

type HookRuntimeProfileSummary = {
  name: HookProfileName;
  phases: RuntimePhase[];
  fallbackMetrics: string[];
  metrics: HookMetricSummary[];
  hooks: string[];
};

type ReviewTriggerBoundarySummary = {
  name: string;
  paths: string[];
};

type ReviewTriggerRuleSummary = {
  name: string;
  type: string;
  severity: string;
  action: string;
  paths: string[];
  evidencePaths: string[];
  boundaries: ReviewTriggerBoundarySummary[];
  directories: string[];
  pathCount: number;
  evidencePathCount: number;
  boundaryCount: number;
  directoryCount: number;
  minBoundaries: number | null;
  maxFiles: number | null;
  maxAddedLines: number | null;
  maxDeletedLines: number | null;
};

type ReviewTriggerConfigSummary = {
  relativePath: string;
  source: string;
  ruleCount: number;
  rules: ReviewTriggerRuleSummary[];
};

type HookFileSummary = {
  name: string;
  relativePath: string;
  source: string;
  triggerCommand: string;
  kind: "runtime-profile" | "shell-command";
  runtimeProfileName?: HookProfileName;
  skipEnvVar?: string;
};

type HooksResponse = {
  generatedAt: string;
  repoRoot: string;
  hooksDir: string;
  configFile: {
    relativePath: string;
    source: string;
    schema?: string;
  } | null;
  reviewTriggerFile: ReviewTriggerConfigSummary | null;
  releaseTriggerFile: ReleaseTriggerConfigSummary | null;
  hookFiles: HookFileSummary[];
  profiles: HookRuntimeProfileSummary[];
  warnings: string[];
};

type FitnessManifest = {
  evidence_files?: string[];
};

type FrontmatterMetric = {
  command?: string;
  description?: string;
  hard_gate?: boolean;
  name?: string;
};

type HookRuntimeConfigFile = {
  schema?: string;
  profiles?: Record<string, {
    phases?: unknown;
    metrics?: unknown;
  }>;
};

type ReviewTriggerConfigFile = {
  review_triggers?: Array<Record<string, unknown>>;
};

type ReleaseTriggerRuleSummary = {
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
  patternCount: number;
  applyToCount: number;
  pathCount: number;
};

type ReleaseTriggerConfigSummary = {
  relativePath: string;
  source: string;
  ruleCount: number;
  rules: ReleaseTriggerRuleSummary[];
};

type ReleaseTriggerConfigFile = {
  release_triggers?: Array<Record<string, unknown>>;
};

type HookRuntimeProfileConfig = {
  name: HookProfileName;
  phases: RuntimePhase[];
  metrics: string[];
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function detectRuntimeProfile(
  hookName: string,
  source: string,
  knownProfiles: Set<HookProfileName>,
): HookProfileName | undefined {
  const explicitMatch = source.match(/--profile(?:=|\s+)([A-Za-z0-9_-]+)\b/u);
  const explicitProfile = explicitMatch?.[1];
  if (explicitProfile && knownProfiles.has(explicitProfile)) {
    return explicitProfile;
  }
  if (knownProfiles.has(hookName)) {
    return hookName;
  }
  return undefined;
}

function extractTriggerCommand(source: string): string {
  const runtimeLine = source
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.includes("tools/hook-runtime/src/cli.ts"));
  if (runtimeLine) {
    return runtimeLine;
  }

  const commandLines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  return commandLines.at(-1) ?? "(no command detected)";
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
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
async function loadHookRuntimeProfiles(repoRoot: string): Promise<{
  profiles: HookRuntimeProfileConfig[];
  warnings: string[];
}> {
  const configPath = path.join(repoRoot, "docs", "fitness", "runtime", "hooks.yaml");
  const warnings: string[] = [];
  if (!fs.existsSync(configPath)) {
    warnings.push("Missing docs/fitness/runtime/hooks.yaml.");
    return {
      profiles: [],
      warnings,
    };
  }

  const raw = await fsp.readFile(configPath, "utf-8");
  const parsed = (yaml.load(raw) ?? {}) as HookRuntimeConfigFile;
  const configuredProfiles = parsed.profiles ?? {};

  const profiles = Object.entries(configuredProfiles).map(([profileName, configured]) => {
    const phases = normalizeStringList(configured?.phases);
    const metrics = normalizeStringList(configured?.metrics);

    if (!phases.length) {
      warnings.push(`Profile "${profileName}" has no configured phases in hooks.yaml.`);
    }
    if (!metrics.length) {
      warnings.push(`Profile "${profileName}" has no configured metrics in hooks.yaml.`);
    }

    return {
      name: profileName,
      phases,
      metrics,
    };
  });

  if (!profiles.length) {
    warnings.push("hooks.yaml does not define any profiles.");
    return {
      profiles: [],
      warnings,
    };
  }

  return { profiles, warnings };
}

async function loadHookRuntimeConfigSource(repoRoot: string): Promise<HooksResponse["configFile"]> {
  const relativePath = path.posix.join("docs", "fitness", "runtime", "hooks.yaml");
  const configPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const source = await fsp.readFile(configPath, "utf-8");
  const parsed = (yaml.load(source) ?? {}) as HookRuntimeConfigFile;
  return {
    relativePath,
    source,
    schema: typeof parsed.schema === "string" ? parsed.schema : undefined,
  };
}

async function loadReviewTriggerConfigSource(repoRoot: string): Promise<HooksResponse["reviewTriggerFile"]> {
  const relativePath = path.posix.join("docs", "fitness", "review-triggers.yaml");
  const configPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const source = await fsp.readFile(configPath, "utf-8");
  const parsed = (yaml.load(source) ?? {}) as ReviewTriggerConfigFile;
  const rawRules = Array.isArray(parsed.review_triggers) ? parsed.review_triggers : [];
  const rules = rawRules.map((rule) => {
    const boundaries = rule.boundaries && typeof rule.boundaries === "object"
      ? Object.entries(rule.boundaries as Record<string, unknown>)
        .filter(([boundaryName]) => typeof boundaryName === "string" && boundaryName.trim().length > 0)
        .map(([boundaryName, value]) => ({
          name: boundaryName,
          paths: normalizeStringList(value),
        }))
      : [];
    const paths = normalizeStringList(rule.paths);
    const evidencePaths = normalizeStringList(rule.evidence_paths);
    const directories = normalizeStringList(rule.directories);

    return {
      name: typeof rule.name === "string" && rule.name.trim().length > 0 ? rule.name : "unknown",
      type: typeof rule.type === "string" && rule.type.trim().length > 0 ? rule.type : "unknown",
      severity: typeof rule.severity === "string" && rule.severity.trim().length > 0 ? rule.severity : "medium",
      action: typeof rule.action === "string" && rule.action.trim().length > 0 ? rule.action : "require_human_review",
      paths,
      evidencePaths,
      boundaries,
      directories,
      pathCount: paths.length,
      evidencePathCount: evidencePaths.length,
      boundaryCount: boundaries.length,
      directoryCount: directories.length,
      minBoundaries: normalizeInteger(rule.min_boundaries),
      maxFiles: normalizeInteger(rule.max_files),
      maxAddedLines: normalizeInteger(rule.max_added_lines),
      maxDeletedLines: normalizeInteger(rule.max_deleted_lines),
    } satisfies ReviewTriggerRuleSummary;
  });

  return {
    relativePath,
    source,
    ruleCount: rules.length,
    rules,
  };
}

async function loadReleaseTriggerConfigSource(repoRoot: string): Promise<HooksResponse["releaseTriggerFile"]> {
  const relativePath = path.posix.join("docs", "fitness", "release-triggers.yaml");
  const configPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const source = await fsp.readFile(configPath, "utf-8");
  const parsed = (yaml.load(source) ?? {}) as ReleaseTriggerConfigFile;
  const rawRules = Array.isArray(parsed.release_triggers) ? parsed.release_triggers : [];
  const rules = rawRules.map((rule) => {
    const patterns = normalizeStringList(rule.patterns);
    const applyTo = normalizeStringList(rule.apply_to);
    const paths = normalizeStringList(rule.paths);
    const groupBy = normalizeStringList(rule.group_by);

    return {
      name: typeof rule.name === "string" && rule.name.trim().length > 0 ? rule.name : "unknown",
      type: typeof rule.type === "string" && rule.type.trim().length > 0 ? rule.type : "unknown",
      severity: typeof rule.severity === "string" && rule.severity.trim().length > 0 ? rule.severity : "medium",
      action: typeof rule.action === "string" && rule.action.trim().length > 0 ? rule.action : "require_human_review",
      patterns,
      applyTo,
      paths,
      groupBy,
      baseline: typeof rule.baseline === "string" && rule.baseline.trim().length > 0 ? rule.baseline : null,
      maxGrowthPercent: normalizeNumber(rule.max_growth_percent),
      minGrowthBytes: normalizeNumber(rule.min_growth_bytes),
      patternCount: patterns.length,
      applyToCount: applyTo.length,
      pathCount: paths.length,
    } satisfies ReleaseTriggerRuleSummary;
  });

  return {
    relativePath,
    source,
    ruleCount: rules.length,
    rules,
  };
}


async function loadMetricLookup(repoRoot: string): Promise<{
  metrics: Map<string, Omit<HookMetricSummary, "resolved">>;
  warnings: string[];
}> {
  const metrics = new Map<string, Omit<HookMetricSummary, "resolved">>();
  const warnings: string[] = [];
  const manifestPath = path.join(repoRoot, "docs", "fitness", "manifest.yaml");

  if (!fs.existsSync(manifestPath)) {
    warnings.push('Missing docs/fitness/manifest.yaml, so hook metrics could not be resolved.');
    return { metrics, warnings };
  }

  try {
    const rawManifest = await fsp.readFile(manifestPath, "utf-8");
    const manifest = (yaml.load(rawManifest) ?? {}) as FitnessManifest;
    const evidenceFiles = Array.isArray(manifest.evidence_files) ? manifest.evidence_files : [];

    for (const relativeFile of evidenceFiles) {
      const absoluteFile = path.join(repoRoot, relativeFile);
      if (!fs.existsSync(absoluteFile)) {
        warnings.push(`Missing metric source file: ${relativeFile}`);
        continue;
      }

      const raw = await fsp.readFile(absoluteFile, "utf-8");
      const parsed = matter(raw);
      const frontmatterMetrics = Array.isArray(parsed.data.metrics) ? parsed.data.metrics : [];

      for (const entry of frontmatterMetrics as FrontmatterMetric[]) {
        if (!entry?.name || !entry.command) {
          continue;
        }
        metrics.set(entry.name, {
          name: entry.name,
          command: entry.command,
          description: entry.description ?? "",
          hardGate: Boolean(entry.hard_gate),
          sourceFile: relativeFile,
        });
      }
    }
  } catch (error) {
    warnings.push(`Failed to read hook metric manifest: ${toMessage(error)}`);
  }

  return { metrics, warnings };
}

function buildProfileSummaries(
  hookFiles: HookFileSummary[],
  metricLookup: Map<string, Omit<HookMetricSummary, "resolved">>,
  runtimeProfiles: HookRuntimeProfileConfig[],
): HookRuntimeProfileSummary[] {
  return runtimeProfiles.map((profile) => {
    const fallbackMetrics = [...profile.metrics];
    return {
      name: profile.name,
      phases: [...profile.phases],
      fallbackMetrics,
      hooks: hookFiles
        .filter((hook) => hook.runtimeProfileName === profile.name)
        .map((hook) => hook.name),
      metrics: fallbackMetrics.map((metricName) => {
        const metric = metricLookup.get(metricName);
        return metric
          ? { ...metric, resolved: true }
          : {
            name: metricName,
            command: "",
            description: "",
            hardGate: false,
            resolved: false,
          };
      }),
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    const hooksDir = path.join(repoRoot, ".husky");
    const hookRuntime = await loadHookRuntimeProfiles(repoRoot);
    const configFile = await loadHookRuntimeConfigSource(repoRoot);
    const reviewTriggerFile = await loadReviewTriggerConfigSource(repoRoot);
    const releaseTriggerFile = await loadReleaseTriggerConfigSource(repoRoot);
    const warnings: string[] = [...hookRuntime.warnings];
    const knownProfiles = new Set(hookRuntime.profiles.map((profile) => profile.name));

    if (!fs.existsSync(hooksDir) || !fs.statSync(hooksDir).isDirectory()) {
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        repoRoot,
        hooksDir,
        configFile,
        reviewTriggerFile,
        releaseTriggerFile,
        hookFiles: [],
        profiles: buildProfileSummaries([], new Map(), hookRuntime.profiles),
        warnings: [...warnings, 'No ".husky" directory found for this repository.'],
      } satisfies HooksResponse);
    }

    const entries = await fsp.readdir(hooksDir, { withFileTypes: true });
    const hookFiles: HookFileSummary[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || entry.name.startsWith("_")) {
        continue;
      }

      const relativePath = path.posix.join(".husky", entry.name);
      const fullPath = path.join(hooksDir, entry.name);
      const source = await fsp.readFile(fullPath, "utf-8");
      const explicitMatch = source.match(/--profile(?:=|\s+)([A-Za-z0-9_-]+)\b/u);
      const explicitProfile = explicitMatch?.[1];
      const runtimeProfileName = source.includes("tools/hook-runtime/src/cli.ts")
        ? detectRuntimeProfile(entry.name, source, knownProfiles)
        : undefined;

      if (source.includes("tools/hook-runtime/src/cli.ts") && explicitProfile && !knownProfiles.has(explicitProfile)) {
        warnings.push(`Hook "${entry.name}" references unknown profile "${explicitProfile}" not defined in hooks.yaml.`);
      }

      hookFiles.push({
        name: entry.name,
        relativePath,
        source,
        triggerCommand: extractTriggerCommand(source),
        kind: runtimeProfileName ? "runtime-profile" : "shell-command",
        runtimeProfileName,
        skipEnvVar: source.includes("SKIP_HOOKS") ? "SKIP_HOOKS" : undefined,
      });
    }

    const metricLookup = await loadMetricLookup(repoRoot);
    warnings.push(...metricLookup.warnings);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      repoRoot,
      hooksDir,
      configFile,
      reviewTriggerFile,
      releaseTriggerFile,
      hookFiles,
      profiles: buildProfileSummaries(hookFiles, metricLookup.metrics, hookRuntime.profiles),
      warnings,
    } satisfies HooksResponse);
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "Harness hooks 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "读取 Hook Runtime 失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
