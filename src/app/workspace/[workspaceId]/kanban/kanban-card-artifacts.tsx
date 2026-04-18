"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
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

const ARTIFACT_GROUP_ORDER: ArtifactType[] = ["screenshot", "code_diff", "test_results", "logs"];

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

function groupArtifactsByType(artifacts: ArtifactInfo[]): Map<ArtifactType, ArtifactInfo[]> {
  const groups = new Map<ArtifactType, ArtifactInfo[]>();
  for (const artifact of artifacts) {
    const list = groups.get(artifact.type) ?? [];
    list.push(artifact);
    groups.set(artifact.type, list);
  }
  return groups;
}

function ScreenshotLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -right-2 -top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
          aria-label="Close preview"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain shadow-2xl"
        />
      </div>
    </div>
  );
}

function ScreenshotGallery({
  artifacts,
  compact: _compact,
  artifactLabels: _artifactLabels,
  t,
}: {
  artifacts: ArtifactInfo[];
  compact: boolean;
  artifactLabels: Record<ArtifactType, string>;
  t: TranslationDictionary;
}) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxAlt, setLightboxAlt] = useState("");

  const openLightbox = useCallback((src: string, alt: string) => {
    setLightboxSrc(src);
    setLightboxAlt(alt);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxSrc(null);
    setLightboxAlt("");
  }, []);

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {artifacts.map((artifact) => {
          const screenshotSrc = getScreenshotSrc(artifact);
          if (!screenshotSrc) return null;
          return (
            <div
              key={artifact.id}
              className={`shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-slate-200 transition-shadow hover:shadow-md dark:border-slate-700 ${compact ? "w-56" : "w-72"}`}
              onClick={() => openLightbox(screenshotSrc, artifact.context || "Screenshot")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") openLightbox(screenshotSrc, artifact.context || "Screenshot"); }}
            >
              <Image
                src={screenshotSrc}
                alt={artifact.context || t.kanban.attachedScreenshot}
                width={1200}
                height={800}
                unoptimized
                className={`w-full ${compact ? "max-h-56" : "max-h-80"} object-cover`}
              />
              {artifact.context && (
                <div className="truncate border-t border-slate-100 px-2.5 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {artifact.context}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {lightboxSrc && (
        <ScreenshotLightbox
          src={lightboxSrc}
          alt={lightboxAlt}
          onClose={closeLightbox}
        />
      )}
    </>
  );
}

function ArtifactGroupSection({
  type,
  artifacts,
  compact: _compact,
  defaultOpen,
  artifactLabels: _artifactLabels,
  t,
}: {
  type: ArtifactType;
  artifacts: ArtifactInfo[];
  compact: boolean;
  defaultOpen: boolean;
  artifactLabels: Record<ArtifactType, string>;
  t: TranslationDictionary;
}) {
  const label = formatArtifactTypeLabel(type, artifactLabels);

  return (
    <details open={defaultOpen} className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-2 [&::-webkit-details-marker]:hidden">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          {label}
        </span>
        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
          artifacts.length > 0
            ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            : "bg-slate-50 text-slate-400 dark:bg-slate-900 dark:text-slate-500"
        }`}>
          {artifacts.length}
        </span>
        <svg
          className="h-3 w-3 shrink-0 text-slate-400 transition-transform group-open:rotate-90 dark:text-slate-500"
          viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="M4 2l4 4-4 4" />
        </svg>
      </summary>
      <div className="space-y-3 border-l-2 border-slate-100 pb-2 pl-3 dark:border-slate-800">
        {artifacts.map((artifact) => {
          const diffChunks = artifact.type === "code_diff" && artifact.content
            ? parseUnifiedDiff(artifact.content, artifact.metadata?.filename)
            : [];

          return (
            <article key={artifact.id} className="space-y-2 border-b border-slate-200/60 py-2 last:border-b-0 dark:border-slate-700/40">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
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
                  <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                    {formatArtifactTimestamp(artifact.createdAt, t)}
                  </div>
                </div>
                <div className="truncate text-[11px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  {artifact.status}
                </div>
              </div>

              {artifact.context && (
                <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">{artifact.context}</p>
              )}

              {artifact.type === "code_diff" && artifact.content ? (
                <div className="space-y-2">
                  {diffChunks.map((chunk, index) => (
                    <details
                      key={`${artifact.id}-${chunk.filename}-${index}`}
                      open={index === 0}
                      className="group/diff border border-slate-200 dark:border-slate-700"
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
                <pre className="overflow-x-auto border border-slate-200 px-3 py-2 text-xs leading-5 text-slate-700 dark:border-slate-700 dark:text-slate-300">
                  {artifact.content}
                </pre>
              ) : null}
            </article>
          );
        })}
      </div>
    </details>
  );
}

function MissingArtifactPlaceholder({
  type,
  artifactLabels,
  t,
}: {
  type: ArtifactType;
  artifactLabels: Record<ArtifactType, string>;
  t: TranslationDictionary;
}) {
  return (
    <div className="rounded-lg border-2 border-dashed border-amber-300/80 px-4 py-3 dark:border-amber-700/50">
      <div className="flex items-center gap-2">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
          {t.kanbanDetail.missingArtifactPlaceholder.replace("{type}", formatArtifactTypeLabel(type, artifactLabels))}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-amber-600/80 dark:text-amber-400/60">
        {t.kanbanDetail.missingArtifactHint}
      </div>
    </div>
  );
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

  const groups = useMemo(() => groupArtifactsByType(artifacts), [artifacts]);
  const missingRequiredArtifacts = requiredArtifacts.filter((type) => (coverage.get(type) ?? 0) === 0);

  return (
    <section className={compact ? "space-y-2 py-2" : "space-y-2 py-2.5"}>
      <div className={compact ? "mb-2" : "mb-3"}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
          {t.kanban.artifactsTitle}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className={`inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/10 dark:text-emerald-300 ${compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"}`}>
            {artifacts.length} {t.kanban.totalLabel}
          </span>
          {requiredArtifacts.length > 0 && (
            missingRequiredArtifacts.length === 0
              ? <span>{t.kanban.nextLaneSatisfied}</span>
              : <span>{t.kanban.missingForNextMove}: {missingRequiredArtifacts.map((type) => formatArtifactTypeLabel(type, artifactLabels)).join(", ")}</span>
          )}
        </div>
      </div>

      {loading ? (
        <div className={`border-l-2 px-3 py-2.5 text-sm text-slate-500 dark:border-l-slate-700 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
          {t.kanban.loadingArtifacts}
        </div>
      ) : loadError ? (
        <div className={`border-l-2 border-rose-300 px-3 py-2 text-sm text-rose-700 dark:border-rose-700/80 dark:text-rose-300 ${compact ? "leading-5" : "leading-6"}`}>
          {loadError}
        </div>
      ) : artifacts.length === 0 && missingRequiredArtifacts.length === 0 ? (
        <div className={`border-l-2 border-slate-300 px-3 py-2.5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
          {t.kanban.noArtifactsYet}
        </div>
      ) : (
        <div className="space-y-1">
          {ARTIFACT_GROUP_ORDER.map((type) => {
            const groupArtifacts = groups.get(type);
            if (!groupArtifacts || groupArtifacts.length === 0) return null;

            if (type === "screenshot") {
              return (
                <div key={type} className="py-1">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      {t.kanbanDetail.screenshotGallery}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {groupArtifacts.length}
                    </span>
                  </div>
                  <ScreenshotGallery
                    artifacts={groupArtifacts}
                    compact={compact}
                    artifactLabels={artifactLabels}
                    t={t}
                  />
                </div>
              );
            }

            return (
              <ArtifactGroupSection
                key={type}
                type={type}
                artifacts={groupArtifacts}
                compact={compact}
                defaultOpen={false}
                artifactLabels={artifactLabels}
                t={t}
              />
            );
          })}

          {missingRequiredArtifacts.length > 0 && (
            <div className="space-y-2 pt-2">
              {missingRequiredArtifacts.map((type) => (
                <MissingArtifactPlaceholder
                  key={type}
                  type={type}
                  artifactLabels={artifactLabels}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
