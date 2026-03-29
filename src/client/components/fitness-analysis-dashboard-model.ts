"use client";

import {
  clampPercent,
  criterionShortLabel,
  humanizeToken,
  type FitnessReport,
} from "./fitness-analysis-types";

export type DashboardGateState = "pass" | "warn" | "fail";

export type DashboardMetricModel = {
  overallReadiness: number;
  nextUnlockReadiness: number | null;
  blockerCount: number;
  passRate: number;
  currentLevelName: string;
  nextLevelName: string | null;
  changedDimensions: number;
  changedCriteria: number;
  previousGeneratedAt?: string;
};

export type DashboardRadarDatum = {
  key: string;
  label: string;
  current: number;
  target: number;
};

export type DashboardGateSummary = {
  pass: number;
  warn: number;
  fail: number;
};

export type DashboardBlockerHotspot = {
  dimension: string;
  label: string;
  count: number;
  leadingCriterion: string;
};

export type DashboardHeatmapCell = {
  id: string;
  dimension: string;
  dimensionLabel: string;
  level: string;
  levelLabel: string;
  score: number;
  passedWeight: number;
  applicableWeight: number;
};

export type FitnessDashboardModel = {
  metrics: DashboardMetricModel;
  radar: DashboardRadarDatum[];
  gateSummary: DashboardGateSummary;
  blockerHotspots: DashboardBlockerHotspot[];
  heatmapLevels: string[];
  heatmapDimensions: string[];
  heatmapCells: DashboardHeatmapCell[];
};

const DIMENSION_ORDER = ["collaboration", "sdlc", "harness", "governance", "context"] as const;
const LEVEL_ORDER = [
  "awareness",
  "assisted_coding",
  "structured_ai_coding",
  "agent_centric",
  "agent_first",
] as const;

function sortByPreferredOrder(value: string, order: readonly string[]) {
  const index = order.indexOf(value);
  return index === -1 ? order.length + 1 : index;
}

function buildGateSummary(report: FitnessReport): DashboardGateSummary {
  return report.criteria.reduce<DashboardGateSummary>((summary, criterion) => {
    if (criterion.status === "pass") {
      summary.pass += 1;
      return summary;
    }
    if (criterion.status === "skipped") {
      summary.warn += 1;
      return summary;
    }
    summary.fail += 1;
    return summary;
  }, { pass: 0, warn: 0, fail: 0 });
}

function buildRadar(report: FitnessReport): DashboardRadarDatum[] {
  const orderedKeys = Object.keys(report.dimensions).sort((left, right) => (
    sortByPreferredOrder(left, DIMENSION_ORDER) - sortByPreferredOrder(right, DIMENSION_ORDER)
  ));

  return orderedKeys.map((key) => {
    const dimension = report.dimensions[key];
    const current = clampPercent(dimension?.score ?? 0);
    return {
      key,
      label: dimension?.name ?? humanizeToken(key),
      current,
      target: dimension?.nextLevel ? 100 : current,
    };
  });
}

function buildBlockerHotspots(report: FitnessReport): DashboardBlockerHotspot[] {
  const blockerGroups = new Map<string, DashboardBlockerHotspot>();

  for (const blocker of report.blockingCriteria ?? []) {
    const existing = blockerGroups.get(blocker.dimension);
    const increment = blocker.critical ? 2 : 1;
    if (existing) {
      existing.count += increment;
      continue;
    }
    blockerGroups.set(blocker.dimension, {
      dimension: blocker.dimension,
      label: report.dimensions[blocker.dimension]?.name ?? humanizeToken(blocker.dimension),
      count: increment,
      leadingCriterion: criterionShortLabel(blocker.id),
    });
  }

  return [...blockerGroups.values()].sort((left, right) => right.count - left.count);
}

function buildHeatmap(report: FitnessReport) {
  const heatmapCells = report.cells
    .map((cell) => ({
      id: cell.id,
      dimension: cell.dimension,
      dimensionLabel: cell.dimensionName ?? report.dimensions[cell.dimension]?.name ?? humanizeToken(cell.dimension),
      level: cell.level,
      levelLabel: cell.levelName ?? humanizeToken(cell.level),
      score: clampPercent(cell.score),
      passedWeight: cell.passedWeight,
      applicableWeight: cell.applicableWeight,
    }))
    .sort((left, right) => {
      const dimensionOrder = sortByPreferredOrder(left.dimension, DIMENSION_ORDER) - sortByPreferredOrder(right.dimension, DIMENSION_ORDER);
      if (dimensionOrder !== 0) return dimensionOrder;
      return sortByPreferredOrder(left.level, LEVEL_ORDER) - sortByPreferredOrder(right.level, LEVEL_ORDER);
    });

  const heatmapDimensions = [...new Set(heatmapCells.map((cell) => cell.dimension))];
  const heatmapLevels = [...new Set(heatmapCells.map((cell) => cell.level))]
    .sort((left, right) => sortByPreferredOrder(left, LEVEL_ORDER) - sortByPreferredOrder(right, LEVEL_ORDER));

  return {
    heatmapCells,
    heatmapDimensions,
    heatmapLevels,
  };
}

export function toDashboardGateState(value: number): DashboardGateState {
  if (value >= 90) return "pass";
  if (value >= 70) return "warn";
  return "fail";
}

export function buildFitnessDashboardModel(report: FitnessReport): FitnessDashboardModel {
  const gateSummary = buildGateSummary(report);
  const comparison = report.comparison;
  const metrics: DashboardMetricModel = {
    overallReadiness: clampPercent(report.currentLevelReadiness),
    nextUnlockReadiness: report.nextLevelReadiness == null ? null : clampPercent(report.nextLevelReadiness),
    blockerCount: report.blockingCriteria?.length ?? 0,
    passRate: report.criteria.length > 0 ? Math.round((gateSummary.pass / report.criteria.length) * 100) : 0,
    currentLevelName: report.overallLevelName,
    nextLevelName: report.nextLevelName ?? null,
    changedDimensions: comparison?.dimensionChanges.filter((item) => item.change !== "same").length ?? 0,
    changedCriteria: comparison?.criteriaChanges.length ?? 0,
    previousGeneratedAt: comparison?.previousGeneratedAt,
  };

  const { heatmapCells, heatmapDimensions, heatmapLevels } = buildHeatmap(report);

  return {
    metrics,
    radar: buildRadar(report),
    gateSummary,
    blockerHotspots: buildBlockerHotspots(report),
    heatmapLevels,
    heatmapDimensions,
    heatmapCells,
  };
}
