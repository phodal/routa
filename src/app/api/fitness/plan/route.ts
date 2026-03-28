import * as fs from "fs";
import { promises as fsp } from "fs";
import matter from "gray-matter";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";

type FitnessContext = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
};

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
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

function isRoutaRepoRoot(repoRoot: string): boolean {
  return (
    fs.existsSync(path.join(repoRoot, "docs", "fitness", "harness-fluency.model.yaml"))
    && fs.existsSync(path.join(repoRoot, "crates", "routa-cli"))
  );
}

async function resolveRepoRoot(context: FitnessContext): Promise<string> {
  const workspaceId = normalizeContextValue(context.workspaceId);
  const codebaseId = normalizeContextValue(context.codebaseId);
  const repoPath = normalizeContextValue(context.repoPath);
  const system = getRoutaSystem();

  const directPath = repoPath ? path.resolve(repoPath) : undefined;
  if (directPath) {
    if (!fs.existsSync(directPath) || !fs.statSync(directPath).isDirectory()) {
      throw new Error(`repoPath 不存在或不是目录: ${directPath}`);
    }
    if (!isRoutaRepoRoot(directPath)) {
      throw new Error(`repoPath 不是 Routa 仓库: ${directPath}`);
    }
    return directPath;
  }

  if (codebaseId) {
    const codebase = await system.codebaseStore.get(codebaseId);
    if (!codebase) {
      throw new Error(`Codebase 未找到: ${codebaseId}`);
    }

    const candidate = path.resolve(codebase.repoPath);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      throw new Error(`Codebase 的路径不存在或不是目录: ${candidate}`);
    }
    if (!isRoutaRepoRoot(candidate)) {
      throw new Error(`Codebase 的路径不是 Routa 仓库: ${candidate}`);
    }
    return candidate;
  }

  if (!workspaceId) {
    throw new Error("缺少 fitness 上下文，请提供 workspaceId / codebaseId / repoPath 之一");
  }

  const codebases = await system.codebaseStore.listByWorkspace(workspaceId);
  if (codebases.length === 0) {
    throw new Error(`Workspace 下没有配置 codebase: ${workspaceId}`);
  }

  const fallback = codebases.find((codebase) => codebase.isDefault) ?? codebases[0];
  const candidate = path.resolve(fallback.repoPath);

  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error(`默认 codebase 的路径不存在或不是目录: ${candidate}`);
  }
  if (!isRoutaRepoRoot(candidate)) {
    throw new Error(`默认 codebase 的路径不是 Routa 仓库: ${candidate}`);
  }

  return candidate;
}

function isContextError(message: string) {
  return message.includes("缺少 fitness 上下文")
    || message.includes("Codebase 未找到")
    || message.includes("Codebase 的路径")
    || message.includes("repoPath")
    || message.includes("Workspace 下没有配置 codebase")
    || message.includes("不是 Routa 仓库")
    || message.includes("不存在或不是目录");
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

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const tier = parseTier(request.nextUrl.searchParams.get("tier"));
    const scope = parseScope(request.nextUrl.searchParams.get("scope"));
    const repoRoot = await resolveRepoRoot(context);
    const fitnessDir = path.join(repoRoot, "docs", "fitness");
    const entries = await fsp.readdir(fitnessDir, { withFileTypes: true });
    const dimensions: PlannedDimension[] = [];
    const runnerCounts: Record<RunnerKind, number> = { shell: 0, graph: 0, sarif: 0 };
    let metricCount = 0;
    let hardGateCount = 0;

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "README.md" || entry.name === "REVIEW.md") {
        continue;
      }

      const fullPath = path.join(fitnessDir, entry.name);
      const raw = await fsp.readFile(fullPath, "utf-8");
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
        name: typeof data.dimension === "string" ? data.dimension : entry.name.replace(/\.md$/, ""),
        weight: typeof data.weight === "number" ? data.weight : 0,
        thresholdPass: typeof threshold.pass === "number" ? threshold.pass : 90,
        thresholdWarn: typeof threshold.warn === "number" ? threshold.warn : 80,
        sourceFile: entry.name,
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
