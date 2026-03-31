"use client";

import { useEffect, useState } from "react";
import { HarnessAgentHookWorkbench } from "@/client/components/harness-agent-hook-workbench";
import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type { AgentHooksResponse } from "@/client/hooks/use-harness-settings-data";

type AgentHookPanelProps = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: AgentHooksResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
  embedded?: boolean;
};

type AgentHooksState = {
  loading: boolean;
  error: string | null;
  data: AgentHooksResponse | null;
};

export function HarnessAgentHookPanel({
  workspaceId,
  codebaseId,
  repoPath,
  repoLabel: _repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  variant = "full",
  embedded = false,
}: AgentHookPanelProps) {
  const hasExternalState = loading !== undefined || error !== undefined || data !== undefined;
  const [agentHooksState, setAgentHooksState] = useState<AgentHooksState>({
    loading: false,
    error: null,
    data: null,
  });

  useEffect(() => {
    if (hasExternalState) {
      return;
    }
    if (!workspaceId || !repoPath) {
      setAgentHooksState({ loading: false, error: null, data: null });
      return;
    }

    let cancelled = false;

    const fetchAgentHooks = async () => {
      setAgentHooksState({ loading: true, error: null, data: null });

      try {
        const query = new URLSearchParams();
        query.set("workspaceId", workspaceId);
        if (codebaseId) {
          query.set("codebaseId", codebaseId);
        }
        query.set("repoPath", repoPath);

        const response = await fetch(`/api/harness/agent-hooks?${query.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load agent hooks");
        }

        if (cancelled) {
          return;
        }

        setAgentHooksState({ loading: false, error: null, data: payload as AgentHooksResponse });
      } catch (fetchError) {
        if (cancelled) {
          return;
        }

        setAgentHooksState({
          loading: false,
          error: fetchError instanceof Error ? fetchError.message : String(fetchError),
          data: null,
        });
      }
    };

    void fetchAgentHooks();
    return () => {
      cancelled = true;
    };
  }, [codebaseId, hasExternalState, repoPath, workspaceId]);

  const resolvedState = hasExternalState
    ? { loading: loading ?? false, error: error ?? null, data: data ?? null }
    : agentHooksState;

  const description = "Policy hooks that configure agent-side runtime behavior.";
  const systemAction = <span className="text-[10px] text-desktop-text-secondary">Hook systems</span>;

  const agentHookStateFrame = () => {
    if (resolvedState.loading) {
      return <HarnessSectionStateFrame>Loading agent hooks...</HarnessSectionStateFrame>;
    }

    if (unsupportedMessage) {
      return <HarnessUnsupportedState className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-[11px] text-amber-800" />;
    }

    if (resolvedState.error) {
      return <HarnessSectionStateFrame tone="error">{resolvedState.error}</HarnessSectionStateFrame>;
    }

    if (!resolvedState.data) {
      return (
        <HarnessSectionStateFrame>
          No agent hook data found for the selected repository.
        </HarnessSectionStateFrame>
      );
    }

    return (
      <HarnessAgentHookWorkbench
        data={resolvedState.data}
        unsupportedMessage={unsupportedMessage}
        variant={variant}
        embedded={embedded}
      />
    );
  };

  if (embedded) {
    return <div className="space-y-3">{agentHookStateFrame()}</div>;
  }

  return (
    <HarnessSectionCard title="Hook systems" description={description} actions={systemAction} variant={variant}>
      {agentHookStateFrame()}
    </HarnessSectionCard>
  );
}
