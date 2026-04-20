"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Sparkles, Wand2, X } from "lucide-react";

import type { AcpProviderInfo } from "@/client/acp-client";
import { AcpProviderDropdown } from "@/client/components/acp-provider-dropdown";
import { ChatPanel } from "@/client/components/chat-panel";
import type { RepoSelection } from "@/client/components/repo-picker";
import { useAcp } from "@/client/hooks/use-acp";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

type GenerateResult = {
  generatedAt: string;
  frameworksDetected: string[];
  wroteFiles: string[];
  warnings: string[];
  pagesCount: number;
  apisCount: number;
};

type FeatureTreePreflightResult = {
  repoRoot: string;
  selectedScanRoot: string;
  frameworksDetected: string[];
  adapters: Array<{
    id: string;
    confidence: "high" | "medium";
    signals: string[];
  }>;
  candidateRoots: Array<{
    path: string;
    kind: string;
    score: number;
    surfaceCounts: {
      pages: number;
      appRouterApis: number;
      pagesApis: number;
      rustApis: number;
    };
    adapters: string[];
    warnings: string[];
  }>;
  warnings: string[];
};

type SessionTranscriptPayload = {
  latestEventKind?: string;
  history?: Array<{
    update?: Record<string, unknown>;
  }>;
  messages: Array<{
    role: string;
    content: string;
  }>;
};

type GenerateMode = "agent" | "quick-scan";

function basenameOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function summarizeCandidateRoot(repoRoot: string, rootPath: string): string {
  if (!rootPath) {
    return ".";
  }
  const relative = rootPath.startsWith(repoRoot) ? rootPath.slice(repoRoot.length).replace(/^[/\\]/, "") : rootPath;
  return relative || ".";
}

function tryParseJsonCandidate(candidate: string): unknown | null {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  const directCandidates = [trimmed];
  const fencedBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]?.trim() ?? "");
  const objectMatches = [...trimmed.matchAll(/\{[\s\S]*?\}/g)].map((match) => match[0]);
  const candidates = [...directCandidates, ...fencedBlocks, ...objectMatches];

  for (const entry of candidates) {
    if (!entry) continue;
    try {
      return JSON.parse(entry);
    } catch {
      continue;
    }
  }

  return null;
}

function extractTranscriptMetadata(transcript: SessionTranscriptPayload): unknown {
  const preferredRoles = ["assistant", "tool", "plan", "thought"];
  const prioritizedMessages = preferredRoles.flatMap((role) =>
    transcript.messages
      .filter((message) => message.role === role)
      .reverse(),
  );

  for (const message of prioritizedMessages) {
    const parsed = tryParseJsonCandidate(message.content);
    if (parsed != null) {
      return parsed;
    }
  }

  const history = Array.isArray(transcript.history) ? [...transcript.history].reverse() : [];
  for (const entry of history) {
    const update = entry?.update;
    if (!update || typeof update !== "object") {
      continue;
    }

    const rawOutput = update.rawOutput;
    if (rawOutput && typeof rawOutput === "object") {
      return rawOutput;
    }
    if (typeof rawOutput === "string") {
      const parsed = tryParseJsonCandidate(rawOutput);
      if (parsed != null) {
        return parsed;
      }
    }

    const content = update.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part?.text !== "string") continue;
        const parsed = tryParseJsonCandidate(part.text);
        if (parsed != null) {
          return parsed;
        }
      }
    } else if (content && typeof content === "object" && typeof (content as { text?: unknown }).text === "string") {
      const parsed = tryParseJsonCandidate((content as { text: string }).text);
      if (parsed != null) {
        return parsed;
      }
    }

    if (typeof update.text === "string") {
      const parsed = tryParseJsonCandidate(update.text);
      if (parsed != null) {
        return parsed;
      }
    }
  }

  throw new Error("No feature metadata JSON found in the generation transcript.");
}

function hasPotentialCommitTrigger(
  updates: Array<{ sessionId: string; update?: Record<string, unknown> }>,
  sessionId: string,
): boolean {
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const update = updates[index];
    if (update?.sessionId !== sessionId) {
      continue;
    }
    return update.update?.sessionUpdate === "turn_complete";
  }

  return false;
}

