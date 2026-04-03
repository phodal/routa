import { spawn } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import {
  isFitnessContextError,
  normalizeFitnessContextValue,
  resolveFitnessRepoRoot,
  type FitnessContext,
} from "@/core/fitness/repo-root";

const FITNESS_PROFILES = ["generic", "agent_orchestrator"] as const;
const FITNESS_MODES = ["deterministic", "hybrid", "ai"] as const;
const DEFAULT_COMPARE_LAST = true;
const DEFAULT_MODE = "deterministic";

type FitnessProfile = (typeof FITNESS_PROFILES)[number];
type FitnessMode = (typeof FITNESS_MODES)[number];

type ApiProfileStatus = "ok" | "missing" | "error";
type ApiProfileSource = "analysis";

type FitnessProfileResult = {
  profile: FitnessProfile;
  status: ApiProfileStatus;
  source: ApiProfileSource;
  durationMs?: number;
  report?: FitnessReport;
  console?: FitnessConsole;
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
  console: FitnessConsole;
  error?: string;
};

type FitnessConsole = {
  command: string;
  args: string[];
  data: string;
  stdout: string;
  stderr: string;
  reportText?: string;
  exitCode?: number | null;
  signal?: string | null;
};

type FitnessReport = {
  modelVersion: number;
  modelPath: string;
  profile: FitnessProfile;
  mode?: string;
  framing?: "harness_fluency" | "harnessability";
  termMapping?: FitnessTermMapping;
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
  capabilityGroups?: Record<string, unknown>;
  evidencePacks?: Array<unknown>;
  cells: Array<unknown>;
  criteria: Array<unknown>;
  blockingCriteria: Array<unknown>;
  recommendations: Array<FitnessRecommendation>;
  topPrioritizedActions?: Array<FitnessRecommendation>;
  dominantMissingDimensions?: Array<FitnessMissingDimensionInsight>;
  autonomyRecommendation?: FitnessAutonomyRecommendation;
  lifecycleSensorPlacement?: FitnessLifecycleSensorPlacement;
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

type FitnessTermMapping = {
  internalTerm: string;
  publicTerm: string;
  activeTerm: string;
};

type FitnessMissingDimensionInsight = {
  dimension: string;
  name: string;
  failingCriteria: number;
  criticalFailures: number;
  failedWeight: number;
  blockingFailures: number;
};

type FitnessAutonomyRecommendation = {
  band: "low" | "medium" | "high";
  rationale: string;
};

type FitnessSensorPlacementTierSummary = {
  applicableCriteria: number;
  passingCriteria: number;
  failingCriteria: number;
  criticalFailures: number;
  evidenceModes?: Record<string, number>;
};

type FitnessLifecycleSensorPlacement = {
  fast: FitnessSensorPlacementTierSummary;
  normal: FitnessSensorPlacementTierSummary;
  fullOrDeep: FitnessSensorPlacementTierSummary;
  continuous: FitnessSensorPlacementTierSummary;
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

type AnalyzePayload = {
  compareLast: boolean;
  noSave: boolean;
  mode: FitnessMode;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  const includeBoth = payload.runBoth === true;
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
  const mode = body && typeof body === "object" && typeof (body as { mode?: unknown }).mode === "string"
    && FITNESS_MODES.includes((body as { mode: FitnessMode }).mode)
    ? (body as { mode: FitnessMode }).mode
    : DEFAULT_MODE;

  return {
    compareLast: compareLast ?? DEFAULT_COMPARE_LAST,
    noSave,
    mode,
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
    workspaceId: normalizeFitnessContextValue(payload.workspaceId),
    codebaseId: normalizeFitnessContextValue(payload.codebaseId),
    repoPath: normalizeFitnessContextValue(payload.repoPath),
  };
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

function removeReportJsonFromStdout(stdout: string, reportText: string) {
  if (!stdout || !reportText) return stdout;
  const index = stdout.lastIndexOf(reportText);
  if (index < 0) return stdout;
  return `${stdout.slice(0, index)}${stdout.slice(index + reportText.length)}`;
}

function buildConsoleTranscript(params: {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode?: number | null;
  signal?: string | null;
  reportText?: string;
}): FitnessConsole {
  const { command, args, stdout, stderr, durationMs, exitCode, signal, reportText } = params;
  const cleanedStdout = removeReportJsonFromStdout(stdout, reportText ?? "").trim();
  const cleanedStderr = stderr.trim();
  const lines = [`$ ${[command, ...args].join(" ")}`, ""];

  if (cleanedStdout) {
    lines.push("stdout:");
    lines.push(cleanedStdout);
    lines.push("");
  } else if (reportText) {
    lines.push("stdout:");
    lines.push("[No step-by-step stdout logs. This command only emitted the final JSON report, which was parsed into the Fluency report view.]");
    lines.push("");
  }

  if (cleanedStderr) {
    lines.push("stderr:");
    lines.push(cleanedStderr);
    lines.push("");
  }

  if (signal) {
    lines.push(`[signal: ${signal}]`);
  } else if (typeof exitCode === "number") {
    lines.push(`[exit ${exitCode} · ${(durationMs / 1000).toFixed(1)}s]`);
  } else {
    lines.push(`[completed · ${(durationMs / 1000).toFixed(1)}s]`);
  }

  return {
    command,
    args,
    data: `${lines.join("\n")}\n`,
    stdout,
    stderr,
    reportText,
    exitCode,
    signal,
  };
}

async function runFitnessProfile(
  repoRoot: string,
  profile: FitnessProfile,
  compareLast: boolean,
  noSave: boolean,
  mode: FitnessMode,
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

  if (mode !== "deterministic") {
    args.push("--mode", mode);
  }

  if (compareLast) {
    args.push("--compare-last");
  }
  if (noSave) {
    args.push("--no-save");
  }

  return await new Promise<FitnessCommandResult>((resolve) => {
    const command = "cargo";
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
      const durationMs = Date.now() - startTime;
      resolve({
        status: "error",
        durationMs,
        console: buildConsoleTranscript({
          command,
          args,
          stdout,
          stderr,
          durationMs,
        }),
        error: toMessage(error),
      });
    });

    proc.on("close", (code, signal) => {
      const durationMs = Date.now() - startTime;

      if (signal) {
        resolve({
          status: "error",
          durationMs,
          console: buildConsoleTranscript({
            command,
            args,
            stdout,
            stderr,
            durationMs,
            signal,
          }),
          error: `Command terminated by signal: ${signal}`,
        });
        return;
      }

      if (code !== 0) {
        resolve({
          status: "error",
          durationMs,
          console: buildConsoleTranscript({
            command,
            args,
            stdout,
            stderr,
            durationMs,
            exitCode: code,
          }),
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
          console: buildConsoleTranscript({
            command,
            args,
            stdout,
            stderr,
            durationMs,
            exitCode: code,
            reportText,
          }),
        });
      } catch (error) {
        resolve({
          status: "error",
          durationMs,
          console: buildConsoleTranscript({
            command,
            args,
            stdout,
            stderr,
            durationMs,
            exitCode: code,
          }),
          error: toMessage(error),
        });
      }
    });
  });
}

function buildResponse(
  profiles: FitnessProfile[],
  payload: AnalyzePayload,
  repoRoot: string,
) {
  const tasks = profiles.map(async (profile) => {
    const result = await runFitnessProfile(
      repoRoot,
      profile,
      payload.compareLast,
      payload.noSave,
      payload.mode,
    );
    const entry: FitnessProfileResult = {
      profile,
      source: "analysis",
      status: result.status,
      durationMs: result.durationMs,
    };

    if (result.status === "ok" && result.report) {
      entry.report = result.report;
      entry.console = result.console;
      return entry;
    }

    entry.console = result.console;
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
    const repoRoot = await resolveFitnessRepoRoot(context, {
      preferCurrentRepoForDefaultWorkspace: true,
    });

    const payload = await buildResponse(profiles, options, repoRoot);
    return NextResponse.json(payload as FitnessAnalyzeResponse);
  } catch (error) {
    const message = toMessage(error);
    if (isFitnessContextError(message)) {
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
