import {
  normalizeContextValue,
  resolveRepoRoot,
  type HarnessContext,
} from "@/core/harness/context-resolution";
import { getRoutaSystem } from "@/core/routa-system";
import {
  assembleTaskAdaptiveHarness,
  parseTaskAdaptiveHarnessOptions,
  summarizeFileSessionContext,
  type FileSessionContextSummary,
  type TaskAdaptiveHistorySummary,
  type TaskAdaptiveHarnessPack,
} from "@/core/harness/task-adaptive";
import {
  inspectTranscriptTurns,
  type TranscriptTurnInspectionResult,
} from "@/core/harness/transcript-sessions";
import {
  loadMatchingFeatureRetrospectiveMemories,
  saveFeatureRetrospectiveMemory,
  type FeatureRetrospectiveMemoryScope,
} from "@/core/harness/retrospective-memory";
import {
  buildFeatureTreeRetrievalHints,
  confirmFeatureTreeStoryContext,
  loadRelevantFeatureTreeContext,
} from "@/core/kanban/context-preload";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { normalizeTaskContextSearchSpec } from "@/core/models/task";

export const TASK_ADAPTIVE_HARNESS_TOOL_NAME = "assemble_task_adaptive_harness";
export const TASK_HISTORY_SUMMARY_TOOL_NAME = "summarize_task_history_context";
export const FILE_SESSION_CONTEXT_TOOL_NAME = "summarize_file_session_context";
export const TRANSCRIPT_TURN_INSPECTION_TOOL_NAME = "inspect_transcript_turns";
export const LOAD_RETROSPECTIVE_MEMORY_TOOL_NAME = "load_feature_retrospective_memory";
export const SAVE_RETROSPECTIVE_MEMORY_TOOL_NAME = "save_feature_retrospective_memory";
export const LOAD_FEATURE_TREE_CONTEXT_TOOL_NAME = "load_feature_tree_context";
export const CONFIRM_FEATURE_TREE_STORY_CONTEXT_TOOL_NAME = "confirm_feature_tree_story_context";

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

function normalizeRetrospectiveScope(value: unknown): FeatureRetrospectiveMemoryScope | undefined {
  return value === "file" || value === "feature" ? value : undefined;
}

export async function assembleTaskAdaptiveHarnessFromToolArgs(
  args: Record<string, unknown>,
  fallbackWorkspaceId?: string,
): Promise<TaskAdaptiveHarnessPack> {
  const context: HarnessContext = {
    workspaceId: normalizeContextValue(args.workspaceId) ?? fallbackWorkspaceId,
    codebaseId: normalizeContextValue(args.codebaseId),
    repoPath: normalizeContextValue(args.repoPath),
  };
  const repoRoot = await resolveRepoRoot(context);
  const options = parseTaskAdaptiveHarnessOptions(args) ?? {};
  return assembleTaskAdaptiveHarness(repoRoot, options);
}

export async function summarizeTaskHistoryContextFromToolArgs(
  args: Record<string, unknown>,
  fallbackWorkspaceId?: string,
): Promise<{
  historySummary: TaskAdaptiveHistorySummary | null;
  featureId?: string;
  featureName?: string;
  selectedFiles: string[];
  matchedFileDetails: TaskAdaptiveHarnessPack["matchedFileDetails"];
  matchedSessionIds: string[];
  warnings: string[];
}> {
  const pack = await assembleTaskAdaptiveHarnessFromToolArgs(args, fallbackWorkspaceId);
  return {
    historySummary: pack.historySummary ?? null,
    featureId: pack.featureId,
    featureName: pack.featureName,
    selectedFiles: [...pack.selectedFiles],
    matchedFileDetails: pack.matchedFileDetails.map((detail) => ({ ...detail })),
    matchedSessionIds: [...pack.matchedSessionIds],
    warnings: [...pack.warnings],
  };
}

export async function summarizeFileSessionContextFromToolArgs(
  args: Record<string, unknown>,
  fallbackWorkspaceId?: string,
): Promise<FileSessionContextSummary> {
  const context: HarnessContext = {
    workspaceId: normalizeContextValue(args.workspaceId) ?? fallbackWorkspaceId,
    codebaseId: normalizeContextValue(args.codebaseId),
    repoPath: normalizeContextValue(args.repoPath),
  };
  const repoRoot = await resolveRepoRoot(context);
  const options = parseTaskAdaptiveHarnessOptions(args) ?? {};
  return summarizeFileSessionContext(repoRoot, options);
}

