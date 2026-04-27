import type { TaskAdaptiveHarnessTaskType } from "@/core/harness/task-adaptive";
import {
  normalizeTaskContextSearchSpec,
  normalizeTaskJitContextSnapshot,
  type TaskContextSearchSpec,
  type TaskJitContextSnapshot,
} from "@/core/models/task";

type TaskAdaptiveSource = {
  id?: string;
  title: string;
  columnId?: string;
  assignedRole?: string;
  triggerSessionId?: string;
  sessionIds?: string[];
  laneSessions?: Array<{ sessionId: string }>;
  contextSearchSpec?: TaskContextSearchSpec;
  jitContextSnapshot?: TaskJitContextSnapshot;
};

export interface KanbanTaskAdaptiveHarnessOptions {
  taskId?: string;
  taskLabel?: string;
  locale?: string;
  query?: string;
  featureIds?: string[];
  filePaths?: string[];
  routeCandidates?: string[];
  apiCandidates?: string[];
  historySessionIds?: string[];
  moduleHints?: string[];
  symptomHints?: string[];
  taskType?: TaskAdaptiveHarnessTaskType;
  role?: string;
}

function uniqueNonEmptyStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function mergeSearchSpecs(
  primary: TaskContextSearchSpec | undefined,
  fallback: TaskContextSearchSpec | undefined,
): TaskContextSearchSpec | undefined {
  return normalizeTaskContextSearchSpec({
    query: primary?.query ?? fallback?.query,
    featureCandidates: uniqueNonEmptyStrings([
      ...(primary?.featureCandidates ?? []),
      ...(fallback?.featureCandidates ?? []),
    ]),
    relatedFiles: uniqueNonEmptyStrings([
      ...(primary?.relatedFiles ?? []),
      ...(fallback?.relatedFiles ?? []),
    ]),
    routeCandidates: uniqueNonEmptyStrings([
      ...(primary?.routeCandidates ?? []),
      ...(fallback?.routeCandidates ?? []),
    ]),
    apiCandidates: uniqueNonEmptyStrings([
      ...(primary?.apiCandidates ?? []),
      ...(fallback?.apiCandidates ?? []),
    ]),
    moduleHints: uniqueNonEmptyStrings([
      ...(primary?.moduleHints ?? []),
      ...(fallback?.moduleHints ?? []),
    ]),
    symptomHints: uniqueNonEmptyStrings([
      ...(primary?.symptomHints ?? []),
      ...(fallback?.symptomHints ?? []),
    ]),
  });
}

function resolveRecommendedContextSearchSpec(
  task: TaskAdaptiveSource | null | undefined,
): TaskContextSearchSpec | undefined {
  return mergeSearchSpecs(
    task?.jitContextSnapshot?.analysis?.recommendedContextSearchSpec,
    task?.jitContextSnapshot?.recommendedContextSearchSpec,
  );
}

export function hasConfirmedKanbanTaskAdaptiveContext(
  task: TaskAdaptiveSource | null | undefined,
): boolean {
  const hasLaneExperience = Boolean(normalizeTaskJitContextSnapshot(task?.jitContextSnapshot)?.perLaneAnalysis);
  return Boolean(normalizeTaskContextSearchSpec(task?.contextSearchSpec))
    || Boolean(task?.jitContextSnapshot?.analysis)
    || hasLaneExperience;
}

export function shouldEnableKanbanTaskAdaptiveHarness(
  task: TaskAdaptiveSource | null | undefined,
): boolean {
  if (!task) {
    return true;
  }

  return task.columnId !== "backlog" || hasConfirmedKanbanTaskAdaptiveContext(task);
}

export function stripSpeculativeKanbanTaskAdaptiveSnapshot<T extends TaskAdaptiveSource>(
  task: T,
): T {
  if (task.columnId === "backlog" && !hasConfirmedKanbanTaskAdaptiveContext(task)) {
    return {
      ...task,
      jitContextSnapshot: undefined,
    };
  }

  return task;
}

function mergeTaskHintArrays(
  primary: string[] | undefined,
  fallback: string[] | undefined,
): string[] | undefined {
  const values = uniqueNonEmptyStrings([...(primary ?? []), ...(fallback ?? [])]);
  return values.length > 0 ? values : undefined;
}

