import { TaskStatus } from "./task";
import {
  DEFAULT_DEV_REQUIRED_TASK_FIELDS,
  KANBAN_REQUIRED_TASK_FIELDS,
  type KanbanRequiredTaskField,
} from "./task-requirements";

export { DEFAULT_DEV_REQUIRED_TASK_FIELDS, KANBAN_REQUIRED_TASK_FIELDS };
export type { KanbanRequiredTaskField } from "./task-requirements";

export type KanbanColumnStage = "backlog" | "todo" | "dev" | "review" | "blocked" | "done";
export type KanbanDevSessionSupervisionMode = "disabled" | "watchdog_retry" | "ralph_loop";
export type KanbanDevSessionCompletionRequirement =
  | "turn_complete"
  | "completion_summary"
  | "verification_report";

export type KanbanTransport = "acp" | "a2a";

export interface KanbanDeliveryRules {
  /** Require at least one commit ahead of the base branch before transition. */
  requireCommittedChanges?: boolean;
  /** Require a clean working tree before transition. */
  requireCleanWorktree?: boolean;
  /** Require the branch/repo state to be pull-request ready before transition. */
  requirePullRequestReady?: boolean;
}

export interface KanbanContractRules {
  /** Require a valid canonical story YAML block before transition or description updates. */
  requireCanonicalStory?: boolean;
  /** Stop automated retries after this many canonical-story gate failures. */
  loopBreakerThreshold?: number;
}

export interface KanbanAutomationStep {
  id: string;
  /** Transport protocol for this automation step */
  transport?: KanbanTransport;
  providerId?: string;
  role?: string;
  specialistId?: string;
  specialistName?: string;
  specialistLocale?: string;
  /** A2A-specific: URL of the agent card to invoke */
  agentCardUrl?: string;
  /** A2A-specific: Skill ID to invoke on the agent */
  skillId?: string;
  /** A2A-specific: Auth configuration ID for the request */
  authConfigId?: string;
}

export interface KanbanDevSessionSupervision {
  /** Whether dev-lane ACP sessions should be supervised and automatically recovered. */
  mode: KanbanDevSessionSupervisionMode;
  /** Minutes without meaningful ACP activity before the watchdog intervenes. */
  inactivityTimeoutMinutes: number;
  /** Maximum number of recovery attempts after the initial session. */
  maxRecoveryAttempts: number;
  /** External completion signal required in Ralph Loop mode. */
  completionRequirement: KanbanDevSessionCompletionRequirement;
}

/**
 * Automation configuration for a Kanban column.
 * When a card is moved to this column, the automation can trigger an agent session.
 */
export interface KanbanColumnAutomation {
  /** Whether automation is enabled for this column */
  enabled: boolean;
  /** Ordered automation steps to run within the same lane */
  steps?: KanbanAutomationStep[];
  /** Provider ID to use for the automation */
  providerId?: string;
  /** Role for the agent (CRAFTER, ROUTA, GATE, DEVELOPER) */
  role?: string;
  /** Specialist ID to use */
  specialistId?: string;
  /** Specialist name (for display) */
  specialistName?: string;
  /** Specialist locale used to resolve prompt content */
  specialistLocale?: string;
  /** When to trigger: on entry, exit, or both (default: entry) */
  transitionType?: "entry" | "exit" | "both";
  /** Artifacts required before transition is allowed */
  requiredArtifacts?: ("screenshot" | "test_results" | "code_diff")[];
  /** Task fields that must be present before transition is allowed */
  requiredTaskFields?: KanbanRequiredTaskField[];
  /** Canonical story contract requirements enforced before transition or description updates */
  contractRules?: KanbanContractRules;
  /** Delivery-readiness requirements enforced before transition is allowed */
  deliveryRules?: KanbanDeliveryRules;
  /** Automatically advance card to next column on agent success */
  autoAdvanceOnSuccess?: boolean;
}

