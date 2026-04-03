import { v4 as uuidv4 } from "uuid";
import {
  createKanbanBoard,
  DEFAULT_DEV_REQUIRED_TASK_FIELDS,
  DEFAULT_KANBAN_COLUMNS,
  type KanbanColumn,
  getKanbanAutomationSteps,
  type KanbanColumnAutomation,
  getPrimaryKanbanAutomationStep,
  normalizeDefaultKanbanColumnPositions,
  normalizeKanbanAutomation,
  type KanbanColumnStage,
} from "../models/kanban";
import type { RoutaSystem } from "../routa-system";

const RECOMMENDED_AUTOMATION_BY_STAGE: Partial<Record<KanbanColumnStage, KanbanColumnAutomation>> = {
  // Kanban lanes rely on custom specialist prompts. Avoid ROUTA here because
  // coordinator prompt injection overrides the lane specialist on first prompt.
  backlog: {
    enabled: true,
    steps: [{
      id: "backlog-refiner",
      role: "CRAFTER",
      specialistId: "kanban-backlog-refiner",
      specialistName: "Backlog Refiner",
    }],
    transitionType: "entry",
    autoAdvanceOnSuccess: true,
  },
  todo: {
    enabled: true,
    steps: [{
      id: "todo-orchestrator",
      role: "CRAFTER",
      specialistId: "kanban-todo-orchestrator",
      specialistName: "Todo Orchestrator",
    }],
    transitionType: "entry",
    autoAdvanceOnSuccess: false,
  },
  dev: {
    enabled: true,
    steps: [{
      id: "dev-executor",
      role: "CRAFTER",
      specialistId: "kanban-dev-executor",
      specialistName: "Dev Crafter",
    }],
    transitionType: "entry",
    autoAdvanceOnSuccess: false,
  },
  review: {
    enabled: true,
    steps: [
      {
        id: "qa-frontend",
        role: "GATE",
        specialistId: "kanban-qa-frontend",
        specialistName: "QA Frontend",
      },
      {
        id: "review-guard",
        role: "GATE",
        specialistId: "kanban-review-guard",
        specialistName: "Review Guard",
      },
    ],
    transitionType: "entry",
    requiredArtifacts: ["screenshot", "test_results"],
    autoAdvanceOnSuccess: false,
  },
  blocked: {
    enabled: true,
    steps: [{
      id: "blocked-resolver",
      role: "CRAFTER",
      specialistId: "kanban-blocked-resolver",
      specialistName: "Blocked Resolver",
    }],
    transitionType: "entry",
    autoAdvanceOnSuccess: false,
  },
  done: {
    enabled: true,
    steps: [{
      id: "done-reporter",
      role: "GATE",
      specialistId: "kanban-done-reporter",
      specialistName: "Done Reporter",
    }],
    transitionType: "entry",
    autoAdvanceOnSuccess: false,
  },
};

// Migration allowlists for older boards. New default lane automation is defined
// exclusively by RECOMMENDED_AUTOMATION_BY_STAGE above.
const LEGACY_SPECIALIST_IDS_BY_STAGE: Partial<Record<KanbanColumnStage, string[]>> = {
  backlog: ["issue-enricher", "kanban-workflow", "kanban-agent"],
  todo: ["routa", "developer", "kanban-workflow"],
  dev: ["pr-reviewer", "developer", "claude-code", "kanban-workflow"],
  review: ["desk-check", "gate", "pr-reviewer", "kanban-workflow", "kanban-review-guard"],
  blocked: ["claude-code", "developer", "routa", "kanban-workflow"],
  done: ["gate", "verifier", "claude-code", "kanban-workflow"],
};

