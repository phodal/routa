"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopAwareFetch } from "../../../utils/diagnostics";
import type { AcpSessionNotification } from "../../../acp-client";
import type { ChatMessage, UsageInfo } from "../types";
import type { ChecklistItem } from "../../../utils/checklist-parser";
import { type FileChangesState, createFileChangesState } from "../../../utils/file-changes-tracker";
import { extractTaskBlocks, hasTaskBlocks, type ParsedTask } from "../../../utils/task-block-parser";
import { hydrateTranscriptMessages, type SessionTranscriptPayload } from "@/core/session-transcript";
import { processUpdate } from "./message-processor";

export interface UseChatMessagesOptions {
  activeSessionId: string | null;
  updates: AcpSessionNotification[];
  onTasksDetected?: (tasks: ParsedTask[]) => void;
}

export interface UseChatMessagesResult {
  messagesBySession: Record<string, ChatMessage[]>;
  visibleMessages: ChatMessage[];
  sessions: Array<{ sessionId: string; provider?: string; modeId?: string }>;
  sessionModeById: Record<string, string>;
  isSessionRunning: boolean;
  checklistItems: ChecklistItem[];
  fileChangesState: FileChangesState;
  usageInfo: UsageInfo | null;
  setMessagesBySession: React.Dispatch<React.SetStateAction<Record<string, ChatMessage[]>>>;
  setIsSessionRunning: React.Dispatch<React.SetStateAction<boolean>>;
  fetchSessionHistory: (sessionId: string) => Promise<void>;
  fetchSessions: () => Promise<void>;
  resetStreamingRefs: (sessionId: string) => void;
}

