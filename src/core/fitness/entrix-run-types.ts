export type EntrixRunTier = "fast" | "normal" | "deep";
export type EntrixRunScope = "local" | "ci" | "staging" | "prod_observation";

export type EntrixMetricFailureSummary = {
  name: string;
  state: string;
  passed: boolean;
  hardGate: boolean;
  tier: string;
  durationMs: number | null;
  outputSnippet: string | null;
};

export type EntrixMetricResult = {
  name: string;
  state: string;
  passed: boolean | null;
  hardGate: boolean;
  tier: string;
  durationMs: number | null;
  outputSnippet: string | null;
};

export type EntrixDimensionReport = {
  name: string;
  score: number | null;
  passed: number;
  total: number;
  hardGateFailures: string[];
  results: EntrixMetricResult[];
};

export type EntrixReportData = {
  finalScore: number | null;
  hardGateBlocked: boolean | null;
  scoreBlocked: boolean | null;
  dimensions: EntrixDimensionReport[];
};

export type EntrixDimensionSummary = {
  name: string;
  score: number | null;
  passed: number;
  total: number;
  hardGateFailures: string[];
  failingMetrics: EntrixMetricFailureSummary[];
};

export type EntrixRunSummary = {
  finalScore: number | null;
  hardGateBlocked: boolean | null;
  scoreBlocked: boolean | null;
  dimensionCount: number;
  metricCount: number;
  failingMetricCount: number;
  dimensions: EntrixDimensionSummary[];
  /** Total wall-time of the entrix run in milliseconds (from command start to output). */
  durationMs?: number;
  /** Duration of the single slowest metric in milliseconds. */
  slowestMetricMs?: number | null;
  /**
   * Aliases for metricCount/failingMetricCount using the pi-autoresearch METRIC naming
   * convention so autoresearch consumers can consume them without field remapping.
   */
  /** Number of checks run (autoresearch alias for metricCount). */
  checksCount?: number;
  /** Number of checks that did not pass (autoresearch alias for failingMetricCount). */
  failedChecks?: number;
  /** Ratio of passed/waived checks to total checks (0.0-1.0). */
  passRate?: number;
};

export type EntrixRunResponse = {
  generatedAt: string;
  repoRoot: string;
  tier: EntrixRunTier;
  scope: EntrixRunScope;
  command: string;
  args: string[];
  durationMs: number;
  exitCode: number | null;
  report: EntrixReportData;
  summary: EntrixRunSummary;
};
