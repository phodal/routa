"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlanResponse, TierValue } from "@/client/components/harness-execution-plan-flow";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { HarnessAutomationResponse } from "@/core/harness/automation-types";
import type { DesignDecisionResponse } from "@/core/harness/design-decision-types";
import type { CodeownersResponse } from "@/core/harness/codeowners-types";
import type { SpecDetectionResponse } from "@/core/harness/spec-detector-types";

export type RunnerKind = "shell" | "graph" | "sarif";
export type SpecKind = "rulebook" | "manifest" | "dimension" | "narrative" | "policy";

export type MetricSummary = {
  name: string;
  command: string;
  description: string;
  tier: string;
  hardGate: boolean;
  gate: string;
  runner: RunnerKind;
  pattern?: string;
  evidenceType?: string;
  scope: string[];
  runWhenChanged: string[];
};

export type FitnessSpecSummary = {
  name: string;
  relativePath: string;
  kind: SpecKind;
  language: "markdown" | "yaml";
  dimension?: string;
  weight?: number;
  thresholdPass?: number;
  thresholdWarn?: number;
  metricCount: number;
  metrics: MetricSummary[];
  source: string;
  frontmatterSource?: string;
  manifestEntries?: string[];
};

export type SpecsResponse = {
  generatedAt: string;
  repoRoot: string;
  fitnessDir: string;
  files: FitnessSpecSummary[];
};

export type HookMetricSummary = {
  name: string;
  command: string;
  description: string;
  hardGate: boolean;
  resolved: boolean;
  sourceFile?: string;
};

export type HookRuntimeProfileSummary = {
  name: string;
  phases: string[];
  fallbackMetrics: string[];
  metrics: HookMetricSummary[];
  hooks: string[];
};

export type ReviewTriggerBoundarySummary = {
  name: string;
  paths: string[];
};

export type ReviewTriggerLayerSummary = {
  confidenceThreshold?: number | null;
  specialistId?: string | null;
  provider?: string | null;
  model?: string | null;
  context?: string[];
  contextCount?: number;
};

export type ReviewTriggerRuleSummary = {
  name: string;
  type: string;
  severity: string;
  action: string;
  paths: string[];
  evidencePaths: string[];
  boundaries: ReviewTriggerBoundarySummary[];
  directories: string[];
  pathCount: number;
  evidencePathCount: number;
  boundaryCount: number;
  directoryCount: number;
  minBoundaries: number | null;
  maxFiles: number | null;
  maxAddedLines: number | null;
  maxDeletedLines: number | null;
  confidenceThreshold?: number | null;
  fallbackAction?: string | null;
  specialistId?: string | null;
  provider?: string | null;
  model?: string | null;
  context?: string[];
  contextCount?: number;
  reviewLayers?: ReviewTriggerLayerSummary[];
  reviewLayerCount?: number;
};

export type ReleaseTriggerRuleSummary = {
  name: string;
  type: string;
  severity: string;
  action: string;
  patterns: string[];
  applyTo: string[];
  paths: string[];
  groupBy: string[];
  baseline: string | null;
  maxGrowthPercent: number | null;
  minGrowthBytes: number | null;
  patternCount: number;
  applyToCount: number;
  pathCount: number;
};

export type HookFileSummary = {
  name: string;
  relativePath: string;
  source: string;
  triggerCommand: string;
  kind: "runtime-profile" | "shell-command";
  runtimeProfileName?: string;
  skipEnvVar?: string;
};

export type HooksResponse = {
  generatedAt: string;
  repoRoot: string;
  hooksDir: string;
  configFile: {
    relativePath: string;
    source: string;
    schema?: string;
  } | null;
  reviewTriggerFile: {
    relativePath: string;
    source: string;
    ruleCount: number;
    rules: ReviewTriggerRuleSummary[];
  } | null;
  releaseTriggerFile: {
    relativePath: string;
    source: string;
    ruleCount: number;
    rules: ReleaseTriggerRuleSummary[];
  } | null;
  hookFiles: HookFileSummary[];
  profiles: HookRuntimeProfileSummary[];
  warnings: string[];
};

