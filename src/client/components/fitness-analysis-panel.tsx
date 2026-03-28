"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { desktopAwareFetch } from "@/client/utils/diagnostics";

type FitnessProfile = "generic" | "agent_orchestrator";
type ViewMode = "overview" | "dimensions" | "recommendations" | "changes" | "raw";

type FitnessProfileState = "idle" | "loading" | "ready" | "empty" | "error";

type ApiProfileEntry = {
  profile: FitnessProfile;
  status: "ok" | "missing" | "error";
  source: "analysis" | "snapshot";
  report?: FitnessReport;
  error?: string;
  durationMs?: number;
};

type AnalyzeResponse = {
  generatedAt: string;
  requestedProfiles: FitnessProfile[];
  profiles: ApiProfileEntry[];
};

type FitnessReport = {
  modelVersion: number;
  modelPath: string;
  profile: FitnessProfile;
  repoRoot: string;
  generatedAt: string;
  snapshotPath: string;
  overallLevel: string;
  overallLevelName: string;
  currentLevelReadiness: number;
  nextLevel?: string | null;
  nextLevelName?: string | null;
  nextLevelReadiness?: number | null;
  blockingTargetLevel?: string | null;
  blockingTargetLevelName?: string | null;
  dimensions: Record<string, FitnessDimensionResult>;
  recommendations: FitnessRecommendation[];
  comparison?: FitnessComparison;
  blockingCriteria?: Array<{
    id: string;
    level: string;
    dimension: string;
    weight: number;
    critical: boolean;
    status: string;
    detail: string;
    recommendedAction: string;
  }>;
};

type FitnessDimensionResult = {
  dimension: string;
  name: string;
  level: string;
  levelName: string;
  levelIndex: number;
  score: number;
  nextLevel?: string | null;
  nextLevelName?: string | null;
  nextLevelProgress?: number | null;
};

type FitnessRecommendation = {
  criterionId: string;
  action: string;
  whyItMatters: string;
  evidenceHint: string;
  critical: boolean;
  weight: number;
};

type FitnessComparison = {
  previousGeneratedAt: string;
  previousOverallLevel: string;
  overallChange: "same" | "up" | "down";
  dimensionChanges: Array<{
    dimension: string;
    previousLevel: string;
    currentLevel: string;
    change: "same" | "up" | "down";
  }>;
  criteriaChanges: Array<{
    id: string;
    previousStatus?: string;
    currentStatus?: string;
  }>;
};

type ProfilePanelState = {
  state: FitnessProfileState;
  source?: ApiProfileEntry["source"];
  durationMs?: number;
  report?: FitnessReport;
  error?: string;
  updatedAt?: string;
};

const PROFILE_ORDER: FitnessProfile[] = ["generic", "agent_orchestrator"];

const PROFILE_DEFS: Array<{
  id: FitnessProfile;
  name: string;
  description: string;
  focus: string;
}> = [
  {
    id: "generic",
    name: "Generic",
    description: "泛化 AI 工程能力体检",
    focus: "适用于仓库整体成熟度对比",
  },
  {
    id: "agent_orchestrator",
    name: "Agent Orchestrator",
    description: "面向协作编排链路能力体检",
    focus: "更关注 Specialist / Team / 自动化协同面",
  },
];

const VIEW_MODES: Array<{ id: ViewMode; label: string }> = [
  { id: "overview", label: "总览" },
  { id: "dimensions", label: "维度雷达" },
  { id: "recommendations", label: "建议清单" },
  { id: "changes", label: "对比变化" },
  { id: "raw", label: "原始 JSON" },
];

type FitnessAnalysisContext = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
  codebaseLabel?: string;
};

type FitnessAnalysisPanelProps = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
  codebaseLabel?: string;
};

const EMPTY_STATE: Record<FitnessProfile, ProfilePanelState> = {
  generic: {
    state: "idle",
  },
  agent_orchestrator: {
    state: "idle",
  },
};

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function readinessTone(score: number) {
  const value = clampPercent(score);
  if (value >= 90) return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (value >= 75) return "border-sky-300 bg-sky-50 text-sky-700";
  if (value >= 60) return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-rose-300 bg-rose-50 text-rose-700";
}

