import type { ArtifactType } from "../models/artifact";
import { getNextHappyPathColumnId, type KanbanColumn, type KanbanRequiredTaskField } from "../models/kanban";
import type {
  Task,
  TaskAnalysisStatus,
  TaskArtifactSummary,
  TaskEvidenceSummary,
  TaskInvestCheckSummary,
  TaskInvestValidation,
  TaskStoryReadiness,
} from "../models/task";
import { parseCanonicalStory } from "./canonical-story";
import { deriveInvestValidationFromObjective } from "./invest-validation";

interface ArtifactStoreLike {
  listByTask(taskId: string): Promise<Array<{ type: ArtifactType }>>;
}

interface KanbanBoardStoreLike {
  get(boardId: string): Promise<{
    columns?: Array<Pick<KanbanColumn, "id" | "automation">>;
  } | undefined | null>;
}

interface TaskSummarySystemLike {
  artifactStore?: ArtifactStoreLike;
  kanbanBoardStore?: KanbanBoardStoreLike;
}

const INVEST_KEYS = [
  "independent",
  "negotiable",
  "valuable",
  "estimable",
  "small",
  "testable",
] as const;

const REQUIRED_TASK_FIELD_LABELS: Record<KanbanRequiredTaskField, string> = {
  scope: "scope",
  acceptance_criteria: "acceptance criteria",
  verification_commands: "verification commands",
  test_cases: "test cases",
  verification_plan: "verification plan",
  dependencies_declared: "dependency declaration",
};

const DEPENDENCY_DECLARATION_PATTERN = /\b(depends on|blocked by|dependency plan|execution order|ready now|no dependencies)\b/i;

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeItems(values: string[] | null | undefined): string[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
}

function summarizeStatuses(statuses: TaskAnalysisStatus[]): TaskAnalysisStatus {
  if (statuses.includes("fail")) {
    return "fail";
  }
  if (statuses.includes("warning")) {
    return "warning";
  }
  return "pass";
}

function buildHeuristicInvestValidation(task: Task, issues: string[]): TaskInvestValidation {
  const scope = normalizeText(task.scope);
  const objective = normalizeText(task.objective);
  const comment = normalizeText(task.comment);
  const acceptanceCriteria = normalizeItems(task.acceptanceCriteria);
  const verificationCommands = normalizeItems(task.verificationCommands);
  const testCases = normalizeItems(task.testCases);
  const dependencies = normalizeItems(task.dependencies);
  const hasVerificationPlan = verificationCommands.length > 0 || testCases.length > 0;
  const dependencyNarrative = `${objective}\n${comment}`;
  const declaresDependencies = dependencies.length > 0 || DEPENDENCY_DECLARATION_PATTERN.test(dependencyNarrative);

  const checks: TaskInvestValidation["checks"] = {
    independent: dependencies.length > 0
      ? {
          status: "fail",
          reason: `Depends on ${dependencies.join(", ")} and should likely be split or explicitly sequenced.`,
        }
      : {
          status: "pass",
          reason: declaresDependencies
            ? "Dependency declaration is present and does not list blocking prerequisites."
            : "No blocking prerequisite was detected.",
        },
    negotiable: {
      status: "warning",
      reason: "Negotiability is a human judgment call when no canonical story contract is present.",
    },
    valuable: objective.length >= 24
      ? {
          status: "pass",
          reason: "Objective contains enough detail to express user or delivery value.",
        }
      : {
          status: "fail",
          reason: "Objective is too thin to explain why this story matters.",
        },
    estimable: scope && acceptanceCriteria.length > 0
      ? {
          status: "pass",
          reason: "Scope and acceptance criteria provide enough context to estimate work.",
        }
      : scope || acceptanceCriteria.length > 0
      ? {
          status: "warning",
          reason: "Some sizing context exists, but either scope or acceptance criteria is still missing.",
        }
      : {
          status: "fail",
          reason: "Missing scope and acceptance criteria leaves the story hard to estimate.",
        },
    small: acceptanceCriteria.length >= 6 || dependencies.length >= 2
      ? {
          status: "warning",
          reason: "The story may be too broad because it carries many acceptance criteria or dependencies.",
        }
      : {
          status: "pass",
          reason: "The story looks narrow enough for a single implementation pass.",
        },
    testable: acceptanceCriteria.length >= 2 || hasVerificationPlan
      ? {
          status: "pass",
          reason: "Acceptance criteria or an explicit verification plan makes the outcome testable.",
        }
      : acceptanceCriteria.length === 1
      ? {
          status: "warning",
          reason: "A single acceptance criterion exists, but verification is still thin.",
        }
      : {
          status: "fail",
          reason: "No acceptance criteria or verification plan was provided.",
        },
  };

  return {
    source: "heuristic",
    overallStatus: summarizeStatuses(INVEST_KEYS.map((key) => checks[key].status)),
    checks,
    issues,
  };
}

