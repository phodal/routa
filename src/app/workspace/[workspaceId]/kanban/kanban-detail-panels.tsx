"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AcpTaskAdaptiveHarnessOptions } from "@/client/acp-client";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { desktopAwareFetch, toErrorMessage } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";
import type {
  TaskAdaptiveHarnessPack,
  TaskAdaptiveHistorySummary,
  TaskAdaptiveMatchedFileDetail,
} from "@/core/harness/task-adaptive";
import {
  normalizeTaskJitContextAnalysis,
  normalizeTaskContextSearchSpec,
  type TaskContextSearchSpec,
  type TaskJitContextSnapshot,
} from "@/core/models/task";
import type { TaskInfo } from "../types";
import {
  buildKanbanTaskAdaptiveHarnessOptions,
  hasConfirmedKanbanTaskAdaptiveContext,
} from "./kanban-task-adaptive";
import { mergeTaskLaneExperienceIntoJitSnapshot } from "@/core/kanban/task-lane-experience";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";

function formatTimestamp(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleString();
}

function formatReadinessFieldLabel(field: string, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (field) {
    case "scope":
      return t.kanbanDetail.scope;
    case "acceptance_criteria":
      return t.kanbanDetail.acceptanceCriteria;
    case "verification_commands":
      return t.kanbanDetail.verificationCommands;
    case "test_cases":
      return t.kanbanDetail.testCases;
    case "verification_plan":
      return t.kanbanDetail.verificationPlan;
    case "dependencies_declared":
      return t.kanbanDetail.dependenciesDeclared;
    default:
      return field;
  }
}

function formatCheckStatus(value: boolean, t: ReturnType<typeof useTranslation>["t"]): string {
  return value ? t.kanbanDetail.present : t.kanbanDetail.missing;
}

function formatAnalysisStatus(value: string, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (value) {
    case "pass":
      return t.kanbanDetail.pass;
    case "warning":
      return t.kanbanDetail.warning;
    case "fail":
      return t.kanbanDetail.fail;
    default:
      return value.toUpperCase();
  }
}

function formatVerificationVerdictLabel(
  verdict: string | undefined,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (verdict) {
    case "NOT_APPROVED":
      return t.kanbanDetail.reviewRequestedChanges;
    case "BLOCKED":
      return t.kanbanDetail.reviewBlockedVerdict;
    case "APPROVED":
      return t.kanbanDetail.reviewApprovedVerdict;
    default:
      return t.kanbanDetail.reviewFeedback;
  }
}

function hasTaskAdaptiveSearchHints(options: AcpTaskAdaptiveHarnessOptions | undefined): boolean {
  if (!options) {
    return false;
  }

  return Boolean(
    options.query?.trim()
    || options.featureId?.trim()
    || (options.featureIds?.length ?? 0) > 0
    || (options.filePaths?.length ?? 0) > 0
    || (options.routeCandidates?.length ?? 0) > 0
    || (options.apiCandidates?.length ?? 0) > 0
    || (options.historySessionIds?.length ?? 0) > 0
    || (options.moduleHints?.length ?? 0) > 0
    || (options.symptomHints?.length ?? 0) > 0
  );
}

function getMatchedFileDetails(pack: TaskAdaptiveHarnessPack | null): TaskAdaptiveMatchedFileDetail[] {
  if (!pack) {
    return [];
  }

  if ((pack.matchedFileDetails?.length ?? 0) > 0) {
    return pack.matchedFileDetails;
  }

  return (pack.selectedFiles ?? []).map((filePath) => ({
    filePath,
    changes: 0,
    sessions: 0,
    updatedAt: "",
  }));
}

function packFromTaskJitContextSnapshot(snapshot: TaskJitContextSnapshot | undefined): TaskAdaptiveHarnessPack | null {
  if (!snapshot) {
    return null;
  }

  return {
    summary: snapshot.summary,
    historySummary: snapshot.historySummary as TaskAdaptiveHistorySummary | undefined,
    warnings: snapshot.warnings,
    featureId: snapshot.featureId,
    featureName: snapshot.featureName,
    matchConfidence: snapshot.matchConfidence,
    matchReasons: snapshot.matchReasons,
    selectedFiles: snapshot.matchedFileDetails.map((detail) => detail.filePath),
    matchedFileDetails: snapshot.matchedFileDetails,
    matchedSessionIds: snapshot.matchedSessionIds,
    failures: snapshot.failures.map((failure) => ({
      ...failure,
      provider: failure.provider ?? "unknown",
    })),
    repeatedReadFiles: snapshot.repeatedReadFiles,
    sessions: snapshot.sessions.map((session) => ({
      ...session,
      provider: session.provider ?? "unknown",
      failedReadSignals: session.failedReadSignals.map((failure) => ({
        ...failure,
        provider: failure.provider ?? session.provider ?? "unknown",
      })),
    })),
    frictionProfiles: [],
  };
}

function buildRecommendedContextSearchSpec(
  task: TaskInfo,
  harnessOptions: AcpTaskAdaptiveHarnessOptions,
  pack: TaskAdaptiveHarnessPack,
): TaskContextSearchSpec | undefined {
  const analysisRecommendation = task.jitContextSnapshot?.analysis?.recommendedContextSearchSpec;
  const next = normalizeTaskContextSearchSpec({
    query: task.contextSearchSpec?.query ?? analysisRecommendation?.query ?? harnessOptions.query ?? task.title,
    featureCandidates: uniquePreserveOrder([
      ...(task.contextSearchSpec?.featureCandidates ?? []),
      ...(analysisRecommendation?.featureCandidates ?? []),
      ...(pack.featureId ? [pack.featureId] : []),
      ...(harnessOptions.featureIds ?? []),
    ]).slice(0, 4),
    relatedFiles: uniquePreserveOrder([
      ...(analysisRecommendation?.relatedFiles ?? []),
      ...getMatchedFileDetails(pack).map((detail) => detail.filePath),
    ]).slice(0, 12),
    routeCandidates: uniquePreserveOrder([
      ...(task.contextSearchSpec?.routeCandidates ?? []),
      ...(analysisRecommendation?.routeCandidates ?? []),
      ...(harnessOptions.routeCandidates ?? []),
    ]),
    apiCandidates: uniquePreserveOrder([
      ...(task.contextSearchSpec?.apiCandidates ?? []),
      ...(analysisRecommendation?.apiCandidates ?? []),
      ...(harnessOptions.apiCandidates ?? []),
    ]),
    moduleHints: uniquePreserveOrder([
      ...(task.contextSearchSpec?.moduleHints ?? []),
      ...(analysisRecommendation?.moduleHints ?? []),
      ...(harnessOptions.moduleHints ?? []),
    ]),
    symptomHints: uniquePreserveOrder([
      ...(task.contextSearchSpec?.symptomHints ?? []),
      ...(analysisRecommendation?.symptomHints ?? []),
      ...(harnessOptions.symptomHints ?? []),
    ]),
  });

  return next;
}

