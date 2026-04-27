/**
 * Task model - port of routa-core Task.kt
 *
 * Represents a unit of work within the multi-agent system.
 */

import type { ArtifactType } from "./artifact";
import type { KanbanRequiredTaskField } from "./task-requirements";
import type { TaskCreationSource } from "../kanban/task-creation-policy";

export enum TaskStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  REVIEW_REQUIRED = "REVIEW_REQUIRED",
  COMPLETED = "COMPLETED",
  NEEDS_FIX = "NEEDS_FIX",
  BLOCKED = "BLOCKED",
  CANCELLED = "CANCELLED",
}

export enum TaskPriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  URGENT = "urgent",
}

export enum VerificationVerdict {
  APPROVED = "APPROVED",
  NOT_APPROVED = "NOT_APPROVED",
  BLOCKED = "BLOCKED",
}

export type TaskAnalysisStatus = "pass" | "warning" | "fail";

export interface TaskInvestCheckSummary {
  status: TaskAnalysisStatus;
  reason: string;
}

export interface TaskInvestValidation {
  source: "canonical_story" | "heuristic";
  overallStatus: TaskAnalysisStatus;
  checks: {
    independent: TaskInvestCheckSummary;
    negotiable: TaskInvestCheckSummary;
    valuable: TaskInvestCheckSummary;
    estimable: TaskInvestCheckSummary;
    small: TaskInvestCheckSummary;
    testable: TaskInvestCheckSummary;
  };
  issues: string[];
}

export interface TaskStoryReadiness {
  ready: boolean;
  missing: KanbanRequiredTaskField[];
  requiredTaskFields: KanbanRequiredTaskField[];
  checks: {
    scope: boolean;
    acceptanceCriteria: boolean;
    verificationCommands: boolean;
    testCases: boolean;
    verificationPlan: boolean;
    dependenciesDeclared: boolean;
  };
}

export interface TaskArtifactSummary {
  total: number;
  byType: Partial<Record<ArtifactType, number>>;
  requiredSatisfied: boolean;
  missingRequired: ArtifactType[];
}

export interface TaskEvidenceSummary {
  artifact: TaskArtifactSummary;
  verification: {
    hasVerdict: boolean;
    verdict?: string;
    hasReport: boolean;
  };
  completion: {
    hasSummary: boolean;
  };
  runs: {
    total: number;
    latestStatus: string;
  };
}

export type TaskLaneSessionStatus =
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "transitioned";

export type TaskLaneSessionLoopMode = "watchdog_retry" | "ralph_loop";
export type TaskLaneSessionCompletionRequirement =
  | "turn_complete"
  | "completion_summary"
  | "verification_report";
export type TaskLaneSessionRecoveryReason =
  | "watchdog_inactivity"
  | "agent_failed"
  | "completion_criteria_not_met";

export type TaskLaneHandoffRequestType =
  | "environment_preparation"
  | "runtime_context"
  | "clarification"
  | "rerun_command";

export type TaskLaneHandoffStatus =
  | "requested"
  | "delivered"
  | "completed"
  | "blocked"
  | "failed";

export interface TaskLaneSession {
  sessionId: string;
  routaAgentId?: string;
  worktreeId?: string;
  cwd?: string;
  columnId?: string;
  columnName?: string;
  stepId?: string;
  stepIndex?: number;
  stepName?: string;
  provider?: string;
  role?: string;
  specialistId?: string;
  specialistName?: string;
  /** Transport protocol used for this session */
  transport?: string;
  /** A2A-specific: External task ID from the agent system */
  externalTaskId?: string;
  /** A2A-specific: Context ID for tracking the conversation */
  contextId?: string;
  attempt?: number;
  loopMode?: TaskLaneSessionLoopMode;
  completionRequirement?: TaskLaneSessionCompletionRequirement;
  objective?: string;
  lastActivityAt?: string;
  recoveredFromSessionId?: string;
  recoveryReason?: TaskLaneSessionRecoveryReason;
  status: TaskLaneSessionStatus;
  startedAt: string;
  completedAt?: string;
}

export interface TaskLaneHandoff {
  id: string;
  fromSessionId: string;
  toSessionId: string;
  fromColumnId?: string;
  toColumnId?: string;
  worktreeId?: string;
  cwd?: string;
  requestType: TaskLaneHandoffRequestType;
  request: string;
  status: TaskLaneHandoffStatus;
  requestedAt: string;
  respondedAt?: string;
  responseSummary?: string;
}

