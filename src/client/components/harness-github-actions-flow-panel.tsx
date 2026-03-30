"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { HarnessGitHubActionsFlowGallery } from "@/client/components/harness-github-actions-flow-gallery";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type {
  GitHubActionsFlow,
  GitHubActionsFlowsResponse,
} from "@/client/hooks/use-harness-settings-data";
import type { GitHubWorkflowCategory as WorkflowCategoryKey } from "@/core/github/workflow-classifier";

type FlowState = {
  error: string | null;
  flows: GitHubActionsFlow[];
  loadedContextKey: string;
};

type HarnessGitHubActionsFlowPanelProps = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: GitHubActionsFlowsResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
  initialCategory?: WorkflowCategoryKey;
};

function panelClassName(variant: "full" | "compact") {
  return variant === "compact"
    ? "rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(243,247,252,0.92))] p-3.5"
    : "rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(252,253,255,0.98),rgba(243,247,252,0.94))] p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05)]";
}

function PanelStateFrame({
  variant,
  children,
}: {
  variant: "full" | "compact";
  children: ReactNode;
}) {
  return (
    <section className={panelClassName(variant)}>
      <div className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,248,252,0.95))] p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Repository workflows</div>
        <h2 className="mt-2 text-[24px] font-semibold tracking-[-0.04em] text-slate-950">
          GitHub Actions Flow Gallery
        </h2>
        <div className="mt-4">{children}</div>
      </div>
    </section>
  );
}

export function HarnessGitHubActionsFlowPanel({
  workspaceId,
  codebaseId,
  repoPath,
  repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  variant = "full",
  initialCategory,
}: HarnessGitHubActionsFlowPanelProps) {
  const hasExternalState = loading !== undefined || error !== undefined || data !== undefined;
  const hasContext = Boolean(workspaceId && repoPath);
  const contextKey = hasContext ? `${workspaceId}:${codebaseId ?? "repo-only"}:${repoPath}` : "";

  const [flowState, setFlowState] = useState<FlowState>({
    error: null,
    flows: [],
    loadedContextKey: "",
  });

  useEffect(() => {
    if (hasExternalState || !hasContext) {
      return;
    }

    let cancelled = false;

    const timer = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      const query = new URLSearchParams();
      query.set("workspaceId", workspaceId);
      if (codebaseId) {
        query.set("codebaseId", codebaseId);
      }
      if (repoPath) {
        query.set("repoPath", repoPath);
      }

      void fetch(`/api/harness/github-actions?${query.toString()}`)
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load GitHub Actions workflows");
          }
          if (cancelled) {
            return;
          }
          setFlowState({
            error: null,
            flows: Array.isArray(payload?.flows) ? payload.flows as GitHubActionsFlow[] : [],
            loadedContextKey: contextKey,
          });
        })
        .catch((fetchError: unknown) => {
          if (cancelled) {
            return;
          }
          setFlowState({
            error: fetchError instanceof Error ? fetchError.message : String(fetchError),
            flows: [],
            loadedContextKey: contextKey,
          });
        });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [codebaseId, contextKey, hasContext, hasExternalState, repoPath, workspaceId]);

  const resolvedFlowState = hasExternalState
    ? {
      error: error ?? null,
      flows: Array.isArray(data?.flows) ? data.flows : [],
      loadedContextKey: contextKey,
    }
    : flowState;

  const visibleFlows = useMemo(
    () => (hasContext && resolvedFlowState.loadedContextKey === contextKey ? resolvedFlowState.flows : []),
    [contextKey, hasContext, resolvedFlowState.flows, resolvedFlowState.loadedContextKey],
  );

  const isLoading = hasExternalState
    ? Boolean(loading)
    : (hasContext && resolvedFlowState.loadedContextKey !== contextKey && !resolvedFlowState.error);

  if (isLoading) {
    return (
      <PanelStateFrame variant={variant}>
        <div className="rounded-[24px] border border-slate-200 bg-white/85 px-4 py-6 text-[12px] text-slate-500">
          Loading GitHub Actions workflows...
        </div>
      </PanelStateFrame>
    );
  }

  if (unsupportedMessage) {
    return (
      <PanelStateFrame variant={variant}>
        <HarnessUnsupportedState />
      </PanelStateFrame>
    );
  }

  if (resolvedFlowState.error) {
    return (
      <PanelStateFrame variant={variant}>
        <div className="rounded-[24px] border border-red-200 bg-red-50 px-4 py-6 text-[12px] text-red-700">
          {resolvedFlowState.error}
        </div>
      </PanelStateFrame>
    );
  }

  if (visibleFlows.length === 0) {
    return (
      <PanelStateFrame variant={variant}>
        <div className="rounded-[24px] border border-slate-200 bg-white/85 px-4 py-6 text-[12px] text-slate-500">
          Select a repository to inspect workflow flows.
        </div>
      </PanelStateFrame>
    );
  }

  return (
    <section className={panelClassName(variant)}>
      <HarnessGitHubActionsFlowGallery
        key={initialCategory ?? "Validation"}
        flows={visibleFlows}
        repoLabel={repoLabel}
        variant={variant}
        initialCategory={initialCategory}
      />
    </section>
  );
}
