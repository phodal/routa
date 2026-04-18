import { spawn } from "child_process";

import type {
  EntrixDimensionReport,
  EntrixDimensionSummary,
  EntrixMetricFailureSummary,
  EntrixMetricResult,
  EntrixReportData,
  EntrixRunResponse,
  EntrixRunScope,
  EntrixRunSummary,
  EntrixRunTier,
} from "./entrix-run-types";

type EntrixCommandStrategy = "entrix_binary" | "cargo_runner";

type EntrixCommandResult = {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  error?: string;
};

type EntrixMetricRecord = {
  name?: string;
  state?: string;
  passed?: boolean;
  hard_gate?: boolean;
  tier?: string;
  duration_ms?: number;
  output?: string;
};

type EntrixDimensionRecord = {
  name?: string;
  score?: number;
  passed?: number;
  total?: number;
  hard_gate_failures?: string[];
  results?: EntrixMetricRecord[];
};

type EntrixReportRecord = {
  dimensions?: EntrixDimensionRecord[];
  final_score?: number;
  hard_gate_blocked?: boolean;
  score_blocked?: boolean;
};

function trimSnippet(value: string | undefined, maxLength = 240): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function buildEntrixCommandCandidates(
  _tier: EntrixRunTier,
  _scope: EntrixRunScope,
): EntrixCommandStrategy[] {
  return [
    "entrix_binary",
    "cargo_runner",
  ];
}

function buildEntrixArgs(tier: EntrixRunTier, scope: EntrixRunScope): string[] {
  return ["run", "--tier", tier, "--scope", scope, "--json"];
}

function describeEntrixCommand(
  strategy: EntrixCommandStrategy,
  tier: EntrixRunTier,
  scope: EntrixRunScope,
): Pick<EntrixCommandResult, "command" | "args"> {
  const entrixArgs = buildEntrixArgs(tier, scope);
  switch (strategy) {
    case "entrix_binary":
      return { command: "entrix", args: entrixArgs };
    case "cargo_runner":
      return { command: "cargo", args: ["run", "-q", "-p", "entrix", "--", ...entrixArgs] };
  }
}

function extractJsonOutput(raw: string): string {
  const candidate = raw.trim();
  if (!candidate) {
    throw new Error("Entrix command produced no JSON output");
  }

  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    // Fall through and search for the last JSON object.
  }

  const lastOpen = candidate.lastIndexOf("{");
  if (lastOpen < 0) {
    throw new Error("Unable to locate Entrix JSON output");
  }

  for (let index = lastOpen; index >= 0; index -= 1) {
    if (candidate[index] !== "{") continue;
    const snippet = candidate.slice(index).trim();
    if (!snippet.endsWith("}")) continue;
    try {
      JSON.parse(snippet);
      return snippet;
    } catch {
      // Keep searching for a valid JSON object.
    }
  }

  throw new Error("Unable to parse Entrix JSON output");
}

function summarizeFailingMetric(metric: EntrixMetricRecord): EntrixMetricFailureSummary {
  return {
    name: typeof metric.name === "string" ? metric.name : "unknown",
    state: typeof metric.state === "string" ? metric.state : "unknown",
    passed: metric.passed === true,
    hardGate: metric.hard_gate === true,
    tier: typeof metric.tier === "string" ? metric.tier : "unknown",
    durationMs: typeof metric.duration_ms === "number" ? metric.duration_ms : null,
    outputSnippet: trimSnippet(metric.output),
  };
}

function normalizeEntrixMetric(metric: EntrixMetricRecord): EntrixMetricResult {
  return {
    name: typeof metric.name === "string" ? metric.name : "unknown",
    state: typeof metric.state === "string" ? metric.state : "unknown",
    passed: typeof metric.passed === "boolean" ? metric.passed : null,
    hardGate: metric.hard_gate === true,
    tier: typeof metric.tier === "string" ? metric.tier : "unknown",
    durationMs: typeof metric.duration_ms === "number" ? metric.duration_ms : null,
    outputSnippet: trimSnippet(metric.output),
  };
}

function normalizeEntrixDimension(dimension: EntrixDimensionRecord): EntrixDimensionReport {
  const results = Array.isArray(dimension.results) ? dimension.results : [];
  return {
    name: typeof dimension.name === "string" ? dimension.name : "unknown",
    score: typeof dimension.score === "number" ? dimension.score : null,
    passed: typeof dimension.passed === "number" ? dimension.passed : 0,
    total: typeof dimension.total === "number" ? dimension.total : results.length,
    hardGateFailures: Array.isArray(dimension.hard_gate_failures)
      ? dimension.hard_gate_failures.filter((value): value is string => typeof value === "string")
      : [],
    results: results.map(normalizeEntrixMetric),
  };
}

