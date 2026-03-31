"use client";

import type { FitnessSpecSummary } from "@/client/hooks/use-harness-settings-data";

export type DimensionDensityDatum = {
  id: string;
  label: string;
  fileName: string;
  metricCount: number;
  hardGateCount: number;
  weight: number;
  thresholdPass: number;
  thresholdWarn: number;
  score: number;
  isSelected: boolean;
};

export type FitnessFilesDashboardModel = {
  dimensions: DimensionDensityDatum[];
  selectedDimension: DimensionDensityDatum | null;
};

function normalizeFitnessPath(relativePath: string) {
  return relativePath.startsWith("docs/fitness/")
    ? relativePath.slice("docs/fitness/".length)
    : relativePath;
}

function normalizeWeight(weight: number, maxWeight: number) {
  if (maxWeight <= 0) {
    return 0;
  }

  return Math.round((weight / maxWeight) * 100);
}

function strictnessScore(thresholdPass: number, thresholdWarn: number) {
  return Math.round((thresholdPass * 0.6) + (thresholdWarn * 0.4));
}

function buildSpecScore({
  weight,
  maxWeight,
  metricCount,
  hardGateCount,
  thresholdPass,
  thresholdWarn,
}: {
  weight: number;
  maxWeight: number;
  metricCount: number;
  hardGateCount: number;
  thresholdPass: number;
  thresholdWarn: number;
}) {
  const weightScore = normalizeWeight(weight, maxWeight);
  const gateCoverage = metricCount > 0 ? Math.round((hardGateCount / metricCount) * 100) : 0;
  const thresholds = strictnessScore(thresholdPass, thresholdWarn);

  return Math.round((weightScore * 0.45) + (gateCoverage * 0.35) + (thresholds * 0.2));
}

export function buildHarnessFitnessFilesDashboardModel(
  specFiles: FitnessSpecSummary[],
  selectedSpec: FitnessSpecSummary | null,
): FitnessFilesDashboardModel {
  const manifestEntries = specFiles
    .find((file) => file.kind === "manifest")
    ?.manifestEntries
    ?.map(normalizeFitnessPath) ?? [];
  const manifestEntrySet = new Set(manifestEntries);
  const allDimensions = specFiles.filter((file) => file.kind === "dimension");
  const dimensionFiles = manifestEntrySet.size > 0
    ? allDimensions.filter((file) => manifestEntrySet.has(normalizeFitnessPath(file.relativePath)))
    : allDimensions;
  const selectedId = selectedSpec?.kind === "dimension" ? selectedSpec.relativePath : null;
  const maxWeight = Math.max(
    ...dimensionFiles.map((file) => file.weight ?? 0),
    0,
  );

  const dimensions = dimensionFiles
    .map((file) => {
      const weight = file.weight ?? 0;
      const thresholdPass = file.thresholdPass ?? 90;
      const thresholdWarn = file.thresholdWarn ?? 80;
      const hardGateCount = file.metrics.filter((metric) => metric.hardGate).length;

      return {
        id: file.relativePath,
        label: file.dimension ?? file.name.replace(/\.[^.]+$/u, ""),
        fileName: file.name,
        metricCount: file.metricCount,
        hardGateCount,
        weight,
        thresholdPass,
        thresholdWarn,
        score: buildSpecScore({
          weight,
          maxWeight,
          metricCount: file.metricCount,
          hardGateCount,
          thresholdPass,
          thresholdWarn,
        }),
        isSelected: selectedId === file.relativePath,
      };
    })
    .sort((left, right) => right.score - left.score || right.weight - left.weight || right.metricCount - left.metricCount);

  return {
    dimensions,
    selectedDimension: dimensions.find((dimension) => dimension.isSelected) ?? null,
  };
}