function buildGenerationPrompt(args: {
  repoRoot: string;
  selectedScanRoot: string;
  adapters: Array<{ id: string; confidence: "high" | "medium"; signals: string[] }>;
  candidateRoots: FeatureTreePreflightResult["candidateRoots"];
  warnings: string[];
}): string {
  const candidateSummary = args.candidateRoots
    .slice(0, 5)
    .map((candidate) => {
      const counts = candidate.surfaceCounts;
      return `- path: ${candidate.path}
  kind: ${candidate.kind}
  score: ${candidate.score}
  adapters: ${candidate.adapters.join(", ") || "none"}
  pages: ${counts.pages}
  appRouterApis: ${counts.appRouterApis}
  pagesApis: ${counts.pagesApis}
  rustApis: ${counts.rustApis}`;
    })
    .join("\n");

  const adapterSummary = args.adapters.length > 0
    ? args.adapters.map((adapter) =>
      `- ${adapter.id} (${adapter.confidence}) signals: ${adapter.signals.join(", ") || "none"}`).join("\n")
    : "- none";

  const warningSummary = args.warnings.length > 0
    ? args.warnings.map((warning) => `- ${warning}`).join("\n")
    : "- none";

  return `Analyze this repository and return strict JSON only for Routa feature metadata.

Repository root: ${args.repoRoot}
Preferred scan root: ${args.selectedScanRoot}

Detected adapters:
${adapterSummary}

Candidate roots:
${candidateSummary}

Preflight warnings:
${warningSummary}

Requirements:
- Focus analysis on the preferred scan root for actual product surfaces.
- Treat the repository root as the output root for FEATURE_TREE artifacts.
- Use pages, APIs, and source files from repository evidence.
- If evidence is partial, mark features as draft rather than inventing detail.
- Return strict JSON only matching the required feature metadata schema.`;
}

