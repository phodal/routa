"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { X } from "lucide-react";

import { useTranslation } from "@/i18n";
import { useAcp } from "@/client/hooks/use-acp";
import { desktopAwareFetch, toErrorMessage } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { RuntimeFitnessStatusResponse } from "@/core/fitness/runtime-status-types";
import type { FitnessSpecSummary } from "@/client/hooks/use-harness-settings-data";
import type { PlanResponse } from "@/client/components/harness-execution-plan-flow";
import type { EntrixRunResponse } from "@/core/fitness/entrix-run-types";
import { buildCanvasSpecialistPrompt, extractCanvasSourceFromSpecialistOutput, extractCanvasSpecialistOutputFromHistory } from "@/core/canvas/specialist-source";
import { buildKanbanFitnessWorkbenchUserPrompt } from "./kanban-fitness-workbench-prompt";
import { compileCanvasTsx, CanvasErrorBoundary } from "@/client/canvas-runtime";
import { CanvasThemeProvider } from "@/client/canvas-sdk/theme-context";
import { lightTheme } from "@/client/canvas-sdk/tokens";

type QueryState<T> = {
  loading: boolean;
  error: string | null;
  data: T;
};

function basename(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/");
  return segments[segments.length - 1] ?? normalized;
}

interface KanbanFitnessWorkbenchModalProps {
  open: boolean;
  workspaceId: string;
  codebase: CodebaseData | null;
  runtimeFitness?: RuntimeFitnessStatusResponse | null;
  sessionId: string | null;
  onSessionIdChange: (sessionId: string | null) => void;
  onClose: () => void;
}

function buildBaseFitnessQuery(
  workspaceId: string,
  input: {
    codebaseId?: string | null;
    repoPath?: string | null;
  },
): URLSearchParams {
  const query = new URLSearchParams({ workspaceId });
  if (input.codebaseId) {
    query.set("codebaseId", input.codebaseId);
  }
  if (input.repoPath) {
    query.set("repoPath", input.repoPath);
  }
  return query;
}

function formatSavedAt(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toLocaleTimeString();
}

function ScopedCanvasPreview({ source }: { source: string | null }): JSX.Element {
  const result = useMemo(
    () => (source ? compileCanvasTsx(source) : null),
    [source],
  );
  const Component = result && result.ok ? result.Component : null;
  const compileError = result && !result.ok ? result.error : null;

  return (
    <CanvasThemeProvider theme={lightTheme}>
      <CanvasErrorBoundary>
        <div
          className="min-h-full"
          style={{
            background: lightTheme.tokens.bg.editor,
            color: lightTheme.tokens.text.primary,
            fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: "13px",
            lineHeight: "18px",
          }}
        >
          {Component ? (
            <div className="min-h-full p-5">
              <Component />
            </div>
          ) : source ? (
            <div className="p-5">
              <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] leading-5 text-rose-700">
                {compileError ?? "Canvas compilation failed."}
              </div>
            </div>
          ) : null}
        </div>
      </CanvasErrorBoundary>
    </CanvasThemeProvider>
  );
}