export interface TaskCommentEntry {
  id: string;
  body: string;
  createdAt: string;
  source?: "legacy_import" | "update_card";
  agentId?: string;
  sessionId?: string;
}

export interface TaskDeliverySnapshotCommit {
  sha: string;
  shortSha: string;
  summary: string;
  authorName: string;
  authoredAt: string;
  additions: number;
  deletions: number;
}

export interface TaskDeliverySnapshot {
  capturedAt: string;
  repoPath: string;
  worktreeId?: string;
  worktreePath?: string;
  branch?: string;
  baseBranch?: string;
  baseRef: string;
  baseSha: string;
  headSha: string;
  commits: TaskDeliverySnapshotCommit[];
  source: "review_transition" | "done_transition" | "pr_run" | "manual";
}

export interface FallbackAgent {
  providerId?: string;
  role?: string;
  specialistId?: string;
  specialistName?: string;
}

export interface TaskContextSearchSpec {
  query?: string;
  featureCandidates?: string[];
  relatedFiles?: string[];
  routeCandidates?: string[];
  apiCandidates?: string[];
  moduleHints?: string[];
  symptomHints?: string[];
}

export type TaskJitContextMatchConfidence = "high" | "medium" | "low";

export interface TaskJitContextFailureSignal {
  provider?: string;
  sessionId: string;
  message: string;
  toolName: string;
  command?: string;
}

export interface TaskJitContextMatchedFileDetail {
  filePath: string;
  changes: number;
  sessions: number;
  updatedAt: string;
}

export interface TaskJitContextSessionSummary {
  provider: string;
  sessionId: string;
  updatedAt: string;
  promptSnippet: string;
  matchedFiles: string[];
  matchedChangedFiles: string[];
  matchedReadFiles: string[];
  matchedWrittenFiles: string[];
  repeatedReadFiles: string[];
  toolNames: string[];
  failedReadSignals: TaskJitContextFailureSignal[];
  resumeCommand?: string;
}

export interface TaskJitContextSeedSessionSummary {
  provider: string;
  sessionId: string;
  updatedAt: string;
  promptSnippet: string;
  touchedFiles: string[];
  repeatedReadFiles: string[];
  toolNames: string[];
  failedReadSignals: TaskJitContextFailureSignal[];
}

export interface TaskJitContextHistorySummary {
  overview: string;
  seedSessionCount: number;
  recoveredSessionCount: number;
  matchedFileCount: number;
  seedSessions: TaskJitContextSeedSessionSummary[];
}

export interface TaskJitContextAnalysisSessionLead {
  sessionId: string;
  provider?: string;
  reason: string;
}

export interface TaskJitContextAnalysis {
  updatedAt?: string;
  summary: string;
  topFiles: string[];
  topSessions: TaskJitContextAnalysisSessionLead[];
  reusablePrompts: string[];
  recommendedContextSearchSpec?: TaskContextSearchSpec;
}

export interface TaskJitContextLaneFlowGuidance {
  category: string;
  severity: "info" | "warning" | "critical";
  summary: string;
  recommendation: string;
  affectedColumns: string[];
}

export interface TaskJitContextLaneAnalysis {
  columnId: string;
  columnName?: string;
  synthesizedAt: string;
  sessionCount: number;
  latestSessionId?: string;
  latestStatus?: TaskLaneSessionStatus;
  completedSessions: number;
  failedSessions: number;
  recoveredSessions: number;
  summary: string;
  learnedPatterns: string[];
  topFailures: string[];
  recommendedActions: string[];
  contextHints?: TaskContextSearchSpec;
  flowGuidance: TaskJitContextLaneFlowGuidance[];
}

export interface TaskJitContextSnapshot {
  generatedAt: string;
  repoPath?: string;
  featureId?: string;
  featureName?: string;
  summary: string;
  matchConfidence: TaskJitContextMatchConfidence;
  matchReasons: string[];
  warnings: string[];
  matchedFileDetails: TaskJitContextMatchedFileDetail[];
  matchedSessionIds: string[];
  failures: TaskJitContextFailureSignal[];
  repeatedReadFiles: string[];
  sessions: TaskJitContextSessionSummary[];
  historySummary?: TaskJitContextHistorySummary;
  recommendedContextSearchSpec?: TaskContextSearchSpec;
  analysis?: TaskJitContextAnalysis;
  perLaneAnalysis?: Record<string, TaskJitContextLaneAnalysis>;
}

