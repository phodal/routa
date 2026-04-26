"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AcpSessionNotification } from "@/client/acp-client";
import { resolveApiPath } from "@/client/config/backend";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import {
  extractCanvasToolWriteCandidate,
  getCanvasToolInputFromUpdate,
  getCanvasToolWriteCandidateKey,
  mergeCanvasToolInputs,
  type CanvasToolWriteCandidate,
} from "@/core/canvas/session-canvas-detection";

export interface SessionCanvasArtifact {
  fileName: string;
  filePath: string;
  id: string;
  title: string;
  viewerUrl: string;
}

export interface UseSessionCanvasArtifactsOptions {
  repoPath?: string | null;
  sessionId: string | null;
  updates: AcpSessionNotification[];
  workspaceId: string;
}

export interface UseSessionCanvasArtifactsResult {
  activeCanvas: SessionCanvasArtifact | null;
  clearActiveCanvas: () => void;
  error: string | null;
  isMaterializing: boolean;
}

interface CreateCanvasResponse {
  id: string;
  title?: string;
}

function getNotificationUpdate(notification: AcpSessionNotification): Record<string, unknown> {
  return (notification.update ?? notification) as Record<string, unknown>;
}

function isTerminalCanvasToolUpdate(update: Record<string, unknown>): boolean {
  const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";
  const status = typeof update.status === "string" ? update.status.toLowerCase() : "";

  if (kind === "tool_call_update") {
    return status === "completed" || status === "success" || status === "done";
  }

  return kind === "tool_call" && status === "completed";
}

async function createCanvasArtifactFromCandidate(
  candidate: CanvasToolWriteCandidate,
  workspaceId: string,
  repoPath?: string | null,
): Promise<SessionCanvasArtifact> {
  const response = await desktopAwareFetch(resolveApiPath("/api/canvas"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      renderMode: "dynamic",
      title: candidate.title,
      source: candidate.source,
      workspaceId,
      repoPath: repoPath ?? undefined,
    }),
  });

  const payload = await response.json().catch(() => null) as CreateCanvasResponse & { error?: string } | null;
  if (!response.ok || !payload?.id) {
    throw new Error(payload?.error ?? `Canvas artifact creation failed with HTTP ${response.status}`);
  }

  return {
    fileName: candidate.fileName,
    filePath: candidate.filePath,
    id: payload.id,
    title: payload.title ?? candidate.title,
    viewerUrl: `/canvas/${payload.id}`,
  };
}

export function useSessionCanvasArtifacts({
  repoPath,
  sessionId,
  updates,
  workspaceId,
}: UseSessionCanvasArtifactsOptions): UseSessionCanvasArtifactsResult {
  const [activeCanvas, setActiveCanvas] = useState<SessionCanvasArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMaterializing, setIsMaterializing] = useState(false);
  const lastProcessedUpdateIndexRef = useRef(updates.length);
  const updatesLengthRef = useRef(updates.length);
  const processedCandidateKeysRef = useRef<Set<string>>(new Set());
  const rawInputByToolCallIdRef = useRef<Map<string, Record<string, unknown>>>(new Map());

  useEffect(() => {
    updatesLengthRef.current = updates.length;
  }, [updates.length]);

  useEffect(() => {
    lastProcessedUpdateIndexRef.current = updatesLengthRef.current;
    processedCandidateKeysRef.current.clear();
    rawInputByToolCallIdRef.current.clear();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- session switch must clear stale live Canvas panel state.
    setActiveCanvas(null);
    setError(null);
    setIsMaterializing(false);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || sessionId === "__placeholder__") return;
    if (updates.length === 0) return;

    if (lastProcessedUpdateIndexRef.current > updates.length) {
      lastProcessedUpdateIndexRef.current = 0;
    }
    const pending = updates.slice(lastProcessedUpdateIndexRef.current);
    if (pending.length === 0) return;
    lastProcessedUpdateIndexRef.current = updates.length;

    let latestCandidate: CanvasToolWriteCandidate | null = null;
    for (const notification of pending) {
      if (notification.sessionId !== sessionId) continue;

      const update = getNotificationUpdate(notification);
      const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : undefined;
      const currentInput = getCanvasToolInputFromUpdate(update);
      const previousInput = toolCallId
        ? rawInputByToolCallIdRef.current.get(toolCallId)
        : undefined;
      const mergedInput = mergeCanvasToolInputs(previousInput, currentInput);

      if (toolCallId && mergedInput) {
        rawInputByToolCallIdRef.current.set(toolCallId, mergedInput);
      }

      if (!isTerminalCanvasToolUpdate(update)) continue;

      const candidate = extractCanvasToolWriteCandidate({
        previousRawInput: mergedInput,
        sessionId,
        update,
      });
      if (!candidate) continue;

      const key = getCanvasToolWriteCandidateKey(candidate);
      if (processedCandidateKeysRef.current.has(key)) continue;
      processedCandidateKeysRef.current.add(key);
      latestCandidate = candidate;
    }

    if (!latestCandidate) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external ACP tool completion starts async artifact materialization.
    setIsMaterializing(true);
    setError(null);

    void createCanvasArtifactFromCandidate(latestCandidate, workspaceId, repoPath)
      .then((created) => {
        if (!cancelled) {
          setActiveCanvas(created);
        }
      })
      .catch((createError: unknown) => {
        if (!cancelled) {
          setError(createError instanceof Error ? createError.message : "Failed to render canvas");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsMaterializing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath, sessionId, updates, workspaceId]);

  const clearActiveCanvas = useCallback(() => {
    setActiveCanvas(null);
    setError(null);
  }, []);

  return {
    activeCanvas,
    clearActiveCanvas,
    error,
    isMaterializing,
  };
}