function buildTaskJitContextSnapshot(
  task: TaskInfo,
  repoPath: string | null | undefined,
  harnessOptions: AcpTaskAdaptiveHarnessOptions,
  pack: TaskAdaptiveHarnessPack,
): TaskJitContextSnapshot {
  const matchReasons = uniquePreserveOrder(pack.matchReasons ?? []);
  const warnings = uniquePreserveOrder(pack.warnings ?? []);
  const matchedSessionIds = uniquePreserveOrder(pack.matchedSessionIds ?? []);
  const failures = uniqueFailureSignals(pack.failures ?? []);
  const repeatedReadFiles = uniquePreserveOrder(pack.repeatedReadFiles ?? []);
  const sessions = pack.sessions ?? [];

  const snapshot: TaskJitContextSnapshot = {
    generatedAt: new Date().toISOString(),
    repoPath: repoPath ?? undefined,
    featureId: pack.featureId,
    featureName: pack.featureName,
    summary: pack.summary,
    matchConfidence: pack.matchConfidence ?? "low",
    matchReasons,
    warnings,
    matchedFileDetails: getMatchedFileDetails(pack),
    matchedSessionIds,
    failures,
    repeatedReadFiles,
    sessions: sessions.map((session) => ({
      provider: session.provider,
      sessionId: session.sessionId,
      updatedAt: session.updatedAt,
      promptSnippet: session.promptSnippet,
      matchedFiles: uniquePreserveOrder(session.matchedFiles),
      matchedChangedFiles: uniquePreserveOrder(session.matchedChangedFiles),
      matchedReadFiles: uniquePreserveOrder(session.matchedReadFiles),
      matchedWrittenFiles: uniquePreserveOrder(session.matchedWrittenFiles),
      repeatedReadFiles: uniquePreserveOrder(session.repeatedReadFiles),
      toolNames: uniquePreserveOrder(session.toolNames),
      failedReadSignals: uniqueFailureSignals(session.failedReadSignals),
      resumeCommand: session.resumeCommand,
    })),
    historySummary: pack.historySummary
      ? {
          overview: pack.historySummary.overview,
          seedSessionCount: pack.historySummary.seedSessionCount,
          recoveredSessionCount: pack.historySummary.recoveredSessionCount,
          matchedFileCount: pack.historySummary.matchedFileCount,
          seedSessions: (pack.historySummary.seedSessions ?? []).map((session) => ({
            provider: session.provider,
            sessionId: session.sessionId,
            updatedAt: session.updatedAt,
            promptSnippet: session.promptSnippet,
            touchedFiles: uniquePreserveOrder(session.touchedFiles),
            repeatedReadFiles: uniquePreserveOrder(session.repeatedReadFiles),
            toolNames: uniquePreserveOrder(session.toolNames),
            failedReadSignals: uniqueFailureSignals(session.failedReadSignals),
          })),
        }
      : undefined,
    recommendedContextSearchSpec: buildRecommendedContextSearchSpec(task, harnessOptions, pack),
    analysis: normalizeTaskJitContextAnalysis(task.jitContextSnapshot?.analysis),
    perLaneAnalysis: task.jitContextSnapshot?.perLaneAnalysis,
  };

  return mergeTaskLaneExperienceIntoJitSnapshot({
    laneSessions: task.laneSessions ?? [],
    laneHandoffs: task.laneHandoffs ?? [],
    id: task.id,
    title: task.title,
    objective: task.objective,
    columnId: task.columnId,
    contextSearchSpec: task.contextSearchSpec,
    jitContextSnapshot: snapshot,
  }) ?? snapshot;
}

function formatMatchConfidenceLabel(
  confidence: TaskAdaptiveHarnessPack["matchConfidence"] | undefined,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (confidence) {
    case "high":
      return t.kanbanDetail.matchConfidenceHigh;
    case "medium":
      return t.kanbanDetail.matchConfidenceMedium;
    case "low":
    default:
      return t.kanbanDetail.matchConfidenceLow;
  }
}

function formatMatchedFileSeed(fileDetail: TaskAdaptiveMatchedFileDetail): string {
  const stats: string[] = [];
  if (fileDetail.changes > 0) {
    stats.push(`changes ${fileDetail.changes}`);
  }
  if (fileDetail.sessions > 0) {
    stats.push(`sessions ${fileDetail.sessions}`);
  }
  return stats.length > 0 ? `${fileDetail.filePath} (${stats.join(", ")})` : fileDetail.filePath;
}