function normalizeTaskContextSearchText(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTaskContextSearchItems(values: readonly string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const normalized = Array.from(new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean),
  ));

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeTaskContextSearchSpec(
  value: TaskContextSearchSpec | null | undefined,
): TaskContextSearchSpec | undefined {
  if (!value) {
    return undefined;
  }

  const normalized: TaskContextSearchSpec = {
    query: normalizeTaskContextSearchText(value.query),
    featureCandidates: normalizeTaskContextSearchItems(value.featureCandidates),
    relatedFiles: normalizeTaskContextSearchItems(value.relatedFiles),
    routeCandidates: normalizeTaskContextSearchItems(value.routeCandidates),
    apiCandidates: normalizeTaskContextSearchItems(value.apiCandidates),
    moduleHints: normalizeTaskContextSearchItems(value.moduleHints),
    symptomHints: normalizeTaskContextSearchItems(value.symptomHints),
  };

  return Object.values(normalized).some((entry) =>
    typeof entry === "string" ? entry.length > 0 : Array.isArray(entry) && entry.length > 0
  )
    ? normalized
    : undefined;
}

export function parseTaskContextSearchSpec(value: unknown): TaskContextSearchSpec | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  return normalizeTaskContextSearchSpec({
    query: typeof candidate.query === "string" ? candidate.query : undefined,
    featureCandidates: Array.isArray(candidate.featureCandidates)
      ? candidate.featureCandidates.filter((item): item is string => typeof item === "string")
      : undefined,
    relatedFiles: Array.isArray(candidate.relatedFiles)
      ? candidate.relatedFiles.filter((item): item is string => typeof item === "string")
      : undefined,
    routeCandidates: Array.isArray(candidate.routeCandidates)
      ? candidate.routeCandidates.filter((item): item is string => typeof item === "string")
      : undefined,
    apiCandidates: Array.isArray(candidate.apiCandidates)
      ? candidate.apiCandidates.filter((item): item is string => typeof item === "string")
      : undefined,
    moduleHints: Array.isArray(candidate.moduleHints)
      ? candidate.moduleHints.filter((item): item is string => typeof item === "string")
      : undefined,
    symptomHints: Array.isArray(candidate.symptomHints)
      ? candidate.symptomHints.filter((item): item is string => typeof item === "string")
      : undefined,
  });
}

function normalizeTaskJitContextFailureSignal(
  value: TaskJitContextFailureSignal | null | undefined,
): TaskJitContextFailureSignal | undefined {
  if (!value) {
    return undefined;
  }

  const sessionId = normalizeTaskContextSearchText(value.sessionId);
  const message = normalizeTaskContextSearchText(value.message);
  const toolName = normalizeTaskContextSearchText(value.toolName);
  if (!sessionId || !message || !toolName) {
    return undefined;
  }

  return {
    provider: normalizeTaskContextSearchText(value.provider),
    sessionId,
    message,
    toolName,
    command: normalizeTaskContextSearchText(value.command),
  };
}

function normalizeTaskJitContextMatchedFileDetail(
  value: TaskJitContextMatchedFileDetail | null | undefined,
): TaskJitContextMatchedFileDetail | undefined {
  if (!value) {
    return undefined;
  }

  const filePath = normalizeTaskContextSearchText(value.filePath);
  const updatedAt = normalizeTaskContextSearchText(value.updatedAt);
  if (!filePath) {
    return undefined;
  }

  return {
    filePath,
    changes: typeof value.changes === "number" && Number.isFinite(value.changes) ? value.changes : 0,
    sessions: typeof value.sessions === "number" && Number.isFinite(value.sessions) ? value.sessions : 0,
    updatedAt: updatedAt ?? "",
  };
}

