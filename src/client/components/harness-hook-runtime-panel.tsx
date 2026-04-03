"use client";

import { useEffect, useState } from "react";
import { HarnessHookWorkbench } from "@/client/components/harness-hook-workbench";
import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type { HooksResponse } from "@/client/hooks/use-harness-settings-data";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

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
  embedded?: boolean;
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
  repoLabel: _repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  variant = "full",
  embedded = false,
}: HooksPanelProps) {
  const { t } = useTranslation();
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

        const response = await desktopAwareFetch(`/api/harness/hooks?${query.toString()}`);
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

  const runtimeStateFrame = () => {
    if (resolvedState.loading) {
      return <HarnessSectionStateFrame>{t.harness.hookRuntime.loadingHookRuntime}</HarnessSectionStateFrame>;
    }

    if (unsupportedMessage) {
      return <HarnessUnsupportedState className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-4 text-[11px] text-amber-800" />;
    }

    if (resolvedState.error) {
      return <HarnessSectionStateFrame tone="error">{resolvedState.error}</HarnessSectionStateFrame>;
    }

    if (!resolvedState.data) {
      return (
        <HarnessSectionStateFrame>
          {t.harness.hookRuntime.noHookRuntimeData}
        </HarnessSectionStateFrame>
      );
    }

    return (
      <HarnessHookWorkbench
        data={resolvedState.data}
        unsupportedMessage={unsupportedMessage}
        variant={variant}
        embedded={embedded}
      />
    );
  };

  if (embedded) {
    return <div className="space-y-3">{runtimeStateFrame()}</div>;
  }

  return (
    <HarnessSectionCard title="Hook systems" variant={variant}>
      {runtimeStateFrame()}
    </HarnessSectionCard>
  );
}
