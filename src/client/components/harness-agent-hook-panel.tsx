"use client";

import { useEffect, useState } from "react";
import { HarnessAgentHookWorkbench } from "@/client/components/harness-agent-hook-workbench";
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

  const sectionClass = variant === "compact"
    ? "rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4"
    : "rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm";

  if (resolvedState.loading) {
    return (
      <section className={sectionClass}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Agent hook system</div>
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Loading agent hooks...
        </div>
      </section>
    );
  }

  if (unsupportedMessage) {
    return (
      <section className={sectionClass}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Agent hook system</div>
        <HarnessUnsupportedState />
      </section>
    );
  }

  if (resolvedState.error) {
    return (
      <section className={sectionClass}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Agent hook system</div>
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-[11px] text-red-700">
          {resolvedState.error}
        </div>
      </section>
    );
  }

  if (!resolvedState.data) {
    return (
      <section className={sectionClass}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Agent hook system</div>
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          No agent hook data found for the selected repository.
        </div>
      </section>
    );
  }

  return (
    <HarnessAgentHookWorkbench
      data={resolvedState.data}
      unsupportedMessage={unsupportedMessage}
      variant={variant}
    />
  );
}