function normalizeTaskJitContextSessionSummary(
  value: TaskJitContextSessionSummary | null | undefined,
): TaskJitContextSessionSummary | undefined {
  if (!value) {
    return undefined;
  }

  const provider = normalizeTaskContextSearchText(value.provider);
  const sessionId = normalizeTaskContextSearchText(value.sessionId);
  const updatedAt = normalizeTaskContextSearchText(value.updatedAt);
  const promptSnippet = normalizeTaskContextSearchText(value.promptSnippet);
  if (!provider || !sessionId || !updatedAt || !promptSnippet) {
    return undefined;
  }

  return {
    provider,
    sessionId,
    updatedAt,
    promptSnippet,
    matchedFiles: normalizeTaskContextSearchItems(value.matchedFiles) ?? [],
    matchedChangedFiles: normalizeTaskContextSearchItems(value.matchedChangedFiles) ?? [],
    matchedReadFiles: normalizeTaskContextSearchItems(value.matchedReadFiles) ?? [],
    matchedWrittenFiles: normalizeTaskContextSearchItems(value.matchedWrittenFiles) ?? [],
    repeatedReadFiles: normalizeTaskContextSearchItems(value.repeatedReadFiles) ?? [],
    toolNames: normalizeTaskContextSearchItems(value.toolNames) ?? [],
    failedReadSignals: (value.failedReadSignals ?? [])
      .map((entry) => normalizeTaskJitContextFailureSignal(entry))
      .filter((entry): entry is TaskJitContextFailureSignal => Boolean(entry)),
    resumeCommand: normalizeTaskContextSearchText(value.resumeCommand),
  };
}

function normalizeTaskJitContextSeedSessionSummary(
  value: TaskJitContextSeedSessionSummary | null | undefined,
): TaskJitContextSeedSessionSummary | undefined {
  if (!value) {
    return undefined;
  }

  const provider = normalizeTaskContextSearchText(value.provider);
  const sessionId = normalizeTaskContextSearchText(value.sessionId);
  const updatedAt = normalizeTaskContextSearchText(value.updatedAt);
  const promptSnippet = normalizeTaskContextSearchText(value.promptSnippet);
  if (!provider || !sessionId || !updatedAt || !promptSnippet) {
    return undefined;
  }

  return {
    provider,
    sessionId,
    updatedAt,
    promptSnippet,
    touchedFiles: normalizeTaskContextSearchItems(value.touchedFiles) ?? [],
    repeatedReadFiles: normalizeTaskContextSearchItems(value.repeatedReadFiles) ?? [],
    toolNames: normalizeTaskContextSearchItems(value.toolNames) ?? [],
    failedReadSignals: (value.failedReadSignals ?? [])
      .map((entry) => normalizeTaskJitContextFailureSignal(entry))
      .filter((entry): entry is TaskJitContextFailureSignal => Boolean(entry)),
  };
}

function normalizeTaskJitContextHistorySummary(
  value: TaskJitContextHistorySummary | null | undefined,
): TaskJitContextHistorySummary | undefined {
  if (!value) {
    return undefined;
  }

  const overview = normalizeTaskContextSearchText(value.overview);
  if (!overview) {
    return undefined;
  }

  return {
    overview,
    seedSessionCount: typeof value.seedSessionCount === "number" && Number.isFinite(value.seedSessionCount)
      ? value.seedSessionCount
      : 0,
    recoveredSessionCount: typeof value.recoveredSessionCount === "number" && Number.isFinite(value.recoveredSessionCount)
      ? value.recoveredSessionCount
      : 0,
    matchedFileCount: typeof value.matchedFileCount === "number" && Number.isFinite(value.matchedFileCount)
      ? value.matchedFileCount
      : 0,
    seedSessions: (value.seedSessions ?? [])
      .map((entry) => normalizeTaskJitContextSeedSessionSummary(entry))
      .filter((entry): entry is TaskJitContextSeedSessionSummary => Boolean(entry)),
  };
}

function normalizeTaskJitContextAnalysisSessionLead(
  value: TaskJitContextAnalysisSessionLead | null | undefined,
): TaskJitContextAnalysisSessionLead | undefined {
  if (!value) {
    return undefined;
  }

  const sessionId = normalizeTaskContextSearchText(value.sessionId);
  const reason = normalizeTaskContextSearchText(value.reason);
  if (!sessionId || !reason) {
    return undefined;
  }

  return {
    sessionId,
    provider: normalizeTaskContextSearchText(value.provider),
    reason,
  };
}