export async function inspectTranscriptTurnsFromToolArgs(
  args: Record<string, unknown>,
  fallbackWorkspaceId?: string,
): Promise<TranscriptTurnInspectionResult> {
  const context: HarnessContext = {
    workspaceId: normalizeContextValue(args.workspaceId) ?? fallbackWorkspaceId,
    codebaseId: normalizeContextValue(args.codebaseId),
    repoPath: normalizeContextValue(args.repoPath),
  };
  const repoRoot = await resolveRepoRoot(context);
  const options = parseTaskAdaptiveHarnessOptions(args) ?? {};
  const sessionIds = normalizeStringArray(args.sessionIds)
    ?? normalizeStringArray(args.historySessionIds)
    ?? options.historySessionIds
    ?? [];

  if (sessionIds.length === 0) {
    throw new Error("inspect_transcript_turns requires sessionIds or historySessionIds.");
  }

  return inspectTranscriptTurns(repoRoot, {
    sessionIds,
    filePaths: options.filePaths,
    featureId: options.featureId,
    maxUserPrompts: normalizePositiveInteger(args.maxUserPrompts),
    maxSignals: normalizePositiveInteger(args.maxSignals),
  });
}

export async function loadFeatureRetrospectiveMemoryFromToolArgs(
  args: Record<string, unknown>,
  fallbackWorkspaceId?: string,
): Promise<ReturnType<typeof loadMatchingFeatureRetrospectiveMemories>> {
  const context: HarnessContext = {
    workspaceId: normalizeContextValue(args.workspaceId) ?? fallbackWorkspaceId,
    codebaseId: normalizeContextValue(args.codebaseId),
    repoPath: normalizeContextValue(args.repoPath),
  };
  const repoRoot = await resolveRepoRoot(context);
  const options = parseTaskAdaptiveHarnessOptions(args) ?? {};
  const filePaths = normalizeStringArray(args.filePaths) ?? options.filePaths ?? [];
  const featureId = normalizeContextValue(args.featureId) ?? options.featureId ?? options.featureIds?.[0];

  return loadMatchingFeatureRetrospectiveMemories(repoRoot, {
    filePaths,
    featureId,
  });
}

export async function loadFeatureTreeContextFromToolArgs(
  args: Record<string, unknown>,
  fallbackWorkspaceId?: string,
): Promise<Awaited<ReturnType<typeof loadRelevantFeatureTreeContext>>> {
  const context: HarnessContext = {
    workspaceId: normalizeContextValue(args.workspaceId) ?? fallbackWorkspaceId,
    codebaseId: normalizeContextValue(args.codebaseId),
    repoPath: normalizeContextValue(args.repoPath),
  };
  const repoRoot = await resolveRepoRoot(context);
  const options = parseTaskAdaptiveHarnessOptions(args) ?? {};

  return loadRelevantFeatureTreeContext({
    repoPath: repoRoot,
    hints: buildFeatureTreeRetrievalHints({
      featureIds: normalizeStringArray(args.featureIds) ?? options.featureIds,
      query: normalizeContextValue(args.query) ?? options.query ?? options.taskLabel,
      filePaths: normalizeStringArray(args.filePaths) ?? options.filePaths,
      routeCandidates: normalizeStringArray(args.routeCandidates) ?? options.routeCandidates,
      apiCandidates: normalizeStringArray(args.apiCandidates) ?? options.apiCandidates,
      moduleHints: normalizeStringArray(args.moduleHints) ?? options.moduleHints,
      symptomHints: normalizeStringArray(args.symptomHints) ?? options.symptomHints,
    }),
    maxEntries: normalizePositiveInteger(args.maxFeatures),
  });
}

