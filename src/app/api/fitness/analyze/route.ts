import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";

const FITNESS_PROFILES = ["generic", "agent_orchestrator"] as const;
const DEFAULT_COMPARE_LAST = true;

type FitnessProfile = (typeof FITNESS_PROFILES)[number];

type ApiProfileStatus = "ok" | "missing" | "error";
type ApiProfileSource = "analysis";

type FitnessProfileResult = {
  profile: FitnessProfile;
  status: ApiProfileStatus;
  source: ApiProfileSource;
  durationMs?: number;
  report?: FitnessReport;
  error?: string;
};

type FitnessAnalyzeResponse = {
  generatedAt: string;
  requestedProfiles: FitnessProfile[];
  profiles: FitnessProfileResult[];
};

type FitnessCommandResult = {
  status: ApiProfileStatus;
  durationMs: number;
  report?: FitnessReport;
  error?: string;
};

type FitnessReport = {
  modelVersion: number;
  modelPath: string;
  profile: FitnessProfile;
  repoRoot: string;
  generatedAt: string;
  snapshotPath: string;
  overallLevel: string;
  overallLevelName: string;
  currentLevelReadiness: number;
  nextLevel?: string | null;
  nextLevelName?: string | null;
  nextLevelReadiness?: number | null;
  blockingTargetLevel?: string | null;
  blockingTargetLevelName?: string | null;
  dimensions: Record<string, FitnessDimensionResult>;
  cells: Array<unknown>;
  criteria: Array<unknown>;
  blockingCriteria: Array<unknown>;
  recommendations: Array<FitnessRecommendation>;
  comparison?: FitnessComparison | null;
};

type FitnessDimensionResult = {
  dimension: string;
  name: string;
  level: string;
  levelName: string;
  levelIndex: number;
  score: number;
  nextLevel?: string | null;
  nextLevelName?: string | null;
  nextLevelProgress?: number | null;
};

type FitnessRecommendation = {
  criterionId: string;
  action: string;
  whyItMatters: string;
  evidenceHint: string;
  critical: boolean;
  weight: number;
};

type FitnessDimensionChange = {
  dimension: string;
  previousLevel: string;
  currentLevel: string;
  change: "same" | "up" | "down";
};

type FitnessCriterionChange = {
  id: string;
  previousStatus?: string;
  currentStatus?: string;
};

type FitnessComparison = {
  previousGeneratedAt: string;
  previousOverallLevel: string;
  overallChange: "same" | "up" | "down";
  dimensionChanges: FitnessDimensionChange[];
  criteriaChanges: FitnessCriterionChange[];
};

type FitnessContext = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
};