function levelTone(change: "same" | "up" | "down") {
  if (change === "up") return "text-emerald-700 dark:text-emerald-300";
  if (change === "down") return "text-rose-700 dark:text-rose-300";
  return "text-slate-500 dark:text-slate-300";
}

function formatTime(value: string | undefined) {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleString();
}

function formatDuration(ms: number | undefined) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "未知";
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  return `${Math.round(ms)}ms`;
}

function normalizeApiResponse(payload: unknown): ApiProfileEntry[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { profiles?: unknown }).profiles)) {
    return [];
  }

  return ((payload as { profiles: unknown[] }).profiles).reduce<ApiProfileEntry[]>((entries, entry) => {
    if (!entry || typeof entry !== "object") {
      return entries;
    }

    const value = entry as Partial<ApiProfileEntry>;
    if (
      (value.profile !== "generic" && value.profile !== "agent_orchestrator")
      || value.status === undefined
    ) {
      return entries;
    }

    const status = value.status;
    if (status !== "ok" && status !== "missing" && status !== "error") {
      return entries;
    }
    if (value.source !== "analysis" && value.source !== "snapshot") {
      return entries;
    }

    entries.push({
      profile: value.profile,
      status,
      source: value.source,
      report: value.report as FitnessReport | undefined,
      error: typeof value.error === "string" ? value.error : undefined,
      durationMs: typeof value.durationMs === "number" && Number.isFinite(value.durationMs) ? value.durationMs : undefined,
    });
    return entries;
  }, []);
}

function buildAnalysisQuery(context: FitnessAnalysisContext): string {
  const params = new URLSearchParams();
  if (context.workspaceId?.trim()) params.set("workspaceId", context.workspaceId.trim());
  if (context.codebaseId?.trim()) params.set("codebaseId", context.codebaseId.trim());
  if (context.repoPath?.trim()) params.set("repoPath", context.repoPath.trim());
  return params.toString();
}

function buildAnalysisPayload(context: FitnessAnalysisContext) {
  const payload: {
    workspaceId?: string;
    codebaseId?: string;
    repoPath?: string;
  } = {};

  if (context.workspaceId?.trim()) payload.workspaceId = context.workspaceId.trim();
  if (context.codebaseId?.trim()) payload.codebaseId = context.codebaseId.trim();
  if (context.repoPath?.trim()) payload.repoPath = context.repoPath.trim();
  return payload;
}

