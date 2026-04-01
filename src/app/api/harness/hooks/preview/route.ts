import { NextRequest, NextResponse } from "next/server";
import { getServerBridge } from "@/core/platform";
import {
  isContextError,
  parseContext,
  resolveRepoRoot,
  type HookProfileName,
  type RuntimePhase,
} from "../shared";

type PreviewMode = "dry-run" | "live";

type PhasePreview = {
  phase: RuntimePhase;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  reason?: string;
  message?: string;
  metrics?: string[];
  index?: number;
  total?: number;
};

type MetricPreview = {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  exitCode?: number;
  command?: string;
  sourceFile?: string;
  outputTail?: string;
};

type HookPreviewResponse = {
  generatedAt: string;
  repoRoot: string;
  profile: HookProfileName;
  mode: PreviewMode;
  ok: boolean;
  exitCode: number;
  command: string[];
  phaseResults: PhasePreview[];
  metricResults: MetricPreview[];
  eventSample: Record<string, unknown>[];
  stderr: string;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseMode(value: string | null): PreviewMode {
  return value === "live" ? "live" : "dry-run";
}

function parseJsonLines(raw: string): Record<string, unknown>[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed && typeof parsed === "object" ? [parsed as Record<string, unknown>] : [];
      } catch {
        return [];
      }
    });
}

function asRuntimePhase(value: unknown): RuntimePhase | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asStatus(value: unknown): "passed" | "failed" | "skipped" | null {
  return value === "passed" || value === "failed" || value === "skipped" ? value : null;
}

function toPhaseResults(events: Record<string, unknown>[]): PhasePreview[] {
  return events.flatMap((event) => {
    const kind = typeof event.event === "string" ? event.event : "";
    if (kind !== "phase.complete" && kind !== "phase.skip") {
      return [];
    }

    const phase = asRuntimePhase(event.phase);
    const status = asStatus(event.status);
    if (!phase || !status) {
      return [];
    }

    return [{
      phase,
      status,
      durationMs: typeof event.durationMs === "number" ? event.durationMs : 0,
      reason: typeof event.reason === "string" ? event.reason : undefined,
      message: typeof event.message === "string" ? event.message : undefined,
      metrics: Array.isArray(event.metrics) ? event.metrics.filter((value): value is string => typeof value === "string") : undefined,
      index: typeof event.index === "number" ? event.index : undefined,
      total: typeof event.total === "number" ? event.total : undefined,
    }];
  });
}

function toMetricResults(events: Record<string, unknown>[]): MetricPreview[] {
  return events.reduce<MetricPreview[]>((results, event) => {
    const kind = typeof event.event === "string" ? event.event : "";
    if (kind === "metric.complete") {
      const name = typeof event.name === "string" ? event.name : null;
      if (!name) {
        return results;
      }
      results.push({
        name,
        status: event.passed === true ? "passed" : "failed",
        durationMs: typeof event.durationMs === "number" ? event.durationMs : undefined,
        exitCode: typeof event.exitCode === "number" ? event.exitCode : undefined,
        command: typeof event.command === "string" ? event.command : undefined,
        sourceFile: typeof event.sourceFile === "string" ? event.sourceFile : undefined,
        outputTail: typeof event.outputTail === "string" ? event.outputTail : undefined,
      });
      return results;
    }

    if (kind === "metric.skip" && Array.isArray(event.metrics)) {
      for (const name of event.metrics.filter((value): value is string => typeof value === "string")) {
        results.push({
          name,
          status: "skipped",
        });
      }
    }

    return results;
  }, []);
}

async function runHookPreview(repoRoot: string, profile: HookProfileName, mode: PreviewMode): Promise<HookPreviewResponse> {
  const bridge = getServerBridge();
  const command = [
    "--import",
    "tsx",
    "tools/hook-runtime/src/cli.ts",
    "run",
    "--profile",
    profile,
    "--output",
    "jsonl",
    "--allow-review-unavailable",
    "--tail-lines",
    "20",
  ];

  if (mode === "dry-run") {
    command.push("--dry-run");
  }

  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const child = bridge.process.spawn("node", command, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (exitCode) => {
      resolve({
        stdout,
        stderr,
        exitCode: typeof exitCode === "number" ? exitCode : 1,
      });
    });
  });

  const events = parseJsonLines(result.stdout);
  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    profile,
    mode,
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    command: ["node", ...command],
    phaseResults: toPhaseResults(events),
    metricResults: toMetricResults(events),
    eventSample: events.slice(-20),
    stderr: result.stderr.trim(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const profile = request.nextUrl.searchParams.get("profile");
    const mode = parseMode(request.nextUrl.searchParams.get("mode"));

    if (typeof profile !== "string" || profile.trim().length === 0) {
      return NextResponse.json(
        { error: "缺少或无效的 profile" },
        { status: 400 },
      );
    }

    const repoRoot = await resolveRepoRoot(context);
    const preview = await runHookPreview(repoRoot, profile, mode);
    return NextResponse.json(preview);
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "Harness hook preview 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "执行 Hook Runtime preview 失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
