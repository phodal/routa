import {
  normalizeTaskContextSearchSpec,
  normalizeTaskJitContextSnapshot,
  type Task,
  type TaskContextSearchSpec,
  type TaskJitContextLaneAnalysis,
  type TaskJitContextLaneFlowGuidance,
  type TaskJitContextSnapshot,
  type TaskLaneHandoff,
  type TaskLaneSession,
} from "../models/task";
import type { FlowDiagnosisReport, FlowGuidanceItem } from "./flow-ledger-types";

export type TaskLaneExperienceSource = Pick<Task, "laneSessions" | "laneHandoffs"> & Partial<Pick<
  Task,
  | "id"
  | "title"
  | "objective"
  | "columnId"
  | "contextSearchSpec"
  | "jitContextSnapshot"
>>;

interface LaneExperienceOptions {
  flowReport?: FlowDiagnosisReport;
  synthesizedAt?: string;
}

const LANE_MEMORY_TEXT_LIMIT = 240;
const FALLBACK_SYNTHESIZED_AT = "1970-01-01T00:00:00.000Z";

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean))];
}

function compactLaneMemoryText(value: string | undefined | null, maxLength = LANE_MEMORY_TEXT_LIMIT): string {
  const compacted = typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : "";
  if (compacted.length <= maxLength) {
    return compacted;
  }
  return `${compacted.slice(0, maxLength - 3).trimEnd()}...`;
}