export function KanbanFitnessWorkbenchModal({
  open,
  workspaceId,
  codebase,
  runtimeFitness,
  sessionId,
  onSessionIdChange,
  onClose,
}: KanbanFitnessWorkbenchModalProps) {
  const { t } = useTranslation();
  const acp = useAcp();
  const {
    connect,
    createSession,
    promptSession,
    providers,
    selectedProvider,
    loading: acpLoading,
  } = acp;
  const [specsState, setSpecsState] = useState<QueryState<FitnessSpecSummary[]>>({
    loading: false,
    error: null,
    data: [],
  });
  const [planState, setPlanState] = useState<QueryState<PlanResponse | null>>({
    loading: false,
    error: null,
    data: null,
  });
  const [runtimeState, setRuntimeState] = useState<QueryState<RuntimeFitnessStatusResponse | null>>({
    loading: false,
    error: null,
    data: runtimeFitness ?? null,
  });
  const [entrixState, setEntrixState] = useState<QueryState<EntrixRunResponse | null>>({
    loading: false,
    error: null,
    data: null,
  });
  const [previewSource, setPreviewSource] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [persistedFilePath, setPersistedFilePath] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const pendingPromptSessionIdRef = useRef<string | null>(null);
  const lastPersistedSourceRef = useRef<string | null>(null);
  const latestRuntimeFitnessRef = useRef<RuntimeFitnessStatusResponse | null>(runtimeFitness ?? null);
  const startAttemptedRef = useRef(false);

  const repoPath = codebase?.repoPath ?? "";
  const repoLabel = codebase?.label ?? (repoPath ? basename(repoPath) : "");
  const branch = codebase?.branch ?? null;
  const codebaseId = codebase?.id ?? null;
  const contextReady = open
    && Boolean(repoPath)
    && !specsState.loading
    && !planState.loading
    && !runtimeState.loading
    && !entrixState.loading
    && Boolean(entrixState.data);
  const preferredProvider = useMemo(() => {
    const availableProviders = providers.filter((provider) => provider.status === "available");
    return availableProviders.find((provider) => provider.id === selectedProvider)?.id
      ?? availableProviders.find((provider) => provider.id === "opencode")?.id
      ?? availableProviders[0]?.id
      ?? (selectedProvider === "codex" ? "opencode" : selectedProvider || "opencode");
  }, [providers, selectedProvider]);

  const canvasPrompt = useMemo(() => {
    if (!repoPath || !repoLabel) return null;
    const userPrompt = buildKanbanFitnessWorkbenchUserPrompt({
      workspaceId,
      repoPath,
      repoLabel,
      branch,
      entrixRun: entrixState.data,
      specFiles: specsState.data,
      plan: planState.data,
    });
    return buildCanvasSpecialistPrompt(userPrompt);
  }, [
    branch,
    entrixState.data,
    planState.data,
    repoLabel,
    repoPath,
    specsState.data,
    workspaceId,
  ]);

  useEffect(() => {
    latestRuntimeFitnessRef.current = runtimeFitness ?? null;
  }, [runtimeFitness]);

  useEffect(() => {
    if (!open) {
      startAttemptedRef.current = false;
      return;
    }
    if (!repoPath) {
      setSpecsState({ loading: false, error: null, data: [] });
      setPlanState({ loading: false, error: null, data: null });
      setRuntimeState({ loading: false, error: null, data: latestRuntimeFitnessRef.current });
      setEntrixState({ loading: false, error: null, data: null });
      return;
    }

    const baseQuery = buildBaseFitnessQuery(workspaceId, {
      codebaseId,
      repoPath,
    });
    const planQuery = new URLSearchParams(baseQuery);
    planQuery.set("tier", "normal");
    planQuery.set("scope", "local");

    let cancelled = false;
    setSpecsState((current) => ({ ...current, loading: true, error: null }));
    setPlanState((current) => ({ ...current, loading: true, error: null }));
    setRuntimeState((current) => ({ ...current, loading: true, error: null }));
    setEntrixState({ loading: true, error: null, data: null });

    const loadContext = async () => {
      try {
        const [specsResponse, planResponse, runtimeResponse, entrixResponse] = await Promise.all([
          desktopAwareFetch(resolveApiPath(`/api/fitness/specs?${baseQuery.toString()}`), {
            cache: "no-store",
          }),
          desktopAwareFetch(resolveApiPath(`/api/fitness/plan?${planQuery.toString()}`), {
            cache: "no-store",
          }),
          desktopAwareFetch(resolveApiPath(`/api/fitness/runtime?${baseQuery.toString()}`), {
            cache: "no-store",
          }),
          desktopAwareFetch(resolveApiPath("/api/fitness/run"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId,
              codebaseId: codebaseId ?? undefined,
              repoPath,
              tier: "fast",
              scope: "local",
            }),
          }),
        ]);

        const specsJson = await specsResponse.json().catch(() => null);
        const planJson = await planResponse.json().catch(() => null);
        const runtimeJson = await runtimeResponse.json().catch(() => null);
        const entrixJson = await entrixResponse.json().catch(() => null);
        if (cancelled) return;

        if (specsResponse.ok) {
          setSpecsState({
            loading: false,
            error: null,
            data: Array.isArray(specsJson?.files) ? specsJson.files as FitnessSpecSummary[] : [],
          });
        } else {
          setSpecsState({
            loading: false,
            error: specsJson?.error ?? "Failed to load fitness files",
            data: [],
          });
        }

        if (planResponse.ok) {
          setPlanState({
            loading: false,
            error: null,
            data: (planJson ?? null) as PlanResponse | null,
          });
        } else {
          setPlanState({
            loading: false,
            error: planJson?.error ?? "Failed to load execution plan",
            data: null,
          });
        }

        const nextRuntimeFitness = runtimeResponse.ok
          ? (runtimeJson ?? null) as RuntimeFitnessStatusResponse | null
          : latestRuntimeFitnessRef.current;

        if (runtimeResponse.ok) {
          setRuntimeState({
            loading: false,
            error: null,
            data: nextRuntimeFitness,
          });
        } else {
          setRuntimeState({
            loading: false,
            error: runtimeJson?.error ?? "Failed to load runtime fitness",
            data: latestRuntimeFitnessRef.current,
          });
        }

        if (entrixResponse.ok) {
          setEntrixState({
            loading: false,
            error: null,
            data: (entrixJson ?? null) as EntrixRunResponse | null,
          });
        } else {
          setEntrixState({
            loading: false,
            error: entrixJson?.error ?? "Failed to execute Entrix fitness",
            data: null,
          });
        }
      } catch (error) {
        if (cancelled) return;
        const message = toErrorMessage(error) || "Failed to load fitness context";
        setSpecsState({
          loading: false,
          error: message,
          data: [],
        });
        setPlanState({
          loading: false,
          error: message,
          data: null,
        });
        setRuntimeState({
          loading: false,
          error: message,
          data: latestRuntimeFitnessRef.current,
        });
        setEntrixState({
          loading: false,
          error: message,
          data: null,
        });
      }
    };

    void loadContext();

    return () => {
      cancelled = true;
    };
  }, [codebaseId, open, repoPath, workspaceId]);

  const startSession = useCallback(async () => {
    if (!repoPath || !workspaceId || !canvasPrompt) return;

    setPreviewError(null);
    startAttemptedRef.current = true;

    try {
      await connect();
      const result = await createSession(
        repoPath,
        preferredProvider,
        undefined,
        "DEVELOPER",
        workspaceId,
        undefined,
        undefined,
        "fitness-ui-builder",
        undefined,
        undefined,
        undefined,
        branch ?? undefined,
        "full",
      );

      if (!result?.sessionId) {
        throw new Error("Failed to create fitness specialist session");
      }

      pendingPromptSessionIdRef.current = result.sessionId;
      lastPersistedSourceRef.current = null;
      setPreviewSource(null);
      setPersistedFilePath(null);
      setLastSavedAt(null);
      onSessionIdChange(result.sessionId);
    } catch (error) {
      setPreviewError(toErrorMessage(error) || "Failed to create fitness specialist session");
    }
  }, [
    branch,
    canvasPrompt,
    connect,
    createSession,
    onSessionIdChange,
    preferredProvider,
    repoPath,
    workspaceId,
  ]);

  useEffect(() => {
    if (!contextReady || sessionId || startAttemptedRef.current) {
      return;
    }

    void startSession();
  }, [contextReady, sessionId, startSession]);

  useEffect(() => {
    if (!open || !sessionId || pendingPromptSessionIdRef.current !== sessionId || !canvasPrompt) {
      return;
    }

    let cancelled = false;

    const sendPrompt = async () => {
      pendingPromptSessionIdRef.current = null;
      try {
        await promptSession(sessionId, canvasPrompt);
      } catch (error) {
        if (cancelled) return;
        setPreviewError(toErrorMessage(error) || "Failed to start specialist prompt");
      }
    };

    void sendPrompt();

    return () => {
      cancelled = true;
    };
  }, [canvasPrompt, open, promptSession, sessionId]);

  useEffect(() => {
    if (!open || !sessionId) {
      return;
    }

    let cancelled = false;

    const pullHistory = async () => {
      try {
        const response = await desktopAwareFetch(
          resolveApiPath(`/api/sessions/${encodeURIComponent(sessionId)}/history?consolidated=true`),
          { cache: "no-store" },
        );
        const json = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(json?.error ?? `Failed to load session history (${response.status})`);
        }
        if (cancelled) return;

        const rawOutput = extractCanvasSpecialistOutputFromHistory(
          Array.isArray(json?.history) ? json.history as Array<Record<string, unknown>> : [],
        );
        const extractedSource = extractCanvasSourceFromSpecialistOutput(rawOutput);
        if (extractedSource) {
          const compiled = compileCanvasTsx(extractedSource);
          if (compiled.ok) {
            setPreviewError(null);
            setPreviewSource((current) => current === extractedSource ? current : extractedSource);
          }
        }
      } catch (error) {
        if (cancelled) return;
        setPreviewError((current) => current ?? (toErrorMessage(error) || "Failed to refresh generated canvas"));
      }
    };

    void pullHistory();
    const intervalId = window.setInterval(() => {
      void pullHistory();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [open, sessionId]);

  useEffect(() => {
    if (!open || !workspaceId || !repoPath || !previewSource) {
      return;
    }
    if (lastPersistedSourceRef.current === previewSource) {
      return;
    }

    setPersistError(null);
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await desktopAwareFetch(resolveApiPath("/api/canvas/specialist/materialize"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId,
              repoPath,
              repoLabel,
              source: previewSource,
            }),
          });
          const json = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(json?.error ?? `Failed to persist canvas (${response.status})`);
          }
          lastPersistedSourceRef.current = previewSource;
          setPersistedFilePath(typeof json?.filePath === "string" ? json.filePath : null);
          setLastSavedAt(new Date().toISOString());
        } catch (error) {
          setPersistError(toErrorMessage(error) || "Failed to persist generated canvas");
        }
      })();
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [open, previewSource, repoLabel, repoPath, workspaceId]);

  if (!open) {
    return null;
  }

  const sessionFrameSrc = sessionId
    ? `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}?embed=true`
    : null;
  const savedAtLabel = formatSavedAt(lastSavedAt);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4 py-6">
      <div
        className="flex h-[90vh] w-full max-w-[1520px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-[#1c1f2e] dark:bg-[#12141c]"
        role="dialog"
        aria-modal="true"
        aria-label={t.kanban.fitnessWorkbenchTitle}
        data-testid="kanban-fitness-workbench-modal"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-[#232736]">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              {t.kanban.fitnessLabel}
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
              {t.kanban.fitnessWorkbenchTitle}
            </div>
            <div className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
              {repoPath || t.kanban.fitnessWorkbenchNoRepo}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#1a1d29] dark:hover:text-slate-50"
            aria-label={t.common.close}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[minmax(0,1.08fr)_minmax(26rem,0.92fr)]">
          <section className="flex min-h-0 flex-col border-r border-slate-200 dark:border-[#232736]">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-5 py-3 text-[11px] dark:border-[#232736]">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700 dark:border-[#2b3142] dark:bg-[#161a25] dark:text-slate-300">
                {repoLabel || "-"}
              </span>
              {branch ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700 dark:border-[#2b3142] dark:bg-[#161a25] dark:text-slate-300">
                  {branch}
                </span>
              ) : null}
              {savedAtLabel ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                  {t.kanban.fitnessWorkbenchSaved} {savedAtLabel}
                </span>
              ) : null}
              {sessionId ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-slate-600 dark:border-[#2b3142] dark:bg-[#161a25] dark:text-slate-300">
                  {sessionId}
                </span>
              ) : null}
            </div>

            {persistedFilePath ? (
              <div className="border-b border-slate-200 px-5 py-2 text-[11px] text-slate-500 dark:border-[#232736] dark:text-slate-400">
                {t.kanban.fitnessWorkbenchSaved} <span className="font-mono text-slate-700 dark:text-slate-200">{persistedFilePath}</span>
              </div>
            ) : null}

            {(specsState.error || planState.error || previewError || persistError) ? (
              <div className="space-y-2 border-b border-slate-200 px-5 py-3 text-[12px] dark:border-[#232736]">
                {specsState.error ? <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">{specsState.error}</div> : null}
                {planState.error ? <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">{planState.error}</div> : null}
                {runtimeState.error ? <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">{runtimeState.error}</div> : null}
                {entrixState.error ? <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">{entrixState.error}</div> : null}
                {previewError ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">{previewError}</div> : null}
                {persistError ? <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">{persistError}</div> : null}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto bg-slate-100/70 dark:bg-[#0f121a]">
              {repoPath ? (
                previewSource ? (
                  <ScopedCanvasPreview source={previewSource} />
                ) : (
                  <div className="flex h-full min-h-[320px] items-center justify-center px-6 py-8">
                    <div className="max-w-md rounded-xl border border-dashed border-slate-300 bg-white/80 px-5 py-6 text-center text-[13px] leading-6 text-slate-600 dark:border-[#2a3142] dark:bg-[#131823] dark:text-slate-300">
                      {specsState.loading || planState.loading
                        || runtimeState.loading || entrixState.loading
                        ? t.kanban.fitnessWorkbenchContextLoading
                        : acpLoading || pendingPromptSessionIdRef.current
                          ? t.kanban.fitnessWorkbenchGenerating
                          : t.kanban.fitnessWorkbenchWaiting}
                    </div>
                  </div>
                )
              ) : (
                <div className="flex h-full min-h-[320px] items-center justify-center px-6 py-8">
                  <div className="max-w-md rounded-xl border border-dashed border-slate-300 bg-white/80 px-5 py-6 text-center text-[13px] leading-6 text-slate-600 dark:border-[#2a3142] dark:bg-[#131823] dark:text-slate-300">
                    {t.kanban.fitnessWorkbenchNoRepo}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="flex min-h-0 flex-col bg-slate-50 dark:bg-[#0f1218]">
            <div className="border-b border-slate-200 px-5 py-3 dark:border-[#232736]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                {t.kanban.fitnessWorkbenchProcess}
              </div>
              <div className="mt-1 text-[12px] text-slate-600 dark:text-slate-300">
                {t.kanban.fitnessWorkbenchProcessHint}
              </div>
            </div>
            <div className="min-h-0 flex-1">
              {sessionFrameSrc ? (
                <iframe
                  key={sessionFrameSrc}
                  src={sessionFrameSrc}
                  title={t.kanban.fitnessWorkbenchProcess}
                  className="h-full w-full border-0 bg-transparent"
                />
              ) : (
                <div className="flex h-full items-center justify-center px-6 py-8 text-[13px] text-slate-600 dark:text-slate-300">
                  {t.kanban.fitnessWorkbenchGenerating}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
