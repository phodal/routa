"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";
import type { ArtifactType } from "@/core/models/artifact";
import { useTranslation } from "@/i18n";
import type { TranslationDictionary } from "@/i18n";
import type { ArtifactInfo } from "../types";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

interface KanbanCardArtifactsProps {
  taskId: string;
  compact?: boolean;
  requiredArtifacts?: ArtifactType[];
  refreshSignal?: number;
}

function getArtifactLabels(t: TranslationDictionary): Record<ArtifactType, string> {
  return {
    screenshot: t.kanban.screenshotType,
    test_results: t.kanban.testResultsType,
    code_diff: t.kanban.codeDiffType,
    logs: t.kanban.logsType,
    canvas: "Canvas",
  };
}

function formatArtifactTypeLabel(type: ArtifactType, labels: Record<ArtifactType, string>): string {
  return labels[type] ?? type;
}

function formatArtifactTimestamp(value: string, t: TranslationDictionary): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t.kanban.timeUnavailable;
  return date.toLocaleString();
}

interface DiffChunk {
  filename: string;
  content: string;
  previewContent: string;
  additions: number;
  deletions: number;
}

function isValidBase64Content(value: string): boolean {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 !== 0) return false;
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized);
}

function getScreenshotSrc(artifact: ArtifactInfo): string | null {
  if (artifact.type !== "screenshot" || !artifact.content) return null;
  const mediaType = artifact.metadata?.mediaType || "image/png";
  if (!mediaType.startsWith("image/")) return null;

  const normalized = artifact.content.replace(/\s+/g, "");
  if (!isValidBase64Content(normalized)) return null;

  return `data:${mediaType};base64,${normalized}`;
}

function parseUnifiedDiff(content: string, fallbackFilename?: string): DiffChunk[] {
  const lines = content.split("\n");
  const chunks: DiffChunk[] = [];
  let currentFilename = fallbackFilename || "diff.patch";
  let currentLines: string[] = [];
  let additions = 0;
  let deletions = 0;
  let previewLines: string[] = [];

  const flush = () => {
    const joined = currentLines.join("\n").trim();
    if (!joined) return;
    chunks.push({
      filename: currentFilename,
      content: joined,
      previewContent: previewLines.join("\n"),
      additions,
      deletions,
    });
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      currentLines = [line];
      additions = 0;
      deletions = 0;
      previewLines = [];
      const match = line.match(/ b\/(.+)$/);
      currentFilename = match?.[1] || fallbackFilename || "diff.patch";
      continue;
    }

    currentLines.push(line);
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;

    // Build a language-highlightable preview from unified diff lines.
    if (
      !line.startsWith("index ")
      && !line.startsWith("--- ")
      && !line.startsWith("+++ ")
      && !line.startsWith("@@ ")
    ) {
      if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
        previewLines.push(line.slice(1));
      } else {
        previewLines.push(line);
      }
    }
  }

  flush();
  return chunks.length > 0
    ? chunks
    : [{
      filename: fallbackFilename || "diff.patch",
      content,
      previewContent: content,
      additions: 0,
      deletions: 0,
    }];
}

