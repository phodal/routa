"use client";

import { useEffect, useState } from "react";
import { HarnessHookWorkbench } from "@/client/components/harness-hook-workbench";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type { HooksResponse } from "@/client/hooks/use-harness-settings-data";

type HooksPanelProps = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: HooksResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
};

type HooksState = {
  loading: boolean;
  error: string | null;
  data: HooksResponse | null;
};

export function HarnessHookRuntimePanel({
  workspaceId,
  codebaseId,
  repoPath,
  repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  variant = "full",
}: HooksPanelProps) {
  const hasExternalState = loading !== undefined || error !== undefined || data !== undefined;
  const [hooksState, setHooksState] = useState<HooksState>({
    loading: false,
    error: null,
    data: null,
  });

  useEffect(() => {
    if (hasExternalState) {
      return;
    }
    if (!workspaceId || !repoPath) {
      setHooksState({
        loading: false,
        error: null,
        data: null,
      });
      return;
    }

    let cancelled = false;

    const fetchHooks = async () => {
      setHooksState({
        loading: true,
        error: null,
        data: null,
      });

      try {
        const query = new URLSearchParams();
        query.set("workspaceId", workspaceId);
        if (codebaseId) {
          query.set("codebaseId", codebaseId);
        }
        query.set("repoPath", repoPath);

        const response = await fetch(`/api/harness/hooks?${query.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load hook runtime");
        }

        if (cancelled) {
          return;
        }

        setHooksState({
          loading: false,
          error: null,
          data: payload as HooksResponse,
        });
      } catch (fetchError) {
        if (cancelled) {
          return;
        }

        setHooksState({
          loading: false,
          error: fetchError instanceof Error ? fetchError.message : String(fetchError),
          data: null,
        });
      }
    };

    void fetchHooks();
    return () => {
      cancelled = true;
    };
  }, [codebaseId, hasExternalState, repoPath, workspaceId]);

  const resolvedState = hasExternalState
    ? {
      loading: loading ?? false,
      error: error ?? null,
      data: data ?? null,
    }
    : hooksState;

  if (resolvedState.loading) {
    return (
      <section className={variant === "compact"
        ? "rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4"
        : "rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm"}
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Hook system</div>
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Loading hook runtime...
        </div>
      </section>
    );
  }

  if (unsupportedMessage) {
    return (
      <section className={variant === "compact"
        ? "rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4"
        : "rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm"}
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Hook system</div>
        <HarnessUnsupportedState />
      </section>
    );
  }

  if (resolvedState.error) {
    return (
      <section className={variant === "compact"
        ? "rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4"
        : "rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm"}
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Hook system</div>
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-[11px] text-red-700">
          {resolvedState.error}
        </div>
      </section>
    );
  }

  if (!resolvedState.data) {
    return (
      <section className={variant === "compact"
        ? "rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4"
        : "rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm"}
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Hook system</div>
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          No hook runtime data found for the selected repository.
        </div>
      </section>
    );
  }

  return (
    <HarnessHookWorkbench
      workspaceId={workspaceId}
      codebaseId={codebaseId}
      repoPath={repoPath}
      repoLabel={repoLabel}
      data={resolvedState.data}
      unsupportedMessage={unsupportedMessage}
      variant={variant}
    />
  );
}
