import { createHash } from "node:crypto";

import { loadSessionHistory } from "@/core/session-history";
import { historyNotificationsToMessages } from "@/core/session-transcript";
import { createArtifact } from "../models/artifact";
import type { KanbanColumnStage, KanbanTransport } from "../models/kanban";
import type { Task } from "../models/task";
import type { ArtifactStore } from "../store/artifact-store";

const FALLBACK_KIND = "session_final_response_fallback";
const MAX_FALLBACK_CONTENT_LENGTH = 16_000;

export interface CompletionFallbackArtifactResult {
  status: "created" | "skipped" | "blocked";
  reason?: string;
  artifactId?: string;
}

export interface CompletionFallbackArtifactParams {
  task: Task;
  sessionId: string;
  workspaceId: string;
  stage: KanbanColumnStage;
  transport?: KanbanTransport;
  artifactStore: ArtifactStore;
  finalResponseText?: string;
}

function isFallbackEligible(task: Task, stage: KanbanColumnStage): boolean {
  if (stage !== "dev") {
    return true;
  }

  const searchable = [
    task.columnId,
    task.title,
    task.objective,
    task.scope,
    task.comment,
    task.assignedRole,
    task.assignedSpecialistId,
    task.assignedSpecialistName,
    ...task.labels,
  ].filter(Boolean).join(" ").toLowerCase();

  return /\b(product|architecture|architect|qa|ops|security|review|release|gate|solution|design|docs?)\b/i
    .test(searchable);
}

function containsSensitiveText(text: string): boolean {
  return [
    /["']?(password|passwd|api[_-]?key|secret|token|cookie|authorization)["']?\s*[:=]\s*["']?[^\s"']+/i,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}/,
    /\bsk-[A-Za-z0-9_-]{20,}/,
    /\bANTHROPIC_[A-Z0-9_]*\s*[:=]/i,
  ].some((pattern) => pattern.test(text));
}

function truncateContent(text: string): { content: string; truncated: boolean } {
  if (text.length <= MAX_FALLBACK_CONTENT_LENGTH) {
    return { content: text, truncated: false };
  }
  return {
    content: `${text.slice(0, MAX_FALLBACK_CONTENT_LENGTH)}\n\n[truncated]`,
    truncated: true,
  };
}

function stableFallbackArtifactId(taskId: string, sessionId: string): string {
  return `session-final-response-fallback-${taskId}-${sessionId}`.replace(/[^A-Za-z0-9_.:-]/g, "-");
}

export async function loadLatestAssistantFinalResponse(sessionId: string): Promise<string | undefined> {
  const history = await loadSessionHistory(sessionId, { consolidated: true });
  const messages = historyNotificationsToMessages(history, sessionId);
  return [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.content.trim().length > 0)
    ?.content
    .trim();
}

export async function ensureCompletionFallbackArtifact(
  params: CompletionFallbackArtifactParams,
): Promise<CompletionFallbackArtifactResult> {
  if (!isFallbackEligible(params.task, params.stage)) {
    return { status: "skipped", reason: "lane_not_eligible" };
  }

  const existingArtifacts = await params.artifactStore.listByTask(params.task.id);
  if (existingArtifacts.length > 0) {
    return { status: "skipped", reason: "task_already_has_artifacts" };
  }

  const artifactId = stableFallbackArtifactId(params.task.id, params.sessionId);
  const existingFallback = await params.artifactStore.getArtifact(artifactId);
  if (existingFallback) {
    return { status: "skipped", reason: "fallback_already_exists", artifactId };
  }

  const rawText = params.finalResponseText?.trim()
    ?? await loadLatestAssistantFinalResponse(params.sessionId);
  if (!rawText) {
    return { status: "skipped", reason: "empty_final_response" };
  }

  const sensitiveBlocked = containsSensitiveText(rawText);
  if (sensitiveBlocked) {
    return {
      status: "blocked",
      reason: "sensitive_content_blocked",
      artifactId,
    };
  }

  const { content, truncated } = truncateContent(rawText);

  const contentHash = createHash("sha256").update(rawText).digest("hex");
  const artifact = createArtifact({
    id: artifactId,
    type: "logs",
    taskId: params.task.id,
    workspaceId: params.workspaceId,
    providedByAgentId: params.sessionId,
    content,
    context: sensitiveBlocked
      ? "Sensitive session final response fallback blocked"
      : "Session final response fallback",
    status: "provided",
    metadata: {
      kind: FALLBACK_KIND,
      source: "session-final-response",
      fallback: "true",
      sessionId: params.sessionId,
      transport: params.transport ?? "acp",
      contentHash,
      truncated: String(truncated),
      sensitiveBlocked: "false",
    },
  });

  await params.artifactStore.saveArtifact(artifact);
  return {
    status: sensitiveBlocked ? "blocked" : "created",
    reason: sensitiveBlocked ? "sensitive_content_blocked" : undefined,
    artifactId,
  };
}