function uniquePreserveOrder(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatBulletList(items: string[], emptyFallback: string): string {
  if (items.length === 0) {
    return `- ${emptyFallback}`;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function formatOrderedList(items: string[], emptyFallback: string): string {
  if (items.length === 0) {
    return `- ${emptyFallback}`;
  }

  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function buildTranscriptHints(sessionIds: string[]): string[] {
  return uniquePreserveOrder(sessionIds.map((sessionId) => `~/.codex/sessions/**/${sessionId}*.jsonl`));
}

function uniqueFailureSignals(failures: TaskAdaptiveHarnessPack["failures"]): TaskAdaptiveHarnessPack["failures"] {
  const seen = new Set<string>();
  const result: TaskAdaptiveHarnessPack["failures"] = [];

  for (const failure of failures ?? []) {
    const key = [failure.sessionId, failure.toolName, failure.command ?? "", failure.message].join("\u0000");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(failure);
  }

  return result;
}

function resolveHistoryAnalysisSessionIds(
  pack: TaskAdaptiveHarnessPack,
  fallback: string[] | undefined,
): string[] | undefined {
  const matchedTranscriptSessionIds = pack.sessions
    .map((session) => session.sessionId)
    .filter((sessionId) => sessionId.trim().length > 0);
  if (matchedTranscriptSessionIds.length > 0) {
    return matchedTranscriptSessionIds;
  }

  const summarizedSeedSessionIds = (pack.historySummary?.seedSessions ?? [])
    .map((session) => session.sessionId)
    .filter((sessionId) => sessionId.trim().length > 0);
  if (summarizedSeedSessionIds.length > 0) {
    return summarizedSeedSessionIds;
  }

  return fallback;
}

type PreloadedTaskHistorySummaryResult = {
  historySummary: TaskAdaptiveHistorySummary | null;
  featureId?: string;
  featureName?: string;
  selectedFiles: string[];
  matchedFileDetails: TaskAdaptiveMatchedFileDetail[];
  matchedSessionIds: string[];
  warnings: string[];
};

function buildJitContextSessionPrompt(
  task: TaskInfo,
  pack: TaskAdaptiveHarnessPack,
  matchedFileDetails: TaskAdaptiveMatchedFileDetail[],
  specialistLanguage: KanbanSpecialistLanguage,
): string {
  const fileLines = matchedFileDetails.slice(0, 8).map((fileDetail, index) => `${index + 1}. ${formatMatchedFileSeed(fileDetail)}`);
  const warningLines = pack.warnings.slice(0, 3).map((warning) => `- ${warning}`);
  const failureLines = pack.failures.slice(0, 3).map((failure) => `- ${failure.message} [${failure.toolName}] (${failure.sessionId})`);
  const repeatedReadLines = pack.repeatedReadFiles.slice(0, 5).map((filePath) => `- ${filePath}`);
  const sessionLines = (pack.sessions.length > 0 ? pack.sessions : pack.historySummary?.seedSessions ?? [])
    .slice(0, 3)
    .map((session) => `- ${session.sessionId}: ${session.promptSnippet}`);
  const historySummary = pack.historySummary?.overview?.trim() || pack.summary;

  if (specialistLanguage === "zh-CN") {
    return [
      "继续当前 Kanban 卡片，不要复述下面的上下文，把它当作阅读和排查线索直接使用。",
      "",
      "卡片上下文：",
      `- 标题：${task.title}`,
      task.objective ? `- 目标：${task.objective}` : null,
      pack.featureName || pack.featureId ? `- 命中功能：${pack.featureName ?? pack.featureId}` : null,
      historySummary ? `- History Summary：${historySummary}` : null,
      "",
      fileLines.length > 0 ? "优先阅读文件：" : null,
      ...fileLines,
      "",
      warningLines.length > 0 ? "检索警告：" : null,
      ...warningLines,
      "",
      failureLines.length > 0 ? "历史问题：" : null,
      ...failureLines,
      "",
      repeatedReadLines.length > 0 ? "重复读取热点：" : null,
      ...repeatedReadLines,
      "",
      sessionLines.length > 0 ? "优先看的命中会话：" : null,
      ...sessionLines,
      "",
      "下一步：先阅读优先文件，再继续当前卡片最小的下一步实现、修复或验证动作。",
    ].filter(Boolean).join("\n");
  }

  return [
    "Continue the current Kanban card. Do not summarize the context back; use it as a reading and debugging seed.",
    "",
    "Card context:",
    `- Title: ${task.title}`,
    task.objective ? `- Objective: ${task.objective}` : null,
    pack.featureName || pack.featureId ? `- Matched feature: ${pack.featureName ?? pack.featureId}` : null,
    historySummary ? `- History summary: ${historySummary}` : null,
    "",
    fileLines.length > 0 ? "Read these files first:" : null,
    ...fileLines,
    "",
    warningLines.length > 0 ? "Retrieval warnings:" : null,
    ...warningLines,
    "",
    failureLines.length > 0 ? "Historical friction:" : null,
    ...failureLines,
    "",
    repeatedReadLines.length > 0 ? "Repeated-read hotspots:" : null,
    ...repeatedReadLines,
    "",
    sessionLines.length > 0 ? "Start from these matched history sessions:" : null,
    ...sessionLines,
    "",
    "Next: inspect the priority files first, then continue with the smallest useful implementation, debugging, or verification step for this card.",
  ].filter(Boolean).join("\n");
}

function buildHistorySummaryToolArgs(
  workspaceId: string | undefined,
  repoPath: string | null | undefined,
  harnessOptions: AcpTaskAdaptiveHarnessOptions,
): Record<string, unknown> {
  const toolArgs: Record<string, unknown> = {};

  if (workspaceId?.trim()) {
    toolArgs.workspaceId = workspaceId.trim();
  }
  if (repoPath?.trim()) {
    toolArgs.repoPath = repoPath.trim();
  }
  if (harnessOptions.taskLabel?.trim()) {
    toolArgs.taskLabel = harnessOptions.taskLabel.trim();
  }
  if (harnessOptions.locale?.trim()) {
    toolArgs.locale = harnessOptions.locale.trim();
  }
  if (harnessOptions.query?.trim()) {
    toolArgs.query = harnessOptions.query.trim();
  }
  if (harnessOptions.featureId?.trim()) {
    toolArgs.featureId = harnessOptions.featureId.trim();
  }
  if ((harnessOptions.featureIds?.length ?? 0) > 0) {
    toolArgs.featureIds = [...(harnessOptions.featureIds ?? [])];
  }
  if ((harnessOptions.filePaths?.length ?? 0) > 0) {
    toolArgs.filePaths = [...(harnessOptions.filePaths ?? [])];
  }
  if ((harnessOptions.routeCandidates?.length ?? 0) > 0) {
    toolArgs.routeCandidates = [...(harnessOptions.routeCandidates ?? [])];
  }
  if ((harnessOptions.apiCandidates?.length ?? 0) > 0) {
    toolArgs.apiCandidates = [...(harnessOptions.apiCandidates ?? [])];
  }
  if ((harnessOptions.historySessionIds?.length ?? 0) > 0) {
    toolArgs.historySessionIds = [...(harnessOptions.historySessionIds ?? [])];
  }
  if ((harnessOptions.moduleHints?.length ?? 0) > 0) {
    toolArgs.moduleHints = [...(harnessOptions.moduleHints ?? [])];
  }
  if ((harnessOptions.symptomHints?.length ?? 0) > 0) {
    toolArgs.symptomHints = [...(harnessOptions.symptomHints ?? [])];
  }
  if (harnessOptions.taskType) {
    toolArgs.taskType = harnessOptions.taskType;
  }
  if (typeof harnessOptions.maxFiles === "number") {
    toolArgs.maxFiles = harnessOptions.maxFiles;
  }
  if (typeof harnessOptions.maxSessions === "number") {
    toolArgs.maxSessions = harnessOptions.maxSessions;
  }
  if (harnessOptions.role?.trim()) {
    toolArgs.role = harnessOptions.role.trim();
  }

  return toolArgs;
}

function buildJitHistoryAnalysisPrompt(
  task: TaskInfo,
  pack: TaskAdaptiveHarnessPack,
  matchedFileDetails: TaskAdaptiveMatchedFileDetail[],
  specialistLanguage: KanbanSpecialistLanguage,
  toolArgs: Record<string, unknown>,
  preloadedSummary: PreloadedTaskHistorySummaryResult,
): string {
  const historySummary = preloadedSummary.historySummary?.overview?.trim()
    || pack.historySummary?.overview?.trim()
    || pack.summary.trim();
  const historySummaryData = preloadedSummary.historySummary ?? pack.historySummary;
  const featureLine = pack.featureName ?? pack.featureId;
  const fileSeedLines = matchedFileDetails
    .slice(0, 8)
    .map((fileDetail) => formatMatchedFileSeed(fileDetail));
  const matchedSessions = pack.sessions.slice(0, 6);
  const matchedSessionLines = matchedSessions
    .slice(0, 5)
    .map((session) => [
      `${session.sessionId} [${session.provider}]`,
      `   - Prompt: ${session.promptSnippet}`,
      `   - Matched files: ${
        session.matchedFiles.length > 0
          ? session.matchedFiles.join(", ")
          : session.matchedReadFiles.length > 0
            ? session.matchedReadFiles.join(", ")
            : "None"
      }`,
    ].join("\n"));
  const seedSessionLines = (historySummaryData?.seedSessions ?? [])
    .slice(0, 5)
    .map((session) => [
      `${session.sessionId} [${session.provider}]`,
      `   - Prompt: ${session.promptSnippet}`,
      `   - Touched files: ${session.touchedFiles.length > 0 ? session.touchedFiles.join(", ") : "None"}`,
    ].join("\n"));
  const transcriptHints = buildTranscriptHints(
    matchedSessions.length > 0
      ? matchedSessions.map((session) => session.sessionId)
      : preloadedSummary.matchedSessionIds,
  );
  const warningLines = pack.warnings.slice(0, 4);
  const reasonLines = pack.matchReasons.slice(0, 4);
  const failureLines = pack.failures
    .slice(0, 4)
    .map((failure) => `${failure.message} [${failure.toolName}] (${failure.sessionId})`);
  const repeatedReadLines = pack.repeatedReadFiles.slice(0, 4);
  const workspaceLabel = typeof toolArgs.workspaceId === "string" ? toolArgs.workspaceId : null;
  const repoPathLabel = typeof toolArgs.repoPath === "string" ? toolArgs.repoPath : null;
  const taskTypeLabel = typeof toolArgs.taskType === "string" ? toolArgs.taskType : null;
  const retrievalSummaryZh = [
    `- 预执行工具: summarize_task_history_context`,
    featureLine ? `- 当前命中功能: ${featureLine}` : null,
    `- 命中置信度: ${pack.matchConfidence}`,
    historySummaryData ? `- 种子会话数: ${historySummaryData.seedSessionCount}` : null,
    historySummaryData ? `- 最终命中会话数: ${historySummaryData.recoveredSessionCount}` : null,
    `- 候选文件数: ${matchedFileDetails.length}`,
  ].filter(Boolean) as string[];
  const retrievalSummaryEn = [
    "- Preloaded tool: summarize_task_history_context",
    featureLine ? `- Current matched feature: ${featureLine}` : null,
    `- Match confidence: ${pack.matchConfidence}`,
    historySummaryData ? `- Seed sessions: ${historySummaryData.seedSessionCount}` : null,
    historySummaryData ? `- Recovered matched sessions: ${historySummaryData.recoveredSessionCount}` : null,
    `- Candidate files: ${matchedFileDetails.length}`,
  ].filter(Boolean) as string[];

  if (specialistLanguage === "zh-CN") {
    return [
      "请对这张 Kanban 卡片的历史实现线索做一次只读复盘，目标是压缩上下文、指出最值得继续深挖的历史证据，并把结构化结论保存回当前卡片。",
      "",
      "必须执行的工作流：",
      "1. 先区分“种子会话”和“最终命中会话”，不要把所有历史 session 当成同等证据。",
      "2. 先基于下面已经预加载的摘要证据做综合分析，再决定是否需要回读少量 transcript JSONL。",
      "3. 优先解释这些命中会话和候选文件，到底为当前 story 提供了什么上下文，而不是复述 transcript。",
      "4. 只产出下次还要复用的结果，不要把过程性拆分、推理链和 UI 已经展示的数据再保存一遍。",
      "5. 调用 `save_history_memory_context`，把下次还要复用的 task-adaptive history memory 结果保存到当前任务。",
      "6. 保存成功后，只用简短回复确认你保存了哪些高价值结论；不要再输出一整段 JSON。",
      "",
      "保存动作：",
      "- 直接调用 `save_history_memory_context`，不要在聊天里回显整段 payload。",
      `- tool 参数里的 \`taskId\` 固定为 \`${task.id}\`。`,
      "- 只保存这些字段：`summary`、`topFiles`、`topSessions`、`reusablePrompts`、`recommendedContextSearchSpec`；`updatedAt` 可选。",
      "- `topSessions` 的每一项只需要 `sessionId`、可选 `provider`、以及 1 句 `reason`。",
      "- `recommendedContextSearchSpec` 只在必要时填写 `query`、`featureCandidates`、`relatedFiles`、`routeCandidates`、`apiCandidates`、`moduleHints`、`symptomHints`。",
      "",
      "补充规则：",
      "- `summary` 最多 2 句：第一句说“下次先看什么”，第二句说“主要风险或判断点是什么”。",
      "- `summary` 不要写成复盘报告，不要用“历史上下文已稳定收敛到”“真正高价值入口不是”“不要重扫整个仓库”这类过重表述。",
      "- `topSessions` 优先放最终命中的 Codex/Claude 会话，而不是泛泛的 ACP 会话。",
      "- `topSessions.reason` 控制在 1 句内，先说覆盖的文件/契约，再说用途。",
      "- `reusablePrompts` 必须是可以直接粘贴给下一轮 agent 的祈使句，不要写解释性 prose。",
      "- `recommendedContextSearchSpec` 只保留下一次 JIT 检索真正需要复用的高信号 hints。",
      "- 如果某个字段没有内容，用空数组；不要保存过程性问题分类、证据列表或推理链。",
      "",
      "上下文：",
      `- Task ID: ${task.id}`,
      `- 标题：${task.title}`,
      task.objective ? `- 目标：${task.objective}` : null,
      workspaceLabel ? `- Workspace: ${workspaceLabel}` : null,
      repoPathLabel ? `- Repo Path: ${repoPathLabel}` : null,
      taskTypeLabel ? `- Task Type: ${taskTypeLabel}` : null,
      "",
      "### 检索总览",
      ...retrievalSummaryZh,
      "",
      historySummary ? "### 预加载 History Summary" : null,
      historySummary || null,
      "",
      "### 当前候选文件",
      formatOrderedList(fileSeedLines, "无"),
      "",
      "### 最终命中的 Codex/Claude 会话",
      formatOrderedList(matchedSessionLines, "无"),
      "",
      "### 种子会话（弱一些的上游线索）",
      formatOrderedList(seedSessionLines, "无"),
      "",
      "### Transcript Hints（可选：仅在摘要不足、需要恢复真实开场或确认范围漂移时，优先少量读取高相关 JSONL）",
      formatBulletList(transcriptHints, "无"),
      "",
      "### 命中原因",
      formatBulletList(reasonLines, "无额外命中原因"),
      "",
      "### 检索警告",
      formatBulletList(warningLines, "无"),
      "",
      "### 历史问题",
      formatBulletList(failureLines, "没有额外的高信号历史问题"),
      "",
      "### 重复读取热点",
      formatBulletList(repeatedReadLines, "没有额外的重复读取热点"),
      "",
      "除非你需要用不同 hints 刷新结果，否则不要再次调用 `summarize_task_history_context`。",
      "除非上面的摘要证据明显不足，否则不要回读 task 上挂着的全部 ACP 会话。",
    ].filter(Boolean).join("\n");
  }

  return [
    "Run a read-only retrospective on the history signals for this Kanban card. The goal is to compress context, surface the strongest evidence, and save a structured result back to the task.",
    "",
    "Required workflow:",
    "1. Distinguish retrieval seed sessions from the final matched sessions. Do not treat every historical session as equally trustworthy.",
    "2. Start from the preloaded summary evidence below before deciding whether any transcript rereads are necessary.",
    "3. Explain what the matched sessions and files contribute to the current story instead of replaying transcripts.",
    "4. Save only the reusable result, not the process breakdown or reasoning chain already visible in the UI.",
    "5. Call `save_history_memory_context` and persist the reusable task-adaptive history memory result to the current task.",
    "6. After the save succeeds, reply with a short confirmation of the highest-value items you saved. Do not dump the full JSON again.",
    "",
    "Save action:",
    "- Call `save_history_memory_context` directly instead of pasting the payload into chat.",
    `- Use \`taskId=${task.id}\` in the tool call.`,
    "- Save only these fields: `summary`, `topFiles`, `topSessions`, `reusablePrompts`, and `recommendedContextSearchSpec`. `updatedAt` is optional.",
    "- Each `topSessions` item only needs `sessionId`, optional `provider`, and a one-sentence `reason`.",
    "- Only include `query`, `featureCandidates`, `relatedFiles`, `routeCandidates`, `apiCandidates`, `moduleHints`, and `symptomHints` in `recommendedContextSearchSpec` when they add real reuse value.",
    "",
    "Extra rules:",
    "- Keep `summary` to 2 sentences max: sentence one says what to inspect first next time, sentence two says the main risk or decision point.",
    "- Do not write `summary` like a retrospective report. Avoid meta phrasing such as \"the history converged\", \"the real high-value entry point is\", or \"do not rescan the repo\".",
    "- Prefer final matched Codex/Claude sessions in `topSessions` instead of generic ACP sessions.",
    "- Keep `topSessions.reason` to one sentence: covered files/contracts first, then why it matters.",
    "- Make `reusablePrompts` imperative and immediately reusable by the next agent.",
    "- Keep `recommendedContextSearchSpec` focused on the small set of hints that should survive into the next JIT retrieval.",
    "- If a field has no content, send an empty array instead of removing the field entirely.",
    "- Do not save process-only categories, evidence lists, or reasoning traces.",
    "",
    "Context:",
    `- Task ID: ${task.id}`,
    `- Title: ${task.title}`,
    task.objective ? `- Objective: ${task.objective}` : null,
    workspaceLabel ? `- Workspace: ${workspaceLabel}` : null,
    repoPathLabel ? `- Repo Path: ${repoPathLabel}` : null,
    taskTypeLabel ? `- Task Type: ${taskTypeLabel}` : null,
    "",
    "### Retrieval Summary",
    ...retrievalSummaryEn,
      "",
    historySummary ? "### Preloaded History Summary" : null,
    historySummary || null,
      "",
    "### Candidate Files",
    formatOrderedList(fileSeedLines, "None"),
      "",
    "### Final Matched Codex Or Claude Sessions",
    formatOrderedList(matchedSessionLines, "None"),
      "",
    "### Seed Sessions (weaker upstream evidence)",
    formatOrderedList(seedSessionLines, "None"),
      "",
    "### Transcript Hints (optional: only inspect a few high-relevance JSONL files if the summary is insufficient or you need the true opening request)",
    formatBulletList(transcriptHints, "None"),
      "",
    "### Match Reasons",
    formatBulletList(reasonLines, "No additional match reasons"),
      "",
    "### Retrieval Warnings",
    formatBulletList(warningLines, "None"),
    "",
    "### Historical Friction",
    formatBulletList(failureLines, "No additional high-signal historical friction"),
    "",
    "### Repeated-Read Hotspots",
    formatBulletList(repeatedReadLines, "No additional repeated-read hotspots"),
    "",
    "Do not call `summarize_task_history_context` again unless you need to refresh the result with different hints.",
    "Do not reread every linked ACP session end to end unless the summary is clearly insufficient.",
  ].filter(Boolean).join("\n");
}

function SummaryGridItem({
  label,
  value,
  detail,
  compact = false,
}: {
  label: string;
  value: string;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <div className="space-y-0.5 border-b border-slate-200/70 px-1.5 py-1.5 text-sm dark:border-slate-700/60">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className="font-medium text-slate-900 dark:text-slate-100">{value}</div>
      {detail && !compact && (
        <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</div>
      )}
    </div>
  );
}

export function StoryReadinessPanel({
  task,
  compact = false,
}: {
  task: TaskInfo;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const readiness = task.storyReadiness;
  const investValidation = task.investValidation;
  const readinessChecks = readiness?.checks;
  const investChecks = investValidation?.checks;
  const requiredLabels = readiness?.requiredTaskFields.map((field) => formatReadinessFieldLabel(field, t)) ?? [];
  const missingLabels = readiness?.missing.map((field) => formatReadinessFieldLabel(field, t)) ?? [];

  return (
    <div className="space-y-3">
      <div className={`border-l-2 px-3 py-2.5 ${
        readiness?.ready
          ? "border-l-emerald-400/80 dark:border-l-emerald-500/70"
          : "border-l-amber-400/80 dark:border-l-amber-500/70"
      }`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            readiness?.ready
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
          }`}>
            {readiness?.ready ? t.kanbanDetail.readyForDev : t.kanbanDetail.blockedForDev}
          </span>
          <span className="text-xs text-slate-600 dark:text-slate-300">
            {requiredLabels.length > 0
              ? `${t.kanbanDetail.requiredForNextMove}: ${requiredLabels.join(", ")}`
              : t.kanbanDetail.gateNotConfigured}
          </span>
        </div>
        <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
          {missingLabels.length > 0
            ? `${t.kanbanDetail.missingFields}: ${missingLabels.join(", ")}`
            : t.kanbanDetail.allRequiredFields}
        </div>
      </div>

      {readinessChecks && (
        <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-3"}`}>
          <SummaryGridItem
            label={t.kanbanDetail.scope}
            value={formatCheckStatus(readinessChecks.scope, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.acceptanceCriteria}
            value={formatCheckStatus(readinessChecks.acceptanceCriteria, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.verificationCommands}
            value={formatCheckStatus(readinessChecks.verificationCommands, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.testCases}
            value={formatCheckStatus(readinessChecks.testCases, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.verificationPlan}
            value={formatCheckStatus(readinessChecks.verificationPlan, t)}
            compact={compact}
          />
          <SummaryGridItem
            label={t.kanbanDetail.dependenciesDeclared}
            value={formatCheckStatus(readinessChecks.dependenciesDeclared, t)}
            compact={compact}
          />
        </div>
      )}

      {investValidation && investChecks && (
        <div className="space-y-2 border-t border-slate-200/70 pt-2 dark:border-slate-700/70">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {t.kanbanDetail.investSummary}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t.kanbanDetail.source}: {investValidation.source === "canonical_story"
                ? t.kanbanDetail.sourceCanonicalStory
                : t.kanbanDetail.sourceHeuristic}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t.kanbanDetail.overall}: {formatAnalysisStatus(investValidation.overallStatus, t)}
            </span>
          </div>
          <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-3"}`}>
            <SummaryGridItem
              label={t.kanbanDetail.investIndependent}
              value={formatAnalysisStatus(investChecks.independent.status, t)}
              detail={investChecks.independent.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investNegotiable}
              value={formatAnalysisStatus(investChecks.negotiable.status, t)}
              detail={investChecks.negotiable.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investValuable}
              value={formatAnalysisStatus(investChecks.valuable.status, t)}
              detail={investChecks.valuable.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investEstimable}
              value={formatAnalysisStatus(investChecks.estimable.status, t)}
              detail={investChecks.estimable.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investSmall}
              value={formatAnalysisStatus(investChecks.small.status, t)}
              detail={investChecks.small.reason}
              compact={compact}
            />
            <SummaryGridItem
              label={t.kanbanDetail.investTestable}
              value={formatAnalysisStatus(investChecks.testable.status, t)}
              detail={investChecks.testable.reason}
              compact={compact}
            />
          </div>
          {investValidation.issues.length > 0 && (
            <div className="mt-2 border-t border-amber-200/70 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/50 dark:text-amber-300">
              {investValidation.issues.join(" ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function EvidenceBundlePanel({
  task,
  compact = false,
}: {
  task: TaskInfo;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const evidence = task.evidenceSummary;
  if (!evidence) {
    return (
      <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        {t.kanbanDetail.noEvidenceSummary}
      </div>
    );
  }

  const reviewable = evidence.artifact.requiredSatisfied
    && (evidence.verification.hasReport || evidence.verification.hasVerdict || evidence.completion.hasSummary);
  const missingRequiredArtifacts = evidence.artifact.missingRequired ?? [];
  const missingRequired = missingRequiredArtifacts.length > 0
    ? missingRequiredArtifacts.join(", ")
    : t.kanbanDetail.none;
  const artifactBreakdown = Object.entries(evidence.artifact.byType)
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ") || t.kanbanDetail.none;

  return (
    <div className="space-y-3">
      <div className={`border-l-2 px-3 py-2.5 ${
        reviewable
          ? "border-l-emerald-400/80 dark:border-l-emerald-500/70"
          : "border-l-amber-400/80 dark:border-l-amber-500/70"
      }`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            reviewable
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
          }`}>
            {reviewable ? t.kanbanDetail.reviewable : t.kanbanDetail.reviewBlocked}
          </span>
          <span className="text-xs text-slate-600 dark:text-slate-300">
            {t.kanbanDetail.requiredArtifacts}: {missingRequired}
          </span>
        </div>
      </div>
      <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-3"}`}>
        <SummaryGridItem
          label={t.kanbanDetail.requiredArtifacts}
          value={`${evidence.artifact.total}`}
          detail={artifactBreakdown}
          compact={compact}
        />
        <SummaryGridItem
          label={t.kanbanDetail.verification}
          value={evidence.verification.verdict ?? formatCheckStatus(evidence.verification.hasVerdict, t)}
          detail={evidence.verification.hasReport ? t.kanbanDetail.reportPresent : t.kanbanDetail.reportMissing}
          compact={compact}
        />
        <SummaryGridItem
          label={t.kanbanDetail.completion}
          value={evidence.completion.hasSummary ? t.kanbanDetail.summaryPresent : t.kanbanDetail.summaryMissing}
          compact={compact}
        />
      </div>
    </div>
  );
}

export function ReviewFeedbackPanel({
  task,
  compact = false,
}: {
  task: TaskInfo;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const report = task.verificationReport?.trim();
  const verdict = task.verificationVerdict;

  if (!report && !verdict) {
    return (
      <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        {t.kanbanDetail.reportMissing}
      </div>
    );
  }

  const verdictLabel = formatVerificationVerdictLabel(verdict, t);
  const verdictTone = verdict === "BLOCKED"
    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200"
    : verdict === "APPROVED"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200";

  return (
    <div className="space-y-3">
      <div className={`border-l-2 px-3 py-2.5 ${
        verdict === "APPROVED"
          ? "border-l-emerald-400/80 dark:border-l-emerald-500/70"
          : verdict === "BLOCKED"
            ? "border-l-rose-400/80 dark:border-l-rose-500/70"
            : "border-l-amber-400/80 dark:border-l-amber-500/70"
      }`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${verdictTone}`}>
            {task.columnId === "dev" && verdict !== "APPROVED"
              ? t.kanbanDetail.reviewReturnedToDev
              : verdictLabel}
          </span>
          {verdict && (
            <span className="text-xs text-slate-600 dark:text-slate-300">
              {t.kanbanDetail.verification}: {verdictLabel}
            </span>
          )}
        </div>
      </div>
      {report ? (
        <div className={`border-b border-slate-200/70 text-sm text-slate-700 dark:border-slate-700/70 dark:text-slate-200 ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}>
          <MarkdownViewer
            content={report}
            className="prose prose-sm max-w-none text-slate-800 dark:prose-invert dark:text-slate-200"
          />
        </div>
      ) : (
        <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
          {t.kanbanDetail.reportMissing}
        </div>
      )}
    </div>
  );
}

export function JitContextPanel({
  task,
  workspaceId,
  repoPath,
  specialistLanguage,
  activeSessionId,
  onPatchTask,
  onLoadIntoSession,
  onOpenHistoryAnalysis,
  compact = false,
  showTitle = false,
}: {
  task: TaskInfo;
  workspaceId?: string;
  repoPath?: string | null;
  specialistLanguage: KanbanSpecialistLanguage;
  activeSessionId?: string | null;
  onPatchTask?: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onLoadIntoSession?: (sessionId: string, prompt: string) => Promise<void>;
  onOpenHistoryAnalysis?: (prompt: string, targetWindow: Window | null) => Promise<void>;
  compact?: boolean;
  showTitle?: boolean;
}) {
  const { t } = useTranslation();
  const hasConfirmedTaskAdaptiveContext = useMemo(
    () => hasConfirmedKanbanTaskAdaptiveContext(task),
    [task],
  );
  const savedAnalysis = task.jitContextSnapshot?.analysis;
  const hasSavedAnalysis = Boolean(savedAnalysis);
  const backlogNeedsRefinementFirst = task.columnId === "backlog" && !hasConfirmedTaskAdaptiveContext && !hasSavedAnalysis;
  const persistedPack = useMemo(
    () => (backlogNeedsRefinementFirst ? null : packFromTaskJitContextSnapshot(task.jitContextSnapshot)),
    [backlogNeedsRefinementFirst, task.jitContextSnapshot],
  );
  const [expanded, setExpanded] = useState(hasSavedAnalysis);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(Boolean(persistedPack));
  const [error, setError] = useState<string | null>(null);
  const [pack, setPack] = useState<TaskAdaptiveHarnessPack | null>(persistedPack);
  const [injecting, setInjecting] = useState(false);
  const [injectError, setInjectError] = useState<string | null>(null);
  const [injectSuccess, setInjectSuccess] = useState(false);
  const [openingAnalysis, setOpeningAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisSuccess, setAnalysisSuccess] = useState(false);
  const clearedSnapshotRef = useRef<string | null>(null);
  const harnessOptions = useMemo(
    () => buildKanbanTaskAdaptiveHarnessOptions(task.title, {
      locale: specialistLanguage,
      role: task.assignedRole,
      task,
    }),
    [specialistLanguage, task],
  );
  const canLoadContext = !backlogNeedsRefinementFirst && hasTaskAdaptiveSearchHints(harnessOptions);
  const uniqueFailures = useMemo(
    () => uniqueFailureSignals(pack?.failures ?? []),
    [pack?.failures],
  );
  const uniqueRepeatedReadFiles = useMemo(
    () => uniquePreserveOrder(pack?.repeatedReadFiles ?? []),
    [pack?.repeatedReadFiles],
  );
  const uniqueWarnings = useMemo(
    () => uniquePreserveOrder(pack?.warnings ?? []),
    [pack?.warnings],
  );
  const uniqueMatchReasons = useMemo(
    () => uniquePreserveOrder(pack?.matchReasons ?? []),
    [pack?.matchReasons],
  );
  const historicalIssueCount = uniqueFailures.length + uniqueRepeatedReadFiles.length;
  const historySummary = pack?.historySummary ?? null;
  const historySeedSessionCount = historySummary?.seedSessionCount ?? 0;
  const recoveredSessionCount = pack?.sessions.length ?? 0;
  const matchedFileDetails = getMatchedFileDetails(pack);
  const matchedFileCount = matchedFileDetails.length;
  const matchConfidence = pack?.matchConfidence ?? "low";
  const harnessSignature = useMemo(
    () => JSON.stringify(harnessOptions),
    [harnessOptions],
  );

  useEffect(() => {
    setExpanded(hasSavedAnalysis);
    setLoading(false);
    setLoaded(Boolean(persistedPack));
    setError(null);
    setPack(persistedPack);
    setInjecting(false);
    setInjectError(null);
    setInjectSuccess(false);
    setOpeningAnalysis(false);
    setAnalysisError(null);
    setAnalysisSuccess(false);
  }, [hasSavedAnalysis, harnessSignature, persistedPack, repoPath, workspaceId]);

  useEffect(() => {
    const staleSnapshotSignature = backlogNeedsRefinementFirst && task.jitContextSnapshot
      ? `${task.id}:${task.jitContextSnapshot.generatedAt ?? "unknown"}`
      : null;

    if (!staleSnapshotSignature) {
      clearedSnapshotRef.current = null;
      return;
    }
    if (!onPatchTask || clearedSnapshotRef.current === staleSnapshotSignature) {
      return;
    }

    clearedSnapshotRef.current = staleSnapshotSignature;
    void onPatchTask(task.id, { jitContextSnapshot: null }).catch(() => {
      if (clearedSnapshotRef.current === staleSnapshotSignature) {
        clearedSnapshotRef.current = null;
      }
    });
  }, [backlogNeedsRefinementFirst, onPatchTask, task.id, task.jitContextSnapshot]);

  const loadContext = async () => {
    if (loading) {
      return;
    }

    if (!workspaceId && !repoPath) {
      setPack(null);
      setLoaded(true);
      setError(t.kanbanDetail.jitContextUnavailable);
      return;
    }

    if (!canLoadContext) {
      setPack(null);
      setLoaded(true);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setInjectError(null);
    setInjectSuccess(false);
    setAnalysisError(null);
    setAnalysisSuccess(false);

    try {
      const response = await desktopAwareFetch("/api/harness/task-adaptive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          repoPath,
          taskAdaptiveHarness: harnessOptions,
        }),
      });
      const data = await response.json().catch(() => ({})) as TaskAdaptiveHarnessPack & { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(data.details ?? data.error ?? t.kanbanDetail.jitContextSearchFailed);
      }
      setPack(data);
      setLoaded(true);
      if (onPatchTask && !backlogNeedsRefinementFirst && harnessOptions) {
        const nextSnapshot = buildTaskJitContextSnapshot(task, repoPath, harnessOptions, data);
        const currentSnapshot = task.jitContextSnapshot;
        const nextSignature = JSON.stringify(nextSnapshot);
        const currentSignature = currentSnapshot ? JSON.stringify(currentSnapshot) : "";
        if (nextSignature !== currentSignature) {
          void onPatchTask(task.id, {
            jitContextSnapshot: nextSnapshot,
          }).catch(() => {});
        }
      }
    } catch (fetchError) {
      setPack(null);
      setLoaded(true);
      setError(toErrorMessage(fetchError));
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && !loaded) {
      void loadContext();
    }
  };

  const handleLoadIntoSession = async () => {
    if (!pack || !activeSessionId || !onLoadIntoSession || injecting) {
      return;
    }

    setInjecting(true);
    setInjectError(null);
    setInjectSuccess(false);

    try {
      await onLoadIntoSession(
        activeSessionId,
        buildJitContextSessionPrompt(task, pack, matchedFileDetails, specialistLanguage),
      );
      setInjectSuccess(true);
    } catch (sessionError) {
      setInjectError(toErrorMessage(sessionError));
    } finally {
      setInjecting(false);
    }
  };

  const handleOpenHistoryAnalysis = async () => {
    if (!pack || !harnessOptions || !onOpenHistoryAnalysis || openingAnalysis) {
      return;
    }

    const targetWindow = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    if (!targetWindow) {
      setAnalysisError(t.kanbanDetail.jitContextHistoryAnalysisPopupBlocked);
      setAnalysisSuccess(false);
      return;
    }

    setOpeningAnalysis(true);
    setAnalysisError(null);
    setAnalysisSuccess(false);

    try {
      const refreshedHarnessOptions: AcpTaskAdaptiveHarnessOptions = {
        ...harnessOptions,
        featureId: pack.featureId ?? harnessOptions.featureId,
        featureIds: pack.featureId
          ? [pack.featureId]
          : harnessOptions.featureIds,
        filePaths: matchedFileDetails.length > 0
          ? matchedFileDetails.map((fileDetail) => fileDetail.filePath)
          : harnessOptions.filePaths,
        historySessionIds: resolveHistoryAnalysisSessionIds(pack, harnessOptions.historySessionIds),
        maxFiles: matchedFileDetails.length > 0
          ? Math.max(harnessOptions.maxFiles ?? 0, matchedFileDetails.length)
          : harnessOptions.maxFiles,
        maxSessions: pack.sessions.length > 0
          ? Math.max(harnessOptions.maxSessions ?? 0, Math.min(pack.sessions.length, 6))
          : harnessOptions.maxSessions,
      };
      const toolArgs = buildHistorySummaryToolArgs(workspaceId, repoPath, refreshedHarnessOptions);
      const summaryResponse = await desktopAwareFetch("/api/harness/task-adaptive/history-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toolArgs),
      });
      const preloadedSummary = await summaryResponse.json().catch(() => ({})) as PreloadedTaskHistorySummaryResult & {
        error?: string;
        details?: string;
      };
      if (!summaryResponse.ok) {
        throw new Error(preloadedSummary.details ?? preloadedSummary.error ?? t.kanbanDetail.jitContextHistoryAnalysisFailed);
      }

      await onOpenHistoryAnalysis(
        buildJitHistoryAnalysisPrompt(
          task,
          pack,
          matchedFileDetails,
          specialistLanguage,
          toolArgs,
          preloadedSummary,
        ),
        targetWindow,
      );
      setAnalysisSuccess(true);
    } catch (sessionError) {
      try {
        targetWindow.close();
      } catch {
        // Ignore cleanup failures for browsers that already navigated/closed.
      }
      setAnalysisError(toErrorMessage(sessionError));
    } finally {
      setOpeningAnalysis(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 ${compact ? "px-3 py-2" : "px-3.5 py-2.5"} dark:border-slate-700/70 dark:bg-slate-900/20`}>
        <div className="space-y-1">
          {showTitle ? (
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {t.kanbanDetail.jitContext}
            </div>
          ) : null}
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {t.kanbanDetail.jitContextHint}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {loaded && pack ? (
              <>
                <span>{t.kanbanDetail.historicalIssues}: {historicalIssueCount}</span>
                <span>{t.kanbanDetail.historySeedSessions}: {historySeedSessionCount}</span>
                <span>{t.kanbanDetail.relatedSessions}: {recoveredSessionCount}</span>
                <span>{t.kanbanDetail.matchedFiles}: {matchedFileCount}</span>
              </>
            ) : hasSavedAnalysis && savedAnalysis ? (
              <>
                <span>{t.kanbanDetail.savedHistoryAnalysis}</span>
                <span>{t.kanbanDetail.analysisTopFiles}: {savedAnalysis.topFiles.length}</span>
                <span>{t.kanbanDetail.analysisTopSessions}: {savedAnalysis.topSessions.length}</span>
              </>
            ) : (
              <span>{backlogNeedsRefinementFirst ? t.kanbanDetail.jitContextNeedsRefinement : canLoadContext ? t.kanbanDetail.jitContextHint : t.kanbanDetail.jitContextNoHistorySessions}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {expanded && loaded && pack && onOpenHistoryAnalysis ? (
            <button
              type="button"
              onClick={() => {
                void handleOpenHistoryAnalysis();
              }}
              disabled={openingAnalysis}
              className="rounded-md border border-sky-200 px-2 py-1 text-[11px] font-medium text-sky-700 transition-colors hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-900/50 dark:text-sky-300 dark:hover:bg-sky-900/20"
            >
              {openingAnalysis ? t.kanbanDetail.openingJitContextHistoryAnalysis : t.kanbanDetail.openJitContextHistoryAnalysis}
            </button>
          ) : null}
          {expanded && loaded && pack && activeSessionId && onLoadIntoSession ? (
            <button
              type="button"
              onClick={() => {
                void handleLoadIntoSession();
              }}
              disabled={injecting}
              className="rounded-md border border-emerald-200 px-2 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-900/50 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
            >
              {injecting ? t.kanbanDetail.loadingJitContextIntoCurrentSession : t.kanbanDetail.loadJitContextIntoCurrentSession}
            </button>
          ) : null}
          {expanded && canLoadContext && loaded ? (
            <button
              type="button"
              onClick={() => {
                void loadContext();
              }}
              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t.kanbanDetail.refreshJitContext}
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleExpanded}
            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-expanded={expanded}
          >
            {expanded ? t.kanbanDetail.hideJitContext : t.kanbanDetail.showJitContext}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3">
          {analysisError ? (
            <div className="rounded-xl border border-rose-200/80 bg-rose-50/80 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/10 dark:text-rose-200">
              {analysisError}
            </div>
          ) : null}

          {analysisSuccess ? (
            <div className="rounded-xl border border-sky-200/80 bg-sky-50/80 px-3 py-2.5 text-sm text-sky-700 dark:border-sky-900/50 dark:bg-sky-900/10 dark:text-sky-200">
              {t.kanbanDetail.jitContextHistoryAnalysisOpened}
            </div>
          ) : null}

          {injectError ? (
            <div className="rounded-xl border border-rose-200/80 bg-rose-50/80 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/10 dark:text-rose-200">
              {injectError}
            </div>
          ) : null}

          {injectSuccess ? (
            <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/80 px-3 py-2.5 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/10 dark:text-emerald-200">
              {t.kanbanDetail.jitContextLoadedIntoCurrentSession}
            </div>
          ) : null}

          {savedAnalysis ? (
            <div className="rounded-xl border border-sky-200/80 bg-sky-50/70 px-3 py-2.5 dark:border-sky-900/50 dark:bg-sky-900/10">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">
                  {t.kanbanDetail.savedHistoryAnalysis}
                </div>
                {formatTimestamp(savedAnalysis.updatedAt) ? (
                  <span className="text-[11px] text-sky-700/80 dark:text-sky-200/80">
                    {t.kanbanDetail.updatedAt}: {formatTimestamp(savedAnalysis.updatedAt)}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
                {savedAnalysis.summary}
              </div>

              {savedAnalysis.topFiles.length > 0 ? (
                <div className="mt-3 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.analysisTopFiles}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {savedAnalysis.topFiles.map((filePath, index) => (
                      <span
                        key={`analysis-file:${index}:${filePath}`}
                        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300"
                      >
                        {filePath}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {savedAnalysis.topSessions.length > 0 ? (
                <div className="mt-3 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.analysisTopSessions}
                  </div>
                  <div className="space-y-2">
                    {savedAnalysis.topSessions.map((session, index) => (
                      <div
                        key={`analysis-session:${index}:${session.sessionId}`}
                        className="rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 dark:border-slate-700/70 dark:bg-slate-950/40"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                          <span>{session.sessionId}</span>
                          {session.provider ? (
                            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                              {session.provider}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                          {session.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {savedAnalysis.reusablePrompts.length > 0 ? (
                <div className="mt-3 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.analysisReusablePrompts}
                  </div>
                  <div className="space-y-2">
                    {savedAnalysis.reusablePrompts.map((prompt, index) => (
                      <div
                        key={`analysis-prompt:${index}:${prompt}`}
                        className="rounded-md bg-white/80 px-2 py-1.5 text-sm text-slate-700 dark:bg-slate-950/60 dark:text-slate-200"
                      >
                        {prompt}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {!hasSavedAnalysis && loading ? (
            <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
              {t.kanbanDetail.loadingJitContext}
            </div>
          ) : !hasSavedAnalysis && error ? (
            <div className="rounded-xl border border-rose-200/80 bg-rose-50/80 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/10 dark:text-rose-200">
              {error}
            </div>
          ) : !hasSavedAnalysis && backlogNeedsRefinementFirst ? (
            <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
              {t.kanbanDetail.jitContextNeedsRefinement}
            </div>
          ) : !hasSavedAnalysis && !canLoadContext ? (
            <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
              {t.kanbanDetail.jitContextNoHistorySessions}
            </div>
          ) : !hasSavedAnalysis && (!pack || (uniqueFailures.length === 0 && uniqueRepeatedReadFiles.length === 0 && pack.sessions.length === 0 && matchedFileDetails.length === 0 && uniqueWarnings.length === 0 && !pack.historySummary)) ? (
            <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
              {t.kanbanDetail.noJitContext}
            </div>
          ) : pack ? (
            <>
              {historySummary ? (
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.historySummary}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
                    {historySummary.overview}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{t.kanbanDetail.historySeedSessions}: {historySummary.seedSessionCount}</span>
                    <span>{t.kanbanDetail.relatedSessions}: {historySummary.recoveredSessionCount}</span>
                    <span>{t.kanbanDetail.matchedFiles}: {historySummary.matchedFileCount}</span>
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  {t.kanbanDetail.matchConfidence}
                </div>
                <div className="mt-2 inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200">
                  {formatMatchConfidenceLabel(matchConfidence, t)}
                </div>
                {uniqueMatchReasons.length > 0 ? (
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                      {t.kanbanDetail.matchReasons}
                    </div>
                    <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-200">
                      {uniqueMatchReasons.map((reason, index) => (
                        <div key={`${reason}:${index}`}>{reason}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {historySummary && historySummary.seedSessions.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.historySeedSessions}
                  </div>
                  <div className="space-y-2">
                    {historySummary.seedSessions.map((session) => (
                      <div
                        key={`seed:${session.sessionId}`}
                        className="rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                          <span>{session.sessionId}</span>
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            {session.provider}
                          </span>
                          {formatTimestamp(session.updatedAt) ? (
                            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                              {formatTimestamp(session.updatedAt)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                          {session.promptSnippet}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                          {session.failedReadSignals.length > 0 ? (
                            <span>{t.kanbanDetail.historicalIssues}: {session.failedReadSignals.length}</span>
                          ) : null}
                          {session.repeatedReadFiles.length > 0 ? (
                            <span>{t.kanbanDetail.repeatedReadHotspots}: {session.repeatedReadFiles.length}</span>
                          ) : null}
                          {session.toolNames.length > 0 ? (
                            <span>{session.toolNames.join(", ")}</span>
                          ) : null}
                        </div>
                        {session.touchedFiles.length > 0 ? (
                          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {t.kanbanDetail.matchedFiles}: {session.touchedFiles.join(", ")}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : pack.sessions.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.relatedSessions}
                  </div>
                  <div className="space-y-2">
                    {pack.sessions.map((session) => (
                      <div
                        key={`matched:${session.provider}:${session.sessionId}`}
                        className="rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                          <span>{session.sessionId}</span>
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            {session.provider}
                          </span>
                          {formatTimestamp(session.updatedAt) ? (
                            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                              {formatTimestamp(session.updatedAt)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                          {session.promptSnippet}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                          {session.failedReadSignals.length > 0 ? (
                            <span>{t.kanbanDetail.historicalIssues}: {session.failedReadSignals.length}</span>
                          ) : null}
                          {session.repeatedReadFiles.length > 0 ? (
                            <span>{t.kanbanDetail.repeatedReadHotspots}: {session.repeatedReadFiles.length}</span>
                          ) : null}
                          {session.toolNames.length > 0 ? (
                            <span>{session.toolNames.join(", ")}</span>
                          ) : null}
                        </div>
                        {session.matchedFiles.length > 0 ? (
                          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {t.kanbanDetail.matchedFiles}: {session.matchedFiles.join(", ")}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {uniqueWarnings.length > 0 ? (
                <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-900/10">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
                    {t.kanbanDetail.warnings}
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-amber-800 dark:text-amber-100">
                    {uniqueWarnings.map((warning, index) => (
                      <div key={`${warning}:${index}`}>{warning}</div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  {t.kanbanDetail.historicalIssues}
                </div>
                {uniqueFailures.length > 0 ? (
                  <div className="space-y-2">
                    {uniqueFailures.map((failure, index) => (
                      <div
                        key={`${failure.sessionId}:${failure.toolName}:${failure.command ?? ""}:${failure.message}:${index}`}
                        className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-900/10"
                      >
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {failure.message}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {failure.sessionId} · {failure.toolName}
                        </div>
                        {failure.command ? (
                          <div className="mt-2 rounded-md bg-white/80 px-2 py-1 font-mono text-[11px] text-slate-600 dark:bg-slate-950/60 dark:text-slate-300">
                            {failure.command}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="border-b border-slate-200/70 px-1 pb-2 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
                    {t.kanbanDetail.noHistoricalIssues}
                  </div>
                )}

                {uniqueRepeatedReadFiles.length > 0 ? (
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                      {t.kanbanDetail.repeatedReadHotspots}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {uniqueRepeatedReadFiles.map((filePath, index) => (
                        <span
                          key={`${filePath}:${index}`}
                          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300"
                        >
                          {filePath}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {matchedFileDetails.length > 0 ? (
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20">
                  {(pack.featureName || pack.featureId) ? (
                    <div className="mb-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                        {t.kanbanDetail.matchedFeature}
                      </div>
                      <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200">
                        <span>{pack.featureName ?? pack.featureId}</span>
                        {pack.featureName && pack.featureId ? (
                          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {pack.featureId}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.matchedFiles}
                  </div>
                  <div className="mt-2 space-y-2">
                    {matchedFileDetails.map((fileDetail) => (
                      <div
                        key={fileDetail.filePath}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950/60"
                      >
                        <div className="font-mono text-[11px] text-slate-700 dark:text-slate-200">
                          {fileDetail.filePath}
                        </div>
                        {(fileDetail.changes > 0 || fileDetail.sessions > 0 || fileDetail.updatedAt) ? (
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                            {fileDetail.changes > 0 ? (
                              <span>{t.kanbanDetail.changes}: {fileDetail.changes}</span>
                            ) : null}
                            {fileDetail.sessions > 0 ? (
                              <span>{t.trace.sessions}: {fileDetail.sessions}</span>
                            ) : null}
                            {fileDetail.updatedAt ? (
                              <span>{t.kanbanDetail.updatedAt}: {formatTimestamp(fileDetail.updatedAt) ?? fileDetail.updatedAt}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {pack.sessions.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    {t.kanbanDetail.relatedSessions}
                  </div>
                  <div className="space-y-2">
                    {pack.sessions.map((session) => (
                      <div
                        key={session.sessionId}
                        className="rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2.5 dark:border-slate-700/70 dark:bg-slate-900/20"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                          <span>{session.sessionId}</span>
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            {session.provider}
                          </span>
                          {formatTimestamp(session.updatedAt) ? (
                            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                              {formatTimestamp(session.updatedAt)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                          {session.promptSnippet}
                        </div>
                        {session.matchedFiles.length > 0 ? (
                          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {t.kanbanDetail.matchedFiles}: {session.matchedFiles.join(", ")}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
