import { promises as fsp } from "fs";
import * as path from "path";
import { createHash } from "crypto";
import {
  RUNTIME_FITNESS_MODES,
  type RuntimeFitnessCompletedSummary,
  type RuntimeFitnessMode,
  type RuntimeFitnessModeSummary,
  type RuntimeFitnessStatus,
  type RuntimeFitnessStatusResponse,
} from "./runtime-status-types";

type RuntimeFitnessEventRecord = {
  type?: string;
  observed_at_ms?: number;
  mode?: string;
  status?: string;
  final_score?: number | null;
  hard_gate_blocked?: boolean | null;
  score_blocked?: boolean | null;
  duration_ms?: number | null;
  dimension_count?: number | null;
  metric_count?: number | null;
  artifact_path?: string | null;
};

type RuntimeFitnessArtifactRecord = {
  generated_at_ms?: number | null;
  final_score?: number | null;
  hard_gate_blocked?: boolean | null;
  score_blocked?: boolean | null;
  duration_ms?: number | null;
  dimensions?: unknown[];
  metric_count?: number | null;
};

type RuntimeFitnessArtifactSummary = {
  generatedAtMs: number;
  summary: RuntimeFitnessCompletedSummary;
};

function runtimeMarker(repoRoot: string): string {
  return createHash("sha256").update(repoRoot).digest("hex");
}

function runtimeRoot(repoRoot: string): string {
  return path.join("/tmp", "harness-monitor", "runtime", runtimeMarker(repoRoot));
}

function runtimeEventPath(repoRoot: string): string {
  return path.join(runtimeRoot(repoRoot), "events.jsonl");
}

function runtimeArtifactPath(repoRoot: string, mode: RuntimeFitnessMode): string {
  return path.join(runtimeRoot(repoRoot), "artifacts", "fitness", `latest-${mode}.json`);
}

function normalizeMode(value: string | undefined): RuntimeFitnessMode | null {
  if (value === "fast" || value === "full") {
    return value;
  }
  if (value === "normal") {
    return "full";
  }
  return null;
}

function normalizeStatus(value: string | undefined): RuntimeFitnessStatus | null {
  switch (value) {
    case "running":
    case "passed":
    case "failed":
    case "skipped":
      return value;
    default:
      return null;
  }
}

function isTerminalStatus(status: RuntimeFitnessStatus | null): status is Exclude<RuntimeFitnessStatus, "running" | "missing"> {
  return status === "passed" || status === "failed" || status === "skipped";
}

function toIsoString(timestampMs: number | null | undefined): string | null {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || timestampMs <= 0) {
    return null;
  }
  return new Date(timestampMs).toISOString();
}

function deriveArtifactStatus(record: RuntimeFitnessArtifactRecord): Exclude<RuntimeFitnessStatus, "running" | "missing"> {
  if (record.hard_gate_blocked || record.score_blocked) {
    return "failed";
  }
  return "passed";
}

function toCompletedSummaryFromEvent(
  record: RuntimeFitnessEventRecord,
): RuntimeFitnessCompletedSummary | null {
  const status = normalizeStatus(record.status);
  const observedAt = toIsoString(record.observed_at_ms);
  if (!isTerminalStatus(status) || !observedAt) {
    return null;
  }
  return {
    status,
    observedAt,
    finalScore: typeof record.final_score === "number" ? record.final_score : null,
    hardGateBlocked: typeof record.hard_gate_blocked === "boolean" ? record.hard_gate_blocked : null,
    scoreBlocked: typeof record.score_blocked === "boolean" ? record.score_blocked : null,
    durationMs: typeof record.duration_ms === "number" ? record.duration_ms : null,
    dimensionCount: typeof record.dimension_count === "number" ? record.dimension_count : null,
    metricCount: typeof record.metric_count === "number" ? record.metric_count : null,
    artifactPath: typeof record.artifact_path === "string" && record.artifact_path.length > 0 ? record.artifact_path : null,
  };
}