export function buildTaskInvestValidation(task: Task): TaskInvestValidation {
  if (task.investValidation) {
    return task.investValidation;
  }

  const derived = deriveInvestValidationFromObjective(task.objective);
  if (derived) {
    return derived;
  }

  const parseResult = parseCanonicalStory(task.objective);
  if (parseResult.story) {
    const checks = {
      independent: { ...parseResult.story.story.invest.independent },
      negotiable: { ...parseResult.story.story.invest.negotiable },
      valuable: { ...parseResult.story.story.invest.valuable },
      estimable: { ...parseResult.story.story.invest.estimable },
      small: { ...parseResult.story.story.invest.small },
      testable: { ...parseResult.story.story.invest.testable },
    } satisfies Record<typeof INVEST_KEYS[number], TaskInvestCheckSummary>;

    return {
      source: "canonical_story",
      overallStatus: summarizeStatuses(INVEST_KEYS.map((key) => checks[key].status)),
      checks,
      issues: parseResult.issues,
    };
  }

  return buildHeuristicInvestValidation(task, parseResult.issues);
}

export function buildTaskStoryReadinessChecks(task: Task): TaskStoryReadiness["checks"] {
  const objective = `${normalizeText(task.objective)}\n${normalizeText(task.comment)}`;
  const parseResult = parseCanonicalStory(task.objective);
  const hasCanonicalDependencies = Boolean(
    parseResult.story?.story.dependencies_and_sequencing.unblock_condition.trim()
      && parseResult.story.story.dependencies_and_sequencing.depends_on,
  );
  const scope = normalizeText(task.scope);
  const acceptanceCriteria = normalizeItems(task.acceptanceCriteria);
  const verificationCommands = normalizeItems(task.verificationCommands);
  const testCases = normalizeItems(task.testCases);

  return {
    scope: scope.length > 0,
    acceptanceCriteria: acceptanceCriteria.length > 0,
    verificationCommands: verificationCommands.length > 0,
    testCases: testCases.length > 0,
    verificationPlan: verificationCommands.length > 0 || testCases.length > 0,
    dependenciesDeclared: hasCanonicalDependencies
      || normalizeItems(task.dependencies).length > 0
      || Boolean(normalizeText(task.parallelGroup))
      || DEPENDENCY_DECLARATION_PATTERN.test(objective),
  };
}

export function validateTaskReadiness(
  task: Task,
  requiredTaskFields: KanbanRequiredTaskField[],
): TaskStoryReadiness {
  const checks = buildTaskStoryReadinessChecks(task);
  const missing = requiredTaskFields.filter((field) => {
    switch (field) {
      case "scope":
        return !checks.scope;
      case "acceptance_criteria":
        return !checks.acceptanceCriteria;
      case "verification_commands":
        return !checks.verificationCommands;
      case "test_cases":
        return !checks.testCases;
      case "verification_plan":
        return !checks.verificationPlan;
      case "dependencies_declared":
        return !checks.dependenciesDeclared;
      default:
        return false;
    }
  });

  return {
    ready: missing.length === 0,
    missing,
    requiredTaskFields,
    checks,
  };
}

