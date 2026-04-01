import * as fs from "fs";
import { promises as fsp } from "fs";
import matter from "gray-matter";
import yaml from "js-yaml";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  type FitnessContext,
  isFitnessContextError,
  normalizeFitnessContextValue,
  resolveFitnessRepoRoot,
} from "@/core/fitness/repo-root";

type RunnerKind = "shell" | "graph" | "sarif";
type TierValue = "fast" | "normal" | "deep";
type ScopeValue = "local" | "ci" | "staging" | "prod_observation";

type PlannedMetric = {
  name: string;
  command: string;
  description: string;
  tier: TierValue;
  gate: string;
  hardGate: boolean;
  runner: RunnerKind;
  executionScope: ScopeValue;
};

type PlannedDimension = {
  name: string;
  weight: number;
  thresholdPass: number;
  thresholdWarn: number;
  sourceFile: string;
  metrics: PlannedMetric[];
};

type FitnessPlanResponse = {
  generatedAt: string;
  tier: TierValue;
  scope: ScopeValue;
  repoRoot: string;
  dimensionCount: number;
  metricCount: number;
  hardGateCount: number;
  runnerCounts: Record<RunnerKind, number>;
  dimensions: PlannedDimension[];
};

const TIER_ORDER: Record<TierValue, number> = {
  fast: 0,
  normal: 1,
  deep: 2,
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeContextValue(value: unknown): string | undefined {
  return normalizeFitnessContextValue(value);
}

function parseContext(searchParams: URLSearchParams): FitnessContext {
  return {
    workspaceId: normalizeContextValue(searchParams.get("workspaceId")),
    codebaseId: normalizeContextValue(searchParams.get("codebaseId")),
    repoPath: normalizeContextValue(searchParams.get("repoPath")),
  };
}

function parseTier(value: string | null): TierValue {
  return value === "fast" || value === "normal" || value === "deep" ? value : "normal";
}

function parseScope(value: string | null): ScopeValue {
  return value === "local" || value === "ci" || value === "staging" || value === "prod_observation"
    ? value
    : "local";
}

function isContextError(message: string) {
  return isFitnessContextError(message);
}

function mapRunner(metric: Record<string, unknown>): RunnerKind {
  const evidenceType = typeof metric.evidence_type === "string" ? metric.evidence_type : "";
  const command = typeof metric.command === "string" ? metric.command : "";

  if (evidenceType === "sarif") return "sarif";
  if (command.startsWith("graph:")) return "graph";
  return "shell";
}

function tierPasses(metricTier: TierValue, filterTier: TierValue) {
  return TIER_ORDER[metricTier] <= TIER_ORDER[filterTier];
}

function normalizeMetric(rawMetric: unknown): PlannedMetric {
  const metric = (rawMetric && typeof rawMetric === "object" ? rawMetric : {}) as Record<string, unknown>;
  const hardGate = metric.hard_gate === true;
  const tier = typeof metric.tier === "string" && metric.tier in TIER_ORDER
    ? metric.tier as TierValue
    : "normal";
  const executionScope = metric.execution_scope === "ci"
    || metric.execution_scope === "staging"
    || metric.execution_scope === "prod_observation"
    ? metric.execution_scope
    : "local";

  return {
    name: typeof metric.name === "string" ? metric.name : "unknown",
    command: typeof metric.command === "string" ? metric.command : "",
    description: typeof metric.description === "string" ? metric.description : "",
    tier,
    gate: typeof metric.gate === "string" ? metric.gate : (hardGate ? "hard" : "soft"),
    hardGate,
    runner: mapRunner(metric),
    executionScope,
  };
}

function parseManifestEntries(raw: string): string[] {
  try {
    const parsedManifestYaml = (yaml.load(raw) ?? {}) as { evidence_files?: unknown };
    return Array.isArray(parsedManifestYaml.evidence_files)
      ? parsedManifestYaml.evidence_files.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

async function collectFitnessMarkdownFiles(
  rootDir: string,
  relativeDir = "",
): Promise<Array<{ relativePath: string; fullPath: string }>> {
  const currentDir = relativeDir ? path.join(rootDir, relativeDir) : rootDir;
  const entries = await fsp.readdir(currentDir, { withFileTypes: true });
  const files: Array<{ relativePath: string; fullPath: string }> = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const nextRelativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectFitnessMarkdownFiles(rootDir, nextRelativePath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!nextRelativePath.endsWith(".md") || entry.name === "README.md" || entry.name === "REVIEW.md") {
      continue;
    }

    files.push({ relativePath: nextRelativePath, fullPath });
  }

  return files;
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const tier = parseTier(request.nextUrl.searchParams.get("tier"));
    const scope = parseScope(request.nextUrl.searchParams.get("scope"));
    const repoRoot = await resolveFitnessRepoRoot(context);
    const fitnessDir = path.join(repoRoot, "docs", "fitness");
    const markdownByPath = new Map<string, { name: string; raw: string }>();
    let manifestEntries: string[] = [];

    const manifestPath = path.join(fitnessDir, "manifest.yaml");
    if (fs.existsSync(manifestPath)) {
      manifestEntries = parseManifestEntries(await fsp.readFile(manifestPath, "utf-8"));
    }

    const markdownFiles = await collectFitnessMarkdownFiles(fitnessDir);
    for (const file of markdownFiles) {
      const raw = await fsp.readFile(file.fullPath, "utf-8");
      markdownByPath.set(file.relativePath, { name: file.relativePath, raw });
      markdownByPath.set(`docs/fitness/${file.relativePath}`, { name: file.relativePath, raw });
    }

    const orderedMarkdown = new Map<string, { name: string; raw: string }>();
    for (const manifestEntry of manifestEntries) {
      const file = markdownByPath.get(manifestEntry);
      if (file) {
        orderedMarkdown.set(file.name, file);
      }
    }
    for (const [key, file] of markdownByPath.entries()) {
      if (!key.startsWith("docs/fitness/")) {
        orderedMarkdown.set(file.name, file);
      }
    }

    const dimensions: PlannedDimension[] = [];
    const runnerCounts: Record<RunnerKind, number> = { shell: 0, graph: 0, sarif: 0 };
    let metricCount = 0;
    let hardGateCount = 0;

    for (const { name, raw } of orderedMarkdown.values()) {
      const parsed = matter(raw);
      const data = parsed.data as Record<string, unknown>;
      const rawMetrics = Array.isArray(data.metrics) ? data.metrics : [];
      if (rawMetrics.length === 0) {
        continue;
      }

      const metrics = rawMetrics
        .map(normalizeMetric)
        .filter((metric) => tierPasses(metric.tier, tier) && metric.executionScope === scope);

      if (metrics.length === 0) {
        continue;
      }

      for (const metric of metrics) {
        runnerCounts[metric.runner] += 1;
        metricCount += 1;
        if (metric.hardGate) {
          hardGateCount += 1;
        }
      }

      const threshold = (data.threshold && typeof data.threshold === "object" ? data.threshold : {}) as { pass?: unknown; warn?: unknown };
      dimensions.push({
        name: typeof data.dimension === "string" ? data.dimension : name.replace(/\.md$/, ""),
        weight: typeof data.weight === "number" ? data.weight : 0,
        thresholdPass: typeof threshold.pass === "number" ? threshold.pass : 90,
        thresholdWarn: typeof threshold.warn === "number" ? threshold.warn : 80,
        sourceFile: name,
        metrics,
      });
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      tier,
      scope,
      repoRoot,
      dimensionCount: dimensions.length,
      metricCount,
      hardGateCount,
      runnerCounts,
      dimensions,
    } satisfies FitnessPlanResponse);
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "Fitness plan 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "构建 Fitness plan 失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
