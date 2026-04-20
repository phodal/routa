"use client";

import { useCallback, useEffect, useState } from "react";

import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { TranslationDictionary } from "@/i18n/types";
import { useTranslation } from "@/i18n";

import { FitnessAnalysisDashboard } from "./fitness-analysis-dashboard";
import { FitnessAnalysisContent } from "./fitness-analysis-content";
import {
  PROFILE_ORDER,
  buildAnalysisPayload,
  buildAnalysisQuery,
  normalizeApiResponse,
  profileStateTone,
  type AnalyzeResponse,
  type FitnessProfile,
  type FitnessProfileState,
  type ProfilePanelState,
  toMessage,
} from "./fitness-analysis-types";
import { buildHeroModel, buildPrimaryActionLabel } from "./fitness-analysis-view-model";

type FitnessAnalysisPanelProps = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
};

const EMPTY_STATE: Record<FitnessProfile, ProfilePanelState> = {
  generic: { state: "idle" },
  agent_orchestrator: { state: "idle" },
};

type MatrixColumn = {
  key: string;
  title: string[];
  subtitle?: string;
  color: string;
};

type MatrixRow = {
  title: string[];
  subtitle?: string;
};

type MatrixPoint = {
  x: number; // 0~5, 0.5 means first column center
  y: number; // 0~5, 0.5 means first row center
  color: string;
};

const LEVEL_INDEX: Record<string, number> = {
  awareness: 0,
  assisted_coding: 1,
  structured_ai_coding: 2,
  agent_centric: 3,
  agent_first: 4,
};

const MATRIX_COLUMN_KEYS = ["collaboration", "sdlc", "harness", "governance", "context"] as const;
const MATRIX_ROW_KEYS = ["awareness", "assistedCoding", "structuredAiCoding", "agentCentric", "agentFirst"] as const;

function buildMatrixColumns(matrix: TranslationDictionary["fitness"]["matrix"]): MatrixColumn[] {
  return MATRIX_COLUMN_KEYS.map((key) => ({
    key,
    title: matrix[key].title,
    subtitle: matrix[key].subtitle,
    color: {
      collaboration: "#0D4E63",
      sdlc: "#53A8B7",
      harness: "#EF6A82",
      governance: "#6C548F",
      context: "#D28A07",
    }[key],
  }));
}

function buildMatrixRows(matrix: TranslationDictionary["fitness"]["matrix"]): MatrixRow[] {
  return MATRIX_ROW_KEYS.map((key) => ({
    title: matrix[key].title,
    subtitle: matrix[key].subtitle,
  }));
}

