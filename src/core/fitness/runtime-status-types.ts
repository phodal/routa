export const RUNTIME_FITNESS_MODES = ["fast", "full"] as const;

export type RuntimeFitnessMode = (typeof RUNTIME_FITNESS_MODES)[number];
export type RuntimeFitnessStatus = "running" | "passed" | "failed" | "skipped" | "missing";
export type RuntimeFitnessEventStatus = Exclude<RuntimeFitnessStatus, "missing">;

export type RuntimeFitnessCompletedSummary = {
  status: Exclude<RuntimeFitnessEventStatus, "running">;
  observedAt: string;
  finalScore: number | null;
  hardGateBlocked: boolean | null;
  scoreBlocked: boolean | null;
  durationMs: number | null;
  dimensionCount: number | null;
  metricCount: number | null;
  artifactPath: string | null;
};

export type RuntimeFitnessModeSummary = {
  mode: RuntimeFitnessMode;
  currentStatus: RuntimeFitnessStatus;
  currentObservedAt: string | null;
  finalScore: number | null;
  hardGateBlocked: boolean | null;
  scoreBlocked: boolean | null;
  durationMs: number | null;
  dimensionCount: number | null;
  metricCount: number | null;
  artifactPath: string | null;
  lastCompleted: RuntimeFitnessCompletedSummary | null;
};

export type RuntimeFitnessStatusResponse = {
  generatedAt: string;
  repoRoot: string;
  hasRunning: boolean;
  modes: RuntimeFitnessModeSummary[];
  latest: RuntimeFitnessModeSummary | null;
};