export function useChatMessages({
  activeSessionId,
  updates,
  onTasksDetected,
}: UseChatMessagesOptions): UseChatMessagesResult {
  const [sessions, setSessions] = useState<Array<{ sessionId: string; provider?: string; modeId?: string }>>([]);
  const [sessionModeById, setSessionModeById] = useState<Record<string, string>>({});
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>({});
  const visibleMessages = useMemo(() => {
    if (!activeSessionId) return [];
    return messagesBySession[activeSessionId] ?? [];
  }, [activeSessionId, messagesBySession]);
  const [isSessionRunning, setIsSessionRunning] = useState(false);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [fileChangesState, setFileChangesState] = useState<FileChangesState>(createFileChangesState);
  const [usageInfo, setUsageInfo] = useState<UsageInfo | null>(null);

  // Refs for streaming state
  const streamingMsgIdRef = useRef<Record<string, string | null>>({});
  const streamingThoughtIdRef = useRef<Record<string, string | null>>({});
  const lastProcessedUpdateIndexRef = useRef(0);
  const lastUpdateKindRef = useRef<Record<string, string | null>>({});
  const loadedHistoryRef = useRef<Set<string>>(new Set());
  const processedMessageIdsRef = useRef<Set<string>>(new Set());

  const resetStreamingRefs = useCallback((sessionId: string) => {
    streamingMsgIdRef.current[sessionId] = null;
    streamingThoughtIdRef.current[sessionId] = null;
  }, []);

  // Fetch sessions list
  const fetchSessions = useCallback(async () => {
    try {
      const res = await desktopAwareFetch("/api/sessions", { cache: "no-store" });
      const data = await res.json();
      const list = Array.isArray(data?.sessions) ? data.sessions : [];
      setSessions(list);
      const modeMap: Record<string, string> = {};
      for (const s of list) {
        if (s?.sessionId && s?.modeId) {
          modeMap[s.sessionId] = s.modeId;
        }
      }
      setSessionModeById((prev) => ({ ...prev, ...modeMap }));
    } catch {
      // ignore
    }
  }, []);

  // Fetch session history
  const fetchSessionHistory = useCallback(async (sessionId: string) => {
    if (loadedHistoryRef.current.has(sessionId)) return;
    if (sessionId === "__placeholder__") return;

    try {
      const response = await desktopAwareFetch(`/api/sessions/${sessionId}/transcript`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as Partial<SessionTranscriptPayload>;
      const history = Array.isArray(data?.history) ? data.history as AcpSessionNotification[] : [];
      const serializedMessages = Array.isArray(data?.messages) ? data.messages : [];
      const messages = hydrateTranscriptMessages(serializedMessages);

      if (history.length === 0 && messages.length === 0) {
        return;
      }
      loadedHistoryRef.current.add(sessionId);

      // Check if session is still running
      if (history.length > 0 || typeof data?.latestEventKind === "string") {
        const lastKind = data?.latestEventKind
          ?? (((history.at(-1)?.update ?? history.at(-1)) as Record<string, unknown> | undefined)?.sessionUpdate as string | undefined);
        const isRunning = lastKind !== "turn_complete" && lastKind !== "acp_status";
        setIsSessionRunning(isRunning);
      }

      if (messages.length > 0) {
        // Extract tasks from loaded history
        let detectedTasks: ParsedTask[] = [];
        const processedMessages = [...messages];

        for (let i = 0; i < processedMessages.length; i++) {
          const msg = processedMessages[i];
          if (msg.role === "assistant" && hasTaskBlocks(msg.content)) {
            const { tasks, cleanedContent } = extractTaskBlocks(msg.content);
            if (tasks.length > 0) {
              processedMessages[i] = { ...msg, content: cleanedContent };
              detectedTasks = tasks;
            }
          }
        }

        setMessagesBySession((prev) => ({
          ...prev,
          [sessionId]: processedMessages,
        }));

        if (detectedTasks.length > 0 && onTasksDetected) {
          onTasksDetected(detectedTasks);
        }
      }
    } catch {
      // ignore errors
    }
  }, [onTasksDetected]);

  // When active session changes, swap visible transcript and load history
  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    processedMessageIdsRef.current.clear();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset running state on session change
    setIsSessionRunning(false);
    void fetchSessionHistory(activeSessionId);
  }, [activeSessionId, fetchSessionHistory]);

  useEffect(() => {
    if (!activeSessionId) return;
    if (loadedHistoryRef.current.has(activeSessionId)) return;
    if (updates.length === 0) return;
    if ((messagesBySession[activeSessionId]?.length ?? 0) > 0) return;
    const retry = window.setTimeout(() => {
      void fetchSessionHistory(activeSessionId);
    }, 0);
    return () => window.clearTimeout(retry);
  }, [activeSessionId, updates.length, messagesBySession, fetchSessionHistory]);

  // Process SSE updates
  useEffect(() => {
    if (updates.length === 0) return;
    const pending = updates.slice(lastProcessedUpdateIndexRef.current);
    if (pending.length === 0) return;
    lastProcessedUpdateIndexRef.current = updates.length;

    const modeUpdates: Record<string, string> = {};

    setMessagesBySession((prev) => {
      const next = { ...prev };
      const getSessionMessages = (sid: string): ChatMessage[] => {
        if (!next[sid]) {
          next[sid] = [];
          return next[sid];
        }
        next[sid] = [...next[sid]];
        return next[sid];
      };

      for (const notification of pending) {
        const sid = notification.sessionId;
        const update = (notification.update ?? notification) as Record<string, unknown>;
        const kind = update.sessionUpdate as string | undefined;
        if (!sid || !kind) continue;

        const arr = getSessionMessages(sid);
        const extractText = (): string => {
          const content = update.content as { type: string; text?: string } | undefined;
          if (content?.text) return content.text;
          if (typeof update.text === "string") return update.text;
          return "";
        };

        const lastKind = lastUpdateKindRef.current[sid];

        // Track session running state for the active session
        if (sid === activeSessionId) {
          if (kind === "agent_message_chunk" || kind === "tool_call" || kind === "agent_reasoning_chunk") {
            setIsSessionRunning(true);
          } else if (kind === "turn_complete") {
            setIsSessionRunning(false);
          }
        }

        processUpdate(
          kind,
          update,
          arr,
          sid,
          lastKind,
          extractText,
          streamingMsgIdRef,
          streamingThoughtIdRef,
          setChecklistItems,
          setFileChangesState,
          setUsageInfo,
          modeUpdates
        );

        // Track last update kind for streaming message grouping
        lastUpdateKindRef.current[sid] = kind;
      }

      return next;
    });

    if (Object.keys(modeUpdates).length > 0) {
      setSessionModeById((prev) => ({ ...prev, ...modeUpdates }));
    }
  }, [updates, activeSessionId]);

  // Extract tasks from messages after SSE updates
  useEffect(() => {
    if (!onTasksDetected || !activeSessionId) return;

    const messages = messagesBySession[activeSessionId];
    if (!messages || messages.length === 0) return;

    let detectedTasks: ParsedTask[] = [];
    let hasNewTasksToExtract = false;

    for (const msg of messages) {
      if (msg.role === "assistant" &&
          !processedMessageIdsRef.current.has(msg.id) &&
          hasTaskBlocks(msg.content)) {
        hasNewTasksToExtract = true;
        break;
      }
    }

    if (!hasNewTasksToExtract) return;

    setMessagesBySession((prev) => {
      const msgs = prev[activeSessionId];
      if (!msgs) return prev;

      const arr = [...msgs];
      let tasksFound = false;

      for (let i = 0; i < arr.length; i++) {
        const msg = arr[i];
        if (msg.role === "assistant" &&
            !processedMessageIdsRef.current.has(msg.id) &&
            hasTaskBlocks(msg.content)) {
          const { tasks, cleanedContent } = extractTaskBlocks(msg.content);
          if (tasks.length > 0) {
            arr[i] = { ...msg, content: cleanedContent };
            detectedTasks = tasks;
            tasksFound = true;
            processedMessageIdsRef.current.add(msg.id);
          }
        }
      }

      if (tasksFound) {
        return { ...prev, [activeSessionId]: arr };
      }
      return prev;
    });

    if (detectedTasks.length > 0) {
      onTasksDetected(detectedTasks);
    }
  }, [messagesBySession, activeSessionId, onTasksDetected]);

  return {
    messagesBySession,
    visibleMessages,
    sessions,
    sessionModeById,
    isSessionRunning,
    checklistItems,
    fileChangesState,
    usageInfo,
    setMessagesBySession,
    setIsSessionRunning,
    fetchSessionHistory,
    fetchSessions,
    resetStreamingRefs,
  };
}