export type InstructionsResponse = {
  generatedAt: string;
  repoRoot: string;
  fileName: string;
  relativePath: string;
  source: string;
  fallbackUsed: boolean;
  audit: {
    status: "ok" | "heuristic" | "error";
    provider: string;
    generatedAt: string;
    durationMs: number;
    totalScore: number | null;
    overall: "通过" | "有条件通过" | "不通过" | null;
    oneSentence: string | null;
    principles: {
      routing: number | null;
      protection: number | null;
      reflection: number | null;
      verification: number | null;
    };
    error?: string;
  } | null;
};

export type AgentHookConfigSummary = {
  event: string;
  matcher?: string;
  type: string;
  command?: string;
  url?: string;
  prompt?: string;
  timeout: number;
  blocking: boolean;
  description?: string;
  source?: string;
};

export type AgentHooksResponse = {
  generatedAt: string;
  repoRoot: string;
  configFile: {
    relativePath: string;
    source: string;
    schema?: string;
  } | null;
  configFiles?: Array<{
    relativePath: string;
    source: string;
    schema?: string;
    provider?: string;
  }>;
  hooks: AgentHookConfigSummary[];
  warnings: string[];
};

export type GitHubActionsJob = {
  id: string;
  name: string;
  runner: string;
  kind: "job" | "approval" | "release";
  stepCount: number | null;
  needs: string[];
};

export type GitHubActionsFlow = {
  id: string;
  name: string;
  event: string;
  yaml: string;
  jobs: GitHubActionsJob[];
  relativePath?: string;
};

export type GitHubActionsFlowsResponse = {
  generatedAt: string;
  repoRoot: string;
  workflowsDir: string;
  flows: GitHubActionsFlow[];
  warnings: string[];
};

export type { CodeownersResponse };

export type ArchitectureSuiteName = "boundaries" | "cycles";
export type ArchitectureSummaryStatus = "pass" | "fail" | "skipped";

export type ArchitectureViolation =
  | {
    kind: "dependency";
    source: string;
    target: string;
    edgeCount: number;
  }
  | {
    kind: "cycle";
    path: string[];
    edgeCount: number;
  }
  | {
    kind: "empty-test";
    message: string;
  }
  | {
    kind: "unknown";
    summary: string;
  };

export type ArchitectureRuleResult = {
  id: string;
  title: string;
  suite: ArchitectureSuiteName;
  status: "pass" | "fail";
  violationCount: number;
  violations: ArchitectureViolation[];
};

export type ArchitectureSuiteReport = {
  generatedAt: string;
  repoRoot: string;
  suite: ArchitectureSuiteName;
  summaryStatus: ArchitectureSummaryStatus;
  archUnitSource: string | null;
  tsconfigPath: string;
  ruleCount: number;
  failedRuleCount: number;
  results: ArchitectureRuleResult[];
  notes: string[];
};

export type ArchitectureRuleChangeStatus = "pass" | "fail" | "missing";

export type ArchitectureRuleChange = {
  id: string;
  title: string;
  suite: ArchitectureSuiteName;
  previousStatus: ArchitectureRuleChangeStatus;
  currentStatus: ArchitectureRuleChangeStatus;
  previousViolationCount: number;
  currentViolationCount: number;
  violationDelta: number;
};

export type ArchitectureComparison = {
  previousGeneratedAt: string;
  previousSummaryStatus: ArchitectureSummaryStatus;
  currentSummaryStatus: ArchitectureSummaryStatus;
  ruleDelta: number;
  failedRuleDelta: number;
  violationDelta: number;
  changedRules: ArchitectureRuleChange[];
  newFailingRules: ArchitectureRuleChange[];
  resolvedRules: ArchitectureRuleChange[];
};

export type ArchitectureQualityResponse = {
  generatedAt: string;
  repoRoot: string;
  summaryStatus: ArchitectureSummaryStatus;
  archUnitSource: string | null;
  tsconfigPath: string;
  snapshotPath: string;
  suiteCount: number;
  ruleCount: number;
  failedRuleCount: number;
  violationCount: number;
  reports: ArchitectureSuiteReport[];
  notes: string[];
  comparison: ArchitectureComparison | null;
};

export type QueryState<T> = {
  loading: boolean;
  error: string | null;
  data: T | null;
};

type HarnessSettingsDataArgs = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
  selectedTier: TierValue;
  enableArchitecture?: boolean;
  preferCurrentRepoForArchitecture?: boolean;
};

type InstructionRefreshState = {
  contextKey: string;
  token: number;
};