function collectContextSearchFeatureIds(task: TaskAdaptiveSource | null | undefined): string[] | undefined {
  return mergeTaskHintArrays(
    task?.contextSearchSpec?.featureCandidates,
    resolveRecommendedContextSearchSpec(task)?.featureCandidates,
  );
}

function collectContextSearchFilePaths(task: TaskAdaptiveSource | null | undefined): string[] | undefined {
  return mergeTaskHintArrays(
    task?.contextSearchSpec?.relatedFiles,
    resolveRecommendedContextSearchSpec(task)?.relatedFiles,
  );
}

function collectContextSearchRoutes(task: TaskAdaptiveSource | null | undefined): string[] | undefined {
  return mergeTaskHintArrays(
    task?.contextSearchSpec?.routeCandidates,
    resolveRecommendedContextSearchSpec(task)?.routeCandidates,
  );
}

function collectContextSearchApis(task: TaskAdaptiveSource | null | undefined): string[] | undefined {
  return mergeTaskHintArrays(
    task?.contextSearchSpec?.apiCandidates,
    resolveRecommendedContextSearchSpec(task)?.apiCandidates,
  );
}

function collectContextSearchModules(task: TaskAdaptiveSource | null | undefined): string[] | undefined {
  return mergeTaskHintArrays(
    task?.contextSearchSpec?.moduleHints,
    resolveRecommendedContextSearchSpec(task)?.moduleHints,
  );
}

function collectContextSearchSymptoms(task: TaskAdaptiveSource | null | undefined): string[] | undefined {
  return mergeTaskHintArrays(
    task?.contextSearchSpec?.symptomHints,
    resolveRecommendedContextSearchSpec(task)?.symptomHints,
  );
}

function resolveContextSearchQuery(task: TaskAdaptiveSource | null | undefined): string | undefined {
  const query = task?.contextSearchSpec?.query?.trim();
  if (query) {
    return query;
  }

  const recommendedQuery = task?.jitContextSnapshot?.recommendedContextSearchSpec?.query?.trim();
  if (recommendedQuery) {
    return recommendedQuery;
  }

  const title = task?.title?.trim();
  return title ? title : undefined;
}

export function collectKanbanTaskHistorySessionIds(task: TaskAdaptiveSource | null | undefined): string[] | undefined {
  if (!task) {
    return undefined;
  }

  const historySessionIds = uniqueNonEmptyStrings([
    task.triggerSessionId,
    ...(task.sessionIds ?? []),
    ...((task.laneSessions ?? []).map((session) => session.sessionId)),
    ...(task.jitContextSnapshot?.matchedSessionIds ?? []),
    ...((task.jitContextSnapshot?.analysis?.topSessions ?? []).map((session) => session.sessionId)),
    ...((task.jitContextSnapshot?.historySummary?.seedSessions ?? []).map((session) => session.sessionId)),
  ]);

  return historySessionIds.length > 0 ? historySessionIds : undefined;
}

export function resolveKanbanTaskAdaptiveTaskType(
  columnId: string | undefined,
): TaskAdaptiveHarnessTaskType {
  switch (columnId) {
    case "backlog":
    case "todo":
      return "planning";
    case "review":
      return "review";
    default:
      return "implementation";
  }
}

export function buildKanbanTaskAdaptiveHarnessOptions(
  promptLabel: string,
  options: {
    locale?: string;
    role?: string;
    taskType?: TaskAdaptiveHarnessTaskType;
    task?: TaskAdaptiveSource | null;
  },
): KanbanTaskAdaptiveHarnessOptions | undefined {
  if (options.task && !shouldEnableKanbanTaskAdaptiveHarness(options.task)) {
    return undefined;
  }

  return {
    taskId: options.task?.id,
    taskLabel: options.task?.title ?? promptLabel.trim(),
    query: resolveContextSearchQuery(options.task),
    featureIds: collectContextSearchFeatureIds(options.task),
    filePaths: collectContextSearchFilePaths(options.task),
    routeCandidates: collectContextSearchRoutes(options.task),
    apiCandidates: collectContextSearchApis(options.task),
    historySessionIds: collectKanbanTaskHistorySessionIds(options.task),
    moduleHints: collectContextSearchModules(options.task),
    symptomHints: collectContextSearchSymptoms(options.task),
    taskType: options.taskType ?? resolveKanbanTaskAdaptiveTaskType(options.task?.columnId),
    locale: options.locale,
    role: options.role ?? options.task?.assignedRole,
  };
}