async function readArtifactSummary(
  repoRoot: string,
  mode: RuntimeFitnessMode,
): Promise<RuntimeFitnessArtifactSummary | null> {
  const artifactPath = runtimeArtifactPath(repoRoot, mode);
  try {
    const raw = await fsp.readFile(artifactPath, "utf-8");
    const parsed = JSON.parse(raw) as RuntimeFitnessArtifactRecord;
    const generatedAtMs = typeof parsed.generated_at_ms === "number" ? parsed.generated_at_ms : null;
    const observedAt = toIsoString(generatedAtMs);
    if (!generatedAtMs || !observedAt) {
      return null;
    }
    return {
      generatedAtMs,
      summary: {
        status: deriveArtifactStatus(parsed),
        observedAt,
        finalScore: typeof parsed.final_score === "number" ? parsed.final_score : null,
        hardGateBlocked: typeof parsed.hard_gate_blocked === "boolean" ? parsed.hard_gate_blocked : null,
        scoreBlocked: typeof parsed.score_blocked === "boolean" ? parsed.score_blocked : null,
        durationMs: typeof parsed.duration_ms === "number" ? parsed.duration_ms : null,
        dimensionCount: Array.isArray(parsed.dimensions) ? parsed.dimensions.length : null,
        metricCount: typeof parsed.metric_count === "number" ? parsed.metric_count : null,
        artifactPath,
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readLatestRuntimeEvents(repoRoot: string) {
  const latestByMode = new Map<RuntimeFitnessMode, RuntimeFitnessEventRecord>();
  const latestTerminalByMode = new Map<RuntimeFitnessMode, RuntimeFitnessEventRecord>();

  try {
    const raw = await fsp.readFile(runtimeEventPath(repoRoot), "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as RuntimeFitnessEventRecord;
        if (parsed.type !== "fitness") continue;
        const mode = normalizeMode(parsed.mode);
        const status = normalizeStatus(parsed.status);
        if (!mode || !status) continue;
        latestByMode.set(mode, parsed);
        if (isTerminalStatus(status)) {
          latestTerminalByMode.set(mode, parsed);
        }
      } catch {
        // Ignore malformed JSONL rows.
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  return { latestByMode, latestTerminalByMode };
}

function summarizeCurrentFromCompleted(
  mode: RuntimeFitnessMode,
  completed: RuntimeFitnessCompletedSummary,
): RuntimeFitnessModeSummary {
  return {
    mode,
    currentStatus: completed.status,
    currentObservedAt: completed.observedAt,
    finalScore: completed.finalScore,
    hardGateBlocked: completed.hardGateBlocked,
    scoreBlocked: completed.scoreBlocked,
    durationMs: completed.durationMs,
    dimensionCount: completed.dimensionCount,
    metricCount: completed.metricCount,
    artifactPath: completed.artifactPath,
    lastCompleted: completed,
  };
}

function currentObservedAtMs(summary: RuntimeFitnessModeSummary): number {
  const value = summary.currentObservedAt ? Date.parse(summary.currentObservedAt) : Number.NaN;
  return Number.isFinite(value) ? value : -1;
}

async function buildModeSummary(
  repoRoot: string,
  mode: RuntimeFitnessMode,
  latestEvent: RuntimeFitnessEventRecord | undefined,
  latestTerminalEvent: RuntimeFitnessEventRecord | undefined,
): Promise<RuntimeFitnessModeSummary> {
  const latestArtifact = await readArtifactSummary(repoRoot, mode);
  const lastCompleted = toCompletedSummaryFromEvent(latestTerminalEvent ?? {})
    ?? latestArtifact?.summary
    ?? null;

  const currentStatus = normalizeStatus(latestEvent?.status);
  if (currentStatus === "running") {
    return {
      mode,
      currentStatus,
      currentObservedAt: toIsoString(latestEvent?.observed_at_ms),
      finalScore: typeof latestEvent?.final_score === "number" ? latestEvent.final_score : null,
      hardGateBlocked: typeof latestEvent?.hard_gate_blocked === "boolean" ? latestEvent.hard_gate_blocked : null,
      scoreBlocked: typeof latestEvent?.score_blocked === "boolean" ? latestEvent.score_blocked : null,
      durationMs: typeof latestEvent?.duration_ms === "number" ? latestEvent.duration_ms : null,
      dimensionCount: typeof latestEvent?.dimension_count === "number" ? latestEvent.dimension_count : null,
      metricCount: typeof latestEvent?.metric_count === "number" ? latestEvent.metric_count : null,
      artifactPath: typeof latestEvent?.artifact_path === "string" && latestEvent.artifact_path.length > 0 ? latestEvent.artifact_path : null,
      lastCompleted,
    };
  }

  const completedFromEvent = toCompletedSummaryFromEvent(latestEvent ?? {});
  if (completedFromEvent) {
    return summarizeCurrentFromCompleted(mode, completedFromEvent);
  }

  if (lastCompleted) {
    return summarizeCurrentFromCompleted(mode, lastCompleted);
  }

  return {
    mode,
    currentStatus: "missing",
    currentObservedAt: null,
    finalScore: null,
    hardGateBlocked: null,
    scoreBlocked: null,
    durationMs: null,
    dimensionCount: null,
    metricCount: null,
    artifactPath: null,
    lastCompleted: null,
  };
}

export async function readRuntimeFitnessStatus(repoRoot: string): Promise<RuntimeFitnessStatusResponse> {
  const { latestByMode, latestTerminalByMode } = await readLatestRuntimeEvents(repoRoot);
  const modes = await Promise.all(
    RUNTIME_FITNESS_MODES.map((mode) =>
      buildModeSummary(repoRoot, mode, latestByMode.get(mode), latestTerminalByMode.get(mode))),
  );

  const latest = [...modes]
    .sort((left, right) => currentObservedAtMs(right) - currentObservedAtMs(left))[0] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    hasRunning: modes.some((mode) => mode.currentStatus === "running"),
    modes,
    latest: latest && latest.currentStatus !== "missing" ? latest : null,
  };
}