export function resolveNextRequiredTaskFields(
  columns: Array<Pick<KanbanColumn, "id" | "automation">>,
  currentColumnId?: string,
): KanbanRequiredTaskField[] {
  const nextColumnId = getNextHappyPathColumnId(currentColumnId);
  if (!nextColumnId) {
    return [];
  }

  return [...(columns.find((column) => column.id === nextColumnId)?.automation?.requiredTaskFields ?? [])];
}

export function resolveTargetRequiredTaskFields(
  columns: Array<Pick<KanbanColumn, "id" | "automation">>,
  targetColumnId?: string,
): KanbanRequiredTaskField[] {
  if (!targetColumnId) {
    return [];
  }

  return [...(columns.find((column) => column.id === targetColumnId)?.automation?.requiredTaskFields ?? [])];
}

export function formatRequiredTaskFieldLabel(field: KanbanRequiredTaskField): string {
  return REQUIRED_TASK_FIELD_LABELS[field];
}

export async function buildTaskStoryReadiness(
  task: Task,
  system: Pick<TaskSummarySystemLike, "kanbanBoardStore">,
): Promise<TaskStoryReadiness> {
  let board: Awaited<ReturnType<NonNullable<TaskSummarySystemLike["kanbanBoardStore"]>["get"]>> | undefined;

  if (system.kanbanBoardStore && task.boardId) {
    board = (await system.kanbanBoardStore.get(task.boardId)) ?? undefined;
  }

  return validateTaskReadiness(task, resolveNextRequiredTaskFields(board?.columns ?? [], task.columnId));
}

function resolveTransitionRequiredArtifacts(
  task: Task,
  board: { columns?: Array<{ id: string; automation?: { requiredArtifacts?: ArtifactType[] } }> } | undefined,
): {
  requiredArtifacts: ArtifactType[];
} {
  const nextColumnId = getNextHappyPathColumnId(task.columnId);
  const requiredArtifacts = nextColumnId
    ? board?.columns?.find((column) => column.id === nextColumnId)?.automation?.requiredArtifacts ?? []
    : [];

  return {
    requiredArtifacts: [...requiredArtifacts],
  };
}

export async function buildTaskArtifactSummary(
  task: Task,
  system: Pick<TaskSummarySystemLike, "artifactStore">,
): Promise<TaskArtifactSummary> {
  const artifacts = system.artifactStore
    ? await system.artifactStore.listByTask(task.id)
    : [];

  const byType: Partial<Record<ArtifactType, number>> = {};

  for (const artifact of artifacts) {
    byType[artifact.type] = (byType[artifact.type] ?? 0) + 1;
  }

  return {
    total: artifacts.length,
    byType,
    requiredSatisfied: true,
    missingRequired: [],
  };
}

export async function buildTaskEvidenceSummary(
  task: Task,
  system: TaskSummarySystemLike,
): Promise<TaskEvidenceSummary> {
  const artifactSummary = await buildTaskArtifactSummary(task, system);
  let board: { columns?: Array<{ id: string; automation?: { requiredArtifacts?: ArtifactType[] } }> } | undefined;

  if (system.kanbanBoardStore && task.boardId) {
    board = (await system.kanbanBoardStore.get(task.boardId)) ?? undefined;
  }

  const { requiredArtifacts } = resolveTransitionRequiredArtifacts(task, board);
  const missingRequired = requiredArtifacts.filter((artifactType) =>
    (artifactSummary.byType[artifactType] ?? 0) === 0,
  );

  const latestStatus = task.laneSessions?.at(-1)?.status
    ?? (task.sessionIds?.length ? "unknown" : "idle");

  return {
    artifact: {
      ...artifactSummary,
      requiredSatisfied: missingRequired.length === 0,
      missingRequired,
    },
    verification: {
      hasVerdict: Boolean(task.verificationVerdict),
      verdict: task.verificationVerdict,
      hasReport: Boolean(task.verificationReport?.trim()),
    },
    completion: {
      hasSummary: Boolean(task.completionSummary?.trim()),
    },
    runs: {
      total: task.sessionIds?.length ?? 0,
      latestStatus,
    },
  };
}