export function normalizeTaskJitContextAnalysis(
  value: TaskJitContextAnalysis | null | undefined,
): TaskJitContextAnalysis | undefined {
  if (!value) {
    return undefined;
  }

  const summary = normalizeTaskContextSearchText(value.summary);
  if (!summary) {
    return undefined;
  }

  const updatedAt = normalizeTaskContextSearchText(value.updatedAt) ?? new Date().toISOString();
  return {
    updatedAt,
    summary,
    topFiles: normalizeTaskContextSearchItems(value.topFiles) ?? [],
    topSessions: (value.topSessions ?? [])
      .map((entry) => normalizeTaskJitContextAnalysisSessionLead(entry))
      .filter((entry): entry is TaskJitContextAnalysisSessionLead => Boolean(entry)),
    reusablePrompts: normalizeTaskContextSearchItems(value.reusablePrompts) ?? [],
    recommendedContextSearchSpec: normalizeTaskContextSearchSpec(value.recommendedContextSearchSpec),
  };
}

function normalizeTaskJitContextLaneStatus(
  value: TaskLaneSessionStatus | undefined,
): TaskLaneSessionStatus | undefined {
  return value === "running"
    || value === "completed"
    || value === "failed"
    || value === "timed_out"
    || value === "transitioned"
    ? value
    : undefined;
}

function normalizeTaskJitContextCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function normalizeTaskJitContextLaneFlowGuidance(
  value: TaskJitContextLaneFlowGuidance | null | undefined,
): TaskJitContextLaneFlowGuidance | undefined {
  if (!value) {
    return undefined;
  }

  const category = normalizeTaskContextSearchText(value.category);
  const severity = value.severity === "critical" || value.severity === "warning" || value.severity === "info"
    ? value.severity
    : undefined;
  const summary = normalizeTaskContextSearchText(value.summary);
  const recommendation = normalizeTaskContextSearchText(value.recommendation);
  if (!category || !severity || !summary || !recommendation) {
    return undefined;
  }

  return {
    category,
    severity,
    summary,
    recommendation,
    affectedColumns: normalizeTaskContextSearchItems(value.affectedColumns) ?? [],
  };
}

function normalizeTaskJitContextLaneAnalysis(
  value: TaskJitContextLaneAnalysis | null | undefined,
): TaskJitContextLaneAnalysis | undefined {
  if (!value) {
    return undefined;
  }

  const columnId = normalizeTaskContextSearchText(value.columnId);
  const synthesizedAt = normalizeTaskContextSearchText(value.synthesizedAt);
  const summary = normalizeTaskContextSearchText(value.summary);
  if (!columnId || !synthesizedAt || !summary) {
    return undefined;
  }

  return {
    columnId,
    columnName: normalizeTaskContextSearchText(value.columnName),
    synthesizedAt,
    sessionCount: normalizeTaskJitContextCount(value.sessionCount),
    latestSessionId: normalizeTaskContextSearchText(value.latestSessionId),
    latestStatus: normalizeTaskJitContextLaneStatus(value.latestStatus),
    completedSessions: normalizeTaskJitContextCount(value.completedSessions),
    failedSessions: normalizeTaskJitContextCount(value.failedSessions),
    recoveredSessions: normalizeTaskJitContextCount(value.recoveredSessions),
    summary,
    learnedPatterns: normalizeTaskContextSearchItems(value.learnedPatterns) ?? [],
    topFailures: normalizeTaskContextSearchItems(value.topFailures) ?? [],
    recommendedActions: normalizeTaskContextSearchItems(value.recommendedActions) ?? [],
    contextHints: normalizeTaskContextSearchSpec(value.contextHints),
    flowGuidance: (Array.isArray(value.flowGuidance) ? value.flowGuidance : [])
      .map((entry) => normalizeTaskJitContextLaneFlowGuidance(entry))
      .filter((entry): entry is TaskJitContextLaneFlowGuidance => Boolean(entry)),
  };
}

function normalizeTaskJitContextPerLaneAnalysis(
  value: Record<string, TaskJitContextLaneAnalysis> | null | undefined,
): Record<string, TaskJitContextLaneAnalysis> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const normalizedEntries = Object.entries(value)
    .map(([key, entry]) => {
      const normalized = normalizeTaskJitContextLaneAnalysis(entry);
      return normalized ? [normalized.columnId || key, normalized] as const : undefined;
    })
    .filter((entry): entry is readonly [string, TaskJitContextLaneAnalysis] => Boolean(entry));

  return normalizedEntries.length > 0
    ? Object.fromEntries(normalizedEntries)
    : undefined;
}

