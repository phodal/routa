"use client";

export type FitnessProfile = "generic" | "agent_orchestrator";
export type FluencyRunMode = "deterministic" | "hybrid" | "ai";
export type ViewMode = "overview" | "capabilities" | "recommendations" | "changes";

export type FitnessProfileState = "idle" | "loading" | "ready" | "empty" | "error";

export type CriterionStatus = "pass" | "fail" | "skipped";

export type CriterionResult = {
  id: string;
  level: string;
  dimension: string;
  capabilityGroup?: string | null;
  capabilityGroupName?: string | null;
  weight: number;
  critical: boolean;
  status: CriterionStatus;
  detectorType: string;
  profiles?: string[];
  evidenceMode?: string;
  detail: string;
  evidence: string[];
  whyItMatters: string;
  recommendedAction: string;
  evidenceHint: string;
};

export type CellResult = {
  id: string;
  level: string;
  levelName: string;
  dimension: string;
  dimensionName: string;
  score: number;
  passed: boolean;
  passedWeight: number;
  applicableWeight: number;
  criteria: CriterionResult[];
};

export type FitnessDimensionResult = {
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

export type FitnessRecommendation = {
  criterionId: string;
  action: string;
  whyItMatters: string;
  evidenceHint: string;
  critical: boolean;
  weight: number;
};

export type FluencyFraming = "harness_fluency" | "harnessability";

export type FluencyTermMapping = {
  internalTerm: string;
  publicTerm: string;
  activeTerm: string;
};

export type AutonomyBand = "low" | "medium" | "high";

export type AutonomyRecommendation = {
  band: AutonomyBand;
  rationale: string;
};

export type MissingDimensionInsight = {
  dimension: string;
  name: string;
  failingCriteria: number;
  criticalFailures: number;
  failedWeight: number;
  blockingFailures: number;
};

export type SensorPlacementTierSummary = {
  applicableCriteria: number;
  passingCriteria: number;
  failingCriteria: number;
  criticalFailures: number;
  evidenceModes?: Record<string, number>;
};

export type LifecycleSensorPlacementSummary = {
  fast: SensorPlacementTierSummary;
  normal: SensorPlacementTierSummary;
  fullOrDeep: SensorPlacementTierSummary;
  continuous: SensorPlacementTierSummary;
};

export type FitnessComparison = {
  previousGeneratedAt: string;
  previousOverallLevel: string;
  overallChange: "same" | "up" | "down";
  dimensionChanges: Array<{
    dimension: string;
    previousLevel: string;
    currentLevel: string;
    change: "same" | "up" | "down";
  }>;
  criteriaChanges: Array<{
    id: string;
    previousStatus?: string;
    currentStatus?: string;
  }>;
};

export type FitnessReport = {
  modelVersion: number;
  modelPath: string;
  profile: FitnessProfile;
  mode?: string;
  framing?: FluencyFraming;
  termMapping?: FluencyTermMapping;
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
  evidencePacks?: FitnessEvidencePack[];
  cells: CellResult[];
  criteria: CriterionResult[];
  recommendations: FitnessRecommendation[];
  comparison?: FitnessComparison;
  blockingCriteria?: CriterionResult[];
  topPrioritizedActions?: FitnessRecommendation[];
  dominantMissingDimensions?: MissingDimensionInsight[];
  autonomyRecommendation?: AutonomyRecommendation;
  lifecycleSensorPlacement?: LifecycleSensorPlacementSummary;
};

export type FitnessEvidenceExcerpt = {
  path: string;
  content: string;
  truncated: boolean;
};

export type FitnessEvidencePack = {
  criterionId: string;
  capabilityGroup: string;
  capabilityGroupName: string;
  status: CriterionStatus;
  evidenceMode: string;
  detectorType: string;
  selectionReasons: string[];
  detail: string;
  evidence: string[];
  excerpts: FitnessEvidenceExcerpt[];
  whyItMatters: string;
  recommendedAction: string;
  evidenceHint: string;
  aiPromptTemplate?: string | null;
  aiRequires?: string[];
};

export type ApiProfileEntry = {
  profile: FitnessProfile;
  status: "ok" | "missing" | "error";
  source: "analysis" | "snapshot";
  report?: FitnessReport;
  error?: string;
  durationMs?: number;
};

export type AnalyzeResponse = {
  generatedAt: string;
  requestedProfiles: FitnessProfile[];
  profiles: ApiProfileEntry[];
};

export type ProfilePanelState = {
  state: FitnessProfileState;
  source?: ApiProfileEntry["source"];
  durationMs?: number;
  report?: FitnessReport;
  error?: string;
  updatedAt?: string;
};

export type FitnessAnalysisContext = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
};

export type FitnessAnalysisOptions = {
  mode?: FluencyRunMode;
};