export interface KanbanColumn {
  id: string;
  name: string;
  color?: string;
  position: number;
  stage: KanbanColumnStage;
  /** Whether the column is structurally visible on the board */
  visible?: boolean;
  /** Column visual width configuration */
  width?: "compact" | "standard" | "wide";
  /** Automation configuration for this column */
  automation?: KanbanColumnAutomation;
}

export interface KanbanBoard {
  id: string;
  workspaceId: string;
  name: string;
  isDefault: boolean;
  githubToken?: string;
  columns: KanbanColumn[];
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_KANBAN_COLUMN_ORDER: KanbanColumnStage[] = [
  "backlog",
  "todo",
  "dev",
  "review",
  "done",
  "blocked",
];

export const KANBAN_HAPPY_PATH_COLUMN_ORDER: Exclude<KanbanColumnStage, "blocked">[] = [
  "backlog",
  "todo",
  "dev",
  "review",
  "done",
];

export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: "backlog", name: "Backlog", color: "slate", position: 0, stage: "backlog" },
  { id: "todo", name: "Todo", color: "sky", position: 1, stage: "todo" },
  { id: "dev", name: "Dev", color: "amber", position: 2, stage: "dev" },
  { id: "review", name: "Review", color: "slate", position: 3, stage: "review" },
  { id: "done", name: "Done", color: "emerald", position: 4, stage: "done" },
  { id: "blocked", name: "Blocked", color: "rose", position: 5, stage: "blocked" },
];

export function getDefaultKanbanColumnPosition(columnId?: string): number {
  const normalizedColumnId = columnId?.toLowerCase();
  const index = DEFAULT_KANBAN_COLUMN_ORDER.findIndex((id) => id === normalizedColumnId);
  return index >= 0 ? index : DEFAULT_KANBAN_COLUMN_ORDER.length;
}

export function getNextHappyPathColumnId(currentColumnId?: string): string | undefined {
  const normalizedColumnId = currentColumnId?.toLowerCase() ?? "backlog";
  const currentIndex = KANBAN_HAPPY_PATH_COLUMN_ORDER.findIndex((id) => id === normalizedColumnId);
  return currentIndex >= 0 && currentIndex < KANBAN_HAPPY_PATH_COLUMN_ORDER.length - 1
    ? KANBAN_HAPPY_PATH_COLUMN_ORDER[currentIndex + 1]
    : undefined;
}

export function normalizeDefaultKanbanColumnPositions(columns: KanbanColumn[]): KanbanColumn[] {
  return columns
    .map((column) => ({ ...column }))
    .sort((left, right) => {
      const rankDiff = getDefaultKanbanColumnPosition(left.id) - getDefaultKanbanColumnPosition(right.id);
      return rankDiff !== 0 ? rankDiff : left.position - right.position;
    })
    .map((column, index) => ({
      ...column,
      position: index,
    }));
}

export function cloneKanbanColumns(columns: KanbanColumn[]): KanbanColumn[] {
  return columns.map((column) => ({
    ...column,
    automation: column.automation
      ? {
        ...column.automation,
        requiredArtifacts: column.automation.requiredArtifacts
          ? [...column.automation.requiredArtifacts]
          : undefined,
        requiredTaskFields: column.automation.requiredTaskFields
          ? [...column.automation.requiredTaskFields]
          : undefined,
        contractRules: column.automation.contractRules
          ? { ...column.automation.contractRules }
          : undefined,
        deliveryRules: column.automation.deliveryRules
          ? { ...column.automation.deliveryRules }
          : undefined,
        steps: column.automation.steps?.map((step) => ({ ...step })),
      }
      : undefined,
  }));
}

function createFallbackAutomationStep(automation: KanbanColumnAutomation): KanbanAutomationStep {
  return {
    id: "step-1",
    providerId: automation.providerId,
    role: automation.role,
    specialistId: automation.specialistId,
    specialistName: automation.specialistName,
    specialistLocale: automation.specialistLocale,
  };
}