export async function confirmFeatureTreeStoryContextFromToolArgs(
  args: Record<string, unknown>,
  fallbackWorkspaceId?: string,
): Promise<Awaited<ReturnType<typeof confirmFeatureTreeStoryContext>>> {
  const context: HarnessContext = {
    workspaceId: normalizeContextValue(args.workspaceId) ?? fallbackWorkspaceId,
    codebaseId: normalizeContextValue(args.codebaseId),
    repoPath: normalizeContextValue(args.repoPath),
  };
  const repoRoot = await resolveRepoRoot(context);
  const options = parseTaskAdaptiveHarnessOptions(args) ?? {};

  const result = await confirmFeatureTreeStoryContext({
    repoPath: repoRoot,
    hints: buildFeatureTreeRetrievalHints({
      featureIds: normalizeStringArray(args.featureIds) ?? options.featureIds,
      query: normalizeContextValue(args.query) ?? options.query ?? options.taskLabel,
      filePaths: normalizeStringArray(args.filePaths) ?? options.filePaths,
      routeCandidates: normalizeStringArray(args.routeCandidates) ?? options.routeCandidates,
      apiCandidates: normalizeStringArray(args.apiCandidates) ?? options.apiCandidates,
      moduleHints: normalizeStringArray(args.moduleHints) ?? options.moduleHints,
      symptomHints: normalizeStringArray(args.symptomHints) ?? options.symptomHints,
    }),
    maxEntries: normalizePositiveInteger(args.maxFeatures),
  });

  const taskId = normalizeContextValue(args.taskId);
  if (!taskId || !result.confirmedContextSearchSpec) {
    return result;
  }

  const system = getRoutaSystem();
  const task = await system.taskStore.get(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const requestedWorkspaceId = context.workspaceId;
  if (!requestedWorkspaceId) {
    throw new Error("workspaceId is required when taskId is provided.");
  }

  if (task.workspaceId !== requestedWorkspaceId) {
    throw new Error(`Task ${taskId} does not belong to workspace ${requestedWorkspaceId}.`);
  }

  task.contextSearchSpec = normalizeTaskContextSearchSpec({
    query: result.confirmedContextSearchSpec.query ?? task.contextSearchSpec?.query,
    featureCandidates: [
      ...(task.contextSearchSpec?.featureCandidates ?? []),
      ...(result.confirmedContextSearchSpec.featureCandidates ?? []),
    ],
    relatedFiles: [
      ...(task.contextSearchSpec?.relatedFiles ?? []),
      ...(result.confirmedContextSearchSpec.relatedFiles ?? []),
    ],
    routeCandidates: [
      ...(task.contextSearchSpec?.routeCandidates ?? []),
      ...(result.confirmedContextSearchSpec.routeCandidates ?? []),
    ],
    apiCandidates: [
      ...(task.contextSearchSpec?.apiCandidates ?? []),
      ...(result.confirmedContextSearchSpec.apiCandidates ?? []),
    ],
    moduleHints: [
      ...(task.contextSearchSpec?.moduleHints ?? []),
      ...(result.confirmedContextSearchSpec.moduleHints ?? []),
    ],
    symptomHints: [
      ...(task.contextSearchSpec?.symptomHints ?? []),
      ...(result.confirmedContextSearchSpec.symptomHints ?? []),
    ],
  });
  task.updatedAt = new Date();
  await system.taskStore.save(task);

  getKanbanEventBroadcaster().notify({
    workspaceId: task.workspaceId,
    entity: "task",
    action: "updated",
    resourceId: taskId,
    source: "agent",
  });

  return {
    ...result,
    confirmedContextSearchSpec: task.contextSearchSpec,
  };
}

export async function saveFeatureRetrospectiveMemoryFromToolArgs(
  args: Record<string, unknown>,
  fallbackWorkspaceId?: string,
): Promise<ReturnType<typeof saveFeatureRetrospectiveMemory>> {
  const context: HarnessContext = {
    workspaceId: normalizeContextValue(args.workspaceId) ?? fallbackWorkspaceId,
    codebaseId: normalizeContextValue(args.codebaseId),
    repoPath: normalizeContextValue(args.repoPath),
  };
  const repoRoot = await resolveRepoRoot(context);
  const options = parseTaskAdaptiveHarnessOptions(args) ?? {};
  const scope = normalizeRetrospectiveScope(args.scope);
  if (!scope) {
    throw new Error("save_feature_retrospective_memory requires scope=file|feature.");
  }

  const summary = normalizeContextValue(args.summary);
  if (!summary) {
    throw new Error("save_feature_retrospective_memory requires summary.");
  }

  return saveFeatureRetrospectiveMemory(repoRoot, {
    scope,
    targetId: normalizeContextValue(args.targetId),
    filePath: normalizeContextValue(args.filePath) ?? (scope === "file" && options.filePaths?.length === 1 ? options.filePaths[0] : undefined),
    featureId: normalizeContextValue(args.featureId) ?? options.featureId ?? options.featureIds?.[0],
    featureName: normalizeContextValue(args.featureName),
    summary,
  });
}