export function applyRecommendedAutomationToColumns(columns: KanbanColumn[]): KanbanColumn[] {
  return columns.map((column) => {
    const recommended = RECOMMENDED_AUTOMATION_BY_STAGE[column.stage];
    const legacySpecialists = LEGACY_SPECIALIST_IDS_BY_STAGE[column.stage] ?? [];
    if (!recommended) {
      return { ...column };
    }

    const recommendedPrimaryStep = getPrimaryKanbanAutomationStep(recommended);

    if (!column.automation) {
      return {
        ...column,
        automation: normalizeKanbanAutomation(recommended),
      };
    }

    const currentAutomation = normalizeKanbanAutomation(column.automation) ?? column.automation;
    const currentSteps = getKanbanAutomationSteps(currentAutomation);
    const recommendedStepSpecialistIds = getKanbanAutomationSteps(recommended)
      .map((step) => step.specialistId)
      .filter((value): value is string => Boolean(value));
    const recommendedStepSpecialistNames = getKanbanAutomationSteps(recommended)
      .map((step) => step.specialistName)
      .filter((value): value is string => Boolean(value));
    const legacySpecialistId = currentAutomation.specialistId;
    const hasCustomSteps = getKanbanAutomationSteps(currentAutomation).some((step) => {
      if (step.specialistId) {
        return !legacySpecialists.includes(step.specialistId)
          && !recommendedStepSpecialistIds.includes(step.specialistId);
      }
      if (step.specialistName) {
        return !recommendedStepSpecialistNames.includes(step.specialistName);
      }
      return false;
    });
    const shouldMigrateLegacySpecialist = Boolean(
      legacySpecialistId && legacySpecialists.includes(legacySpecialistId),
    );
    const shouldMigrateRecommendedSpecialist = Boolean(
      (currentAutomation.specialistId && currentAutomation.specialistId === recommendedPrimaryStep?.specialistId)
      || (!currentAutomation.specialistId
        && currentAutomation.specialistName
        && currentAutomation.specialistName === recommendedPrimaryStep?.specialistName),
    );
    const shouldRefreshArtifactPolicy = (
      (shouldMigrateLegacySpecialist || shouldMigrateRecommendedSpecialist)
      && JSON.stringify(currentAutomation.requiredArtifacts ?? []) === JSON.stringify(["screenshot"])
    );

    if (
      hasCustomSteps
      || (
        (currentAutomation.specialistId || currentAutomation.specialistName)
        && !shouldMigrateLegacySpecialist
        && !shouldMigrateRecommendedSpecialist
      )
    ) {
      return {
        ...column,
        automation: currentAutomation,
      };
    }

    const mergedRecommendedSteps = getKanbanAutomationSteps(recommended).map((step, index) => {
      const currentStep = currentSteps[index];
      return {
        ...step,
        providerId: currentStep?.providerId ?? step.providerId,
        role: currentStep?.role ?? step.role,
        specialistLocale: currentStep?.specialistLocale
          ?? currentAutomation.specialistLocale
          ?? step.specialistLocale,
      };
    });

    return {
      ...column,
      automation: normalizeKanbanAutomation({
        ...recommended,
        ...currentAutomation,
        enabled: currentAutomation.enabled ?? recommended.enabled,
        steps: mergedRecommendedSteps,
        providerId: currentAutomation.providerId ?? recommendedPrimaryStep?.providerId,
        role: currentAutomation.role ?? recommendedPrimaryStep?.role,
        specialistId: recommendedPrimaryStep?.specialistId,
        specialistName: recommendedPrimaryStep?.specialistName,
        specialistLocale: currentAutomation.specialistLocale
          ?? currentSteps[0]?.specialistLocale
          ?? recommendedPrimaryStep?.specialistLocale,
        transitionType: currentAutomation.transitionType ?? recommended.transitionType,
        requiredArtifacts: shouldRefreshArtifactPolicy
          ? recommended.requiredArtifacts
          : (currentAutomation.requiredArtifacts ?? recommended.requiredArtifacts),
        autoAdvanceOnSuccess: recommended.autoAdvanceOnSuccess,
      }),
    };
  });
}

function createRecommendedDefaultColumns(): KanbanColumn[] {
  return normalizeDefaultKanbanColumnPositions(applyRecommendedAutomationToColumns(DEFAULT_KANBAN_COLUMNS))
    .map((column) => (
      column.stage === "dev"
        ? {
            ...column,
            automation: column.automation
              ? {
                  ...column.automation,
                  requiredTaskFields: [...DEFAULT_DEV_REQUIRED_TASK_FIELDS],
                }
              : column.automation,
          }
        : column
    ));
}

export async function ensureDefaultBoard(system: RoutaSystem, workspaceId: string): Promise<ReturnType<typeof createKanbanBoard>> {
  const existing = await system.kanbanBoardStore.getDefault(workspaceId);
  if (existing) {
    const normalizedColumns = normalizeDefaultKanbanColumnPositions(
      applyRecommendedAutomationToColumns(existing.columns),
    );
    if (JSON.stringify(normalizedColumns) !== JSON.stringify(existing.columns)) {
      const updated = {
        ...existing,
        columns: normalizedColumns,
        updatedAt: new Date(),
      };
      await system.kanbanBoardStore.save(updated);
      return updated;
    }
    return existing;
  }

  const workspace = await system.workspaceStore.get(workspaceId);
  const board = createKanbanBoard({
    id: uuidv4(),
    workspaceId,
    name: workspace?.title ? `${workspace.title} Board` : "Workspace Board",
    isDefault: true,
    columns: createRecommendedDefaultColumns(),
  });
  await system.kanbanBoardStore.save(board);
  await system.kanbanBoardStore.setDefault(workspaceId, board.id);
  return board;
}