export function GenerateFeatureTreeDrawer({
  open,
  workspaceId,
  repoPath,
  repoSelection,
  codebases,
  onClose,
  onGenerated,
}: {
  open: boolean;
  workspaceId: string;
  repoPath?: string;
  repoSelection: RepoSelection | null;
  codebases: CodebaseData[];
  onClose: () => void;
  onGenerated: () => void;
}) {
  const { t, locale } = useTranslation();
  const acp = useAcp();
  const {
    connect,
    createSession,
    promptSession,
    selectSession,
    providers,
    selectedProvider,
    setProvider,
    loading: acpLoading,
    error: acpError,
    updates,
  } = acp;

  const [mode, setMode] = useState<GenerateMode>("agent");
  const [dryRun, setDryRun] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [applyingAgentResult, setApplyingAgentResult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflight, setPreflight] = useState<FeatureTreePreflightResult | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [hasPromptedSession, setHasPromptedSession] = useState(false);
  const [transcriptRetryNonce, setTranscriptRetryNonce] = useState(0);
  const committedSessionIdsRef = useRef<Set<string>>(new Set());
  const transcriptRetryCountRef = useRef<Record<string, number>>({});
  const transcriptRetryTimerRef = useRef<number | null>(null);
  const transcriptCommitInFlightRef = useRef(false);

  useEffect(() => {
    if (!open || !repoPath) return;

    let cancelled = false;
    setPreflightLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await desktopAwareFetch(
          `/spec/feature-tree/preflight?workspaceId=${encodeURIComponent(workspaceId)}&repoPath=${encodeURIComponent(repoPath)}`,
        );
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        if (!cancelled) {
          setPreflight(body as FeatureTreePreflightResult);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setPreflightLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, repoPath, workspaceId]);

  useEffect(() => {
    if (!open) {
      setMode("agent");
      setDryRun(false);
      setGenerating(false);
      setApplyingAgentResult(false);
      setError(null);
      setResult(null);
      setSessionId(null);
      setSessionName("");
      setHasPromptedSession(false);
      setTranscriptRetryNonce(0);
      committedSessionIdsRef.current.clear();
      transcriptRetryCountRef.current = {};
      transcriptCommitInFlightRef.current = false;
      if (transcriptRetryTimerRef.current !== null) {
        window.clearTimeout(transcriptRetryTimerRef.current);
        transcriptRetryTimerRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    if (!sessionId || !preflight || transcriptCommitInFlightRef.current) {
      return;
    }

    const shouldInspectTranscript = hasPotentialCommitTrigger(updates, sessionId);
    if (!shouldInspectTranscript || committedSessionIdsRef.current.has(sessionId)) {
      return;
    }

    if (transcriptRetryTimerRef.current !== null) {
      window.clearTimeout(transcriptRetryTimerRef.current);
      transcriptRetryTimerRef.current = null;
    }

    const attempt = transcriptRetryCountRef.current[sessionId] ?? 0;
    const maxAttempts = 4;
    transcriptCommitInFlightRef.current = true;
    setApplyingAgentResult(true);

    void (async () => {
      try {
        const transcriptResponse = await desktopAwareFetch(
          `/sessions/${encodeURIComponent(sessionId)}/transcript`,
          { cache: "no-store" },
        );
        const transcript = await transcriptResponse.json() as SessionTranscriptPayload;
        if (!transcriptResponse.ok) {
          throw new Error("Failed to load generation transcript.");
        }

        let metadata: unknown;
        try {
          metadata = extractTranscriptMetadata(transcript);
        } catch {
          if (attempt >= maxAttempts) {
            throw new Error(t.featureExplorer.generateFailed);
          }
          const nextAttempt = attempt + 1;
          const delayMs = attempt === 0 ? 250 : 1000;
          transcriptRetryCountRef.current[sessionId] = nextAttempt;
          transcriptRetryTimerRef.current = window.setTimeout(() => {
            transcriptCommitInFlightRef.current = false;
            transcriptRetryTimerRef.current = null;
            setTranscriptRetryNonce((current) => current + 1);
          }, delayMs);
          return;
        }

        committedSessionIdsRef.current.add(sessionId);
        transcriptRetryCountRef.current[sessionId] = 0;
        const commitResponse = await desktopAwareFetch("/spec/feature-tree/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            repoPath,
            scanRoot: preflight.selectedScanRoot,
            metadata,
          }),
        });
        const body = await commitResponse.json();
        if (!commitResponse.ok) {
          throw new Error(body.error ?? `HTTP ${commitResponse.status}`);
        }

        setResult(body as GenerateResult);
        onGenerated();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        const retryPending = transcriptRetryTimerRef.current !== null;
        transcriptCommitInFlightRef.current = false;
        if (!retryPending) {
          setApplyingAgentResult(false);
          setGenerating(false);
        }
      }
    })();
  }, [onGenerated, preflight, repoPath, sessionId, t.featureExplorer.generateFailed, transcriptRetryNonce, updates, workspaceId]);

  useEffect(() => () => {
    if (transcriptRetryTimerRef.current !== null) {
      window.clearTimeout(transcriptRetryTimerRef.current);
    }
  }, []);

  const effectiveRepoSelection = useMemo<RepoSelection | null>(() => {
    if (repoSelection) return repoSelection;
    if (!repoPath) return null;
    return {
      name: basenameOf(repoPath),
      path: repoPath,
      branch: "",
    };
  }, [repoPath, repoSelection]);

  const providerOptions: AcpProviderInfo[] = providers;
  const selectedScanRootSummary = preflight && repoPath
    ? summarizeCandidateRoot(repoPath, preflight.selectedScanRoot)
    : ".";
  const preflightAdapters = preflight?.adapters ?? [];
  const preflightCandidateRoots = preflight?.candidateRoots ?? [];
  const preflightWarnings = preflight?.warnings ?? [];

  const handleQuickScan = async () => {
    if (!repoPath) return;
    setGenerating(true);
    setError(null);
    setResult(null);

    try {
      const response = await desktopAwareFetch("/spec/feature-tree/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          repoPath,
          dryRun,
        }),
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }

      setResult(body as GenerateResult);
      if (!dryRun) {
        onGenerated();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleAgentGenerate = async () => {
    if (!repoPath || !preflight) return;

    setGenerating(true);
    setApplyingAgentResult(false);
    setError(null);
    setResult(null);

    try {
      await connect();
      const nextSessionName = `Feature tree generation · ${basenameOf(repoPath)}`;
      const created = await createSession(
        repoPath,
        selectedProvider,
        undefined,
        "ROUTA",
        workspaceId,
        undefined,
        undefined,
        "feature-tree-orchestrator",
        locale,
        undefined,
        undefined,
        effectiveRepoSelection?.branch || undefined,
      );

      const nextSessionId = created?.sessionId;
      if (!nextSessionId) {
        throw new Error(t.featureExplorer.generateFailed);
      }

      selectSession(nextSessionId);
      setSessionId(nextSessionId);
      setSessionName(nextSessionName);
      setHasPromptedSession(true);

      await promptSession(nextSessionId, buildGenerationPrompt({
        repoRoot: preflight.repoRoot,
        selectedScanRoot: preflight.selectedScanRoot,
        adapters: preflightAdapters,
        candidateRoots: preflightCandidateRoots,
        warnings: preflightWarnings,
      }));
    } catch (err) {
      setGenerating(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleGenerate = async () => {
    if (mode === "quick-scan") {
      await handleQuickScan();
      return;
    }
    await handleAgentGenerate();
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
        data-testid="generate-feature-tree-backdrop"
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-6xl flex-col overflow-hidden border-l border-desktop-border bg-desktop-bg-primary shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t.featureExplorer.generateDrawerTitle}
        data-testid="generate-feature-tree-drawer"
      >
        <div className="flex items-start justify-between gap-3 border-b border-desktop-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-desktop-text-primary">
              {t.featureExplorer.generateDrawerTitle}
            </div>
            <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">
              {t.featureExplorer.generateDrawerDescription}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            title={t.common.close}
            className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-desktop-text-secondary hover:text-desktop-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col xl:flex-row">
            <div className="w-full shrink-0 overflow-y-auto border-b border-desktop-border px-4 py-4 xl:w-[25rem] xl:border-b-0 xl:border-r">
              <div className="space-y-5">
                <section className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/30 p-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                    {t.featureExplorer.repository}
                  </div>
                  <div className="text-xs text-desktop-text-primary break-all">
                    {repoPath || workspaceId}
                  </div>
                </section>

                <section className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/30 p-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                    {t.featureExplorer.generateModeLabel}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setMode("agent")}
                      className={`rounded-sm border px-3 py-2 text-xs font-medium ${mode === "agent"
                        ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
                        : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary"}`}
                    >
                      <span className="flex items-center justify-center gap-2">
                        <Sparkles className="h-3.5 w-3.5" />
                        {t.featureExplorer.generateModeAgent}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("quick-scan")}
                      className={`rounded-sm border px-3 py-2 text-xs font-medium ${mode === "quick-scan"
                        ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
                        : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary"}`}
                    >
                      <span className="flex items-center justify-center gap-2">
                        <Wand2 className="h-3.5 w-3.5" />
                        {t.featureExplorer.generateModeQuickScan}
                      </span>
                    </button>
                  </div>
                  <div className="mt-2 text-[10px] text-desktop-text-secondary">
                    {mode === "agent"
                      ? t.featureExplorer.generateModeAgentDescription
                      : t.featureExplorer.generateModeQuickScanDescription}
                  </div>
                </section>

                <section className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/30 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                      {t.featureExplorer.preflightLabel}
                    </div>
                    {preflightLoading ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-desktop-text-secondary" />
                    ) : null}
                  </div>
                  {preflight ? (
                    <div className="space-y-2 text-[11px] text-desktop-text-primary">
                      <div className="flex items-center justify-between gap-3">
                        <span>{t.featureExplorer.frameworkDetected}</span>
                        <span className="font-mono text-[10px]">{(preflight.frameworksDetected ?? []).join(", ") || "generic"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>{t.featureExplorer.scanRootLabel}</span>
                        <span className="font-mono text-[10px]">{selectedScanRootSummary}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>{t.featureExplorer.adaptersLabel}</span>
                        <span className="font-mono text-[10px]">{preflightAdapters.map((entry) => entry.id).join(", ") || "none"}</span>
                      </div>
                      {preflightCandidateRoots.length > 0 ? (
                        <div className="space-y-1">
                          <div className="text-[10px] text-desktop-text-secondary">
                            {t.featureExplorer.candidateRootsLabel}
                          </div>
                          {preflightCandidateRoots.slice(0, 3).map((candidate) => (
                            <div key={candidate.path} className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-2 py-1.5">
                              <div className="font-mono text-[10px] text-desktop-text-primary">
                                {summarizeCandidateRoot(preflight.repoRoot, candidate.path)}
                              </div>
                              <div className="mt-1 text-[10px] text-desktop-text-secondary">
                                {candidate.kind} · {candidate.surfaceCounts.pages}p / {candidate.surfaceCounts.appRouterApis + candidate.surfaceCounts.pagesApis + candidate.surfaceCounts.rustApis} api
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {preflightWarnings.length > 0 ? (
                        <div className="space-y-1">
                          {preflightWarnings.map((warning) => (
                            <div key={warning} className="text-[10px] text-amber-600 dark:text-amber-300">
                              {warning}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-[11px] text-desktop-text-secondary">
                      {t.featureExplorer.preflightPending}
                    </div>
                  )}
                </section>

                {mode === "agent" ? (
                  <section className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/30 p-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                      {t.providerDropdown.selectProvider}
                    </div>
                    <AcpProviderDropdown
                      providers={providerOptions}
                      selectedProvider={selectedProvider}
                      onProviderChange={setProvider}
                      dataTestId="feature-tree-provider-dropdown"
                    />
                    <div className="mt-2 text-[10px] text-desktop-text-secondary">
                      {t.featureExplorer.agentLogsDescription}
                    </div>
                  </section>
                ) : (
                  <section className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/30 p-3">
                    <div className="flex items-center gap-2">
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-desktop-text-primary">
                        <input
                          type="checkbox"
                          checked={dryRun}
                          onChange={(event) => setDryRun(event.target.checked)}
                          className="rounded border-desktop-border"
                        />
                        {t.featureExplorer.dryRunLabel}
                      </label>
                    </div>
                    <div className="mt-1 text-[10px] text-desktop-text-secondary">
                      {t.featureExplorer.dryRunDescription}
                    </div>
                  </section>
                )}

                {(error || acpError) ? (
                  <div className="rounded-sm border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                    {t.featureExplorer.generateFailed} {error || acpError}
                  </div>
                ) : null}

                {result ? (
                  <section className="rounded-sm border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    <div className="mb-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      {mode === "quick-scan" && dryRun ? t.featureExplorer.previewMode : t.featureExplorer.generateSuccess}
                    </div>
                    <div className="space-y-1.5 text-[11px] text-emerald-800 dark:text-emerald-200">
                      <div className="flex items-center justify-between">
                        <span>{t.featureExplorer.frameworkDetected}</span>
                        <span className="font-mono">{result.frameworksDetected.join(", ")}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>{t.featureExplorer.pagesDetected}</span>
                        <span className="font-mono">{result.pagesCount}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>{t.featureExplorer.apisDetected}</span>
                        <span className="font-mono">{result.apisCount}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>{t.featureExplorer.filesWritten}</span>
                        <span className="font-mono">{result.wroteFiles.length}</span>
                      </div>
                      {result.warnings.map((warning) => (
                        <div key={warning} className="text-[10px] text-amber-600 dark:text-amber-300">
                          {warning}
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 bg-desktop-bg-secondary/10">
              {sessionId && effectiveRepoSelection ? (
                <ChatPanel
                  acp={acp}
                  activeSessionId={sessionId}
                  onEnsureSession={async () => sessionId}
                  onSelectSession={async (nextSessionId) => {
                    selectSession(nextSessionId);
                  }}
                  repoSelection={effectiveRepoSelection}
                  onRepoChange={() => {}}
                  codebases={codebases}
                  activeWorkspaceId={workspaceId}
                  agentRole="ROUTA"
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6">
                  <div className="max-w-md rounded-sm border border-dashed border-desktop-border bg-desktop-bg-primary px-4 py-5 text-center">
                    <div className="text-sm font-medium text-desktop-text-primary">
                      {mode === "agent"
                        ? t.featureExplorer.agentLogsTitle
                        : t.featureExplorer.quickScanIdleTitle}
                    </div>
                    <div className="mt-2 text-xs leading-6 text-desktop-text-secondary">
                      {mode === "agent"
                        ? t.featureExplorer.agentLogsEmpty
                        : t.featureExplorer.quickScanIdleDescription}
                    </div>
                    {hasPromptedSession && sessionName ? (
                      <div className="mt-3 text-[10px] font-mono text-desktop-text-secondary">
                        {sessionName}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-desktop-border px-4 py-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || preflightLoading || !repoPath || (mode === "agent" && acpLoading) || !preflight}
            className="flex w-full items-center justify-center gap-2 rounded-sm bg-desktop-accent px-4 py-2 text-xs font-semibold text-white hover:bg-desktop-accent/90 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${(generating || applyingAgentResult) ? "animate-spin" : ""}`} />
            {applyingAgentResult
              ? t.featureExplorer.applyingAgentResult
              : generating
                ? t.featureExplorer.generating
                : mode === "agent"
                  ? t.featureExplorer.generateWithAgentAction
                  : t.featureExplorer.generateAction}
          </button>
        </div>
      </aside>
    </>
  );
}