export function normalizeTaskJitContextSnapshot(
  value: TaskJitContextSnapshot | null | undefined,
): TaskJitContextSnapshot | undefined {
  if (!value) {
    return undefined;
  }

  const generatedAt = normalizeTaskContextSearchText(value.generatedAt);
  const summary = normalizeTaskContextSearchText(value.summary);
  if (!generatedAt || !summary) {
    return undefined;
  }

  const matchConfidence: TaskJitContextMatchConfidence = value.matchConfidence === "low"
    || value.matchConfidence === "medium"
    || value.matchConfidence === "high"
    ? value.matchConfidence
    : "low";

  const normalized: TaskJitContextSnapshot = {
    generatedAt,
    repoPath: normalizeTaskContextSearchText(value.repoPath),
    featureId: normalizeTaskContextSearchText(value.featureId),
    featureName: normalizeTaskContextSearchText(value.featureName),
    summary,
    matchConfidence,
    matchReasons: normalizeTaskContextSearchItems(value.matchReasons) ?? [],
    warnings: normalizeTaskContextSearchItems(value.warnings) ?? [],
    matchedFileDetails: (value.matchedFileDetails ?? [])
      .map((entry) => normalizeTaskJitContextMatchedFileDetail(entry))
      .filter((entry): entry is TaskJitContextMatchedFileDetail => Boolean(entry)),
    matchedSessionIds: normalizeTaskContextSearchItems(value.matchedSessionIds) ?? [],
    failures: (value.failures ?? [])
      .map((entry) => normalizeTaskJitContextFailureSignal(entry))
      .filter((entry): entry is TaskJitContextFailureSignal => Boolean(entry)),
    repeatedReadFiles: normalizeTaskContextSearchItems(value.repeatedReadFiles) ?? [],
    sessions: (value.sessions ?? [])
      .map((entry) => normalizeTaskJitContextSessionSummary(entry))
      .filter((entry): entry is TaskJitContextSessionSummary => Boolean(entry)),
    historySummary: normalizeTaskJitContextHistorySummary(value.historySummary),
    recommendedContextSearchSpec: normalizeTaskContextSearchSpec(value.recommendedContextSearchSpec),
    analysis: normalizeTaskJitContextAnalysis(value.analysis),
    perLaneAnalysis: normalizeTaskJitContextPerLaneAnalysis(value.perLaneAnalysis),
  };

  return normalized;
}

export function parseTaskJitContextAnalysis(value: unknown): TaskJitContextAnalysis | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  return normalizeTaskJitContextAnalysis({
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
    topFiles: Array.isArray(candidate.topFiles)
      ? candidate.topFiles.filter((item): item is string => typeof item === "string")
      : [],
    topSessions: Array.isArray(candidate.topSessions)
      ? candidate.topSessions as TaskJitContextAnalysisSessionLead[]
      : [],
    reusablePrompts: Array.isArray(candidate.reusablePrompts)
      ? candidate.reusablePrompts.filter((item): item is string => typeof item === "string")
      : [],
    recommendedContextSearchSpec: parseTaskContextSearchSpec(candidate.recommendedContextSearchSpec),
  });
}

export function parseTaskJitContextSnapshot(value: unknown): TaskJitContextSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  return normalizeTaskJitContextSnapshot({
    generatedAt: typeof candidate.generatedAt === "string" ? candidate.generatedAt : "",
    repoPath: typeof candidate.repoPath === "string" ? candidate.repoPath : undefined,
    featureId: typeof candidate.featureId === "string" ? candidate.featureId : undefined,
    featureName: typeof candidate.featureName === "string" ? candidate.featureName : undefined,
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
    matchConfidence: candidate.matchConfidence as TaskJitContextMatchConfidence,
    matchReasons: Array.isArray(candidate.matchReasons)
      ? candidate.matchReasons.filter((item): item is string => typeof item === "string")
      : [],
    warnings: Array.isArray(candidate.warnings)
      ? candidate.warnings.filter((item): item is string => typeof item === "string")
      : [],
    matchedFileDetails: Array.isArray(candidate.matchedFileDetails)
      ? candidate.matchedFileDetails as TaskJitContextMatchedFileDetail[]
      : [],
    matchedSessionIds: Array.isArray(candidate.matchedSessionIds)
      ? candidate.matchedSessionIds.filter((item): item is string => typeof item === "string")
      : [],
    failures: Array.isArray(candidate.failures)
      ? candidate.failures as TaskJitContextFailureSignal[]
      : [],
    repeatedReadFiles: Array.isArray(candidate.repeatedReadFiles)
      ? candidate.repeatedReadFiles.filter((item): item is string => typeof item === "string")
      : [],
    sessions: Array.isArray(candidate.sessions)
      ? candidate.sessions as TaskJitContextSessionSummary[]
      : [],
    historySummary: candidate.historySummary as TaskJitContextHistorySummary | undefined,
    recommendedContextSearchSpec: parseTaskContextSearchSpec(candidate.recommendedContextSearchSpec),
    analysis: parseTaskJitContextAnalysis(candidate.analysis),
    perLaneAnalysis: candidate.perLaneAnalysis as Record<string, TaskJitContextLaneAnalysis> | undefined,
  });
}

