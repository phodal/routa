import {
  getKanbanAutomationSteps,
  type KanbanTransport,
  type KanbanAutomationStep,
  type KanbanColumnAutomation,
} from "../models/kanban";
import type { FallbackAgent } from "../models/task";

export interface AutomationSpecialistSummary {
  name?: string;
  role?: string;
  defaultProvider?: string;
}

export type AutomationSpecialistResolver = (
  specialistId: string,
  locale?: string,
) => AutomationSpecialistSummary | undefined;

export type EffectiveAutomationProviderSource = "card" | "lane" | "auto" | "specialist" | "none";

export interface ResolveAutomationOptions {
  autoProviderId?: string;
}

type TaskAutomationFields = {
  columnId?: string;
  assignedProvider?: string;
  assignedRole?: string;
  assignedSpecialistId?: string;
  assignedSpecialistName?: string;
  fallbackAgentChain?: FallbackAgent[];
  enableAutomaticFallback?: boolean;
  maxFallbackAttempts?: number;
};

type ColumnAutomationFields = {
  id: string;
  automation?: KanbanColumnAutomation;
};

export interface ResolvedKanbanAutomationStep extends KanbanAutomationStep {
  providerSource?: Exclude<EffectiveAutomationProviderSource, "card">;
  specialistDefaultProviderId?: string;
}

export interface EffectiveTaskAutomation {
  canRun: boolean;
  source: "card" | "lane" | "none";
  laneAutomation?: KanbanColumnAutomation;
  steps: ResolvedKanbanAutomationStep[];
  stepIndex?: number;
  step?: ResolvedKanbanAutomationStep;
  transport?: KanbanTransport;
  providerId?: string;
  providerSource?: EffectiveAutomationProviderSource;
  role?: string;
  specialistId?: string;
  specialistName?: string;
  agentCardUrl?: string;
  skillId?: string;
  authConfigId?: string;
}

function normalizeProviderId(providerId: string | null | undefined): string | undefined {
  const normalized = providerId?.trim();
  return normalized ? normalized : undefined;
}

function hasTaskAssignment(task: TaskAutomationFields): boolean {
  return Boolean(
    task.assignedProvider
      || task.assignedRole
      || task.assignedSpecialistId
      || task.assignedSpecialistName,
  );
}

function taskAssignmentMatchesStep(
  task: TaskAutomationFields,
  step: ResolvedKanbanAutomationStep,
): boolean {
  const assignedProvider = normalizeProviderId(task.assignedProvider);
  if (assignedProvider && normalizeProviderId(step.providerId) !== assignedProvider) {
    return false;
  }
  if (task.assignedRole && step.role !== task.assignedRole) {
    return false;
  }
  if (task.assignedSpecialistId && step.specialistId !== task.assignedSpecialistId) {
    return false;
  }
  if (task.assignedSpecialistName && step.specialistName !== task.assignedSpecialistName) {
    return false;
  }
  return true;
}

export function resolveKanbanAutomationStep(
  step: KanbanAutomationStep | undefined,
  resolveSpecialist?: AutomationSpecialistResolver,
  options: ResolveAutomationOptions = {},
): ResolvedKanbanAutomationStep | undefined {
  if (!step) return undefined;
  const specialist = step.specialistId
    ? resolveSpecialist?.(step.specialistId, step.specialistLocale)
    : undefined;
  const transport = step.transport === "a2a" ? "acp" : (step.transport ?? "acp");
  const configuredProviderId = normalizeProviderId(step.providerId);
  const autoProviderId = normalizeProviderId(options.autoProviderId);
  const specialistDefaultProviderId = normalizeProviderId(specialist?.defaultProvider);
  const providerId = configuredProviderId ?? autoProviderId ?? specialistDefaultProviderId;
  const providerSource = configuredProviderId
    ? "lane"
    : autoProviderId
      ? "auto"
      : specialistDefaultProviderId
        ? "specialist"
        : "none";

  return {
    ...step,
    transport,
    providerId,
    providerSource,
    specialistDefaultProviderId,
    role: step.role ?? specialist?.role,
    specialistName: step.specialistName ?? specialist?.name,
  };
}

function buildFallbackSteps(chain?: FallbackAgent[]): KanbanAutomationStep[] {
  if (!chain || chain.length === 0) return [];
  return chain.map((agent, index) => ({
    id: `fallback-${index + 1}`,
    providerId: agent.providerId,
    role: agent.role,
    specialistId: agent.specialistId,
    specialistName: agent.specialistName,
  }));
}

export function resolveEffectiveTaskAutomation(
  task: TaskAutomationFields & {
    enableAutomaticFallback?: boolean;
  },
  boardColumns: ColumnAutomationFields[] = [],
  resolveSpecialist?: AutomationSpecialistResolver,
  options: ResolveAutomationOptions = {},
): EffectiveTaskAutomation {
  const currentColumnId = task.columnId ?? "backlog";
  const laneAutomation = boardColumns.find((column) => column.id === currentColumnId)?.automation;
  const enabledLaneAutomation = laneAutomation?.enabled ? laneAutomation : undefined;
  const resolvedLaneSteps = getKanbanAutomationSteps(enabledLaneAutomation)
    .map((step) => resolveKanbanAutomationStep(step, resolveSpecialist, options))
    .filter((step): step is ResolvedKanbanAutomationStep => Boolean(step));
  const hasTaskOverrideFields = hasTaskAssignment(task);
  const hasCardOverride = hasTaskOverrideFields
    && !resolvedLaneSteps.some((step) => taskAssignmentMatchesStep(task, step));
  const canRun = hasCardOverride || Boolean(enabledLaneAutomation);
  const fallbackSteps = task.enableAutomaticFallback
    ? buildFallbackSteps(task.fallbackAgentChain)
    : [];
  const cardOverrideSteps = hasCardOverride
    ? [{
      id: "card-override",
      providerId: task.assignedProvider,
      role: task.assignedRole,
      specialistId: task.assignedSpecialistId,
      specialistName: task.assignedSpecialistName,
    },
    ...fallbackSteps,
    ]
        .map((step) => resolveKanbanAutomationStep(step, resolveSpecialist, options))
        .filter((step): step is ResolvedKanbanAutomationStep => Boolean(step))
    : resolvedLaneSteps;
  const steps = cardOverrideSteps;
  const step = steps[0];
  const providerSource: EffectiveAutomationProviderSource = hasCardOverride && normalizeProviderId(task.assignedProvider)
    ? "card"
    : step?.providerSource ?? "none";

  return {
    canRun,
    source: hasCardOverride ? "card" : enabledLaneAutomation ? "lane" : "none",
    laneAutomation: enabledLaneAutomation,
    steps,
    stepIndex: step ? 0 : undefined,
    step,
    transport: step?.transport ?? (canRun ? "acp" : undefined),
    providerId: hasCardOverride ? normalizeProviderId(task.assignedProvider) ?? step?.providerId : step?.providerId,
    providerSource,
    role: hasCardOverride ? task.assignedRole ?? step?.role ?? (canRun ? "DEVELOPER" : undefined) : step?.role ?? (canRun ? "DEVELOPER" : undefined),
    specialistId: hasCardOverride ? task.assignedSpecialistId ?? step?.specialistId : step?.specialistId,
    specialistName: hasCardOverride ? task.assignedSpecialistName ?? step?.specialistName : step?.specialistName,
    agentCardUrl: step?.agentCardUrl,
    skillId: step?.skillId,
    authConfigId: step?.authConfigId,
  };
}
