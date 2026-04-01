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

type MetricSummary = {
  name: string;
  command: string;
  description: string;
  tier: string;
  hardGate: boolean;
  gate: string;
  runner: "shell" | "graph" | "sarif";
  pattern?: string;
  evidenceType?: string;
  scope: string[];
  runWhenChanged: string[];
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
  return normalizeFitnessContextValue(value);
}

function parseContext(searchParams: URLSearchParams): FitnessContext {
  return {
    workspaceId: normalizeContextValue(searchParams.get("workspaceId")),
    codebaseId: normalizeContextValue(searchParams.get("codebaseId")),
    repoPath: normalizeContextValue(searchParams.get("repoPath")),
  };
}

function isContextError(message: string) {
  return isFitnessContextError(message);
}

function mapRunner(metric: Record<string, unknown>): "shell" | "graph" | "sarif" {
  const evidenceType = typeof metric.evidence_type === "string" ? metric.evidence_type : "";
  const command = typeof metric.command === "string" ? metric.command : "";

  if (evidenceType === "sarif") return "sarif";
  if (command.startsWith("graph:")) return "graph";
  return "shell";
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

function parseManifestEvidenceEntries(raw: string): string[] {
  try {
    const parsedEvidenceManifest = (yaml.load(raw) ?? {}) as { evidence_files?: unknown };
    return Array.isArray(parsedEvidenceManifest.evidence_files)
      ? parsedEvidenceManifest.evidence_files.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
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

    if (!entry.isFile()) continue;
    if (isFluencyModelSpec(entry.name)) continue;
    if (!nextRelativePath.endsWith(".md") && !nextRelativePath.endsWith(".yaml") && !nextRelativePath.endsWith(".yml")) {
      continue;
    }

    files.push({ relativePath: nextRelativePath, fullPath });
  }

  return files;
}

function parseMarkdownSpec(relativePath: string, raw: string): FitnessSpecSummary {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const metrics = Array.isArray(data.metrics) ? data.metrics : [];
  const frontmatterSource = extractFrontmatterSource(raw);

  if (relativePath === "README.md") {
    return {
      name: relativePath,
      relativePath,
      kind: "rulebook",
      language: "markdown",
      metricCount: 0,
      metrics: [],
      source: raw,
      frontmatterSource,
    };
  }

  if (metrics.length === 0) {
    return {
      name: relativePath,
      relativePath,
      kind: "narrative",
      language: "markdown",
      metricCount: 0,
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
    metricCount: metrics.length,
    metrics: metrics.map((rawMetric, index) => {
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
        pattern: typeof metric.pattern === "string" ? metric.pattern : undefined,
        evidenceType: typeof metric.evidence_type === "string" ? metric.evidence_type : undefined,
        scope: normalizeStringList(metric.scope),
        runWhenChanged: normalizeStringList(metric.run_when_changed),
      };
    }),
    source: raw,
    frontmatterSource,
  };
}

function parseManifestSpec(relativePath: string, raw: string): FitnessSpecSummary {
  const manifestEntries = parseManifestEvidenceEntries(raw);

  return {
    name: relativePath,
    relativePath,
    kind: "manifest",
    language: "yaml",
    metricCount: manifestEntries.length,
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
    metrics: [],
    source: raw,
  };
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveFitnessRepoRoot(context);
    const fitnessDir = path.join(repoRoot, "docs", "fitness");
    const files: FitnessSpecSummary[] = [];
    let manifestSpec: FitnessSpecSummary | null = null;
    const byPath = new Map<string, FitnessSpecSummary>();

    const fitnessFiles = await collectFitnessFiles(fitnessDir);
    for (const file of fitnessFiles) {
      const raw = await fsp.readFile(file.fullPath, "utf-8");

      if (file.relativePath.endsWith(".md")) {
        const spec = parseMarkdownSpec(file.relativePath, raw);
        files.push(spec);
        byPath.set(spec.relativePath, spec);
        byPath.set(`docs/fitness/${spec.relativePath}`, spec);
        continue;
      }

      if (file.relativePath.endsWith(".yaml") || file.relativePath.endsWith(".yml")) {
        const spec = path.posix.basename(file.relativePath) === "manifest.yaml"
          ? parseManifestSpec(file.relativePath, raw)
          : parseNonMarkdownSpec(file.relativePath, raw);
        files.push(spec);
        byPath.set(spec.relativePath, spec);
        byPath.set(`docs/fitness/${spec.relativePath}`, spec);
        if (path.posix.basename(file.relativePath) === "manifest.yaml") {
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