type AnalyzePayload = {
  compareLast: boolean;
  noSave: boolean;
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

function isValidProfile(value: string | undefined): value is FitnessProfile {
  return value === "generic" || value === "agent_orchestrator";
}

function normalizeProfiles(raw: unknown): FitnessProfile[] {
  if (!raw || typeof raw !== "object") {
    return ["generic"];
  }

  const payload = raw as {
    runBoth?: boolean;
    profile?: string;
    profiles?: unknown;
  };

  const configured: string[] = [];

  if (Array.isArray(payload.profiles)) {
    for (const profile of payload.profiles) {
      if (typeof profile === "string") configured.push(profile);
    }
  }

  if (configured.length === 0 && payload.profile) {
    configured.push(payload.profile);
  }

  const includeBoth = payload.runBoth === true || payload.runBoth === 1;
  if (includeBoth && configured.length === 0) {
    return [...FITNESS_PROFILES];
  }

  const normalized = configured
    .map((value) => (isValidProfile(value) ? value : undefined))
    .filter((value): value is FitnessProfile => value !== undefined);

  const deduped: FitnessProfile[] = [];
  for (const profile of normalized) {
    if (!deduped.includes(profile)) deduped.push(profile);
  }

  return deduped.length > 0 ? deduped : ["generic"];
}

function parseAnalyzeArgs(body: unknown) {
  const compareLast = body && typeof body === "object" && "compareLast" in body && typeof (body as { compareLast?: unknown }).compareLast === "boolean"
    ? (body as { compareLast?: boolean }).compareLast
    : DEFAULT_COMPARE_LAST;
  const noSave = body && typeof body === "object" && typeof (body as { noSave?: unknown }).noSave === "boolean"
    ? !!(body as { noSave?: boolean }).noSave
    : false;

  return {
    compareLast: compareLast ?? DEFAULT_COMPARE_LAST,
    noSave,
  };
}

function parseAnalyzeContext(body: unknown): FitnessContext {
  if (!body || typeof body !== "object") {
    return {};
  }

  const payload = body as {
    workspaceId?: unknown;
    codebaseId?: unknown;
    repoPath?: unknown;
  };

  return {
    workspaceId: normalizeContextValue(payload.workspaceId),
    codebaseId: normalizeContextValue(payload.codebaseId),
    repoPath: normalizeContextValue(payload.repoPath),
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

  const fromPath = repoPath ? path.resolve(repoPath) : undefined;
  if (fromPath) {
    if (!fs.existsSync(fromPath) || !fs.statSync(fromPath).isDirectory()) {
      throw new Error(`repoPath 不存在或不是目录: ${fromPath}`);
    }
    if (!isRoutaRepoRoot(fromPath)) {
      throw new Error(`repoPath 不是 Routa 仓库: ${fromPath}`);
    }

    return fromPath;
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
    throw new Error("缺少 fitness 分析上下文，请提供 workspaceId / codebaseId / repoPath 之一");
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

function extractJsonOutput(raw: string): string {
  const candidate = raw.trim();
  if (!candidate) {
    throw new Error("Command produced no output");
  }

  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    // Fall back to extracting the last JSON object when logs are printed before JSON.
  }

  const lastOpen = candidate.lastIndexOf("{");
  if (lastOpen < 0) {
    throw new Error("Unable to locate JSON output");
  }

  for (let index = lastOpen; index >= 0; index -= 1) {
    if (candidate[index] !== "{") continue;
    const snippet = candidate.slice(index).trim();
    if (!snippet.endsWith("}")) continue;
    try {
      JSON.parse(snippet);
      return snippet;
    } catch {
      // keep searching
    }
  }

  throw new Error("Unable to parse command JSON output");
}

async function runFitnessProfile(
  repoRoot: string,
  profile: FitnessProfile,
  compareLast: boolean,
  noSave: boolean,
): Promise<FitnessCommandResult> {
  const startTime = Date.now();
  const args = [
    "run",
    "-p",
    "routa-cli",
    "--",
    "fitness",
    "fluency",
    "--format",
    "json",
    "--profile",
    profile,
  ];

  if (compareLast) {
    args.push("--compare-last");
  }
  if (noSave) {
    args.push("--no-save");
  }

  return await new Promise<FitnessCommandResult>((resolve) => {
    const proc = spawn("cargo", args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      resolve({
        status: "error",
        durationMs: Date.now() - startTime,
        error: toMessage(error),
      });
    });

    proc.on("close", (code, signal) => {
      const durationMs = Date.now() - startTime;

      if (signal) {
        resolve({
          status: "error",
          durationMs,
          error: `Command terminated by signal: ${signal}`,
        });
        return;
      }

      if (code !== 0) {
        resolve({
          status: "error",
          durationMs,
          error: `Command failed (exit ${code}): ${stderr || "no stderr output"}`,
        });
        return;
      }

      try {
        const reportText = extractJsonOutput(stdout);
        const report = JSON.parse(reportText) as FitnessReport;
        resolve({
          status: "ok",
          durationMs,
          report,
        });
      } catch (error) {
        resolve({
          status: "error",
          durationMs,
          error: toMessage(error),
        });
      }
    });
  });
}

function isContextError(message: string) {
  return message.includes("缺少 fitness 分析上下文")
    || message.includes("Codebase 未找到")
    || message.includes("Codebase 的路径")
    || message.includes("repoPath")
    || message.includes("Workspace 下没有配置 codebase")
    || message.includes("不是 Routa 仓库")
    || message.includes("不存在或不是目录");
}

function buildResponse(
  profiles: FitnessProfile[],
  payload: AnalyzePayload,
  repoRoot: string,
) {
  const tasks = profiles.map(async (profile) => {
    const result = await runFitnessProfile(repoRoot, profile, payload.compareLast, payload.noSave);
    const entry: FitnessProfileResult = {
      profile,
      source: "analysis",
      status: result.status,
      durationMs: result.durationMs,
    };

    if (result.status === "ok" && result.report) {
      entry.report = result.report;
      return entry;
    }

    entry.error = result.error ?? "分析失败（未知错误）";
    return entry;
  });

  return Promise.all(tasks).then((collected) => ({
    generatedAt: new Date().toISOString(),
    requestedProfiles: profiles,
    profiles: collected,
  }));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);
    const profiles = normalizeProfiles(body);
    const options = parseAnalyzeArgs(body);
    const context = parseAnalyzeContext(body);
    const repoRoot = await resolveRepoRoot(context);

    const payload = await buildResponse(profiles, options, repoRoot);
    return NextResponse.json(payload as FitnessAnalyzeResponse);
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "Fitness 分析上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "Fitness 分析调用失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
