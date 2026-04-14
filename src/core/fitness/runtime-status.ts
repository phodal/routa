import { createHash } from "crypto";
import { promises as fsp } from "fs";
import * as path from "path";

import {
  resolveFitnessRepoRoot,
  type FitnessContext,
} from "./repo-root";

const RUNTIME_APP_SLUG = "harness-monitor";
const NO_RUNTIME_CHANGE_KEY = "__none__";

type RuntimeMailboxEventStatus = "running" | "passed" | "failed" | "skipped";

type RuntimeMailboxEvent = {
  type?: string;
  repo_root?: string;
  observed_at_ms?: number;
  mode?: string;
  status?: RuntimeMailboxEventStatus | string;
  final_score?: number | null;
  hard_gate_blocked?: boolean | null;
  score_blocked?: boolean | null;
  duration_ms?: number | null;
  dimension_count?: number | null;
  metric_count?: number | null;
  artifact_path?: string | null;
};

type RuntimeSnapshotDimension = {
  hard_gate_failures?: number;
};

type RuntimeSnapshot = {
  mode?: string;
  final_score?: number | null;
  hard_gate_blocked?: boolean | null;
  score_blocked?: boolean | null;
  duration_ms?: number | null;
  metric_count?: number | null;
  artifact_path?: string | null;
  generated_at_ms?: number | null;
  dimensions?: RuntimeSnapshotDimension[];
  failing_metrics?: unknown[];
};

export type FitnessRuntimeRunSummary = {
  mode: string;
  status: RuntimeMailboxEventStatus | "unknown";
  observedAt: string;
  observedAtMs: number;
  finalScore: number | null;
  hardGateBlocked: boolean;
  scoreBlocked: boolean;
  blockerCount: number;
  hardGateFailureCount: number;
  failingMetricCount: number;
  durationMs: number | null;
  metricCount: number | null;
  artifactPath: string | null;
};

export type FitnessRuntimeStatus = {
  generatedAt: string;
  repoRoot: string;
  activeRun: FitnessRuntimeRunSummary | null;
  latestRun: FitnessRuntimeRunSummary | null;
};

function runtimeRoot(repoRoot: string): string {
  const marker = createHash("sha256").update(repoRoot).digest("hex");
  return path.join("/tmp", RUNTIME_APP_SLUG, "runtime", marker);
}

function runtimeMailboxDir(repoRoot: string): string {
  return path.join(runtimeRoot(repoRoot), "mailbox", "fitness", "new");
}

function runtimeArtifactDir(repoRoot: string): string {
  return path.join(runtimeRoot(repoRoot), "artifacts", "fitness");
}