export function mergeTaskJitContextAnalysis(
  snapshot: TaskJitContextSnapshot | null | undefined,
  analysis: TaskJitContextAnalysis | null | undefined,
): TaskJitContextSnapshot | undefined {
  const normalizedAnalysis = normalizeTaskJitContextAnalysis(analysis);
  const normalizedSnapshot = normalizeTaskJitContextSnapshot(snapshot);

  if (!normalizedSnapshot) {
    if (!normalizedAnalysis) {
      return undefined;
    }

    return normalizeTaskJitContextSnapshot({
      generatedAt: normalizedAnalysis.updatedAt ?? new Date().toISOString(),
      summary: normalizedAnalysis.summary,
      matchConfidence: "low",
      matchReasons: [],
      warnings: [],
      matchedFileDetails: [],
      matchedSessionIds: [],
      failures: [],
      repeatedReadFiles: [],
      sessions: [],
      recommendedContextSearchSpec: normalizedAnalysis.recommendedContextSearchSpec,
      analysis: normalizedAnalysis,
    });
  }

  return normalizeTaskJitContextSnapshot({
    ...normalizedSnapshot,
    recommendedContextSearchSpec:
      normalizedAnalysis?.recommendedContextSearchSpec
      ?? normalizedSnapshot.recommendedContextSearchSpec,
    analysis: normalizedAnalysis,
  });
}

export interface Task {
  id: string;
  title: string;
  objective: string;
  comment?: string;
  comments: TaskCommentEntry[];
  scope?: string;
  acceptanceCriteria?: string[];
  verificationCommands?: string[];
  testCases?: string[];
  assignedTo?: string;
  status: TaskStatus;
  boardId?: string;
  columnId?: string;
  position: number;
  priority?: TaskPriority;
  labels: string[];
  assignee?: string;
  assignedProvider?: string;
  assignedRole?: string;
  assignedSpecialistId?: string;
  assignedSpecialistName?: string;
  /** Ordered fallback agents to try when the primary agent fails */
  fallbackAgentChain?: FallbackAgent[];
  /** Whether to automatically try the next fallback agent on failure */
  enableAutomaticFallback?: boolean;
  /** Maximum number of fallback attempts before giving up */
  maxFallbackAttempts?: number;
  triggerSessionId?: string;
  /** All session IDs that have been associated with this task (history) */
  sessionIds: string[];
  /** Durable per-lane session history for Kanban workflow handoff */
  laneSessions: TaskLaneSession[];
  /** Adjacent-lane handoff requests and responses */
  laneHandoffs: TaskLaneHandoff[];
  githubId?: string;
  githubNumber?: number;
  githubUrl?: string;
  githubRepo?: string;
  githubState?: string;
  githubSyncedAt?: Date;
  lastSyncError?: string;
  isPullRequest?: boolean;
  dependencies: string[];
  parallelGroup?: string;
  workspaceId: string;
  /** Session ID that created this task (for session-scoped filtering) */
  sessionId?: string;
  creationSource?: TaskCreationSource;
  /** Associated codebase IDs for this task */
  codebaseIds: string[];
  /** Structured retrieval hints used to hydrate JIT Context and history search. */
  contextSearchSpec?: TaskContextSearchSpec;
  /** Persisted JIT retrieval snapshot and recommended follow-up context for this card. */
  jitContextSnapshot?: TaskJitContextSnapshot;
  /** Git worktree ID created for this task when it enters the dev column */
  worktreeId?: string;
  /** Frozen delivery evidence captured before PR / merge / base sync can erase base..HEAD */
  deliverySnapshot?: TaskDeliverySnapshot;
  createdAt: Date;
  updatedAt: Date;
  completionSummary?: string;
  verificationVerdict?: VerificationVerdict;
  verificationReport?: string;
}