export function FitnessAnalysisPanel({
  workspaceId,
  codebaseId,
  repoPath,
  codebaseLabel,
}: FitnessAnalysisPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [selectedProfile, setSelectedProfile] = useState<FitnessProfile>("generic");
  const [compareLast, setCompareLast] = useState(true);
  const [noSave, setNoSave] = useState(false);
  const [profiles, setProfiles] = useState<Record<FitnessProfile, ProfilePanelState>>(EMPTY_STATE);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<string | null>(null);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const hasContext = Boolean(
    workspaceId?.trim()
    || codebaseId?.trim()
    || repoPath?.trim()
  );
  const contextQuery = buildAnalysisQuery({ workspaceId, codebaseId, repoPath });
  const contextPayload = buildAnalysisPayload({ workspaceId, codebaseId, repoPath });
  const contextLabel = codebaseLabel || repoPath || null;

  const selectedState = profiles[selectedProfile];
  const activeReport = selectedState.report;

  const dimensions = useMemo(() => {
    if (!activeReport) return [];
    return Object.values(activeReport.dimensions)
      .slice()
      .sort((left, right) => right.score - left.score || right.levelIndex - left.levelIndex);
  }, [activeReport]);

  const dimensionMap = useMemo(
    () => (activeReport ? Object.values(activeReport.dimensions) : []),
    [activeReport]
  );

  const applyProfiles = useCallback((entries: ApiProfileEntry[]) => {
    setProfiles((current) => {
      const next = { ...current };

      for (const profile of PROFILE_ORDER) {
        const entry = entries.find((item) => item.profile === profile);
        if (!entry) {
          next[profile] = {
            ...next[profile],
            state: "empty",
            error: `${new Date().toLocaleTimeString()} 未返回结果`,
          };
          continue;
        }

      if (entry.status === "ok" && entry.report) {
          next[profile] = {
            state: "ready",
            source: entry.source,
            durationMs: entry.durationMs,
            report: entry.report,
            updatedAt: entry.report.generatedAt,
          };
          continue;
        }

        if (entry.status === "missing") {
          next[profile] = {
            state: "empty",
            source: entry.source,
            error: entry.error ?? "暂无快照",
          };
          continue;
        }

        next[profile] = {
          state: "error",
          source: entry.source,
          durationMs: entry.durationMs,
          error: entry.error ?? "分析失败",
        };
      }

      return next;
    });

    setGlobalError(null);
  }, []);

  const failProfiles = useCallback((targetProfiles: FitnessProfile[], message: string) => {
    setProfiles((current) => {
      const next = { ...current };
      for (const profile of targetProfiles) {
        next[profile] = {
          ...next[profile],
          state: "error",
          source: "analysis",
          error: message,
        };
      }
      return next;
    });
  }, []);

  const syncProfiles = useCallback(async () => {
    if (!hasContext) {
      setProfiles(EMPTY_STATE);
      setLastSnapshotAt(null);
      setGlobalError("请先选择要分析的 Workspace 与 Repository");
      return;
    }

    setGlobalError(null);
    try {
      const reportUrl = contextQuery ? `/api/fitness/report?${contextQuery}` : "/api/fitness/report";
      const response = await desktopAwareFetch(reportUrl, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.text();
        setGlobalError(`获取快照失败: ${response.status} ${body}`);
        return;
      }

      const raw = await response.json().catch(() => null);
      if (raw && typeof raw === "object" && typeof (raw as { generatedAt?: unknown }).generatedAt === "string") {
        setLastSnapshotAt((raw as { generatedAt: string }).generatedAt);
      } else {
        setLastSnapshotAt(new Date().toLocaleString());
      }
      const payload = normalizeApiResponse(raw);
      applyProfiles(payload);
    } catch (error) {
      setGlobalError(`获取快照失败: ${toMessage(error)}`);
    }
  }, [applyProfiles, contextQuery, hasContext]);

  useEffect(() => {
    void syncProfiles();
  }, [syncProfiles]);

  const runProfiles = useCallback(async (targetProfiles: FitnessProfile[]) => {
    const requestProfiles = targetProfiles.slice();
    if (requestProfiles.length === 0) return;

    if (!hasContext) {
      setGlobalError("请先在上方选择 Workspace 与 Repository");
      failProfiles(requestProfiles, "请先在上方选择 Workspace 与 Repository");
      return;
    }

    setProfiles((current) => {
      const next = { ...current };
      for (const profile of requestProfiles) {
        next[profile] = {
          ...next[profile],
          state: "loading",
          error: undefined,
          updatedAt: new Date().toLocaleString(),
        };
      }
      return next;
    });

    setGlobalError(null);

    try {
      const response = await desktopAwareFetch("/api/fitness/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profiles: requestProfiles,
          compareLast,
          noSave,
          ...contextPayload,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
      setProfiles((current) => {
        const next = { ...current };
        for (const profile of requestProfiles) {
          next[profile] = {
            state: "error",
            source: "analysis",
            error: `执行失败: ${response.status} ${body || "空响应"}`,
          };
        }
        return next;
      });
      setGlobalError(`执行失败: ${response.status} ${body || "空响应"}`);
      return;
    }

    const payload: AnalyzeResponse = await response.json().catch(() => ({
      generatedAt: new Date().toISOString(),
      requestedProfiles: requestProfiles,
      profiles: [],
    }));
    applyProfiles(normalizeApiResponse(payload));
    setLastSnapshotAt(payload.generatedAt);
    } catch (error) {
      setGlobalError(`执行失败: ${toMessage(error)}`);
      setProfiles((current) => {
        const next = { ...current };
        for (const profile of requestProfiles) {
          next[profile] = {
            state: "error",
            source: "analysis",
            error: toMessage(error),
          };
        }
        return next;
      });
    }
  }, [applyProfiles, compareLast, contextPayload, failProfiles, hasContext, noSave]);

  const onRunSelectedProfile = useCallback(() => runProfiles([selectedProfile]), [runProfiles, selectedProfile]);
  const onRunAllProfiles = useCallback(() => runProfiles([...PROFILE_ORDER]), [runProfiles]);

  const renderStatusBadge = (state: FitnessProfileState) => {
    const base = "inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]";
    if (state === "ready") return <span className={`${base} border-emerald-300 bg-emerald-50 text-emerald-700`}>已就绪</span>;
    if (state === "loading") return <span className={`${base} border-sky-300 bg-sky-50 text-sky-700`}>分析中</span>;
    if (state === "error") return <span className={`${base} border-rose-300 bg-rose-50 text-rose-700`}>异常</span>;
    if (state === "empty") return <span className={`${base} border-slate-200 bg-slate-100 text-slate-600`}>未生成</span>;
    return <span className={`${base} border-slate-200 bg-slate-100 text-slate-600`}>待运行</span>;
  };

  const renderProfileMiniCard = (profile: FitnessProfile) => {
    const info = PROFILE_DEFS.find((entry) => entry.id === profile);
    const state = profiles[profile];
    const report = state.report;

    const score = report ? report.currentLevelReadiness : 0;
    const label = clampPercent(score);
    const subtitle = info ? `${info.name} · ${info.focus}` : profile;
    const source = state.source === "analysis" ? "实时分析" : state.source === "snapshot" ? "快照" : "";
    const durationText = formatDuration(state.durationMs);

    return (
      <article
        key={profile}
        className="rounded-[20px] border border-desktop-border bg-desktop-bg-secondary/70 p-4 transition-colors hover:bg-desktop-bg-primary/80"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-desktop-text-secondary uppercase tracking-[0.14em]">{subtitle}</div>
            <div className="mt-1 text-sm text-desktop-text-primary">{info?.description}</div>
          </div>
          <div className="shrink-0">
            {renderStatusBadge(state.state)}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-desktop-border bg-white/80 p-3 dark:bg-white/5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold text-desktop-text-secondary">当前层级</span>
            <span className="text-[11px] text-desktop-text-secondary">{source || "-"}</span>
          </div>
          <div className="mt-1 text-sm font-semibold text-desktop-text-primary">
            {report?.overallLevelName ?? "未分析"}
          </div>
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className={`h-full rounded-full ${readinessTone(score)} transition-all`}
                  style={{ width: `${label}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-desktop-text-secondary">
                <span>{label}%</span>
                <span>耗时 {durationText}</span>
              </div>
              <div className="mt-1 text-[11px] text-desktop-text-secondary">
                {state.updatedAt ? `更新时间 ${formatTime(state.updatedAt)}` : "尚未更新"}
              </div>
            </div>
        </div>

        {state.state === "error" && state.error ? (
          <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{state.error}</p>
        ) : null}
      </article>
    );
  };

  const renderOverview = () => {
    if (!activeReport) {
      return (
        <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-6 text-sm text-desktop-text-secondary">
          尚未生成当前配置的 Fitness 报告。请先运行分析。
        </div>
      );
    }

    const topRecommendations = activeReport.recommendations.slice(0, 4);
    const blockers = activeReport.blockingCriteria ?? [];

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-desktop-text-secondary uppercase tracking-[0.14em]">
                当前 Profile
              </div>
              <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">
                {activeReport.profile.toUpperCase()} · {activeReport.overallLevelName}
              </h3>
              <p className="mt-1 text-xs text-desktop-text-secondary">
                快照来源：{activeReport.snapshotPath}
              </p>
            </div>
            <div className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${readinessTone(activeReport.currentLevelReadiness)}`}>
              {clampPercent(activeReport.currentLevelReadiness)}% readiness
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-desktop-text-secondary">模型版本</p>
              <p className="mt-1 text-sm text-desktop-text-primary">v{activeReport.modelVersion}</p>
            </div>
            <div>
              <p className="text-xs text-desktop-text-secondary">阻塞级别</p>
              <p className="mt-1 text-sm text-desktop-text-primary">
                {activeReport.blockingTargetLevelName ?? "无阻塞"}
              </p>
            </div>
          </div>

          {activeReport.nextLevelName ? (
            <p className="mt-4 rounded-lg border border-desktop-border bg-white/70 px-3 py-2 text-xs text-desktop-text-secondary dark:bg-white/6">
              目标方向：{activeReport.nextLevelName}
              {activeReport.nextLevelReadiness !== undefined && activeReport.nextLevelReadiness !== null
                ? `（达成进度 ${clampPercent(activeReport.nextLevelReadiness)}%）`
                : ""}
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold text-desktop-text-secondary uppercase tracking-[0.14em]">建议 Top 4</div>
          {topRecommendations.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {topRecommendations.map((item) => (
                <li key={item.criterionId} className="rounded-xl border border-desktop-border bg-white/80 p-3 dark:bg-white/6">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-desktop-text-primary">{item.action}</p>
                    {item.critical ? (
                      <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">Critical</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-desktop-text-secondary">{item.whyItMatters}</p>
                  <p className="mt-1 text-[11px] text-desktop-text-secondary">证据线索：{item.evidenceHint}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-desktop-text-secondary">当前暂无建议。</p>
          )}
        </div>

        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold text-desktop-text-secondary uppercase tracking-[0.14em]">阻塞项</div>
          {blockers.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {blockers.slice(0, 5).map((item) => (
                <li key={item.id} className="rounded-xl border border-desktop-border bg-white/80 p-3 dark:bg-white/6">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-desktop-text-secondary">{item.id}</span>
                    <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-desktop-text-primary">{item.recommendedAction}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-desktop-text-secondary">当前无阻塞项。</p>
          )}
        </div>
      </div>
    );
  };

  const renderDimensions = () => (
    <div className="grid gap-3 sm:grid-cols-2">
      {dimensions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-6 text-sm text-desktop-text-secondary">
          尚未返回维度数据。
        </div>
      ) : dimensions.map((dimension) => {
        const percentage = clampPercent(dimension.score);
        return (
          <article
            key={dimension.dimension}
            className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4"
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-desktop-text-primary">{dimension.name}</div>
              <span className="rounded-full border border-desktop-border px-2 py-0.5 text-[11px] text-desktop-text-secondary">
                {dimension.levelName}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-desktop-text-secondary">Level {dimension.level}（{dimension.levelIndex}）</p>

            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className={`h-full rounded-full ${readinessTone(dimension.score)} transition-all`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <div className="mt-1 text-right text-[11px] text-desktop-text-secondary">
                {percentage}%
              </div>
            </div>
            {dimension.nextLevelName ? (
              <p className="mt-3 text-[11px] text-desktop-text-secondary">
                下一层级：{dimension.nextLevelName}
                {dimension.nextLevelProgress !== null && dimension.nextLevelProgress !== undefined
                  ? `（${clampPercent(dimension.nextLevelProgress)}%）`
                  : ""}
              </p>
            ) : null}
          </article>
        );
      })}
    </div>
  );

  const renderRecommendations = () => (
    <div className="space-y-2">
      {activeReport ? (
        activeReport.recommendations.map((item) => (
          <article key={item.criterionId} className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-semibold text-sm text-desktop-text-primary">{item.action}</h4>
              {item.critical ? (
                <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">Critical</span>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-desktop-text-secondary">{item.whyItMatters}</p>
            <p className="mt-2 text-[11px] text-desktop-text-secondary">证据线索：{item.evidenceHint}</p>
          </article>
        ))
      ) : (
        <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-6 text-sm text-desktop-text-secondary">
          当前 Profile 没有建议数据。
        </div>
      )}
    </div>
  );

  const renderChanges = () => {
    if (!activeReport?.comparison) {
      return (
        <div className="space-y-4">
          <div className="rounded-2xl border border-dashed border-desktop-border p-4 text-sm text-desktop-text-secondary">
            当前快照未开启历史对比（请开启 compare-last 并重跑）或缺少历史快照。
          </div>
          <section className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
              <div className="text-xs text-desktop-text-secondary">维度快照差异</div>
              {dimensionMap.map((dimension) => (
                <div key={dimension.dimension} className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-desktop-text-primary">{dimension.name}</span>
                  <span className="text-desktop-text-secondary">{dimension.levelName}</span>
                </div>
              ))}
            </article>
            <article className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
              <div className="text-xs text-desktop-text-secondary">对比清单（无差异）</div>
              <p className="mt-2 text-xs text-desktop-text-secondary">开启历史对比后可见层级变化、关键项状态变化。</p>
            </article>
          </section>
        </div>
      );
    }

    const comp = activeReport.comparison;
    return (
      <div className="space-y-4">
        <article className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-sm text-desktop-text-primary">
            与上次对比：{formatTime(comp.previousGeneratedAt)}
          </div>
          <div className="mt-2 text-xs text-desktop-text-secondary">
            上次总体：{comp.previousOverallLevel} → 当前总体：{activeReport.overallLevel}
            <span className={`ml-2 font-semibold ${levelTone(comp.overallChange)}`}>
              {comp.overallChange === "up" ? "上升" : comp.overallChange === "down" ? "下降" : "持平"}
            </span>
          </div>
        </article>

        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold text-desktop-text-secondary uppercase tracking-[0.14em]">维度变化</div>
          {comp.dimensionChanges.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {comp.dimensionChanges.map((item) => (
                <li key={`${item.dimension}-${item.currentLevel}`} className="flex items-center justify-between text-sm">
                  <span className="text-desktop-text-secondary">{item.dimension}</span>
                  <span className="font-semibold text-desktop-text-primary">
                    {item.previousLevel}
                    <span className="text-xs text-desktop-text-secondary"> → </span>
                    {item.currentLevel}
                    <span className={`ml-2 text-xs ${levelTone(item.change)}`}>
                      {item.change === "up" ? "↑" : item.change === "down" ? "↓" : "—"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-desktop-text-secondary">当前未检测到维度变化。</p>
          )}
        </div>

        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold text-desktop-text-secondary uppercase tracking-[0.14em]">关键项状态变化</div>
          {comp.criteriaChanges.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm">
              {comp.criteriaChanges.slice(0, 6).map((item) => (
                <li key={item.id} className="rounded-lg border border-desktop-border bg-white/85 p-2 dark:bg-white/8">
                  <span className="font-mono text-[11px] text-desktop-text-secondary">{item.id}</span>
                  <span className="ml-2 text-xs text-desktop-text-secondary">
                    {item.previousStatus ?? "unknown"}
                    <span className="text-desktop-text-secondary"> → </span>
                    {item.currentStatus ?? "unknown"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-desktop-text-secondary">暂无关键项状态变化。</p>
          )}
        </div>
      </div>
    );
  };

  const renderRaw = () => {
    if (!activeReport) return <div className="rounded-2xl border border-dashed border-desktop-border p-4 text-sm text-desktop-text-secondary">当前无可显示的原始数据。</div>;
    const jsonText = JSON.stringify(activeReport, null, 2);

    return (
      <div className="space-y-2">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={async () => {
              if (typeof window === "undefined") {
                return;
              }
              await navigator.clipboard.writeText(jsonText);
              setCopiedRaw(true);
              window.setTimeout(() => {
                setCopiedRaw(false);
              }, 1200);
            }}
            className="rounded-full border border-desktop-border px-3 py-1.5 text-xs font-semibold text-desktop-text-secondary hover:bg-desktop-bg-primary/70"
          >
            {copiedRaw ? "已复制" : "复制 JSON"}
          </button>
        </div>
        <pre className="overflow-x-auto rounded-2xl border border-desktop-border bg-slate-950 p-4 text-xs leading-5 text-slate-100">
          <code>{jsonText}</code>
        </pre>
      </div>
    );
  };

  const renderCurrentView = () => {
    if (viewMode === "dimensions") return renderDimensions();
    if (viewMode === "recommendations") return renderRecommendations();
    if (viewMode === "changes") return renderChanges();
    if (viewMode === "raw") return renderRaw();
    return renderOverview();
  };

  const crossProfileDiff = useMemo(() => {
    const generic = profiles.generic.report;
    const orchestrator = profiles.agent_orchestrator.report;
    if (!generic || !orchestrator) return null;

    const genericScore = clampPercent(generic.currentLevelReadiness);
    const orchestratorScore = clampPercent(orchestrator.currentLevelReadiness);
    const diff = genericScore - orchestratorScore;

    return {
      genericScore,
      orchestratorScore,
      diff,
    };
  }, [profiles.generic.report, profiles.agent_orchestrator.report]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-desktop-text-secondary uppercase tracking-[0.14em]">Profile 切换</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {PROFILE_DEFS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedProfile(item.id)}
                  className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${selectedProfile === item.id
                    ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
                    : "border-desktop-border text-desktop-text-secondary hover:bg-desktop-bg-primary/70"}`}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          <div className="ml-auto flex flex-wrap gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-desktop-text-secondary">
              <input
                type="checkbox"
                checked={compareLast}
                onChange={(event) => setCompareLast(event.currentTarget.checked)}
                className="h-4 w-4 rounded border-slate-300 text-desktop-accent"
              />
              与上次对比
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-desktop-text-secondary">
              <input
                type="checkbox"
                checked={noSave}
                onChange={(event) => setNoSave(event.currentTarget.checked)}
                className="h-4 w-4 rounded border-slate-300 text-desktop-accent"
              />
              不落盘
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRunSelectedProfile}
            disabled={!hasContext || selectedState.state === "loading"}
            className="rounded-full bg-desktop-accent px-4 py-2 text-sm font-semibold text-desktop-text-on-accent disabled:opacity-60"
          >
            运行当前 Profile
          </button>
          <button
            type="button"
            onClick={onRunAllProfiles}
            disabled={
              !hasContext
              || profiles.generic.state === "loading"
              || profiles.agent_orchestrator.state === "loading"
            }
            className="rounded-full border border-desktop-border px-4 py-2 text-sm font-semibold text-desktop-text-primary hover:bg-desktop-bg-primary/80 disabled:opacity-60"
          >
            同时运行两套
          </button>
          <button
            type="button"
            onClick={() => void syncProfiles()}
            disabled={!hasContext}
            className="rounded-full border border-desktop-border px-4 py-2 text-sm font-semibold text-desktop-text-primary hover:bg-desktop-bg-primary/80"
          >
            刷新快照
          </button>
        </div>

        <p className="mt-2 text-xs text-desktop-text-secondary">
          {hasContext
            ? `当前上下文：${contextLabel ?? "未命名仓库"}`
            : "上下文未设置，请先选择要分析的 Workspace 与 Repository。"
          }
        </p>

        {globalError ? (
          <p className="mt-3 text-xs text-rose-700 dark:text-rose-300">{globalError}</p>
        ) : null}

          <div className="mt-3 text-[11px] text-desktop-text-secondary">
            {hasContext && lastSnapshotAt ? `最近更新：${lastSnapshotAt}` : "尚未刷新快照"}
          </div>

        <div className="mt-4">
          <div className="inline-flex flex-wrap gap-2 rounded-xl border border-desktop-border bg-desktop-bg-primary p-1">
            {VIEW_MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setViewMode(item.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${item.id === viewMode
                  ? "bg-desktop-accent text-desktop-text-on-accent"
                  : "text-desktop-text-secondary hover:bg-desktop-bg-secondary"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        {PROFILE_ORDER.map(renderProfileMiniCard)}
      </section>

      {crossProfileDiff ? (
        <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/60 p-4">
          <div className="text-xs font-semibold text-desktop-text-secondary uppercase tracking-[0.14em]">双 Profile 对比</div>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <div>Generic: {crossProfileDiff.genericScore}%</div>
            <div>Agent Orchestrator: {crossProfileDiff.orchestratorScore}%</div>
            <div>
              差值:
              <span className={crossProfileDiff.diff >= 0 ? "ml-1 text-emerald-600" : "ml-1 text-rose-600"}>
                {crossProfileDiff.diff >= 0 ? "+" : ""}
                {crossProfileDiff.diff}%
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {renderCurrentView()}
    </div>
  );
}
