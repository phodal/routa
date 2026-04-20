import {
  getNextHappyPathColumnId,
  type KanbanColumn,
  type KanbanContractRules,
} from "@/core/models/kanban";
import type { Task } from "@/core/models/task";
import { parseCanonicalStory } from "./canonical-story";

export const DEFAULT_CONTRACT_LOOP_BREAKER_THRESHOLD = 2;
export const CONTRACT_GATE_BLOCKED_LABEL = "contract-gate-blocked";
export const CONTRACT_GATE_NOTE_PREFIX = "Contract gate blocked:";

export interface TaskContractReadiness {
  checked: boolean;
  ready: boolean;
  hasCanonicalStoryBlock: boolean;
  issues: string[];
  loopBreakerThreshold: number;
}

function normalizeLoopBreakerThreshold(rules: KanbanContractRules | undefined): number {
  return Math.max(1, rules?.loopBreakerThreshold ?? DEFAULT_CONTRACT_LOOP_BREAKER_THRESHOLD);
}

export function hasContractRules(
  rules: KanbanContractRules | undefined,
): rules is KanbanContractRules {
  return Boolean(rules?.requireCanonicalStory);
}

export function resolveTargetContractRules(
  columns: Array<Pick<KanbanColumn, "id" | "automation">>,
  targetColumnId?: string,
): KanbanContractRules | undefined {
  if (!targetColumnId) {
    return undefined;
  }

  return columns.find((column) => column.id === targetColumnId)?.automation?.contractRules;
}

export function resolveCurrentOrNextContractRules(
  columns: Array<Pick<KanbanColumn, "id" | "automation">>,
  currentColumnId?: string,
): KanbanContractRules | undefined {
  const resolvedCurrentColumnId = currentColumnId ?? "backlog";
  const currentRules = resolveTargetContractRules(columns, resolvedCurrentColumnId);
  if (hasContractRules(currentRules)) {
    return currentRules;
  }

  return resolveTargetContractRules(columns, getNextHappyPathColumnId(resolvedCurrentColumnId));
}

export function resolveCurrentOrNextContractGate(
  columns: Array<Pick<KanbanColumn, "id" | "name" | "automation">>,
  currentColumnId?: string,
): { columnName: string; rules: KanbanContractRules } | null {
  const resolvedCurrentColumnId = currentColumnId ?? "backlog";
  const currentColumn = columns.find((column) => column.id === resolvedCurrentColumnId);
  if (hasContractRules(currentColumn?.automation?.contractRules)) {
    return {
      columnName: currentColumn.name ?? resolvedCurrentColumnId,
      rules: currentColumn.automation.contractRules,
    };
  }

  const nextColumnId = getNextHappyPathColumnId(resolvedCurrentColumnId);
  const nextColumn = nextColumnId
    ? columns.find((column) => column.id === nextColumnId)
    : undefined;
  if (hasContractRules(nextColumn?.automation?.contractRules)) {
    return {
      columnName: nextColumn.name ?? nextColumnId ?? "the next column",
      rules: nextColumn.automation.contractRules,
    };
  }

  return null;
}

export function buildTaskContractReadiness(
  task: Pick<Task, "objective">,
  rules: KanbanContractRules | undefined,
): TaskContractReadiness {
  if (!hasContractRules(rules)) {
    return {
      checked: false,
      ready: true,
      hasCanonicalStoryBlock: true,
      issues: [],
      loopBreakerThreshold: normalizeLoopBreakerThreshold(rules),
    };
  }

  const parseResult = parseCanonicalStory(task.objective);
  if (!parseResult.hasYamlBlock) {
    return {
      checked: true,
      ready: false,
      hasCanonicalStoryBlock: false,
      issues: [
        "Canonical story YAML is missing. Add exactly one ```yaml``` block with the canonical story contract.",
      ],
      loopBreakerThreshold: normalizeLoopBreakerThreshold(rules),
    };
  }

  return {
    checked: true,
    ready: Boolean(parseResult.story),
    hasCanonicalStoryBlock: true,
    issues: parseResult.story ? [] : parseResult.issues,
    loopBreakerThreshold: normalizeLoopBreakerThreshold(rules),
  };
}

export function formatTaskContractIssues(issues: string[]): string {
  if (issues.length === 0) {
    return "Canonical story YAML failed validation.";
  }

  const summary = issues.slice(0, 2).join(" ");
  return issues.length > 2 ? `${summary} (${issues.length - 2} more issue(s))` : summary;
}

export function buildTaskContractTransitionErrorFromRules(
  readiness: TaskContractReadiness,
  targetColumnName: string,
  rules: KanbanContractRules | undefined,
): string | null {
  if (!hasContractRules(rules) || readiness.ready) {
    return null;
  }

  if (!readiness.hasCanonicalStoryBlock) {
    return `Cannot move task to "${targetColumnName}": ${readiness.issues[0] ?? "Canonical story YAML is missing."} Regenerate the canonical YAML in Backlog before retrying.`;
  }

  return `Cannot move task to "${targetColumnName}": canonical story YAML is invalid. ${formatTaskContractIssues(readiness.issues)} Regenerate the canonical YAML in Backlog before retrying.`;
}

export function buildTaskContractUpdateErrorFromRules(
  readiness: TaskContractReadiness,
  targetColumnName: string,
  rules: KanbanContractRules | undefined,
): string | null {
  if (!hasContractRules(rules) || readiness.ready) {
    return null;
  }

  if (!readiness.hasCanonicalStoryBlock) {
    return `Cannot update card description: ${readiness.issues[0] ?? "Canonical story YAML is missing."} This card must satisfy the canonical contract gate for "${targetColumnName}".`;
  }

  return `Cannot update card description: canonical story YAML is invalid for "${targetColumnName}". ${formatTaskContractIssues(readiness.issues)}`;
}

export function buildContractGateNote(message: string): string {
  return `${CONTRACT_GATE_NOTE_PREFIX} ${message}`.trim();
}

export function countContractGateFailures(task: Pick<Task, "comments">): number {
  return (task.comments ?? []).filter((entry) => entry.body?.startsWith(CONTRACT_GATE_NOTE_PREFIX)).length;
}

export function buildContractLoopBreakerMessage(
  targetColumnName: string,
  failureCount: number,
  threshold: number,
): string {
  return `Stopped automatic retries for "${targetColumnName}" after ${failureCount} canonical contract gate failures (limit: ${threshold}). Regenerate the canonical story YAML in Backlog before retrying.`;
}