async function readJsonFile<T>(targetPath: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(targetPath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function listJsonFiles(dirPath: string): Promise<string[]> {
  try {
    return (await fsp.readdir(dirPath))
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map((entry) => path.join(dirPath, entry));
  } catch {
    return [];
  }
}

function normalizeMode(mode: string | null | undefined): string {
  const trimmed = typeof mode === "string" ? mode.trim() : "";
  return trimmed.length > 0 ? trimmed : "full";
}

function normalizeObservedAt(observedAtMs: number | null | undefined): number {
  return typeof observedAtMs === "number" && Number.isFinite(observedAtMs) ? observedAtMs : 0;
}

function countHardGateFailures(snapshot: RuntimeSnapshot | null): number {
  if (!Array.isArray(snapshot?.dimensions)) {
    return 0;
  }

  return snapshot.dimensions.reduce((total, dimension) => {
    const value = dimension?.hard_gate_failures;
    return total + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
}

function countFailingMetrics(snapshot: RuntimeSnapshot | null): number {
  return Array.isArray(snapshot?.failing_metrics) ? snapshot.failing_metrics.length : 0;
}

function summarizeRun(
  event: RuntimeMailboxEvent | null,
  snapshot: RuntimeSnapshot | null,
): FitnessRuntimeRunSummary | null {
  if (!event && !snapshot) {
    return null;
  }

  const observedAtMs = normalizeObservedAt(
    event?.observed_at_ms
    ?? snapshot?.generated_at_ms,
  );
  const hardGateFailureCount = countHardGateFailures(snapshot);
  const scoreBlocked = (event?.score_blocked ?? snapshot?.score_blocked) === true;
  const hardGateBlocked = (event?.hard_gate_blocked ?? snapshot?.hard_gate_blocked) === true;
  const blockerCount = hardGateFailureCount + (scoreBlocked ? 1 : 0);

  return {
    mode: normalizeMode(event?.mode ?? snapshot?.mode),
    status: (event?.status as RuntimeMailboxEventStatus | undefined) ?? "unknown",
    observedAt: new Date(observedAtMs || Date.now()).toISOString(),
    observedAtMs,
    finalScore: typeof event?.final_score === "number"
      ? event.final_score
      : typeof snapshot?.final_score === "number"
        ? snapshot.final_score
        : null,
    hardGateBlocked,
    scoreBlocked,
    blockerCount,
    hardGateFailureCount,
    failingMetricCount: countFailingMetrics(snapshot),
    durationMs: typeof event?.duration_ms === "number"
      ? event.duration_ms
      : typeof snapshot?.duration_ms === "number"
        ? snapshot.duration_ms
        : null,
    metricCount: typeof event?.metric_count === "number"
      ? event.metric_count
      : typeof snapshot?.metric_count === "number"
        ? snapshot.metric_count
        : null,
    artifactPath: event?.artifact_path ?? snapshot?.artifact_path ?? null,
  };
}

async function readMailboxEvents(repoRoot: string): Promise<RuntimeMailboxEvent[]> {
  const entries = await listJsonFiles(runtimeMailboxDir(repoRoot));
  const events = await Promise.all(entries.map((entry) => readJsonFile<RuntimeMailboxEvent>(entry)));
  return events
    .filter((event): event is RuntimeMailboxEvent => event !== null && event.type === "fitness")
    .sort((left, right) => normalizeObservedAt(left.observed_at_ms) - normalizeObservedAt(right.observed_at_ms));
}

async function readLatestSnapshotsByMode(repoRoot: string): Promise<Map<string, RuntimeSnapshot>> {
  const artifactDir = runtimeArtifactDir(repoRoot);
  const entries = await listJsonFiles(artifactDir);
  const latestFiles = entries.filter((entry) => path.basename(entry).startsWith("latest-"));
  const snapshots = await Promise.all(latestFiles.map((entry) => readJsonFile<RuntimeSnapshot>(entry)));

  const latestByMode = new Map<string, RuntimeSnapshot>();
  for (const snapshot of snapshots) {
    if (!snapshot) continue;
    latestByMode.set(normalizeMode(snapshot.mode), snapshot);
  }
  return latestByMode;
}

async function readSnapshotForEvent(
  event: RuntimeMailboxEvent | null,
  latestSnapshotsByMode: Map<string, RuntimeSnapshot>,
): Promise<RuntimeSnapshot | null> {
  if (!event) {
    return null;
  }

  if (typeof event.artifact_path === "string" && event.artifact_path.length > 0) {
    const snapshot = await readJsonFile<RuntimeSnapshot>(event.artifact_path);
    if (snapshot) {
      return snapshot;
    }
  }

  if (event.status === "skipped") {
    return null;
  }

  return latestSnapshotsByMode.get(normalizeMode(event.mode)) ?? null;
}

export async function readFitnessRuntimeStatusForRepoRoot(repoRoot: string): Promise<FitnessRuntimeStatus> {
  const [events, latestSnapshotsByMode] = await Promise.all([
    readMailboxEvents(repoRoot),
    readLatestSnapshotsByMode(repoRoot),
  ]);

  const latestEventByMode = new Map<string, RuntimeMailboxEvent>();
  for (const event of events) {
    latestEventByMode.set(normalizeMode(event.mode), event);
  }

  const activeRunEvent = Array.from(latestEventByMode.values())
    .filter((event) => event.status === "running")
    .sort((left, right) => normalizeObservedAt(right.observed_at_ms) - normalizeObservedAt(left.observed_at_ms))[0] ?? null;

  const latestTerminalEvent = events
    .filter((event) => event.status !== "running")
    .sort((left, right) => normalizeObservedAt(right.observed_at_ms) - normalizeObservedAt(left.observed_at_ms))[0] ?? null;

  const [activeRunSnapshot, latestRunSnapshot] = await Promise.all([
    readSnapshotForEvent(activeRunEvent, latestSnapshotsByMode),
    readSnapshotForEvent(latestTerminalEvent, latestSnapshotsByMode),
  ]);

  let latestRun = summarizeRun(latestTerminalEvent, latestRunSnapshot);
  if (!latestRun && latestSnapshotsByMode.size > 0) {
    const latestSnapshot = Array.from(latestSnapshotsByMode.values())
      .sort((left, right) => normalizeObservedAt(right.generated_at_ms) - normalizeObservedAt(left.generated_at_ms))[0] ?? null;
    latestRun = summarizeRun(null, latestSnapshot);
  }

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    activeRun: summarizeRun(activeRunEvent, activeRunSnapshot),
    latestRun,
  };
}

export async function readFitnessRuntimeStatus(context: FitnessContext): Promise<FitnessRuntimeStatus> {
  const repoRoot = await resolveFitnessRepoRoot(context, {
    preferCurrentRepoForDefaultWorkspace: true,
  });
  return readFitnessRuntimeStatusForRepoRoot(repoRoot);
}

export async function tryReadFitnessRuntimeStatus(context: FitnessContext): Promise<FitnessRuntimeStatus | null> {
  try {
    return await readFitnessRuntimeStatus(context);
  } catch {
    return null;
  }
}

export function buildFitnessRuntimeChangeKey(status: FitnessRuntimeStatus | null): string {
  if (!status) {
    return NO_RUNTIME_CHANGE_KEY;
  }

  return [
    status.repoRoot,
    status.activeRun?.mode ?? "",
    status.activeRun?.status ?? "",
    String(status.activeRun?.observedAtMs ?? 0),
    status.latestRun?.mode ?? "",
    status.latestRun?.status ?? "",
    String(status.latestRun?.observedAtMs ?? 0),
    String(status.latestRun?.finalScore ?? ""),
    String(status.latestRun?.blockerCount ?? 0),
  ].join(":");
}