export function KanbanCardArtifacts({
  taskId,
  compact = false,
  requiredArtifacts = [],
  refreshSignal = 0,
}: KanbanCardArtifactsProps) {
  const { t } = useTranslation();
  const artifactLabels = useMemo(() => getArtifactLabels(t), [t]);
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const loadArtifacts = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await desktopAwareFetch(`/api/tasks/${encodeURIComponent(taskId)}/artifacts`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error(data.error ?? t.kanban.failedToLoadArtifacts);
        }
        setArtifacts(Array.isArray(data.artifacts) ? data.artifacts as ArtifactInfo[] : []);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : t.kanban.failedToLoadArtifacts);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadArtifacts();
    return () => controller.abort();
  }, [refreshSignal, taskId, t.kanban.failedToLoadArtifacts]);

  const coverage = useMemo(() => {
    const counts = new Map<ArtifactType, number>();
    for (const artifact of artifacts) {
      counts.set(artifact.type, (counts.get(artifact.type) ?? 0) + 1);
    }
    return counts;
  }, [artifacts]);

  const screenshotCount = coverage.get("screenshot") ?? 0;
  const missingRequiredArtifacts = requiredArtifacts.filter((type) => (coverage.get(type) ?? 0) === 0);

  return (
    <section className={compact ? "space-y-2 py-2" : "space-y-2 py-2.5"}>
      <div className={compact ? "mb-2" : "mb-3"}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
          {t.kanban.artifactsTitle}
        </div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t.kanban.artifactsDescription}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/10 dark:text-emerald-300 ${compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"}`}>
            {artifacts.length} {t.kanban.totalLabel}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-900/10 dark:text-sky-300 ${compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"}`}>
            {screenshotCount} {t.kanban.screenshotsLabel}
          </span>
          {requiredArtifacts.map((type) => {
            const present = (coverage.get(type) ?? 0) > 0;
            return (
              <span
                key={type}
                className={`inline-flex items-center gap-1 rounded-full border ${present
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/10 dark:text-emerald-300"
                  : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300"
                  } ${compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"}`}
              >
                {present ? t.kanban.readyLabel : t.kanban.missingLabel} {formatArtifactTypeLabel(type, artifactLabels)}
              </span>
            );
          })}
        </div>
        <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">
          {requiredArtifacts.length > 0
            ? (
              missingRequiredArtifacts.length === 0
                ? `${t.kanban.nextLaneSatisfied}: ${requiredArtifacts.map((type) => formatArtifactTypeLabel(type, artifactLabels)).join(", ")}.`
                : `${t.kanban.missingForNextMove}: ${missingRequiredArtifacts.map((type) => formatArtifactTypeLabel(type, artifactLabels)).join(", ")}.`
            )
            : t.kanban.artifactManageHint}
        </div>

        {loading ? (
          <div className={`border-l-2 px-3 py-2.5 text-sm text-slate-500 dark:border-l-slate-700 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
            {t.kanban.loadingArtifacts}
          </div>
        ) : loadError ? (
          <div className={`border-l-2 border-rose-300 px-3 py-2 text-sm text-rose-700 dark:border-rose-700/80 dark:text-rose-300 ${compact ? "leading-5" : "leading-6"}`}>
            {loadError}
          </div>
        ) : artifacts.length === 0 ? (
          <div className={`border-l-2 border-slate-300 px-3 py-2.5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
            {t.kanban.noArtifactsYet}
          </div>
        ) : (
          <div className="space-y-3">
            {artifacts.map((artifact) => {
              const screenshotSrc = getScreenshotSrc(artifact);
              const diffChunks = artifact.type === "code_diff" && artifact.content
                ? parseUnifiedDiff(artifact.content, artifact.metadata?.filename)
                : [];

              return (
                <article
                  key={artifact.id}
                  className="space-y-2 border-b border-slate-200/80 py-2.5 last:border-b-0 dark:border-slate-700/60"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-200">
                          {formatArtifactTypeLabel(artifact.type, artifactLabels)}
                        </span>
                        {artifact.providedByAgentId && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {t.kanban.byAgent} {artifact.providedByAgentId}
                          </span>
                        )}
                        {artifact.metadata?.filename && (
                          <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {artifact.metadata.filename}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {formatArtifactTimestamp(artifact.createdAt, t)}
                      </div>
                    </div>
                    <div className="truncate text-[11px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                      {artifact.status}
                    </div>
                  </div>

                  {artifact.context && (
                    <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300">{artifact.context}</p>
                  )}

                  {screenshotSrc ? (
                    <Image
                      src={screenshotSrc}
                      alt={artifact.context || t.kanban.attachedScreenshot}
                      width={1200}
                      height={800}
                      unoptimized
                      className="mt-3 max-h-56 w-full border border-slate-200 object-cover dark:border-slate-700"
                    />
                  ) : artifact.type === "code_diff" && artifact.content ? (
                    <div className="mt-3 space-y-2">
                      {diffChunks.map((chunk, index) => (
                        <details
                          key={`${artifact.id}-${chunk.filename}-${index}`}
                          open
                          className="group border border-slate-200 dark:border-slate-700"
                        >
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 [&::-webkit-details-marker]:hidden">
                            <span className="truncate font-medium">{chunk.filename}</span>
                            <span className="shrink-0 font-mono">
                              <span className="text-emerald-600 dark:text-emerald-300">+{chunk.additions}</span>
                              {" "}
                              <span className="text-rose-600 dark:text-rose-300">-{chunk.deletions}</span>
                            </span>
                          </summary>
                          <CodeViewer
                            code={chunk.previewContent || chunk.content}
                            filename={chunk.filename}
                            showHeader={false}
                            showCopyButton
                            showLineNumbers
                            wordWrap={false}
                            maxHeight="260px"
                            className="border-t border-slate-200 dark:border-slate-700"
                          />
                        </details>
                      ))}
                    </div>
                  ) : artifact.content ? (
                    <pre className="mt-3 overflow-x-auto border border-slate-200 px-3 py-2 text-xs leading-5 text-slate-700 dark:border-slate-700 dark:text-slate-300">
                      {artifact.content}
                    </pre>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
