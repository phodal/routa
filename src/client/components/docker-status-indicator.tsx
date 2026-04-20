"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

interface DockerStatusResponse {
  available: boolean;
  daemonRunning: boolean;
  version?: string;
  error?: string;
  checkedAt: string;
  image?: string;
  imageAvailable?: boolean;
}

interface DockerStatusIndicatorProps {
  compact?: boolean;
  className?: string;
}

export function DockerStatusIndicator({ compact = false, className = "" }: DockerStatusIndicatorProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DockerStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await desktopAwareFetch("/api/acp/docker/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as DockerStatusResponse);
    } catch {
      setStatus({
        available: false,
        daemonRunning: false,
        error: t.dockerStatus.checkFailed,
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const available = !!status?.available;
  const isChecking = loading && !status;
  const isRetryable = !available && !isChecking;

  const versionLabel = status?.version?.trim() || "ready";
  const readyLabel = t.dockerStatus.ready.replace("{version}", versionLabel);

  const label = isChecking
    ? t.dockerStatus.checking
    : available
      ? readyLabel
      : loading
        ? t.dockerStatus.retrying
        : t.dockerStatus.unavailable;
  const toneClass = isChecking
    ? "border-gray-200 text-gray-500 bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:bg-gray-800/30"
    : available
      ? "border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-800/60 dark:text-emerald-300 dark:bg-emerald-900/20"
      : "border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 dark:border-amber-800/60 dark:text-amber-300 dark:bg-amber-900/20 dark:hover:bg-amber-900/30";
  const compactToneClass = isChecking
    ? "text-desktop-text-tertiary"
    : available
      ? "text-emerald-500"
      : "text-amber-500";
  const dotClass = isChecking
    ? "bg-gray-400 animate-pulse"
    : available
      ? "bg-emerald-500"
      : loading
        ? "bg-amber-500 animate-pulse"
        : "bg-amber-500";
  const title = available
    ? status?.error ?? label
    : loading
      ? t.dockerStatus.refreshing
      : status?.error ?? t.dockerStatus.clickToRefresh;

  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={isRetryable ? () => void refresh() : undefined}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] transition-colors ${
          compact ? "border-0" : "border"
        } ${
          compact ? "bg-transparent" : toneClass
        } ${
          compact ? compactToneClass : ""
        } ${compact ? "hover:bg-transparent" : ""} ${className} ${
          isRetryable ? "cursor-pointer" : "cursor-default"
        }`}
        title={title}
        disabled={!isRetryable}
        aria-disabled={!isRetryable}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        <span className="max-w-[140px] truncate">{label}</span>
      </button>
    </div>
  );
}
