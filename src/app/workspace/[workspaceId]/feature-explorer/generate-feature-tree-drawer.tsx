"use client";

import { useState } from "react";
import { RefreshCw, X } from "lucide-react";

import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

const FRAMEWORK_OPTIONS = [
  { value: "", label: "frameworkAuto" as const },
  { value: "nextjs", label: "Next.js" },
  { value: "spring-boot", label: "Spring Boot" },
  { value: "eggjs", label: "Egg.js" },
] as const;

type GenerateResult = {
  generatedAt: string;
  frameworksDetected: string[];
  wroteFiles: string[];
  warnings: string[];
  pagesCount: number;
  apisCount: number;
};

export function GenerateFeatureTreeDrawer({
  open,
  workspaceId,
  repoPath,
  onClose,
  onGenerated,
}: {
  open: boolean;
  workspaceId: string;
  repoPath?: string;
  onClose: () => void;
  onGenerated: () => void;
}) {
  const { t } = useTranslation();
  const [framework, setFramework] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);

  if (!open) return null;

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setResult(null);

    try {
      const response = await desktopAwareFetch("/spec/feature-tree/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          repoPath: repoPath || undefined,
          framework: framework || undefined,
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
        data-testid="generate-feature-tree-backdrop"
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-md flex-col overflow-hidden border-l border-desktop-border bg-desktop-bg-primary shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t.featureExplorer.generateDrawerTitle}
        data-testid="generate-feature-tree-drawer"
      >
        {/* Header */}
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Repo context */}
          <section className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/30 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary mb-2">
              {t.featureExplorer.repository}
            </div>
            <div className="text-xs text-desktop-text-primary truncate">
              {repoPath || workspaceId}
            </div>
          </section>

          {/* Framework selection */}
          <section className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/30 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary mb-2">
              {t.featureExplorer.frameworkLabel}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FRAMEWORK_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFramework(option.value)}
                  className={`rounded-sm border px-2.5 py-1 text-[11px] font-medium ${
                    framework === option.value
                      ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
                      : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary hover:text-desktop-text-primary"
                  }`}
                >
                  {option.value === ""
                    ? t.featureExplorer.frameworkAuto
                    : option.label}
                </button>
              ))}
            </div>
          </section>

          {/* Mode selection */}
          <section className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/30 p-3">
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-desktop-text-primary">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  className="rounded border-desktop-border"
                />
                {t.featureExplorer.dryRunLabel}
              </label>
            </div>
            <div className="mt-1 text-[10px] text-desktop-text-secondary">
              {t.featureExplorer.dryRunDescription}
            </div>
          </section>

          {/* Error */}
          {error && (
            <div className="rounded-sm border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {t.featureExplorer.generateFailed} {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <section className="rounded-sm border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <div className="mb-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                {dryRun ? t.featureExplorer.previewMode : t.featureExplorer.generateSuccess}
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
                {result.wroteFiles.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {result.wroteFiles.map((file) => (
                      <div key={file} className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
                        {file}
                      </div>
                    ))}
                  </div>
                )}
                {result.warnings.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {result.warnings.map((warning, i) => (
                      <div key={i} className="text-[10px] text-amber-600 dark:text-amber-300">
                        ⚠ {warning}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-desktop-border px-4 py-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="flex w-full items-center justify-center gap-2 rounded-sm bg-desktop-accent px-4 py-2 text-xs font-semibold text-white hover:bg-desktop-accent/90 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${generating ? "animate-spin" : ""}`} />
            {generating ? t.featureExplorer.generating : t.featureExplorer.generateAction}
          </button>
        </div>
      </aside>
    </>
  );
}