type ArchitectureRefreshState = {
  contextKey: string;
  token: number;
};

function buildHarnessQuery(workspaceId?: string, codebaseId?: string, repoPath?: string) {
  const query = new URLSearchParams();
  if (workspaceId) {
    query.set("workspaceId", workspaceId);
  }
  if (codebaseId) {
    query.set("codebaseId", codebaseId);
  }
  if (repoPath) {
    query.set("repoPath", repoPath);
  }
  return query;
}

function emptyQueryState<T>(): QueryState<T> {
  return {
    loading: false,
    error: null,
    data: null,
  };
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function normalizeSpecsResponse(payload: Partial<SpecsResponse> | null | undefined): SpecsResponse {
  return {
    generatedAt: payload?.generatedAt ?? "",
    repoRoot: payload?.repoRoot ?? "",
    fitnessDir: payload?.fitnessDir ?? "",
    files: safeArray(payload?.files).map((file) => ({
      ...file,
      metrics: safeArray(file.metrics),
      manifestEntries: safeArray(file.manifestEntries),
    })),
  };
}

function normalizePlanResponse(payload: Partial<PlanResponse> | null | undefined): PlanResponse {
  const dimensions = safeArray(payload?.dimensions).map((dimension) => ({
    ...dimension,
    metrics: safeArray(dimension.metrics),
  }));
  const metrics = dimensions.flatMap((dimension) => dimension.metrics);
  const derivedRunnerCounts = metrics.reduce<Record<RunnerKind, number>>((counts, metric) => {
    if (metric.runner === "graph" || metric.runner === "sarif") {
      counts[metric.runner] += 1;
    } else {
      counts.shell += 1;
    }
    return counts;
  }, { shell: 0, graph: 0, sarif: 0 });

  return {
    generatedAt: payload?.generatedAt ?? "",
    tier: payload?.tier ?? "normal",
    scope: payload?.scope ?? "local",
    repoRoot: payload?.repoRoot ?? "",
    dimensionCount: payload?.dimensionCount ?? dimensions.length,
    metricCount: payload?.metricCount ?? metrics.length,
    hardGateCount: payload?.hardGateCount ?? metrics.filter((metric) => metric.hardGate).length,
    runnerCounts: {
      shell: payload?.runnerCounts?.shell ?? derivedRunnerCounts.shell,
      graph: payload?.runnerCounts?.graph ?? derivedRunnerCounts.graph,
      sarif: payload?.runnerCounts?.sarif ?? derivedRunnerCounts.sarif,
    },
    dimensions,
  };
}

function normalizeHooksResponse(payload: Partial<HooksResponse> | null | undefined): HooksResponse {
  return {
    generatedAt: payload?.generatedAt ?? "",
    repoRoot: payload?.repoRoot ?? "",
    hooksDir: payload?.hooksDir ?? "",
    configFile: payload?.configFile ?? null,
    reviewTriggerFile: payload?.reviewTriggerFile
      ? {
        ...payload.reviewTriggerFile,
        rules: safeArray(payload.reviewTriggerFile.rules),
      }
      : null,
    releaseTriggerFile: payload?.releaseTriggerFile
      ? {
        ...payload.releaseTriggerFile,
        rules: safeArray(payload.releaseTriggerFile.rules),
      }
      : null,
    hookFiles: safeArray(payload?.hookFiles),
    profiles: safeArray(payload?.profiles),
    warnings: safeArray(payload?.warnings),
  };
}

function normalizeInstructionsResponse(
  payload: Partial<InstructionsResponse> | null | undefined,
): InstructionsResponse {
  return {
    generatedAt: payload?.generatedAt ?? "",
    repoRoot: payload?.repoRoot ?? "",
    fileName: payload?.fileName ?? "",
    relativePath: payload?.relativePath ?? "",
    source: payload?.source ?? "",
    fallbackUsed: Boolean(payload?.fallbackUsed),
    audit: payload?.audit ?? null,
  };
}

function normalizeArchitectureViolation(
  payload: unknown,
): ArchitectureViolation {
  const record = asRecord(payload);
  if (record?.kind === "dependency") {
    return {
      kind: "dependency",
      source: typeof record.source === "string" ? record.source : "",
      target: typeof record.target === "string" ? record.target : "",
      edgeCount: typeof record.edgeCount === "number" ? record.edgeCount : 0,
    };
  }

  if (record?.kind === "cycle") {
    return {
      kind: "cycle",
      path: Array.isArray(record.path) ? record.path.filter((value): value is string => typeof value === "string") : [],
      edgeCount: typeof record.edgeCount === "number" ? record.edgeCount : 0,
    };
  }

  if (record?.kind === "empty-test") {
    return {
      kind: "empty-test",
      message: typeof record.message === "string" ? record.message : "",
    };
  }

  return {
    kind: "unknown",
    summary: typeof record?.summary === "string" ? record.summary : "",
  };
}

function normalizeArchitectureResponse(
  payload: Partial<ArchitectureQualityResponse> | null | undefined,
): ArchitectureQualityResponse {
  const reports: ArchitectureSuiteReport[] = safeArray(payload?.reports).map((report) => ({
    generatedAt: report?.generatedAt ?? "",
    repoRoot: report?.repoRoot ?? "",
    suite: report?.suite === "cycles" ? "cycles" : "boundaries",
    summaryStatus: report?.summaryStatus === "fail" || report?.summaryStatus === "skipped"
      ? report.summaryStatus
      : "pass",
    archUnitSource: typeof report?.archUnitSource === "string" ? report.archUnitSource : null,
    tsconfigPath: report?.tsconfigPath ?? "",
    ruleCount: report?.ruleCount ?? 0,
    failedRuleCount: report?.failedRuleCount ?? 0,
    results: safeArray(report?.results).map((result) => ({
      id: result?.id ?? "",
      title: result?.title ?? "",
      suite: result?.suite === "cycles" ? "cycles" : "boundaries",
      status: result?.status === "fail" ? "fail" : "pass",
      violationCount: result?.violationCount ?? 0,
      violations: safeArray(result?.violations).map((violation) => normalizeArchitectureViolation(violation)),
    })),
    notes: safeArray(report?.notes),
  }));

  return {
    generatedAt: payload?.generatedAt ?? "",
    repoRoot: payload?.repoRoot ?? "",
    summaryStatus: payload?.summaryStatus === "fail" || payload?.summaryStatus === "skipped"
      ? payload.summaryStatus
      : "pass",
    archUnitSource: typeof payload?.archUnitSource === "string" ? payload.archUnitSource : null,
    tsconfigPath: payload?.tsconfigPath ?? "",
    snapshotPath: payload?.snapshotPath ?? "",
    suiteCount: payload?.suiteCount ?? reports.length,
    ruleCount: payload?.ruleCount ?? reports.reduce((sum, report) => sum + report.ruleCount, 0),
    failedRuleCount: payload?.failedRuleCount ?? reports.reduce((sum, report) => sum + report.failedRuleCount, 0),
    violationCount: payload?.violationCount ?? reports.reduce(
      (sum, report) => sum + report.results.reduce((inner, result) => inner + result.violationCount, 0),
      0,
    ),
    reports,
    notes: safeArray(payload?.notes),
    comparison: payload?.comparison ? {
      previousGeneratedAt: payload.comparison.previousGeneratedAt ?? "",
      previousSummaryStatus: payload.comparison.previousSummaryStatus === "fail" || payload.comparison.previousSummaryStatus === "skipped"
        ? payload.comparison.previousSummaryStatus
        : "pass",
      currentSummaryStatus: payload.comparison.currentSummaryStatus === "fail" || payload.comparison.currentSummaryStatus === "skipped"
        ? payload.comparison.currentSummaryStatus
        : "pass",
      ruleDelta: payload.comparison.ruleDelta ?? 0,
      failedRuleDelta: payload.comparison.failedRuleDelta ?? 0,
      violationDelta: payload.comparison.violationDelta ?? 0,
      changedRules: safeArray(payload.comparison.changedRules).map((rule) => ({
        id: rule?.id ?? "",
        title: rule?.title ?? "",
        suite: rule?.suite === "cycles" ? "cycles" : "boundaries",
        previousStatus: rule?.previousStatus === "fail" || rule?.previousStatus === "missing" ? rule.previousStatus : "pass",
        currentStatus: rule?.currentStatus === "fail" || rule?.currentStatus === "missing" ? rule.currentStatus : "pass",
        previousViolationCount: rule?.previousViolationCount ?? 0,
        currentViolationCount: rule?.currentViolationCount ?? 0,
        violationDelta: rule?.violationDelta ?? 0,
      })),
      newFailingRules: safeArray(payload.comparison.newFailingRules).map((rule) => ({
        id: rule?.id ?? "",
        title: rule?.title ?? "",
        suite: rule?.suite === "cycles" ? "cycles" : "boundaries",
        previousStatus: rule?.previousStatus === "fail" || rule?.previousStatus === "missing" ? rule.previousStatus : "pass",
        currentStatus: rule?.currentStatus === "fail" || rule?.currentStatus === "missing" ? rule.currentStatus : "pass",
        previousViolationCount: rule?.previousViolationCount ?? 0,
        currentViolationCount: rule?.currentViolationCount ?? 0,
        violationDelta: rule?.violationDelta ?? 0,
      })),
      resolvedRules: safeArray(payload.comparison.resolvedRules).map((rule) => ({
        id: rule?.id ?? "",
        title: rule?.title ?? "",
        suite: rule?.suite === "cycles" ? "cycles" : "boundaries",
        previousStatus: rule?.previousStatus === "fail" || rule?.previousStatus === "missing" ? rule.previousStatus : "pass",
        currentStatus: rule?.currentStatus === "fail" || rule?.currentStatus === "missing" ? rule.currentStatus : "pass",
        previousViolationCount: rule?.previousViolationCount ?? 0,
        currentViolationCount: rule?.currentViolationCount ?? 0,
        violationDelta: rule?.violationDelta ?? 0,
      })),
    } : null,
  };
}

function normalizeGitHubActionsFlowsResponse(
  payload: Partial<GitHubActionsFlowsResponse> | null | undefined,
): GitHubActionsFlowsResponse {
  return {
    generatedAt: payload?.generatedAt ?? "",
    repoRoot: payload?.repoRoot ?? "",
    workflowsDir: payload?.workflowsDir ?? "",
    flows: safeArray(payload?.flows).map((flow) => ({
      ...flow,
      jobs: safeArray(flow.jobs).map((job) => ({
        ...job,
        needs: safeArray(job.needs),
      })),
    })),
    warnings: safeArray(payload?.warnings),
  };
}

function normalizeAgentHooksResponse(
  payload: Partial<AgentHooksResponse> | null | undefined,
): AgentHooksResponse {
  return {
    generatedAt: payload?.generatedAt ?? "",
    repoRoot: payload?.repoRoot ?? "",
    configFile: payload?.configFile ?? null,
    configFiles: safeArray(payload?.configFiles),
    hooks: safeArray(payload?.hooks),
    warnings: safeArray(payload?.warnings),
  };
}

function normalizeSpecDetectionResponse(
  payload: Partial<SpecDetectionResponse> | null | undefined,
): SpecDetectionResponse {
  return {
    generatedAt: payload?.generatedAt ?? "",
    repoRoot: payload?.repoRoot ?? "",
    sources: safeArray(payload?.sources).map((source) => ({
      ...source,
      evidence: safeArray(source.evidence),
      children: safeArray(source.children),
      features: Array.isArray(source.features)
        ? source.features.map((feature) => ({
          ...feature,
          documents: safeArray(feature.documents),
        }))
        : undefined,
    })),
    warnings: safeArray(payload?.warnings),
  };
}

function normalizeDesignDecisionResponse(
  payload: Partial<DesignDecisionResponse> | null | undefined,
): DesignDecisionResponse {
  return {
    generatedAt: payload?.generatedAt ?? "",
    repoRoot: payload?.repoRoot ?? "",
    sources: safeArray(payload?.sources).map((source) => ({
      ...source,
      artifacts: safeArray(source.artifacts),
    })),
    warnings: safeArray(payload?.warnings),
  };
}

function normalizeCodeownersResponse(
  payload: Partial<CodeownersResponse> | null | undefined,
): CodeownersResponse {
  return {
    generatedAt: payload?.generatedAt ?? "",
    repoRoot: payload?.repoRoot ?? "",
    codeownersFile: payload?.codeownersFile ?? null,
    owners: safeArray(payload?.owners),
    rules: safeArray(payload?.rules).map((rule) => ({
      ...rule,
      owners: safeArray(rule.owners),
    })),
    coverage: {
      unownedFiles: safeArray(payload?.coverage?.unownedFiles),
      overlappingFiles: safeArray(payload?.coverage?.overlappingFiles),
      sensitiveUnownedFiles: safeArray(payload?.coverage?.sensitiveUnownedFiles),
    },
    correlation: payload?.correlation
      ? {
        ...payload.correlation,
        triggerCorrelations: safeArray(payload.correlation.triggerCorrelations).map((correlation) => ({
          ...correlation,
          ownerGroups: safeArray(correlation.ownerGroups),
          unownedPaths: safeArray(correlation.unownedPaths),
          overlappingPaths: safeArray(correlation.overlappingPaths),
        })),
        hotspots: safeArray(payload.correlation.hotspots).map((hotspot) => ({
          ...hotspot,
          samplePaths: safeArray(hotspot.samplePaths),
        })),
      }
      : undefined,
    warnings: safeArray(payload?.warnings),
  };
}

function normalizeAutomationsResponse(
  payload: Partial<HarnessAutomationResponse> | null | undefined,
): HarnessAutomationResponse {
  return {
    generatedAt: payload?.generatedAt ?? "",
    repoRoot: payload?.repoRoot ?? "",
    configFile: payload?.configFile ?? null,
    definitions: safeArray(payload?.definitions),
    pendingSignals: safeArray(payload?.pendingSignals),
    recentRuns: safeArray(payload?.recentRuns),
    warnings: safeArray(payload?.warnings),
  };
}

export function useHarnessSettingsData({
  workspaceId,
  codebaseId,
  repoPath,
  selectedTier,
  enableArchitecture = false,
  preferCurrentRepoForArchitecture = false,
}: HarnessSettingsDataArgs) {
  const hasRepoContext = Boolean(workspaceId || codebaseId || repoPath);
  const baseQuery = useMemo(() => (hasRepoContext ? buildHarnessQuery(workspaceId, codebaseId, repoPath) : null), [codebaseId, hasRepoContext, repoPath, workspaceId]);
  const architectureQuery = useMemo(
    () => (hasRepoContext
      ? buildHarnessQuery(
        workspaceId,
        preferCurrentRepoForArchitecture && workspaceId ? undefined : codebaseId,
        preferCurrentRepoForArchitecture && workspaceId ? undefined : repoPath,
      )
      : null),
    [codebaseId, hasRepoContext, preferCurrentRepoForArchitecture, repoPath, workspaceId],
  );

  const [specsState, setSpecsState] = useState<QueryState<SpecsResponse>>(emptyQueryState);
  const [planState, setPlanState] = useState<QueryState<PlanResponse>>(emptyQueryState);
  const [architectureState, setArchitectureState] = useState<QueryState<ArchitectureQualityResponse>>(emptyQueryState);
  const [hooksState, setHooksState] = useState<QueryState<HooksResponse>>(emptyQueryState);
  const [instructionsState, setInstructionsState] = useState<QueryState<InstructionsResponse>>(emptyQueryState);
  const [githubActionsState, setGithubActionsState] = useState<QueryState<GitHubActionsFlowsResponse>>(emptyQueryState);
  const [agentHooksState, setAgentHooksState] = useState<QueryState<AgentHooksResponse>>(emptyQueryState);
  const [specSourcesState, setSpecSourcesState] = useState<QueryState<SpecDetectionResponse>>(emptyQueryState);
  const [designDecisionsState, setDesignDecisionsState] = useState<QueryState<DesignDecisionResponse>>(emptyQueryState);
  const [codeownersState, setCodeownersState] = useState<QueryState<CodeownersResponse>>(emptyQueryState);
  const [automationsState, setAutomationsState] = useState<QueryState<HarnessAutomationResponse>>(emptyQueryState);
  const [instructionsRefreshState, setInstructionsRefreshState] = useState<InstructionRefreshState>({ contextKey: "", token: 0 });
  const [architectureRefreshState, setArchitectureRefreshState] = useState<ArchitectureRefreshState>({ contextKey: "", token: 0 });
  const instructionsContextKey = baseQuery?.toString() ?? "";
  const architectureContextKey = architectureQuery?.toString() ?? "";
  useEffect(() => { setArchitectureState(emptyQueryState()); }, [architectureContextKey]);

  useEffect(() => {
    if (!baseQuery) {
      setSpecsState(emptyQueryState());
      return;
    }

    let cancelled = false;
    const fetchSpecs = async () => {
      setSpecsState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await desktopAwareFetch(`/api/fitness/specs?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load fitness specs");
        }
        if (!cancelled) {
          setSpecsState({
            loading: false,
            error: null,
            data: normalizeSpecsResponse(payload as Partial<SpecsResponse>),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setSpecsState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            data: null,
          });
        }
      }
    };

    void fetchSpecs();
    return () => {
      cancelled = true;
    };
  }, [baseQuery]);

  useEffect(() => {
    if (!baseQuery) {
      setPlanState(emptyQueryState());
      return;
    }

    let cancelled = false;
    const fetchPlan = async () => {
      setPlanState({ loading: true, error: null, data: null });
      try {
        const query = new URLSearchParams(baseQuery);
        query.set("tier", selectedTier);
        query.set("scope", "local");
        const response = await desktopAwareFetch(`/api/fitness/plan?${query.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load fitness plan");
        }
        if (!cancelled) {
          setPlanState({
            loading: false,
            error: null,
            data: normalizePlanResponse(payload as Partial<PlanResponse>),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setPlanState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            data: null,
          });
        }
      }
    };

    void fetchPlan();
    return () => {
      cancelled = true;
    };
  }, [baseQuery, selectedTier]);

  useEffect(() => {
    if (!architectureQuery) {
      return;
    }
    if (!enableArchitecture) {
      return;
    }

    const shouldFetch = (
      architectureRefreshState.contextKey === architectureContextKey
      && architectureRefreshState.token > 0
    );
    if (!shouldFetch) {
      return;
    }

    let cancelled = false;
    const fetchArchitecture = async () => {
      setArchitectureState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await desktopAwareFetch(`/api/fitness/architecture?${architectureQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load architecture quality");
        }
        if (!cancelled) {
          setArchitectureState({
            loading: false,
            error: null,
            data: normalizeArchitectureResponse(payload as Partial<ArchitectureQualityResponse>),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setArchitectureState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            data: null,
          });
        }
      }
    };

    void fetchArchitecture();
    return () => {
      cancelled = true;
    };
  }, [architectureContextKey, architectureQuery, architectureRefreshState, enableArchitecture]);

  useEffect(() => {
    if (!baseQuery) {
      setHooksState(emptyQueryState());
      return;
    }

    let cancelled = false;
    const fetchHooks = async () => {
      setHooksState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await desktopAwareFetch(`/api/harness/hooks?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load hook runtime");
        }
        if (!cancelled) {
          setHooksState({
            loading: false,
            error: null,
            data: normalizeHooksResponse(payload as Partial<HooksResponse>),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setHooksState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            data: null,
          });
        }
      }
    };

    void fetchHooks();
    return () => {
      cancelled = true;
    };
  }, [baseQuery]);

  useEffect(() => {
    if (!baseQuery) {
      setInstructionsState(emptyQueryState());
      return;
    }

    let cancelled = false;
    const fetchInstructions = async () => {
      setInstructionsState((current) => ({ ...current, loading: true, error: null }));
      try {
        const query = new URLSearchParams(baseQuery);
        const includeAudit = (
          instructionsRefreshState.contextKey === instructionsContextKey &&
          instructionsRefreshState.token > 0
        );
        query.set("includeAudit", includeAudit ? "1" : "0");
        const response = await desktopAwareFetch(`/api/harness/instructions?${query.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load guidance document");
        }
        if (!cancelled) {
          setInstructionsState({
            loading: false,
            error: null,
            data: normalizeInstructionsResponse(payload as Partial<InstructionsResponse>),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setInstructionsState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            data: null,
          });
        }
      }
    };

    void fetchInstructions();
    return () => {
      cancelled = true;
    };
  }, [baseQuery, instructionsContextKey, instructionsRefreshState]);

  useEffect(() => {
    if (!baseQuery) {
      setGithubActionsState(emptyQueryState());
      return;
    }

    let cancelled = false;
    const fetchGithubActions = async () => {
      setGithubActionsState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await desktopAwareFetch(`/api/harness/github-actions?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load GitHub Actions workflows");
        }
        if (!cancelled) {
          setGithubActionsState({
            loading: false,
            error: null,
            data: normalizeGitHubActionsFlowsResponse(payload as Partial<GitHubActionsFlowsResponse>),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setGithubActionsState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            data: null,
          });
        }
      }
    };

    void fetchGithubActions();
    return () => {
      cancelled = true;
    };
  }, [baseQuery]);

  useEffect(() => {
    if (!baseQuery) {
      setAgentHooksState(emptyQueryState());
      return;
    }

    let cancelled = false;
    const fetchAgentHooks = async () => {
      setAgentHooksState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await desktopAwareFetch(`/api/harness/agent-hooks?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load agent hooks");
        }
        if (!cancelled) {
          setAgentHooksState({
            loading: false,
            error: null,
            data: normalizeAgentHooksResponse(payload as Partial<AgentHooksResponse>),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setAgentHooksState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            data: null,
          });
        }
      }
    };

    void fetchAgentHooks();
    return () => {
      cancelled = true;
    };
  }, [baseQuery]);

  const reloadInstructions = useCallback(() => {
    setInstructionsRefreshState((current) => ({
      contextKey: instructionsContextKey,
      token: current.contextKey === instructionsContextKey ? current.token + 1 : 1,
    }));
  }, [instructionsContextKey]);

  const reloadArchitecture = useCallback(() => {
    setArchitectureRefreshState((current) => ({
      contextKey: architectureContextKey,
      token: current.contextKey === architectureContextKey ? current.token + 1 : 1,
    }));
  }, [architectureContextKey]);

  useEffect(() => {
    if (!baseQuery) {
      setSpecSourcesState(emptyQueryState());
      return;
    }

    let cancelled = false;
    const fetchSpecSources = async () => {
      setSpecSourcesState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await desktopAwareFetch(`/api/harness/spec-sources?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load spec sources");
        }
        if (!cancelled) {
          setSpecSourcesState({
            loading: false,
            error: null,
            data: normalizeSpecDetectionResponse(payload as Partial<SpecDetectionResponse>),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setSpecSourcesState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            data: null,
          });
        }
      }
    };

    void fetchSpecSources();
    return () => {
      cancelled = true;
    };
  }, [baseQuery]);

  useEffect(() => {
    if (!baseQuery) {
      setDesignDecisionsState(emptyQueryState());
      return;
    }

    let cancelled = false;
    const fetchDesignDecisions = async () => {
      setDesignDecisionsState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await desktopAwareFetch(`/api/harness/design-decisions?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load design decisions");
        }
        if (!cancelled) {
          setDesignDecisionsState({
            loading: false,
            error: null,
            data: normalizeDesignDecisionResponse(payload as Partial<DesignDecisionResponse>),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setDesignDecisionsState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            data: null,
          });
        }
      }
    };

    void fetchDesignDecisions();
    return () => {
      cancelled = true;
    };
  }, [baseQuery]);

  useEffect(() => {
    if (!baseQuery) {
      setCodeownersState(emptyQueryState());
      return;
    }

    let cancelled = false;
    const fetchCodeowners = async () => {
      setCodeownersState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await desktopAwareFetch(`/api/harness/codeowners?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load CODEOWNERS");
        }
        if (!cancelled) {
          setCodeownersState({
            loading: false,
            error: null,
            data: normalizeCodeownersResponse(payload as Partial<CodeownersResponse>),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setCodeownersState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            data: null,
          });
        }
      }
    };

    void fetchCodeowners();
    return () => {
      cancelled = true;
    };
  }, [baseQuery]);

  useEffect(() => {
    if (!baseQuery) {
      setAutomationsState(emptyQueryState());
      return;
    }

    let cancelled = false;
    const fetchAutomations = async () => {
      setAutomationsState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await desktopAwareFetch(`/api/harness/automations?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load repo-defined automations");
        }
        if (!cancelled) {
          setAutomationsState({
            loading: false,
            error: null,
            data: normalizeAutomationsResponse(payload as Partial<HarnessAutomationResponse>),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setAutomationsState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            data: null,
          });
        }
      }
    };

    void fetchAutomations();
    return () => {
      cancelled = true;
    };
  }, [baseQuery]);

  return {
    specsState,
    planState,
    architectureState,
    hooksState,
    agentHooksState,
    instructionsState,
    githubActionsState,
    specSourcesState,
    designDecisionsState,
    codeownersState,
    automationsState,
    reloadArchitecture,
    reloadInstructions,
  };
}
