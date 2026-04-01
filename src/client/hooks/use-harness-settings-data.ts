"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlanResponse, TierValue } from "@/client/components/harness-execution-plan-flow";
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

export type QueryState<T> = {
  loading: boolean;
  error: string | null;
  data: T | null;
};

type HarnessSettingsDataArgs = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  selectedTier: TierValue;
};

type InstructionRefreshState = {
  contextKey: string;
  token: number;
};

function buildHarnessQuery(workspaceId: string, codebaseId?: string, repoPath?: string) {
  const query = new URLSearchParams();
  query.set("workspaceId", workspaceId);
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

export function useHarnessSettingsData({
  workspaceId,
  codebaseId,
  repoPath,
  selectedTier,
}: HarnessSettingsDataArgs) {
  const hasRepoContext = Boolean(workspaceId && repoPath);
  const baseQuery = useMemo(
    () => (hasRepoContext ? buildHarnessQuery(workspaceId, codebaseId, repoPath) : null),
    [codebaseId, hasRepoContext, repoPath, workspaceId],
  );

  const [specsState, setSpecsState] = useState<QueryState<SpecsResponse>>(emptyQueryState);
  const [planState, setPlanState] = useState<QueryState<PlanResponse>>(emptyQueryState);
  const [hooksState, setHooksState] = useState<QueryState<HooksResponse>>(emptyQueryState);
  const [instructionsState, setInstructionsState] = useState<QueryState<InstructionsResponse>>(emptyQueryState);
  const [githubActionsState, setGithubActionsState] = useState<QueryState<GitHubActionsFlowsResponse>>(emptyQueryState);
  const [agentHooksState, setAgentHooksState] = useState<QueryState<AgentHooksResponse>>(emptyQueryState);
  const [specSourcesState, setSpecSourcesState] = useState<QueryState<SpecDetectionResponse>>(emptyQueryState);
  const [designDecisionsState, setDesignDecisionsState] = useState<QueryState<DesignDecisionResponse>>(emptyQueryState);
  const [codeownersState, setCodeownersState] = useState<QueryState<CodeownersResponse>>(emptyQueryState);
  const [instructionsRefreshState, setInstructionsRefreshState] = useState<InstructionRefreshState>({
    contextKey: "",
    token: 0,
  });
  const instructionsContextKey = baseQuery?.toString() ?? "";

  useEffect(() => {
    if (!baseQuery) {
      setSpecsState(emptyQueryState());
      return;
    }

    let cancelled = false;
    const fetchSpecs = async () => {
      setSpecsState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await fetch(`/api/fitness/specs?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load fitness specs");
        }
        if (!cancelled) {
          setSpecsState({
            loading: false,
            error: null,
            data: payload as SpecsResponse,
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
        const response = await fetch(`/api/fitness/plan?${query.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load fitness plan");
        }
        if (!cancelled) {
          setPlanState({
            loading: false,
            error: null,
            data: payload as PlanResponse,
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
    if (!baseQuery) {
      setHooksState(emptyQueryState());
      return;
    }

    let cancelled = false;
    const fetchHooks = async () => {
      setHooksState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await fetch(`/api/harness/hooks?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load hook runtime");
        }
        if (!cancelled) {
          setHooksState({
            loading: false,
            error: null,
            data: payload as HooksResponse,
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
        const response = await fetch(`/api/harness/instructions?${query.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load guidance document");
        }
        if (!cancelled) {
          setInstructionsState({
            loading: false,
            error: null,
            data: payload as InstructionsResponse,
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
        const response = await fetch(`/api/harness/github-actions?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load GitHub Actions workflows");
        }
        if (!cancelled) {
          setGithubActionsState({
            loading: false,
            error: null,
            data: payload as GitHubActionsFlowsResponse,
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
        const response = await fetch(`/api/harness/agent-hooks?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load agent hooks");
        }
        if (!cancelled) {
          setAgentHooksState({
            loading: false,
            error: null,
            data: payload as AgentHooksResponse,
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

  useEffect(() => {
    if (!baseQuery) {
      setSpecSourcesState(emptyQueryState());
      return;
    }

    let cancelled = false;
    const fetchSpecSources = async () => {
      setSpecSourcesState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await fetch(`/api/harness/spec-sources?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load spec sources");
        }
        if (!cancelled) {
          setSpecSourcesState({
            loading: false,
            error: null,
            data: payload as SpecDetectionResponse,
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
        const response = await fetch(`/api/harness/design-decisions?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load design decisions");
        }
        if (!cancelled) {
          setDesignDecisionsState({
            loading: false,
            error: null,
            data: payload as DesignDecisionResponse,
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
        const response = await fetch(`/api/harness/codeowners?${baseQuery.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load CODEOWNERS");
        }
        if (!cancelled) {
          setCodeownersState({
            loading: false,
            error: null,
            data: payload as CodeownersResponse,
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

  return {
    specsState,
    planState,
    hooksState,
    agentHooksState,
    instructionsState,
    githubActionsState,
    specSourcesState,
    designDecisionsState,
    codeownersState,
    reloadInstructions,
  };
}