export function normalizeEntrixReport(report: unknown): EntrixReportData {
  const parsed = (report && typeof report === "object" ? report : {}) as EntrixReportRecord;
  const dimensions = Array.isArray(parsed.dimensions) ? parsed.dimensions : [];
  return {
    finalScore: typeof parsed.final_score === "number" ? parsed.final_score : null,
    hardGateBlocked: typeof parsed.hard_gate_blocked === "boolean" ? parsed.hard_gate_blocked : null,
    scoreBlocked: typeof parsed.score_blocked === "boolean" ? parsed.score_blocked : null,
    dimensions: dimensions.map(normalizeEntrixDimension),
  };
}

export function summarizeEntrixReport(report: unknown): EntrixRunSummary {
  const normalized = normalizeEntrixReport(report);
  const summarizedDimensions: EntrixDimensionSummary[] = normalized.dimensions
    .map((dimension) => ({
      name: dimension.name,
      score: dimension.score,
      passed: dimension.passed,
      total: dimension.total,
      hardGateFailures: dimension.hardGateFailures,
      failingMetrics: dimension.results
        .filter((metric) => metric.passed !== true)
        .map((metric) => summarizeFailingMetric({
          name: metric.name,
          state: metric.state,
          passed: metric.passed === true,
          hard_gate: metric.hardGate,
          tier: metric.tier,
          duration_ms: metric.durationMs ?? undefined,
          output: metric.outputSnippet ?? undefined,
        }))
        .slice(0, 6),
    }))
    .sort((left, right) => right.failingMetrics.length - left.failingMetrics.length);

  const metricCount = normalized.dimensions.reduce((sum, dimension) => sum + dimension.total, 0);
  const failingMetricCount = summarizedDimensions.reduce(
    (sum, dimension) => sum + dimension.failingMetrics.length,
    0,
  );

  const allMetrics = normalized.dimensions.flatMap((d) => d.results);
  const slowestMetricMs = allMetrics.length > 0
    ? Math.max(...allMetrics.map((m) => m.durationMs ?? 0))
    : null;
  const passRate = metricCount > 0
    ? (metricCount - failingMetricCount) / metricCount
    : 1.0;

  return {
    finalScore: normalized.finalScore,
    hardGateBlocked: normalized.hardGateBlocked,
    scoreBlocked: normalized.scoreBlocked,
    dimensionCount: summarizedDimensions.length,
    metricCount,
    failingMetricCount,
    dimensions: summarizedDimensions.slice(0, 8),
    slowestMetricMs,
    checksCount: metricCount,
    failedChecks: failingMetricCount,
    passRate: Math.round(passRate * 10000) / 10000,
  };
}

async function runEntrixCommand(
  strategy: EntrixCommandStrategy,
  tier: EntrixRunTier,
  scope: EntrixRunScope,
  repoRoot: string,
): Promise<EntrixCommandResult> {
  const startedAt = Date.now();
  const invocation = describeEntrixCommand(strategy, tier, scope);

  return await new Promise<EntrixCommandResult>((resolve) => {
    // Keep child-process execution on a strict allowlist so callers cannot
    // influence the spawned binary or shell behavior.
    const child = strategy === "entrix_binary"
      ? spawn("entrix", buildEntrixArgs(tier, scope), {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 300_000,
      })
      : spawn("cargo", ["run", "-q", "-p", "entrix", "--", ...buildEntrixArgs(tier, scope)], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 300_000,
      });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        command: invocation.command,
        args: invocation.args,
        stdout,
        stderr,
        exitCode: null,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    child.on("close", (code) => {
      resolve({
        command: invocation.command,
        args: invocation.args,
        stdout,
        stderr,
        exitCode: typeof code === "number" ? code : null,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

export async function executeEntrixRun(params: {
  repoRoot: string;
  tier: EntrixRunTier;
  scope: EntrixRunScope;
}): Promise<EntrixRunResponse> {
  const candidates = buildEntrixCommandCandidates(params.tier, params.scope);
  let lastError = "Entrix command did not start";

  for (const candidate of candidates) {
    const result = await runEntrixCommand(candidate, params.tier, params.scope, params.repoRoot);
    const missingBinary = result.error?.includes("ENOENT") ?? false;
    if (missingBinary) {
      lastError = result.error ?? lastError;
      continue;
    }

    try {
      const jsonOutput = extractJsonOutput(result.stdout);
      const report = JSON.parse(jsonOutput) as unknown;
      const normalizedReport = normalizeEntrixReport(report);
      const summary = summarizeEntrixReport(normalizedReport);
      return {
        generatedAt: new Date().toISOString(),
        repoRoot: params.repoRoot,
        tier: params.tier,
        scope: params.scope,
        command: result.command,
        args: result.args,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        report: normalizedReport,
        summary: { ...summary, durationMs: result.durationMs },
      };
    } catch (error) {
      const details = result.stderr.trim() || result.stdout.trim() || result.error;
      throw new Error(
        [
          `Entrix run failed for ${result.command}`,
          error instanceof Error ? error.message : String(error),
          details ? `details: ${details}` : null,
        ].filter(Boolean).join(" | "),
        { cause: error },
      );
    }
  }

  throw new Error(lastError);
}

export { extractJsonOutput };
