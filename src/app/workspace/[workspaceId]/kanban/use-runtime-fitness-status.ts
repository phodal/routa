"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { resolveApiPath } from "@/client/config/backend";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { RuntimeFitnessStatusResponse } from "@/core/fitness/runtime-status-types";

const RUNTIME_FITNESS_POLL_MS = 5_000;

type UseRuntimeFitnessStatusOptions = {
  workspaceId: string;
  codebaseId?: string | null;
  repoPath?: string | null;
  enabled?: boolean;
  refreshSignal?: number;
  isPageVisible?: boolean;
};

type RuntimeFitnessState = {
  data: RuntimeFitnessStatusResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useRuntimeFitnessStatus({
  workspaceId,
  codebaseId,
  repoPath,
  enabled = true,
  refreshSignal,
  isPageVisible = true,
}: UseRuntimeFitnessStatusOptions): RuntimeFitnessState {
  const [data, setData] = useState<RuntimeFitnessStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const inFlightRef = useRef(false);
  const { t } = useTranslation();
  const loadErrorMessage = t.kanban.fitnessLoadError;

  const queryString = useMemo(() => {
    const query = new URLSearchParams();
    if (codebaseId) {
      query.set("codebaseId", codebaseId);
    } else if (repoPath) {
      query.set("repoPath", repoPath);
    } else if (workspaceId) {
      query.set("workspaceId", workspaceId);
    }
    const serialized = query.toString();
    return serialized.length > 0 ? serialized : null;
  }, [codebaseId, repoPath, workspaceId]);

  const fetchStatus = useCallback(async (options?: { signal?: AbortSignal; showLoading?: boolean }) => {
    if (!enabled || !queryString || inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    if (options?.showLoading) {
      setLoading(true);
    }

    try {
      const response = await desktopAwareFetch(`${resolveApiPath("/api/fitness/runtime")}?${queryString}`, {
        cache: "no-store",
        signal: options?.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.details === "string" ? payload.details : loadErrorMessage);
      }
      setData(payload as RuntimeFitnessStatusResponse);
      setError(null);
    } catch (fetchError) {
      if ((fetchError as Error).name === "AbortError") {
        return;
      }
      setError(toMessage(fetchError));
    } finally {
      inFlightRef.current = false;
      if (options?.showLoading) {
        setLoading(false);
      }
    }
  }, [enabled, loadErrorMessage, queryString]);

  useEffect(() => {
    if (!enabled || !queryString) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    void fetchStatus({ signal: controller.signal, showLoading: true });
    return () => controller.abort();
  }, [enabled, fetchStatus, queryString, refreshNonce, refreshSignal]);

  useEffect(() => {
    if (!enabled || !queryString || !isPageVisible) {
      return;
    }

    const timerId = window.setInterval(() => {
      void fetchStatus();
    }, RUNTIME_FITNESS_POLL_MS);

    return () => window.clearInterval(timerId);
  }, [enabled, fetchStatus, isPageVisible, queryString]);

  const refresh = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  return { data, loading, error, refresh };
}