export function getKanbanAutomationSteps(automation?: KanbanColumnAutomation): KanbanAutomationStep[] {
  if (!automation?.enabled) {
    return [];
  }

  const normalizedSteps = (automation.steps ?? [])
    .map((step, index) => ({
      ...step,
      id: step.id?.trim() || `step-${index + 1}`,
    }))
    .filter((step) => (
      step.transport === "a2a"
      || Boolean(step.providerId)
      || Boolean(step.role)
      || Boolean(step.specialistId)
      || Boolean(step.specialistName)
      || Boolean(step.agentCardUrl)
      || Boolean(step.skillId)
      || Boolean(step.authConfigId)
    ));

  if (normalizedSteps.length > 0) {
    return normalizedSteps;
  }

  return [createFallbackAutomationStep(automation)];
}

export function getPrimaryKanbanAutomationStep(
  automation?: KanbanColumnAutomation,
): KanbanAutomationStep | undefined {
  return getKanbanAutomationSteps(automation)[0];
}

export function normalizeKanbanAutomation(
  automation?: KanbanColumnAutomation,
): KanbanColumnAutomation | undefined {
  if (!automation) return undefined;

  const steps = getKanbanAutomationSteps(automation);
  const primaryStep = steps[0];

  return {
    ...automation,
    steps,
    providerId: primaryStep?.providerId,
    role: primaryStep?.role,
    specialistId: primaryStep?.specialistId,
    specialistName: primaryStep?.specialistName,
    specialistLocale: primaryStep?.specialistLocale,
  };
}

export function createKanbanBoard(params: {
  id: string;
  workspaceId: string;
  name: string;
  isDefault?: boolean;
  githubToken?: string;
  columns?: KanbanColumn[];
}): KanbanBoard {
  const now = new Date();
  return {
    id: params.id,
    workspaceId: params.workspaceId,
    name: params.name,
    isDefault: params.isDefault ?? false,
    githubToken: params.githubToken?.trim() || undefined,
    columns: cloneKanbanColumns(params.columns ?? DEFAULT_KANBAN_COLUMNS),
    createdAt: now,
    updatedAt: now,
  };
}

export function columnIdToTaskStatus(columnId?: string): TaskStatus {
  switch ((columnId ?? "backlog").toLowerCase()) {
    case "dev":
      return TaskStatus.IN_PROGRESS;
    case "review":
      return TaskStatus.REVIEW_REQUIRED;
    case "blocked":
      return TaskStatus.BLOCKED;
    case "done":
      return TaskStatus.COMPLETED;
    default:
      return TaskStatus.PENDING;
  }
}

export function columnStageToTaskStatus(stage?: KanbanColumnStage): TaskStatus {
  switch (stage ?? "backlog") {
    case "dev":
      return TaskStatus.IN_PROGRESS;
    case "review":
      return TaskStatus.REVIEW_REQUIRED;
    case "blocked":
      return TaskStatus.BLOCKED;
    case "done":
      return TaskStatus.COMPLETED;
    default:
      return TaskStatus.PENDING;
  }
}

export function resolveTaskStatusForBoardColumn(
  columns: Pick<KanbanColumn, "id" | "stage">[] = [],
  columnId?: string,
): TaskStatus {
  const column = columns.find((entry) => entry.id === columnId);
  if (column) {
    return columnStageToTaskStatus(column.stage);
  }
  return columnIdToTaskStatus(columnId);
}

export function taskStatusToColumnId(status: TaskStatus | string | undefined): string {
  switch ((status ?? TaskStatus.PENDING).toString().toUpperCase()) {
    case TaskStatus.IN_PROGRESS:
      return "dev";
    case TaskStatus.REVIEW_REQUIRED:
      return "review";
    case TaskStatus.BLOCKED:
      return "blocked";
    case TaskStatus.COMPLETED:
      return "done";
    default:
      return "backlog";
  }
}