export const PROFILE_ORDER: FitnessProfile[] = ["generic", "agent_orchestrator"];
export const FLUENCY_MODES: Array<{ id: FluencyRunMode; label: string; description: string }> = [
  { id: "deterministic", label: "Deterministic", description: "快速读取静态与运行时基线，适合先判断整体成熟度" },
  { id: "hybrid", label: "Hybrid", description: "在基线之外补充证据包，适合排查 blocker 和准备后续裁决" },
  { id: "ai", label: "AI", description: "扩大证据准备范围，适合深挖复杂争议项或实验性评估" },
];

export const PROFILE_DEFS: Array<{
  id: FitnessProfile;
  name: string;
  description: string;
  focus: string;
  reliability: string;
}> = [
  {
    id: "generic",
    name: "Generic",
    description: "仓库整体 fluency 体检",
    focus: "更适合先看成熟度结论、治理覆盖面和默认修复优先级",
    reliability: "相对稳定",
  },
  {
    id: "agent_orchestrator",
    name: "Agent Orchestrator",
    description: "协作编排链路 fluency 体检",
    focus: "更关注 specialist、team、automation 之间的协同能力",
    reliability: "实验性判断",
  },
];

export const VIEW_MODES: Array<{ id: ViewMode; label: string; description: string }> = [
  { id: "overview", label: "总览", description: "先看当前结论、主要 blocker 和能力热区" },
  { id: "capabilities", label: "能力项", description: "按维度拆开每个 level cell 和 criterion 明细" },
  { id: "recommendations", label: "建议动作", description: "查看最值得先做的动作和证据线索" },
  { id: "changes", label: "对比变化", description: "查看这次结果和上一次快照之间的变化" },
];

export function normalizeApiResponse(payload: unknown): ApiProfileEntry[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { profiles?: unknown }).profiles)) {
    return [];
  }

  return ((payload as { profiles: unknown[] }).profiles).reduce<ApiProfileEntry[]>((entries, entry) => {
    if (!entry || typeof entry !== "object") {
      return entries;
    }

    const value = entry as Partial<ApiProfileEntry>;
    if ((value.profile !== "generic" && value.profile !== "agent_orchestrator") || value.status === undefined) {
      return entries;
    }

    if (value.status !== "ok" && value.status !== "missing" && value.status !== "error") {
      return entries;
    }

    if (value.source !== "analysis" && value.source !== "snapshot") {
      return entries;
    }

    entries.push({
      profile: value.profile,
      status: value.status,
      source: value.source,
      report: value.report && typeof value.report === "object" ? value.report as FitnessReport : undefined,
      error: typeof value.error === "string" ? value.error : undefined,
      durationMs: typeof value.durationMs === "number" && Number.isFinite(value.durationMs) ? value.durationMs : undefined,
    });
    return entries;
  }, []);
}

export function buildAnalysisQuery(context: FitnessAnalysisContext): string {
  const params = new URLSearchParams();
  if (context.workspaceId?.trim()) params.set("workspaceId", context.workspaceId.trim());
  if (context.codebaseId?.trim()) params.set("codebaseId", context.codebaseId.trim());
  if (context.repoPath?.trim()) params.set("repoPath", context.repoPath.trim());
  return params.toString();
}

export function buildAnalysisPayload(context: FitnessAnalysisContext, options?: FitnessAnalysisOptions) {
  const payload: FitnessAnalysisContext = {};
  if (context.workspaceId?.trim()) payload.workspaceId = context.workspaceId.trim();
  if (context.codebaseId?.trim()) payload.codebaseId = context.codebaseId.trim();
  if (context.repoPath?.trim()) payload.repoPath = context.repoPath.trim();
  return {
    ...payload,
    ...(options?.mode ? { mode: options.mode } : {}),
  };
}

export function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

export function formatTime(value: string | undefined) {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleString();
}

export function formatDuration(ms: number | undefined) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "未知";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

export function humanizeToken(value: string | undefined) {
  if (!value) return "Unknown";
  return value
    .split(/[._-]/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function criterionShortLabel(value: string) {
  return humanizeToken(value.split(".").slice(-1)[0]);
}

export function readinessBadgeTone(score: number) {
  const value = clampPercent(score);
  if (value >= 90) return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (value >= 75) return "border-sky-300 bg-sky-50 text-sky-700";
  if (value >= 60) return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-rose-300 bg-rose-50 text-rose-700";
}

export function readinessBarTone(score: number) {
  const value = clampPercent(score);
  if (value >= 90) return "bg-emerald-400";
  if (value >= 75) return "bg-sky-400";
  if (value >= 60) return "bg-amber-400";
  return "bg-rose-400";
}

export function criterionStatusTone(status: CriterionStatus) {
  if (status === "pass") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "fail") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function profileStateTone(state: FitnessProfileState) {
  if (state === "ready") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (state === "loading") return "border-sky-300 bg-sky-50 text-sky-700";
  if (state === "error") return "border-rose-300 bg-rose-50 text-rose-700";
  if (state === "empty") return "border-slate-200 bg-slate-100 text-slate-600";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

export function levelChangeTone(change: "same" | "up" | "down") {
  if (change === "up") return "text-emerald-700 dark:text-emerald-300";
  if (change === "down") return "text-rose-700 dark:text-rose-300";
  return "text-slate-500 dark:text-slate-300";
}