function parseStableTimestamp(value: string | undefined | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function resolveLaneExperienceSynthesizedAt(
  task: TaskLaneExperienceSource,
  options: LaneExperienceOptions,
): string {
  if (options.synthesizedAt) {
    return options.synthesizedAt;
  }

  const timestamps = [
    ...((task.laneSessions ?? []).flatMap((session) => [
      session.startedAt,
      session.completedAt,
      session.lastActivityAt,
    ])),
    ...((task.laneHandoffs ?? []).flatMap((handoff) => [
      handoff.requestedAt,
      handoff.respondedAt,
    ])),
    task.jitContextSnapshot?.generatedAt,
  ]
    .map(parseStableTimestamp)
    .filter((timestamp): timestamp is number => typeof timestamp === "number");

  if (timestamps.length === 0) {
    return FALLBACK_SYNTHESIZED_AT;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function sortSessionsByStart(sessions: TaskLaneSession[]): TaskLaneSession[] {
  return [...sessions].sort((left, right) => {
    const leftTime = Date.parse(left.startedAt);
    const rightTime = Date.parse(right.startedAt);
    return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0)
      || left.sessionId.localeCompare(right.sessionId);
  });
}

function groupSessionsByColumn(sessions: TaskLaneSession[]): Map<string, TaskLaneSession[]> {
  const byColumn = new Map<string, TaskLaneSession[]>();
  for (const session of sessions) {
    const columnId = session.columnId?.trim() || "unknown";
    const existing = byColumn.get(columnId) ?? [];
    existing.push(session);
    byColumn.set(columnId, existing);
  }
  return byColumn;
}

function countRecoveryReasons(sessions: TaskLaneSession[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    if (!session.recoveryReason) {
      continue;
    }
    counts.set(session.recoveryReason, (counts.get(session.recoveryReason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}

function toLaneFlowGuidance(item: FlowGuidanceItem): TaskJitContextLaneFlowGuidance {
  return {
    category: item.category,
    severity: item.severity,
    summary: item.summary,
    recommendation: item.recommendation,
    affectedColumns: [...item.affectedColumns],
  };
}

function collectLaneFlowGuidance(
  columnId: string,
  flowReport: FlowDiagnosisReport | undefined,
): TaskJitContextLaneFlowGuidance[] {
  if (!flowReport) {
    return [];
  }

  return flowReport.guidance
    .filter((item) => item.affectedColumns.includes(columnId))
    .map(toLaneFlowGuidance)
    .slice(0, 4);
}

function collectLaneHandoffFailures(
  columnId: string,
  handoffs: TaskLaneHandoff[],
): string[] {
  return handoffs
    .filter((handoff) =>
      (handoff.fromColumnId === columnId || handoff.toColumnId === columnId)
      && (handoff.status === "blocked" || handoff.status === "failed")
    )
    .map((handoff) => {
      const direction = `${handoff.fromColumnId ?? "unknown"} -> ${handoff.toColumnId ?? "unknown"}`;
      const failureText = compactLaneMemoryText(handoff.responseSummary ?? handoff.request);
      return `Handoff ${handoff.id} ${handoff.status} on ${direction}: ${failureText}`;
    })
    .slice(0, 3);
}

function summarizeLane(params: {
  columnName: string;
  sessionCount: number;
  completedSessions: number;
  failedSessions: number;
  recoveredSessions: number;
  latestSession?: TaskLaneSession;
  flowGuidance: TaskJitContextLaneFlowGuidance[];
}): string {
  const statusPart = params.latestSession
    ? `Latest session ${params.latestSession.sessionId} is ${params.latestSession.status}.`
    : "No latest session is available.";
  const flowPart = params.flowGuidance.length > 0
    ? ` Board flow guidance has ${params.flowGuidance.length} related item(s).`
    : "";

  return `${params.columnName} has ${params.sessionCount} lane session(s): `
    + `${params.completedSessions} completed or transitioned, `
    + `${params.failedSessions} failed or timed out, `
    + `${params.recoveredSessions} recovered. ${statusPart}${flowPart}`;
}

function buildLearnedPatterns(params: {
  sessions: TaskLaneSession[];
  latestSession?: TaskLaneSession;
  completedSessions: number;
  failedSessions: number;
  recoveredSessions: number;
  recoveryReasons: Array<{ reason: string; count: number }>;
  flowGuidance: TaskJitContextLaneFlowGuidance[];
}): string[] {
  const patterns: string[] = [];
  const specialistNames = uniqueStrings(params.sessions.map((session) =>
    session.specialistName ?? session.specialistId ?? session.role
  ));

  if (params.completedSessions > 0) {
    patterns.push(`${params.completedSessions} prior run(s) completed or transitioned successfully in this lane.`);
  }
  if (params.failedSessions > 0) {
    patterns.push(`${params.failedSessions} prior run(s) failed or timed out in this lane.`);
  }
  if (params.recoveredSessions > 0) {
    const topReason = params.recoveryReasons[0]?.reason;
    patterns.push(topReason
      ? `Recovery has been needed ${params.recoveredSessions} time(s), most often for ${topReason}.`
      : `Recovery has been needed ${params.recoveredSessions} time(s).`);
  }
  if (params.sessions.length > 1) {
    patterns.push(`This lane has ${params.sessions.length} attempts recorded; check earlier runs before repeating setup.`);
  }
  if (specialistNames.length > 0) {
    patterns.push(`Specialist context used here: ${specialistNames.slice(0, 3).join(", ")}.`);
  }
  if (params.latestSession?.objective) {
    patterns.push(`Latest objective: ${params.latestSession.objective}`);
  }
  for (const guidance of params.flowGuidance.slice(0, 2)) {
    patterns.push(`Board-level ${guidance.category}: ${guidance.summary}`);
  }

  return uniqueStrings(patterns).slice(0, 8);
}

function buildTopFailures(params: {
  failedSessions: TaskLaneSession[];
  handoffFailures: string[];
  recoveryReasons: Array<{ reason: string; count: number }>;
}): string[] {
  const failedSessionLines = params.failedSessions.map((session) => {
    const reason = session.recoveryReason ? `, recovery reason: ${session.recoveryReason}` : "";
    return `${session.sessionId} ended as ${session.status}${reason}.`;
  });
  const recoveryLines = params.recoveryReasons.map((entry) =>
    `${entry.reason} appeared ${entry.count} time(s) as a recovery reason.`
  );
  return uniqueStrings([
    ...failedSessionLines,
    ...params.handoffFailures,
    ...recoveryLines,
  ]).slice(0, 6);
}

function buildRecommendedActions(params: {
  columnName: string;
  latestSession?: TaskLaneSession;
  failedSessions: TaskLaneSession[];
  recoveredSessions: number;
  flowGuidance: TaskJitContextLaneFlowGuidance[];
}): string[] {
  const actions: string[] = [];

  if (params.latestSession?.status === "running") {
    actions.push(`Continue from running session ${params.latestSession.sessionId} before starting another ${params.columnName} run.`);
  }
  if (params.failedSessions.length > 0) {
    actions.push(`Review ${params.failedSessions[0].sessionId} before retrying this lane to avoid repeating the same failure.`);
  }
  if (params.recoveredSessions > 0) {
    actions.push("Check recovery reasons and handoff notes before assuming the lane environment is clean.");
  }
  for (const guidance of params.flowGuidance) {
    actions.push(guidance.recommendation);
  }
  if (actions.length === 0) {
    actions.push(`Reuse the latest ${params.columnName} session context before doing broad rediscovery.`);
  }

  return uniqueStrings(actions).slice(0, 6);
}

function buildLaneContextHints(
  task: TaskLaneExperienceSource,
  sessions: TaskLaneSession[],
): TaskContextSearchSpec | undefined {
  const snapshot = task.jitContextSnapshot;
  return normalizeTaskContextSearchSpec({
    query: task.contextSearchSpec?.query ?? task.title,
    featureCandidates: uniqueStrings([
      ...(task.contextSearchSpec?.featureCandidates ?? []),
      snapshot?.featureId,
      ...(snapshot?.recommendedContextSearchSpec?.featureCandidates ?? []),
      ...(snapshot?.analysis?.recommendedContextSearchSpec?.featureCandidates ?? []),
    ]),
    relatedFiles: uniqueStrings([
      ...(task.contextSearchSpec?.relatedFiles ?? []),
      ...(snapshot?.matchedFileDetails ?? []).map((detail) => detail.filePath),
      ...(snapshot?.analysis?.topFiles ?? []),
    ]),
    routeCandidates: uniqueStrings([
      ...(task.contextSearchSpec?.routeCandidates ?? []),
      ...(snapshot?.recommendedContextSearchSpec?.routeCandidates ?? []),
      ...(snapshot?.analysis?.recommendedContextSearchSpec?.routeCandidates ?? []),
    ]),
    apiCandidates: uniqueStrings([
      ...(task.contextSearchSpec?.apiCandidates ?? []),
      ...(snapshot?.recommendedContextSearchSpec?.apiCandidates ?? []),
      ...(snapshot?.analysis?.recommendedContextSearchSpec?.apiCandidates ?? []),
    ]),
    moduleHints: uniqueStrings([
      ...(task.contextSearchSpec?.moduleHints ?? []),
      ...(snapshot?.recommendedContextSearchSpec?.moduleHints ?? []),
      ...(snapshot?.analysis?.recommendedContextSearchSpec?.moduleHints ?? []),
    ]),
    symptomHints: uniqueStrings([
      ...(task.contextSearchSpec?.symptomHints ?? []),
      ...sessions.map((session) => session.recoveryReason),
      ...sessions
        .filter((session) => session.status === "failed" || session.status === "timed_out")
        .map((session) => `${session.columnName ?? session.columnId ?? "lane"} ${session.status}`),
    ]),
  });
}

function buildLaneAnalysis(
  task: TaskLaneExperienceSource,
  columnId: string,
  sessions: TaskLaneSession[],
  options: Required<Pick<LaneExperienceOptions, "synthesizedAt">> & Pick<LaneExperienceOptions, "flowReport">,
): TaskJitContextLaneAnalysis {
  const orderedSessions = sortSessionsByStart(sessions);
  const latestSession = orderedSessions[orderedSessions.length - 1];
  const columnName = latestSession?.columnName ?? columnId;
  const completedSessions = orderedSessions.filter((session) =>
    session.status === "completed" || session.status === "transitioned"
  ).length;
  const failedSessionEntries = orderedSessions.filter((session) =>
    session.status === "failed" || session.status === "timed_out"
  );
  const recoveredSessions = orderedSessions.filter((session) => Boolean(session.recoveredFromSessionId)).length;
  const recoveryReasons = countRecoveryReasons(orderedSessions);
  const flowGuidance = collectLaneFlowGuidance(columnId, options.flowReport);
  const handoffFailures = collectLaneHandoffFailures(columnId, task.laneHandoffs ?? []);

  return {
    columnId,
    columnName,
    synthesizedAt: options.synthesizedAt,
    sessionCount: orderedSessions.length,
    latestSessionId: latestSession?.sessionId,
    latestStatus: latestSession?.status,
    completedSessions,
    failedSessions: failedSessionEntries.length,
    recoveredSessions,
    summary: summarizeLane({
      columnName,
      sessionCount: orderedSessions.length,
      completedSessions,
      failedSessions: failedSessionEntries.length,
      recoveredSessions,
      latestSession,
      flowGuidance,
    }),
    learnedPatterns: buildLearnedPatterns({
      sessions: orderedSessions,
      latestSession,
      completedSessions,
      failedSessions: failedSessionEntries.length,
      recoveredSessions,
      recoveryReasons,
      flowGuidance,
    }),
    topFailures: buildTopFailures({
      failedSessions: failedSessionEntries,
      handoffFailures,
      recoveryReasons,
    }),
    recommendedActions: buildRecommendedActions({
      columnName,
      latestSession,
      failedSessions: failedSessionEntries,
      recoveredSessions,
      flowGuidance,
    }),
    contextHints: buildLaneContextHints(task, orderedSessions),
    flowGuidance,
  };
}

function mergeLaneAnalysisWithPreviousGuidance(
  previous: TaskJitContextLaneAnalysis | undefined,
  next: TaskJitContextLaneAnalysis,
  preservePreviousGuidance: boolean,
): TaskJitContextLaneAnalysis {
  if (!preservePreviousGuidance || next.flowGuidance.length > 0 || !previous?.flowGuidance.length) {
    return next;
  }

  const preservedGuidance = previous.flowGuidance;
  const flowPatterns = preservedGuidance.slice(0, 2).map((guidance) =>
    `Board-level ${guidance.category}: ${guidance.summary}`
  );
  const flowActions = preservedGuidance.map((guidance) => guidance.recommendation);
  const summary = next.summary.includes("Board flow guidance")
    ? next.summary
    : `${next.summary} Board flow guidance has ${preservedGuidance.length} related item(s).`;

  return {
    ...next,
    summary,
    learnedPatterns: uniqueStrings([
      ...next.learnedPatterns,
      ...flowPatterns,
    ]).slice(0, 8),
    recommendedActions: uniqueStrings([
      ...next.recommendedActions,
      ...flowActions,
    ]).slice(0, 6),
    flowGuidance: preservedGuidance,
  };
}

function mergePerLaneAnalysis(
  previous: Record<string, TaskJitContextLaneAnalysis> | undefined,
  next: Record<string, TaskJitContextLaneAnalysis>,
  options: LaneExperienceOptions,
): Record<string, TaskJitContextLaneAnalysis> {
  const previousEntries = previous ?? {};
  const preservePreviousGuidance = !options.flowReport;
  const merged = new Map<string, TaskJitContextLaneAnalysis>();

  for (const [columnId, analysis] of Object.entries(previousEntries)) {
    merged.set(columnId, analysis);
  }
  for (const [columnId, analysis] of Object.entries(next)) {
    merged.set(columnId, mergeLaneAnalysisWithPreviousGuidance(
      previousEntries[columnId],
      analysis,
      preservePreviousGuidance,
    ));
  }

  return Object.fromEntries(
    [...merged.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function synthesizeTaskLaneJitContextAnalysis(
  task: TaskLaneExperienceSource | null | undefined,
  options: LaneExperienceOptions = {},
): Record<string, TaskJitContextLaneAnalysis> | undefined {
  if (!task || (task.laneSessions?.length ?? 0) === 0) {
    return undefined;
  }

  const synthesizedAt = resolveLaneExperienceSynthesizedAt(task, options);
  const entries = [...groupSessionsByColumn(task.laneSessions ?? []).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([columnId, sessions]) => [
      columnId,
      buildLaneAnalysis(task, columnId, sessions, {
        synthesizedAt,
        flowReport: options.flowReport,
      }),
    ] as const);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function mergeTaskLaneExperienceIntoJitSnapshot(
  task: TaskLaneExperienceSource,
  options: LaneExperienceOptions = {},
): TaskJitContextSnapshot | undefined {
  const synthesizedAt = resolveLaneExperienceSynthesizedAt(task, options);
  const perLaneAnalysis = synthesizeTaskLaneJitContextAnalysis(task, {
    ...options,
    synthesizedAt,
  });
  const normalizedSnapshot = normalizeTaskJitContextSnapshot(task.jitContextSnapshot);

  if (!perLaneAnalysis) {
    return normalizedSnapshot;
  }

  const mergedPerLaneAnalysis = mergePerLaneAnalysis(
    normalizedSnapshot?.perLaneAnalysis,
    perLaneAnalysis,
    options,
  );
  return normalizeTaskJitContextSnapshot({
    generatedAt: normalizedSnapshot?.generatedAt ?? synthesizedAt,
    repoPath: normalizedSnapshot?.repoPath,
    featureId: normalizedSnapshot?.featureId,
    featureName: normalizedSnapshot?.featureName,
    summary: normalizedSnapshot?.summary
      ?? `Kanban lane experience memory for ${task.title ?? task.id ?? "task"}.`,
    matchConfidence: normalizedSnapshot?.matchConfidence ?? "low",
    matchReasons: normalizedSnapshot?.matchReasons ?? [],
    warnings: normalizedSnapshot?.warnings ?? [],
    matchedFileDetails: normalizedSnapshot?.matchedFileDetails ?? [],
    matchedSessionIds: normalizedSnapshot?.matchedSessionIds ?? [],
    failures: normalizedSnapshot?.failures ?? [],
    repeatedReadFiles: normalizedSnapshot?.repeatedReadFiles ?? [],
    sessions: normalizedSnapshot?.sessions ?? [],
    historySummary: normalizedSnapshot?.historySummary,
    recommendedContextSearchSpec: normalizedSnapshot?.recommendedContextSearchSpec,
    analysis: normalizedSnapshot?.analysis,
    perLaneAnalysis: mergedPerLaneAnalysis,
  });
}

export function refreshTaskLaneExperienceMemory<T extends TaskLaneExperienceSource>(
  task: T,
  options: LaneExperienceOptions = {},
): T {
  const snapshot = mergeTaskLaneExperienceIntoJitSnapshot(task, options);
  if (snapshot) {
    task.jitContextSnapshot = snapshot;
  }
  return task;
}

export function buildLaneExperiencePromptSection(
  task: Pick<TaskLaneExperienceSource, "columnId" | "jitContextSnapshot">,
): string | undefined {
  const perLaneAnalysis = task.jitContextSnapshot?.perLaneAnalysis;
  if (!perLaneAnalysis) {
    return undefined;
  }

  const analyses = Object.values(perLaneAnalysis)
    .sort((left, right) => left.columnId.localeCompare(right.columnId));
  if (analyses.length === 0) {
    return undefined;
  }

  const currentColumnId = task.columnId;
  const ordered = [
    ...analyses.filter((analysis) => analysis.columnId === currentColumnId),
    ...analyses.filter((analysis) => analysis.columnId !== currentColumnId),
  ].slice(0, 4);

  const lines = ["## Lane Experience Memory", ""];
  for (const analysis of ordered) {
    lines.push(`- **${analysis.columnName ?? analysis.columnId}**: ${analysis.summary}`);
    if (analysis.learnedPatterns.length > 0) {
      lines.push(`  Learned: ${analysis.learnedPatterns.slice(0, 2).join(" | ")}`);
    }
    if (analysis.topFailures.length > 0) {
      lines.push(`  Watch: ${analysis.topFailures.slice(0, 2).join(" | ")}`);
    }
    if (analysis.recommendedActions.length > 0) {
      lines.push(`  Next: ${analysis.recommendedActions.slice(0, 2).join(" | ")}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}