export function createTask(params: {
  id: string;
  title: string;
  objective: string;
  comment?: string;
  comments?: TaskCommentEntry[];
  workspaceId: string;
  triggerSessionId?: string;
  sessionId?: string;
  creationSource?: TaskCreationSource;
  scope?: string;
  acceptanceCriteria?: string[];
  verificationCommands?: string[];
  testCases?: string[];
  dependencies?: string[];
  parallelGroup?: string;
  boardId?: string;
  columnId?: string;
  position?: number;
  priority?: TaskPriority;
  labels?: string[];
  assignee?: string;
  assignedProvider?: string;
  assignedRole?: string;
  assignedSpecialistId?: string;
  assignedSpecialistName?: string;
  fallbackAgentChain?: FallbackAgent[];
  enableAutomaticFallback?: boolean;
  maxFallbackAttempts?: number;
  githubId?: string;
  githubNumber?: number;
  githubUrl?: string;
  githubRepo?: string;
  githubState?: string;
  githubSyncedAt?: Date;
  lastSyncError?: string;
  isPullRequest?: boolean;
  status?: TaskStatus;
  codebaseIds?: string[];
  contextSearchSpec?: TaskContextSearchSpec;
  jitContextSnapshot?: TaskJitContextSnapshot;
  worktreeId?: string;
}): Task {
  const now = new Date();
  const comments = params.comments ?? buildInitialTaskComments(params.comment, now);
  return {
    id: params.id,
    title: params.title,
    objective: params.objective,
    comment: params.comment,
    comments,
    scope: params.scope,
    acceptanceCriteria: params.acceptanceCriteria,
    verificationCommands: params.verificationCommands,
    testCases: params.testCases,
    status: params.status ?? TaskStatus.PENDING,
    boardId: params.boardId,
    columnId: params.columnId,
    position: params.position ?? 0,
    priority: params.priority,
    labels: params.labels ?? [],
    assignee: params.assignee,
    assignedProvider: params.assignedProvider,
    assignedRole: params.assignedRole,
    assignedSpecialistId: params.assignedSpecialistId,
    assignedSpecialistName: params.assignedSpecialistName,
    fallbackAgentChain: params.fallbackAgentChain,
    enableAutomaticFallback: params.enableAutomaticFallback,
    maxFallbackAttempts: params.maxFallbackAttempts,
    sessionIds: [],
    laneSessions: [],
    laneHandoffs: [],
    githubId: params.githubId,
    githubNumber: params.githubNumber,
    githubUrl: params.githubUrl,
    githubRepo: params.githubRepo,
    githubState: params.githubState,
    githubSyncedAt: params.githubSyncedAt,
    lastSyncError: params.lastSyncError,
    isPullRequest: params.isPullRequest,
    dependencies: params.dependencies ?? [],
    parallelGroup: params.parallelGroup,
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    creationSource: params.creationSource,
    codebaseIds: params.codebaseIds ?? [],
    contextSearchSpec: normalizeTaskContextSearchSpec(params.contextSearchSpec),
    jitContextSnapshot: normalizeTaskJitContextSnapshot(params.jitContextSnapshot),
    worktreeId: params.worktreeId,
    triggerSessionId: params.triggerSessionId,
    createdAt: now,
    updatedAt: now,
  };
}

function buildInitialTaskComments(comment: string | undefined, now: Date): TaskCommentEntry[] {
  const trimmed = comment?.trim();
  if (!trimmed) {
    return [];
  }

  return [{
    id: createTaskCommentId(),
    body: trimmed,
    createdAt: now.toISOString(),
    source: "legacy_import",
  }];
}

function createTaskCommentId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `comment-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function hydrateTaskComments(
  comments: TaskCommentEntry[] | undefined,
  legacyComment: string | undefined,
): TaskCommentEntry[] {
  if ((comments?.length ?? 0) > 0) {
    return comments ?? [];
  }

  return splitLegacyTaskComment(legacyComment);
}

export function splitLegacyTaskComment(comment: string | undefined): TaskCommentEntry[] {
  const trimmed = comment?.trim();
  if (!trimmed) {
    return [];
  }

  return [{
    id: "legacy-comment-1",
    body: trimmed,
    createdAt: "",
    source: "legacy_import",
  }];
}
