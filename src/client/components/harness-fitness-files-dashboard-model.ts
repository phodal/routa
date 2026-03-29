"use client";

import type { FitnessSpecSummary } from "@/client/hooks/use-harness-settings-data";

export type DimensionDensityDatum = {
  id: string;
  label: string;
  fileName: string;
  metricCount: number;
  hardGateCount: number;
  densityScore: number;
  isSelected: boolean;
};

export type FitnessFilesDashboardModel = {
  dimensions: DimensionDensityDatum[];
  selectedDimension: DimensionDensityDatum | null;
};

export function buildHarnessFitnessFilesDashboardModel(
  specFiles: FitnessSpecSummary[],
  selectedSpec: FitnessSpecSummary | null,
): FitnessFilesDashboardModel {
  const selectedId = selectedSpec?.kind === "dimension" ? selectedSpec.relativePath : null;
  const maxMetricCount = Math.max(
    ...specFiles.filter((file) => file.kind === "dimension").map((file) => file.metricCount),
    0,
  );

  const dimensions = specFiles
    .filter((file) => file.kind === "dimension")
    .map((file) => ({
      id: file.relativePath,
      label: file.dimension ?? file.name.replace(/\.[^.]+$/u, ""),
      fileName: file.name,
      metricCount: file.metricCount,
      hardGateCount: file.metrics.filter((metric) => metric.hardGate).length,
      densityScore: maxMetricCount > 0 ? Math.round((file.metricCount / maxMetricCount) * 100) : 0,
      isSelected: selectedId === file.relativePath,
    }))
    .sort((left, right) => right.metricCount - left.metricCount || right.hardGateCount - left.hardGateCount);

  return {
    dimensions,
    selectedDimension: dimensions.find((dimension) => dimension.isSelected) ?? null,
  };
}
