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

type MetricSummary = {
  name: string;
  command: string;
  description: string;
  tier: string;
  hardGate: boolean;
  gate: string;
  runner: "shell" | "graph" | "sarif";
  group?: string;
  pattern?: string;
  evidenceType?: string;
  scope: string[];
  runWhenChanged: string[];
};

type MetricGroupSummary = {
  key: string;
  name: string;
  description: string;
  weight: number;
  metricCount: number;
  hardGateCount: number;
  runnerCounts: Record<"shell" | "graph" | "sarif", number>;
};

type FitnessSpecSummary = {
  name: string;
  relativePath: string;
  kind: "rulebook" | "manifest" | "dimension" | "narrative" | "policy";
  language: "markdown" | "yaml";
  dimension?: string;
  weight?: number;
  thresholdPass?: number;
  thresholdWarn?: number;
  metricCount: number;
  groups: MetricGroupSummary[];
  metrics: MetricSummary[];
  source: string;
  frontmatterSource?: string;
  manifestEntries?: string[];
};

type FitnessSpecsResponse = {
  generatedAt: string;
  repoRoot: string;
  fitnessDir: string;
  files: FitnessSpecSummary[];
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

function mapRunner(metric: Record<string, unknown>): "shell" | "graph" | "sarif" {
  const evidenceType = typeof metric.evidence_type === "string" ? metric.evidence_type : "";
  const command = typeof metric.command === "string" ? metric.command : "";

  if (evidenceType === "sarif") return "sarif";
  if (command.startsWith("graph:")) return "graph";
  return "shell";
}

function createRunnerCounts(): Record<"shell" | "graph" | "sarif", number> {
  return { shell: 0, graph: 0, sarif: 0 };
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function extractFrontmatterSource(raw: string): string | undefined {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  return match ? `---\n${match[1]}\n---` : undefined;
}

function isFluencyModelSpec(relativePath: string): boolean {
  return /^harness-fluency(\.profile\.[^.]+|\.model)?\.ya?ml$/u.test(relativePath);
}

type RawMetricGroup = {
  key: string;
  name: string;
  description: string;
  weight: number;
};

function normalizeMetricGroups(rawGroups: unknown): RawMetricGroup[] {
  return Array.isArray(rawGroups)
    ? rawGroups.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const value = entry as Record<string, unknown>;
      const key = typeof value.key === "string" ? value.key.trim() : "";
      if (!key) return [];
      return [{
        key,
        name: typeof value.name === "string" && value.name.trim().length > 0 ? value.name.trim() : key,
        description: typeof value.description === "string" ? value.description : "",
        weight: typeof value.weight === "number" ? value.weight : 0,
      }];
    })
    : [];
}

function buildMetricGroups(groupDefinitions: RawMetricGroup[], metrics: MetricSummary[]): MetricGroupSummary[] {
  const groups = new Map<string, MetricGroupSummary>();

  for (const definition of groupDefinitions) {
    groups.set(definition.key, {
      key: definition.key,
      name: definition.name,
      description: definition.description,
      weight: definition.weight,
      metricCount: 0,
      hardGateCount: 0,
      runnerCounts: createRunnerCounts(),
    });
  }

  for (const metric of metrics) {
    const rawKey = typeof metric.group === "string" ? metric.group.trim() : "";
    const key = rawKey || "ungrouped";
    const current = groups.get(key) ?? {
      key,
      name: key === "ungrouped" ? "Ungrouped" : key,
      description: "",
      weight: 0,
      metricCount: 0,
      hardGateCount: 0,
      runnerCounts: createRunnerCounts(),
    };

    current.metricCount += 1;
    current.runnerCounts[metric.runner] += 1;
    if (metric.hardGate) {
      current.hardGateCount += 1;
    }
    groups.set(key, current);
  }

  return [...groups.values()].sort((left, right) => {
    if (left.weight !== right.weight) {
      return right.weight - left.weight;
    }
    if (left.metricCount !== right.metricCount) {
      return right.metricCount - left.metricCount;
    }
    return left.name.localeCompare(right.name);
  });
}

async function collectFitnessFiles(
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
      files.push(...await collectFitnessFiles(rootDir, nextRelativePath));
      continue;
    }
    files.push({ relativePath: nextRelativePath, fullPath });
  }

  return files;
}

