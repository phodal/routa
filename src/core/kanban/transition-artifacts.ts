import type { ArtifactType } from "../models/artifact";
import { getNextHappyPathColumnId, type KanbanContractRules, type KanbanDeliveryRules } from "../models/kanban";

type ColumnWithArtifacts = {
  id: string;
  name?: string;
  position?: number;
  automation?: {
    requiredArtifacts?: ArtifactType[];
    contractRules?: KanbanContractRules;
    deliveryRules?: KanbanDeliveryRules;
  };
};

const ARTIFACT_LABELS: Record<string, string> = {
  screenshot: "Screenshot",
  test_results: "Test Results",
  code_diff: "Code Diff",
  logs: "Logs",
};

export function formatArtifactLabel(artifact: string): string {
  return ARTIFACT_LABELS[artifact] ?? artifact;
}

export function formatArtifactSummary(artifacts?: string[]): string {
  if (!artifacts || artifacts.length === 0) return "None";
  return artifacts.map((artifact) => formatArtifactLabel(artifact)).join(", ");
}

export function resolveKanbanTransitionArtifacts(
  columns: ColumnWithArtifacts[],
  currentColumnId?: string,
): {
  currentColumn?: ColumnWithArtifacts;
  nextColumn?: ColumnWithArtifacts;
  currentRequiredArtifacts: ArtifactType[];
  nextRequiredArtifacts: ArtifactType[];
} {
  const resolvedCurrentColumnId = currentColumnId ?? "backlog";
  const currentColumn = columns.find((column) => column.id === resolvedCurrentColumnId);
  const nextColumnId = getNextHappyPathColumnId(currentColumn?.id ?? resolvedCurrentColumnId);
  const nextColumn = nextColumnId
    ? columns.find((column) => column.id === nextColumnId)
    : undefined;

  return {
    currentColumn,
    nextColumn,
    currentRequiredArtifacts: (currentColumn?.automation?.requiredArtifacts ?? []) as ArtifactType[],
    nextRequiredArtifacts: (nextColumn?.automation?.requiredArtifacts ?? []) as ArtifactType[],
  };
}