function SvgMultilineText({
  x,
  y,
  lines,
  fontSize = 16,
  lineGap = 1.2,
  fill = "#111",
  fontWeight = 600,
  textAnchor = "middle",
}: {
  x: number;
  y: number;
  lines: string[];
  fontSize?: number;
  lineGap?: number;
  fill?: string;
  fontWeight?: number | string;
  textAnchor?: "start" | "middle" | "end";
}) {
  return (
    <text
      x={x}
      y={y}
      fill={fill}
      fontSize={fontSize}
      fontWeight={fontWeight}
      textAnchor={textAnchor}
      fontFamily="Inter, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    >
      {lines.map((line, i) => (
        <tspan key={line + i} x={x} dy={i === 0 ? 0 : fontSize * lineGap}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function CapabilityPin({ x, y, color, size = 22 }: { x: number; y: number; color: string; size?: number }) {
  const scale = size / 24;

  return (
    <g transform={`translate(${x}, ${y}) scale(${scale}) translate(-12, -24)`}>
      <path
        d="M12 2C7.58 2 4 5.58 4 10c0 6.2 8 14 8 14s8-7.8 8-14c0-4.42-3.58-8-8-8z"
        fill={color}
      />
      <circle cx="12" cy="10" r="2.7" fill="#fff" />
    </g>
  );
}

function FitnessMatrix({
  selectedReport,
  matrixColumns,
  matrixRows,
  noDataText,
}: {
  selectedReport?: { dimensions?: Record<string, { level?: string | null }> } | undefined;
  matrixColumns: MatrixColumn[];
  matrixRows: MatrixRow[];
  noDataText: string;
}) {
  const matrixWidth = 1400;
  const matrixHeight = 320;
  const margin = { top: 52, right: 14, bottom: 16, left: 152 };
  const plotX = margin.left;
  const plotY = margin.top;
  const plotW = matrixWidth - margin.left - margin.right;
  const plotH = matrixHeight - margin.top - margin.bottom;
  const colCount = matrixColumns.length;
  const rowCount = matrixRows.length;
  const colW = plotW / colCount;
  const rowH = plotH / rowCount;
  const toX = (value: number) => plotX + value * colW;
  const toY = (value: number) => plotY + value * rowH;

  const dimensionMap = selectedReport?.dimensions ?? {};
  const points: MatrixPoint[] = matrixColumns.flatMap((column, index) => {
    const level = dimensionMap[column.key]?.level ?? null;
    const levelIndex = level ? LEVEL_INDEX[level] : undefined;
    if (levelIndex === undefined) {
      return [];
    }

    return [{
      x: index + 0.5,
      y: levelIndex + 0.5,
      color: column.color,
    }];
  });

  const hasPointData = points.length > 0;
  const polylinePoints = points.map((point) => `${toX(point.x)},${toY(point.y)}`).join(" ");

  if (!selectedReport) {
    return (
      <div className="mt-2 rounded-xl border border-dashed border-desktop-border px-3 py-2 text-[11px] text-desktop-text-secondary">
        {matrixRows.length ? noDataText : null}
      </div>
    );
  }

  return (
    <div className="mt-1 overflow-x-auto">
      <div className="min-w-[520px]">
        <svg
          viewBox={`0 0 ${matrixWidth} ${matrixHeight}`}
          className="h-auto w-full"
          role="img"
          aria-label="AI capability matrix"
        >
          <rect
            x={plotX}
            y={plotY}
            width={plotW}
            height={plotH}
            fill="#EEF1F2"
          />

          {Array.from({ length: colCount + 1 }).map((_, i) => {
            const x = plotX + i * colW;
            return (
              <line
                key={`v-${i}`}
                x1={x}
                y1={plotY}
                x2={x}
                y2={plotY + plotH}
                stroke="#FFFFFF"
                strokeWidth={1}
              />
            );
          })}
          {Array.from({ length: rowCount + 1 }).map((_, i) => {
            const y = plotY + i * rowH;
            return (
              <line
                key={`h-${i}`}
                x1={plotX}
                y1={y}
                x2={plotX + plotW}
                y2={y}
                stroke="#FFFFFF"
                strokeWidth={1}
              />
            );
          })}

          {matrixColumns.map((column, index) => {
            const cx = plotX + (index + 0.5) * colW;
            const titleLineHeight = 12 * 1.2;
            const subtitleY = 34 + ((column.title.length - 1) * titleLineHeight) + 16;
            return (
              <g key={column.key}>
                <SvgMultilineText
                  x={cx}
                  y={34}
                  lines={column.title}
                  fontSize={12}
                  fontWeight={700}
                  fill={column.color}
                  textAnchor="middle"
                />
                {column.subtitle ? (
                  <text
                    x={cx}
                    y={subtitleY}
                    fill={column.color}
                    fontSize={10}
                    fontWeight={700}
                    textAnchor="middle"
                    fontFamily="Inter, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
                  >
                    {column.subtitle}
                  </text>
                ) : null}
              </g>
            );
          })}

          {matrixRows.map((row, index) => {
            const cy = plotY + (index + 0.5) * rowH;
            const labelX = plotX - 28;
            return (
              <g key={row.title.join("-")}>
                <SvgMultilineText
                  x={labelX}
                  y={cy - (row.title.length - 1) * 7 - 2}
                  lines={row.title}
                  fontSize={12}
                  fontWeight={600}
                  fill="#111"
                  textAnchor="end"
                />
                {row.subtitle ? (
                  <text
                    x={labelX}
                    y={cy + 17}
                    fill="#A1A1A1"
                    fontSize={8.5}
                    fontWeight={500}
                    textAnchor="end"
                    fontFamily="Inter, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
                  >
                    {row.subtitle}
                  </text>
                ) : null}
              </g>
            );
          })}

          {hasPointData ? (
            <polyline
              points={polylinePoints}
              fill="none"
              stroke="#757575"
              strokeWidth={2}
              strokeDasharray="4 10"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}

          {points.map((point) => (
            <CapabilityPin key={`${point.x}-${point.y}`} x={toX(point.x)} y={toY(point.y)} color={point.color} size={20} />
          ))}

        </svg>
      </div>
    </div>
  );
}

function StatusBadge({
  state,
  t,
}: {
  state: FitnessProfileState;
  t: Pick<TranslationDictionary["fitness"]["panel"], "statusIdle" | "statusLoading" | "statusReady" | "statusEmpty" | "statusError">;
}) {
  const labels: Record<FitnessProfileState, string> = {
    idle: t.statusIdle,
    loading: t.statusLoading,
    ready: t.statusReady,
    empty: t.statusEmpty,
    error: t.statusError,
  };

  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${profileStateTone(state)}`}>
      {labels[state]}
    </span>
  );
}

export function FitnessAnalysisPanel({
  workspaceId,
  codebaseId,
  repoPath,
}: FitnessAnalysisPanelProps) {
  const { t } = useTranslation();
  const fitness = t.fitness;
  const [profiles, setProfiles] = useState<Record<FitnessProfile, ProfilePanelState>>(EMPTY_STATE);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const hasContext = Boolean(workspaceId?.trim() || codebaseId?.trim() || repoPath?.trim());
  const contextQuery = buildAnalysisQuery({ workspaceId, codebaseId, repoPath });
  const contextPayload = buildAnalysisPayload(
    { workspaceId, codebaseId, repoPath },
    { mode: "deterministic" },
  );
  const compareLast = true;
  const noSave = false;

  const selectedProfile: FitnessProfile = "generic";
  const selectedState = profiles.generic;
  const matrixColumns = buildMatrixColumns(fitness.matrix);
  const matrixRows = buildMatrixRows(fitness.matrix);
  const noDataText = fitness.panel.noData;
  const applyProfiles = useCallback((entries: ReturnType<typeof normalizeApiResponse>) => {
    setProfiles((current) => {
      const next = { ...current };

      for (const profile of PROFILE_ORDER) {
        const entry = entries.find((item) => item.profile === profile);

        if (!entry) {
          next[profile] = {
            ...next[profile],
            state: "empty",
            error: `${new Date().toLocaleTimeString()} ${fitness.action.noAction}`,
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
            error: entry.error ?? fitness.action.noSnapshots,
          };
          continue;
        }

        next[profile] = {
          state: "error",
          source: entry.source,
          durationMs: entry.durationMs,
          error: entry.error ?? fitness.action.analyzeFailed,
        };
      }

      return next;
    });

    setGlobalError(null);
  }, [
    fitness.action.analyzeFailed,
    fitness.action.noAction,
    fitness.action.noSnapshots,
  ]);

  const syncProfiles = useCallback(async () => {
    if (!hasContext) {
      setProfiles(EMPTY_STATE);
      setGlobalError(fitness.panel.noWorkspaceSelected);
      return;
    }

    setGlobalError(null);

    try {
      const reportUrl = contextQuery ? `/api/fitness/report?${contextQuery}` : "/api/fitness/report";
      const response = await desktopAwareFetch(reportUrl, { cache: "no-store" });

      if (!response.ok) {
        const body = await response.text();
        setGlobalError(`${fitness.panel.fetchSnapshotFailed}${response.status} ${body}`);
        return;
      }

      const raw = await response.json().catch(() => null);
      applyProfiles(normalizeApiResponse(raw));
    } catch (error) {
      setGlobalError(`${fitness.panel.fetchSnapshotFailed}${toMessage(error)}`);
    }
  }, [
    applyProfiles,
    contextQuery,
    hasContext,
    fitness.panel.fetchSnapshotFailed,
    fitness.panel.noWorkspaceSelected,
  ]);

  useEffect(() => {
    queueMicrotask(() => {
      void syncProfiles();
    });
  }, [syncProfiles]);

  const runProfiles = useCallback(async (targetProfiles: FitnessProfile[]) => {
    if (targetProfiles.length === 0) {
      return;
    }

    if (!hasContext) {
      const message = fitness.panel.noWorkspaceAction;
      setGlobalError(message);
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
      return;
    }

    setGlobalError(null);
    setProfiles((current) => {
      const next = { ...current };
      for (const profile of targetProfiles) {
        next[profile] = {
          ...next[profile],
          state: "loading",
          error: undefined,
          updatedAt: new Date().toLocaleString(),
        };
      }
      return next;
    });

    try {
      const response = await desktopAwareFetch("/api/fitness/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profiles: targetProfiles,
          compareLast,
          noSave,
          ...contextPayload,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        const message = `${fitness.panel.analyzeFailedPrefix}${response.status} ${body || fitness.panel.noAnalyzeResponse}`;
        setGlobalError(message);
        setProfiles((current) => {
          const next = { ...current };
          for (const profile of targetProfiles) {
            next[profile] = {
              state: "error",
              source: "analysis",
              error: message,
            };
          }
          return next;
        });
        return;
      }

      const payload: AnalyzeResponse = await response.json().catch(() => ({
        generatedAt: new Date().toISOString(),
        requestedProfiles: targetProfiles,
        profiles: [],
      }));

      applyProfiles(normalizeApiResponse(payload));
    } catch (error) {
      const message = `${fitness.panel.analyzeFailedPrefix}${toMessage(error)}`;
      setGlobalError(message);
      setProfiles((current) => {
        const next = { ...current };
        for (const profile of targetProfiles) {
          next[profile] = {
            state: "error",
            source: "analysis",
            error: message,
          };
        }
        return next;
      });
    }
  }, [
    applyProfiles,
    compareLast,
    contextPayload,
    hasContext,
    noSave,
    fitness.panel.analyzeFailedPrefix,
    fitness.panel.noAnalyzeResponse,
    fitness.panel.noWorkspaceAction,
  ]);

  const onRunSelectedProfile = useCallback(() => {
    void runProfiles([selectedProfile]);
  }, [runProfiles, selectedProfile]);

  const selectedReport = selectedState.report;
  const blockers = selectedReport?.blockingCriteria ?? [];
  const failedCriteria = selectedReport?.criteria.filter((criterion) => criterion.status === "fail") ?? [];
  const heroModel = buildHeroModel(selectedReport, selectedProfile, selectedState.state, fitness);
  const primaryActionLabel = buildPrimaryActionLabel(selectedReport, selectedState.state, fitness);
  const reportSource = selectedState.source === "analysis"
    ? fitness.panel.reportSourceLive
    : selectedState.source === "snapshot"
      ? fitness.panel.reportSourceSnapshot
      : fitness.panel.reportSourceNone;
  const reportReadiness = selectedReport ? `${Math.round(selectedReport.currentLevelReadiness * 100)}%` : noDataText;
  const reportSourceLabel = selectedReport ? reportSource : fitness.panel.noContextReport;

  return (
    <div className="space-y-3">
      <section className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/60 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[11px] uppercase tracking-[0.14em] text-desktop-text-secondary">
              {heroModel.title}
            </div>
            <div className="mt-1 truncate text-[11px] leading-tight text-desktop-text-secondary">
              {heroModel.currentLevel} → {heroModel.targetLevel}
              <span className="text-desktop-text-secondary"> · {heroModel.confidenceSummary}</span>
              {heroModel.baselineSummary ? (
                <span className="text-desktop-text-secondary"> · {heroModel.baselineSummary}</span>
              ) : null}
              <span className="text-desktop-text-secondary"> · {fitness.panel.blockers} {selectedReport ? blockers.length : noDataText}</span>
              <span className="text-desktop-text-secondary"> · {fitness.panel.failed} {selectedReport ? failedCriteria.length : noDataText}</span>
              <span className="text-desktop-text-secondary"> · {reportSourceLabel}</span>
            </div>
          </div>
          <StatusBadge state={selectedState.state} t={fitness.panel} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRunSelectedProfile}
            disabled={!hasContext || selectedState.state === "loading"}
            className="h-7 rounded-sm bg-desktop-accent px-3 text-[12px] font-semibold leading-none text-desktop-text-on-accent disabled:opacity-60"
          >
            {primaryActionLabel}
          </button>
          <button
            type="button"
            onClick={() => void syncProfiles()}
            disabled={!hasContext}
            className="h-7 rounded-sm border border-desktop-border px-3 text-[12px] font-semibold leading-none text-desktop-text-primary hover:bg-desktop-bg-primary/80 disabled:opacity-60"
          >
            {fitness.panel.refresh}
          </button>
          <span className="ml-auto inline-flex items-center rounded-sm border border-desktop-border px-2 py-0.5 text-[11px] text-desktop-text-secondary">
            {fitness.panel.fit} {reportReadiness}
          </span>
        </div>

        <div className="mt-1 border-t border-desktop-border/80 pt-1">
          <div className="text-[10px] uppercase tracking-[0.1em] text-desktop-text-secondary">{fitness.panel.capabilityMatrix}</div>
          <FitnessMatrix
            selectedReport={selectedReport}
            matrixColumns={matrixColumns}
            matrixRows={matrixRows}
            noDataText={fitness.panel.matrixNoPoint}
          />
        </div>

        {globalError ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-5 text-rose-700">
            {globalError}
          </div>
        ) : null}
      </section>

      <FitnessAnalysisDashboard report={selectedReport} />

      <section className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/60 p-4">
        <FitnessAnalysisContent
          selectedProfile={selectedProfile}
          viewMode="overview"
          profileState={selectedState}
          report={selectedReport}
        />
      </section>
    </div>
  );
}