function parseMarkdownSpec(relativePath: string, raw: string): FitnessSpecSummary {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const rawMetrics = Array.isArray(data.metrics) ? data.metrics : [];
  const frontmatterSource = extractFrontmatterSource(raw);
  const groups = normalizeMetricGroups(data.groups);
  const metricSummaries = rawMetrics.map((rawMetric, index) => {
    const metric = (rawMetric && typeof rawMetric === "object" ? rawMetric : {}) as Record<string, unknown>;
    const hardGate = metric.hard_gate === true;
    const gate = typeof metric.gate === "string" ? metric.gate : (hardGate ? "hard" : "soft");
    return {
      name: typeof metric.name === "string" ? metric.name : `metric-${index + 1}`,
      command: typeof metric.command === "string" ? metric.command : "",
      description: typeof metric.description === "string" ? metric.description : "",
      tier: typeof metric.tier === "string" ? metric.tier : "normal",
      hardGate,
      gate,
      runner: mapRunner(metric),
      group: typeof metric.group === "string" ? metric.group : undefined,
      pattern: typeof metric.pattern === "string" ? metric.pattern : undefined,
      evidenceType: typeof metric.evidence_type === "string" ? metric.evidence_type : undefined,
      scope: normalizeStringList(metric.scope),
      runWhenChanged: normalizeStringList(metric.run_when_changed),
    } satisfies MetricSummary;
  });

  if (relativePath === "README.md") {
    return {
      name: relativePath,
      relativePath,
      kind: "rulebook",
      language: "markdown",
      metricCount: 0,
      groups: [],
      metrics: [],
      source: raw,
      frontmatterSource,
    };
  }

  if (metricSummaries.length === 0) {
    return {
      name: relativePath,
      relativePath,
      kind: "narrative",
      language: "markdown",
      metricCount: 0,
      groups: [],
      metrics: [],
      source: raw,
      frontmatterSource,
    };
  }

  return {
    name: relativePath,
    relativePath,
    kind: "dimension",
    language: "markdown",
    dimension: typeof data.dimension === "string" ? data.dimension : "unknown",
    weight: typeof data.weight === "number" ? data.weight : 0,
    thresholdPass: typeof data.threshold === "object" && data.threshold && typeof (data.threshold as { pass?: unknown }).pass === "number"
      ? (data.threshold as { pass: number }).pass
      : 90,
    thresholdWarn: typeof data.threshold === "object" && data.threshold && typeof (data.threshold as { warn?: unknown }).warn === "number"
      ? (data.threshold as { warn: number }).warn
      : 80,
    metricCount: metricSummaries.length,
    metrics: metricSummaries,
    groups: buildMetricGroups(groups, metricSummaries),
    source: raw,
    frontmatterSource,
  };
}

function parseManifestSpec(relativePath: string, raw: string): FitnessSpecSummary {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const manifestEntries = Array.isArray(data.evidence_files)
    ? data.evidence_files.filter((item): item is string => typeof item === "string")
    : [];

  return {
    name: relativePath,
    relativePath,
    kind: "manifest",
    language: "yaml",
    metricCount: manifestEntries.length,
    groups: [],
    metrics: [],
    source: raw,
    manifestEntries,
  };
}

function parseNonMarkdownSpec(relativePath: string, raw: string): FitnessSpecSummary {
  return {
    name: relativePath,
    relativePath,
    kind: "policy",
    language: "yaml",
    metricCount: 0,
    groups: [],
    metrics: [],
    source: raw,
  };
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    const fitnessDir = path.join(repoRoot, "docs", "fitness");
    const files: FitnessSpecSummary[] = [];
    let manifestSpec: FitnessSpecSummary | null = null;
    const byPath = new Map<string, FitnessSpecSummary>();

    for (const file of await collectFitnessFiles(fitnessDir)) {
      if (isFluencyModelSpec(file.relativePath)) continue;

      if (file.relativePath.endsWith(".md")) {
        const raw = await fsp.readFile(file.fullPath, "utf-8");
        const spec = parseMarkdownSpec(file.relativePath, raw);
        files.push(spec);
        byPath.set(spec.relativePath, spec);
        byPath.set(`docs/fitness/${spec.relativePath}`, spec);
        continue;
      }

      if (file.relativePath.endsWith(".yaml") || file.relativePath.endsWith(".yml")) {
        const raw = await fsp.readFile(file.fullPath, "utf-8");
        const spec = file.relativePath === "manifest.yaml"
          ? parseManifestSpec(file.relativePath, raw)
          : parseNonMarkdownSpec(file.relativePath, raw);
        files.push(spec);
        byPath.set(spec.relativePath, spec);
        byPath.set(`docs/fitness/${spec.relativePath}`, spec);
        if (file.relativePath === "manifest.yaml") {
          manifestSpec = spec;
        }
      }
    }

    const ordered: FitnessSpecSummary[] = [];
    const seen = new Set<string>();
    const push = (spec: FitnessSpecSummary | undefined | null) => {
      if (!spec || seen.has(spec.relativePath)) return;
      seen.add(spec.relativePath);
      ordered.push(spec);
    };

    push(byPath.get("README.md"));
    push(manifestSpec);

    for (const entry of manifestSpec?.manifestEntries ?? []) {
      push(byPath.get(entry));
    }

    for (const spec of files) {
      push(spec);
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      repoRoot,
      fitnessDir,
      files: ordered,
    } satisfies FitnessSpecsResponse);
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "Fitness specs 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "读取 Fitness specs 失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
