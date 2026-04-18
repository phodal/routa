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
