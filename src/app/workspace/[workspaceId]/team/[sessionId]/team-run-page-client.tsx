"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { ChatPanel } from "@/client/components/chat-panel";
import { processUpdate } from "@/client/components/chat-panel/hooks";
import type { ChatMessage } from "@/client/components/chat-panel/types";
import { getToolEventLabel } from "@/client/components/chat-panel/tool-call-name";
import { TiptapInput } from "@/client/components/tiptap-input";
import { useAcp } from "@/client/hooks/use-acp";
import { useNotes } from "@/client/hooks/use-notes";
import { consumePendingPrompt } from "@/client/utils/pending-prompt";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { ChecklistItem } from "@/client/utils/checklist-parser";
import { filterSpecialistsByCategory } from "@/client/utils/specialist-categories";
import { formatRelativeTime, OverlayModal } from "../../ui-components";
import type { SessionInfo } from "../../types";
import {
  avatarInitials,
  buildLaneSnippets,
  extractAskUserQuestionPayload,
  extractFullHistoryText,
  extractGoalFromPrompt,
  extractHistoryText,
  findObjectiveText,
  getActorLabel,
  inferCompletionEvent,
  inferDeliverableLabel,
  inferSessionDeliverableLabel,
  isLowSignalLeadMessage,
  mapAgentStatus,
  normalizeTaskStatus,
  resolveDelegationRosterSpecialistId,
  resolveDelegationTarget,
  resolveRosterSpecialistId,
  sessionBadge,
  summarizeText,
  TEAM_LEAD_SPECIALIST_ID,
  toMemberSessionSummary,
  type AgentSummary,
  type DeliverableItem,
  type PendingSessionQuestion,
  type SessionHistoryEntry,
  type TeamActivityItem,
  type TeamMemberStatus,
  type SessionLaneItem,
  type SessionStreamSummary,
  type SpecialistSummary,
  type TeamMemberItem,
  type TeamTaskNode,
} from "./team-run-page-model";
import {
  ObjectiveSidebarSection,
  SessionTimelineSection,
  TeamMembersSection,
} from "./team-run-page-sections";

function buildTranscriptMessages(
  history: SessionHistoryEntry[],
  sessionId: string,
  {
    hideLowSignalAssistant = false,
  }: {
    hideLowSignalAssistant?: boolean;
  } = {},
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const streamingMsgIdRef = { current: {} as Record<string, string | null> };
  const streamingThoughtIdRef = { current: {} as Record<string, string | null> };
  const noopChecklist = (() => {}) as React.Dispatch<React.SetStateAction<ChecklistItem[]>>;
  const noopFileChanges = (() => {}) as React.Dispatch<React.SetStateAction<unknown>>;
  const noopUsage = (() => {}) as React.Dispatch<React.SetStateAction<unknown>>;
  const modeUpdates: Record<string, string> = {};
  let lastKind: string | null = null;

  const normalizedMessageText = (value?: string) => value?.replace(/\s+/g, " ").trim() ?? "";

  for (const entry of history) {
    const update = entry.update;
    const kind = update?.sessionUpdate;
    if (!update || !kind) continue;

    if (kind === "user_message") {
      const text = extractFullHistoryText(update) ?? extractHistoryText(update);
      if (!text) {
        lastKind = kind;
        continue;
      }
      const lastMessage = messages.at(-1);
      if (lastMessage?.role === "user" && normalizedMessageText(lastMessage.content) === normalizedMessageText(text)) {
        lastKind = kind;
        continue;
      }
      messages.push({
        id: `${sessionId}-user-${messages.length}`,
        role: "user",
        content: text,
        timestamp: new Date(),
      });
      lastKind = kind;
      continue;
    }

    if (kind === "agent_message") {
      const text = extractFullHistoryText(update);
      if (!text || (hideLowSignalAssistant && isLowSignalLeadMessage(text))) {
        lastKind = kind;
        continue;
      }
      const lastMessage = messages.at(-1);
      if (lastMessage?.role === "assistant" && normalizedMessageText(lastMessage.content) === normalizedMessageText(text)) {
        lastKind = kind;
        continue;
      }
      messages.push({
        id: `${sessionId}-assistant-${messages.length}`,
        role: "assistant",
        content: text,
        timestamp: new Date(),
      });
      lastKind = kind;
      continue;
    }

    const extractText = () => {
      if (!update.content) return "";
      if (!Array.isArray(update.content)) {
        return update.content.text ?? "";
      }
      return update.content
        .map((item) => item.text ?? item.content?.text ?? "")
        .join(" ")
        .trim();
    };

    processUpdate(
      kind,
      update as Record<string, unknown>,
      messages,
      sessionId,
      lastKind,
      extractText,
      streamingMsgIdRef,
      streamingThoughtIdRef,
      noopChecklist,
      noopFileChanges,
      noopUsage,
      modeUpdates,
    );

    lastKind = kind;
  }

  return messages.filter((message) => {
    if (hideLowSignalAssistant && message.role === "assistant" && isLowSignalLeadMessage(message.content)) {
      return false;
    }
    if (message.role === "info" && !message.content.trim()) {
      return false;
    }
    return true;
  });
}

function buildFallbackLeadMessages(
  objective: string,
  leadSessionId: string,
  memberLanes: SessionLaneItem[],
  rootHistory: SessionHistoryEntry[],
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (objective.trim()) {
    messages.push({
      id: `${leadSessionId}-fallback-user`,
      role: "user",
      content: objective,
      timestamp: new Date(),
    });
  }

  memberLanes
    .filter((lane) => !lane.isLead)
    .forEach((lane, index) => {
      messages.push({
        id: `${leadSessionId}-fallback-delegate-${lane.sessionId}`,
        role: "tool",
        content: "delegate_task",
        timestamp: new Date(),
        toolName: "delegate_task",
        toolStatus: lane.status === "blocked" ? "failed" : lane.status === "done" ? "completed" : "running",
        toolCallId: `synthetic-delegate-${lane.sessionId}`,
        toolKind: "task",
        toolRawInput: {
          specialist: lane.roleId,
          title: lane.sessionName,
          additionalInstructions: lane.messages
            .find((message) => message.role === "user" || message.role === "assistant")
            ?.content,
          order: index + 1,
        },
        toolRawOutput: lane.completionSummary ?? lane.messages.at(-1)?.content ?? lane.snippets.at(-1)?.text,
      });
    });

  const latestCompletion = [...rootHistory]
    .reverse()
    .find((entry) => entry.update?.sessionUpdate === "task_completion");
  const completionSummary = latestCompletion?.update?.completionSummary ?? extractHistoryText(latestCompletion?.update);
  if (completionSummary && !isLowSignalLeadMessage(completionSummary)) {
    messages.push({
      id: `${leadSessionId}-fallback-complete`,
      role: "assistant",
      content: completionSummary,
      timestamp: new Date(),
    });
  }

  return messages;
}

export function TeamRunPageClient() {
  const params = useParams();
  const router = useRouter();
  const rawWorkspaceId = params.workspaceId as string;
  const rawSessionId = params.sessionId as string;
  const workspaceId =
    rawWorkspaceId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? rawWorkspaceId)
      : rawWorkspaceId;
  const sessionId =
    rawSessionId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/[^/]+\/team\/([^/]+)/)?.[1] ?? rawSessionId)
      : rawSessionId;

  const acp = useAcp();
  const {
    connected: acpConnected,
    loading: acpLoading,
    updates: acpUpdates,
    providers: acpProviders,
    selectedProvider: acpSelectedProvider,
    connect: connectAcp,
    prompt: acpPrompt,
    promptSession: acpPromptSession,
    setProvider: acpSetProvider,
    selectSession,
  } = acp;
  const modalAcp = useAcp();
  const {
    connected: modalAcpConnected,
    loading: modalAcpLoading,
    connect: connectModalAcp,
    selectSession: selectModalSession,
  } = modalAcp;
  const workspacesHook = useWorkspaces();
  const notesHook = useNotes(workspaceId, sessionId);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [workspaceSessions, setWorkspaceSessions] = useState<SessionInfo[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistSummary[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [historiesBySessionId, setHistoriesBySessionId] = useState<Record<string, SessionHistoryEntry[]>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string>(sessionId);
  const [selectedSessionForModal, setSelectedSessionForModal] = useState<string | null>(null);
  const [timelineInputKey, setTimelineInputKey] = useState(0);
  const sessionBlockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUpdateIndexRef = useRef(0);
  const pendingPromptSentRef = useRef<Set<string>>(new Set());
  const pendingPromptTextRef = useRef<string | null>(null);

  useEffect(() => {
    if (!acpConnected && !acpLoading) {
      void connectAcp();
    }
  }, [acpConnected, acpLoading, connectAcp]);

  useEffect(() => {
    if (!acpConnected || sessionId === "__placeholder__") return;
    selectSession(sessionId);
  }, [acpConnected, selectSession, sessionId]);

  useEffect(() => {
    if (!selectedSessionForModal) return;
    if (!modalAcpConnected && !modalAcpLoading) {
      void connectModalAcp();
    }
  }, [connectModalAcp, modalAcpConnected, modalAcpLoading, selectedSessionForModal]);

  useEffect(() => {
    if (!selectedSessionForModal || !modalAcpConnected) return;
    selectModalSession(selectedSessionForModal);
  }, [modalAcpConnected, selectedSessionForModal, selectModalSession]);

  useEffect(() => {
    setSelectedSessionId(sessionId);
  }, [sessionId]);

  const focusSessionBlock = useCallback((targetSessionId: string) => {
    setSelectedSessionId(targetSessionId);
    const node = sessionBlockRefs.current[targetSessionId];
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const handleTimelinePrompt = useCallback((text: string) => {
    if (!sessionId) return;
    void acpPromptSession(sessionId, text);
    setTimelineInputKey((current) => current + 1);
  }, [acpPromptSession, sessionId]);

  useEffect(() => {
    if (!sessionId || !acpConnected || acpLoading) return;
    if (pendingPromptSentRef.current.has(sessionId)) return;

    if (!pendingPromptTextRef.current) {
      const text = consumePendingPrompt(sessionId);
      if (!text) return;
      pendingPromptTextRef.current = text;
    }

    const pendingText = pendingPromptTextRef.current;
    if (!pendingText) return;

    const lastStatusUpdate = acpUpdates.findLast(
      (entry) =>
        (entry as Record<string, unknown>).update &&
        ((entry as Record<string, unknown>).update as Record<string, unknown>).sessionUpdate === "acp_status",
    );
    const acpReady = lastStatusUpdate &&
      ((lastStatusUpdate as Record<string, unknown>).update as Record<string, unknown>).status === "ready";

    if (acpReady) {
      pendingPromptSentRef.current.add(sessionId);
      pendingPromptTextRef.current = null;
      void acpPrompt(pendingText);
      return;
    }

    const timer = setTimeout(() => {
      if (!pendingPromptSentRef.current.has(sessionId) && pendingPromptTextRef.current) {
        pendingPromptSentRef.current.add(sessionId);
        pendingPromptTextRef.current = null;
        void acpPrompt(pendingText);
      }
    }, 8000);

    return () => clearTimeout(timer);
  }, [sessionId, acpConnected, acpLoading, acpUpdates, acpPrompt]);

  useEffect(() => {
    if (!acpUpdates.length) {
      lastUpdateIndexRef.current = 0;
      return;
    }

    const startIndex = lastUpdateIndexRef.current > acpUpdates.length ? 0 : lastUpdateIndexRef.current;
    const pending = acpUpdates.slice(startIndex);
    if (!pending.length) return;
    lastUpdateIndexRef.current = acpUpdates.length;

    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = setTimeout(() => {
      setRefreshKey((current) => current + 1);
      void notesHook.fetchNotes();
    }, 350);

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [acpUpdates, notesHook]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setRefreshKey((current) => current + 1);
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const [sessionRes, sessionsRes, specialistsRes, agentsRes] = await Promise.all([
          desktopAwareFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store", signal: controller.signal }),
          desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`, { cache: "no-store", signal: controller.signal }),
          desktopAwareFetch("/api/specialists", { cache: "no-store", signal: controller.signal }),
          desktopAwareFetch(`/api/agents?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store", signal: controller.signal }),
        ]);
        const sessionData = await sessionRes.json().catch(() => ({}));
        const sessionsData = await sessionsRes.json().catch(() => ({}));
        const specialistsData = await specialistsRes.json().catch(() => ({}));
        const agentsData = await agentsRes.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        setSession((sessionData?.session ?? null) as SessionInfo | null);
        setWorkspaceSessions(Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : []);
        setSpecialists(Array.isArray(specialistsData?.specialists) ? specialistsData.specialists : []);
        setAgents(Array.isArray(agentsData?.agents) ? agentsData.agents : []);
      } catch {
        if (controller.signal.aborted) return;
        setSession(null);
        setWorkspaceSessions([]);
        setSpecialists([]);
        setAgents([]);
      }
    })();

    return () => controller.abort();
  }, [refreshKey, sessionId, workspaceId]);

  const workspace = workspacesHook.workspaces.find((item) => item.id === workspaceId);
  const specialistsById = useMemo(
    () => new Map(specialists.map((specialist) => [specialist.id, specialist])),
    [specialists],
  );
  const agentsById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );

  const descendantSessions = useMemo(() => {
    const childMap = new Map<string, SessionInfo[]>();
    for (const entry of workspaceSessions) {
      if (!entry.parentSessionId) continue;
      const existing = childMap.get(entry.parentSessionId) ?? [];
      existing.push(entry);
      childMap.set(entry.parentSessionId, existing);
    }

    const collect = (rootId: string): SessionInfo[] => {
      const children = childMap.get(rootId) ?? [];
      return children.flatMap((child) => [child, ...collect(child.sessionId)]);
    };

    return collect(sessionId);
  }, [sessionId, workspaceSessions]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const sessionsToLoad = [session, ...descendantSessions];

    (async () => {
      try {
        const historyEntries = await Promise.all(
          sessionsToLoad.map(async (entry) => {
            const response = await desktopAwareFetch(
              `/api/sessions/${encodeURIComponent(entry.sessionId)}/history?consolidated=true`,
              { cache: "no-store", signal: controller.signal },
            );
            const data = await response.json().catch(() => ({}));
            return [entry.sessionId, Array.isArray(data?.history) ? data.history : []] as const;
          }),
        );
        if (controller.signal.aborted) return;
        setHistoriesBySessionId(Object.fromEntries(historyEntries));
      } catch {
        if (controller.signal.aborted) return;
        setHistoriesBySessionId({});
      }
    })();

    return () => controller.abort();
  }, [descendantSessions, refreshKey, session]);

  const taskTree = useMemo<TeamTaskNode[]>(() => {
    const taskNotes = notesHook.notes.filter((note) => note.metadata.type === "task");
    const taskById = new Map(taskNotes.map((note) => [note.id, note]));
    const childrenByParent = new Map<string, typeof taskNotes>();
    const rootNotes: typeof taskNotes = [];

    for (const note of taskNotes) {
      const parentId = note.metadata.parentNoteId;
      if (!parentId || !taskById.has(parentId)) {
        rootNotes.push(note);
        continue;
      }
      const existing = childrenByParent.get(parentId) ?? [];
      existing.push(note);
      childrenByParent.set(parentId, existing);
    }

    const buildNode = (noteId: string): TeamTaskNode | null => {
      const note = taskById.get(noteId);
      if (!note) return null;
      const children = (childrenByParent.get(note.id) ?? [])
        .map((child) => buildNode(child.id))
        .filter((child): child is TeamTaskNode => Boolean(child));
      return {
        id: note.id,
        title: note.title,
        status: normalizeTaskStatus(note.metadata.taskStatus),
        details: note.content.trim() || undefined,
        children,
      };
    };

    return rootNotes
      .map((note) => buildNode(note.id))
      .filter((node): node is TeamTaskNode => Boolean(node));
  }, [notesHook.notes]);

  const allRunSessions = useMemo(
    () => (session ? [session, ...descendantSessions] : descendantSessions),
    [descendantSessions, session],
  );

  const sessionStreams = useMemo<SessionStreamSummary[]>(() => {
    return allRunSessions
      .map((entry) => {
        const history = historiesBySessionId[entry.sessionId] ?? [];
        const latestMeaningful = [...history]
          .reverse()
          .find((historyEntry) => {
            const updateType = historyEntry.update?.sessionUpdate;
            return updateType && updateType !== "agent_message_chunk" && updateType !== "agent_thought_chunk";
          });
        const preview =
          extractHistoryText(latestMeaningful?.update) ??
          summarizeText(latestMeaningful?.update?.rawOutput?.output) ??
          summarizeText(latestMeaningful?.update?.error);
        const lastUpdatedAt = latestMeaningful
          ? new Date(entry.createdAt).getTime() + history.indexOf(latestMeaningful) / 1000
          : new Date(entry.createdAt).getTime();

        return {
          session: entry,
          actor: getActorLabel(entry, specialistsById, agentsById),
          badge: sessionBadge(entry),
          preview,
          eventCount: history.length,
          lastUpdatedLabel: formatRelativeTime(new Date(lastUpdatedAt).toISOString()),
          lastUpdatedAt,
        };
      })
      .sort((a, b) => {
        if (a.session.sessionId === sessionId) return -1;
        if (b.session.sessionId === sessionId) return 1;
        return b.lastUpdatedAt - a.lastUpdatedAt;
      });
  }, [agentsById, allRunSessions, historiesBySessionId, sessionId, specialistsById]);

  const selectedSessionStream = useMemo(
    () => sessionStreams.find((item) => item.session.sessionId === selectedSessionId) ?? sessionStreams[0] ?? null,
    [selectedSessionId, sessionStreams],
  );

  const sessionStreamsBySessionId = useMemo(
    () => new Map(sessionStreams.map((stream) => [stream.session.sessionId, stream])),
    [sessionStreams],
  );

  const latestChildSessionByRosterId = useMemo(() => {
    const map = new Map<string, SessionStreamSummary>();
    for (const stream of sessionStreams) {
      if (!stream.session.parentSessionId) continue;
      const rosterId = resolveRosterSpecialistId(stream.session, agentsById);
      if (!rosterId && !stream.session.specialistId) continue;
      map.set(rosterId ?? stream.session.specialistId ?? stream.session.sessionId, stream);
    }
    return map;
  }, [agentsById, sessionStreams]);

  const rootHistory = useMemo(
    () => historiesBySessionId[sessionId] ?? [],
    [historiesBySessionId, sessionId],
  );
  const objective = useMemo(() => findObjectiveText(session, rootHistory, notesHook.notes), [notesHook.notes, rootHistory, session]);

  const createdAgents = useMemo(() => {
    if (!session) return [] as Array<{ agent: AgentSummary; update: NonNullable<SessionHistoryEntry["update"]>; createdAt: number }>;

    const candidateAgents = [...agents]
      .filter((agent) => new Date(agent.createdAt).getTime() >= new Date(session.createdAt).getTime())
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const matchedAgentIds = new Set<string>();

    return rootHistory.flatMap((entry, index) => {
      const update = entry.update;
      const toolLabel = update ? getToolEventLabel(update as Record<string, unknown>) : "";
      if (!update || update.sessionUpdate !== "tool_call_update" || !toolLabel.includes("create_agent") || update.status !== "completed") {
        return [];
      }

      const requestedName = typeof update.rawInput?.name === "string" ? update.rawInput.name : undefined;
      const requestedRole = typeof update.rawInput?.role === "string" ? update.rawInput.role : undefined;
      if (!requestedName || !requestedRole) return [];

      const matchedAgent = candidateAgents.find((agent) => (
        !matchedAgentIds.has(agent.id)
        && agent.name === requestedName
        && agent.role === requestedRole
      ));
      if (!matchedAgent) return [];

      matchedAgentIds.add(matchedAgent.id);
      return [{
        agent: matchedAgent,
        update,
        createdAt: new Date(session.createdAt).getTime() + index / 1000,
      }];
    });
  }, [agents, rootHistory, session]);

  const _coordinationItems = useMemo<TeamActivityItem[]>(() => {
    const items: Array<TeamActivityItem & { sortKey: number }> = [];
    const leadName = specialistsById.get(TEAM_LEAD_SPECIALIST_ID)?.name ?? "Agent Lead";

    const requestEntry = rootHistory.find((entry) => entry.update?.sessionUpdate === "user_message");
    if (requestEntry && session) {
      items.push({
        id: `${session.sessionId}-objective`,
        type: "plan",
        title: "Objective set",
        actor: "User",
        actorRoleId: "user",
        target: leadName,
        targetRoleId: TEAM_LEAD_SPECIALIST_ID,
        timestamp: formatRelativeTime(session.createdAt),
        summary: extractGoalFromPrompt(extractHistoryText(requestEntry.update)) ?? extractHistoryText(requestEntry.update),
        sessionId: session.sessionId,
        sortKey: new Date(session.createdAt).getTime(),
      });
    }

    const latestSpec = notesHook.notes
      .filter((note) => note.metadata.type === "spec")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    if (latestSpec) {
      items.push({
        id: `spec-${latestSpec.id}`,
        type: "plan",
        title: "Lead created plan",
        actor: leadName,
        actorRoleId: TEAM_LEAD_SPECIALIST_ID,
        timestamp: formatRelativeTime(latestSpec.updatedAt),
        summary: extractGoalFromPrompt(latestSpec.content) ?? summarizeText(latestSpec.content),
        sessionId: latestSpec.sessionId ?? sessionId,
        sortKey: new Date(latestSpec.updatedAt).getTime(),
      });
    }

    rootHistory.forEach((entry, index) => {
      const update = entry.update;
      const updateType = update?.sessionUpdate;
      if (!updateType || !session) return;
      const sortKey = new Date(session.createdAt).getTime() + index / 1000;

      if (updateType === "tool_call_update" && getToolEventLabel(update as Record<string, unknown>).includes("delegate_task")) {
        const target = resolveDelegationTarget(update) ?? "team member";
        const targetRosterId = resolveDelegationRosterSpecialistId(update);
        const linkedStream: SessionStreamSummary | undefined = targetRosterId
          ? latestChildSessionByRosterId.get(targetRosterId)
          : undefined;
        items.push({
          id: `${sessionId}-delegate-${index}`,
          type: update.status === "failed" ? "blocked" : "assign",
          title: update.status === "failed" ? `Dispatch failed for ${target}` : `Task assigned to ${target}`,
          actor: leadName,
          actorRoleId: TEAM_LEAD_SPECIALIST_ID,
          target,
          targetRoleId: targetRosterId,
          timestamp: formatRelativeTime(session.createdAt),
          summary: summarizeText(
            typeof update.rawInput?.additionalInstructions === "string"
              ? update.rawInput.additionalInstructions
              : update.rawOutput?.output,
          ),
          sessionId: linkedStream?.session.sessionId ?? session.sessionId,
          memberSession: toMemberSessionSummary(
            linkedStream,
            linkedStream?.session ?? session,
            linkedStream?.actor ?? target,
            targetRosterId ?? resolveRosterSpecialistId(linkedStream?.session ?? session, agentsById),
          ),
          sortKey,
        });
      }

      if (updateType === "tool_call_update" && getToolEventLabel(update as Record<string, unknown>).includes("create_agent")) {
        const target = typeof update.rawInput?.name === "string" ? update.rawInput.name : "teammate";
        const targetRole = typeof update.rawInput?.role === "string" ? update.rawInput.role : undefined;
        items.push({
          id: `${sessionId}-create-agent-${index}`,
          type: "assign",
          title: `Created teammate ${target}`,
          actor: leadName,
          actorRoleId: TEAM_LEAD_SPECIALIST_ID,
          target,
          targetRoleId: targetRole,
          timestamp: formatRelativeTime(session.createdAt),
          summary: summarizeText(targetRole ? `${target} joined as ${targetRole}` : undefined),
          sortKey,
        });
      }
    });

    for (const child of descendantSessions) {
      const actor = getActorLabel(child, specialistsById, agentsById);
      const childRoleId = resolveRosterSpecialistId(child, agentsById) ?? child.specialistId;
      const childCreatedAt = new Date(child.createdAt).getTime();

      items.push({
        id: `${child.sessionId}-opened`,
        type: "assign",
        title: `Opened session for ${actor}`,
        actor: leadName,
        actorRoleId: TEAM_LEAD_SPECIALIST_ID,
        target: actor,
        targetRoleId: childRoleId,
        timestamp: formatRelativeTime(child.createdAt),
        summary: summarizeText(child.name ?? child.specialistId ?? child.role ?? child.provider),
        sessionId: child.sessionId,
        memberSession: toMemberSessionSummary(
          sessionStreamsBySessionId.get(child.sessionId),
          child,
          actor,
          childRoleId,
        ),
        sortKey: childCreatedAt,
      });

      const history = historiesBySessionId[child.sessionId] ?? [];
      history.forEach((entry, index) => {
        const update = entry.update;
        const updateType = update?.sessionUpdate;
        if (!updateType || !update) return;
        const sortKey = childCreatedAt + index / 1000;

        if (updateType === "task_completion") {
          const completion = inferCompletionEvent(child, actor, update);
          items.push({
            id: `${child.sessionId}-completion-${index}`,
            type: completion.type,
            title: completion.title,
            actor,
            actorRoleId: childRoleId,
            timestamp: formatRelativeTime(child.createdAt),
            summary: completion.summary,
            sessionId: child.sessionId,
            memberSession: toMemberSessionSummary(
              sessionStreamsBySessionId.get(child.sessionId),
              child,
              actor,
              childRoleId,
            ),
            sortKey,
          });
          return;
        }

        if (updateType === "acp_status" && update.status === "error") {
          items.push({
            id: `${child.sessionId}-error-${index}`,
            type: "blocked",
            title: `${actor} hit a runtime error`,
            actor,
            actorRoleId: childRoleId,
            timestamp: formatRelativeTime(child.createdAt),
            summary: summarizeText(update.error),
            sessionId: child.sessionId,
            memberSession: toMemberSessionSummary(
              sessionStreamsBySessionId.get(child.sessionId),
              child,
              actor,
              childRoleId,
            ),
            sortKey,
          });
        }
      });
    }

    return items
      .sort((a, b) => b.sortKey - a.sortKey)
      .slice(0, 24)
      .map(({ sortKey: _sortKey, ...item }) => item);
  }, [agentsById, descendantSessions, historiesBySessionId, latestChildSessionByRosterId, notesHook.notes, rootHistory, session, sessionId, sessionStreamsBySessionId, specialistsById]);

  const latestSessionBySpecialistId = useMemo(() => {
    const map = new Map<string, SessionStreamSummary>();
    for (const stream of sessionStreams) {
      const specialistId = resolveRosterSpecialistId(stream.session, agentsById);
      if (!specialistId) continue;
      if (!map.has(specialistId)) {
        map.set(specialistId, stream);
      }
    }
    return map;
  }, [agentsById, sessionStreams]);

  const sessionStreamByAgentId = useMemo(() => {
    const map = new Map<string, SessionStreamSummary>();
    for (const stream of sessionStreams) {
      if (!stream.session.routaAgentId) continue;
      map.set(stream.session.routaAgentId, stream);
    }
    return map;
  }, [sessionStreams]);

  const teamMembers = useMemo<TeamMemberItem[]>(() => {
    const leadStream = sessionStreams.find((stream) => stream.session.sessionId === sessionId);
    const leadItem: TeamMemberItem = {
      id: TEAM_LEAD_SPECIALIST_ID,
      actor: specialistsById.get(TEAM_LEAD_SPECIALIST_ID)?.name ?? "Agent Lead",
      roleId: TEAM_LEAD_SPECIALIST_ID,
      roleLabel: TEAM_LEAD_SPECIALIST_ID,
      status: session?.acpStatus === "error" ? "blocked" : "working",
      lastUpdatedLabel: leadStream?.lastUpdatedLabel ?? formatRelativeTime(session?.createdAt ?? new Date().toISOString()),
      sessionId,
      preview: leadStream?.preview,
      avatarLabel: avatarInitials(specialistsById.get(TEAM_LEAD_SPECIALIST_ID)?.name ?? "Agent Lead"),
    };

    if (createdAgents.length > 0) {
      return [
        leadItem,
        ...createdAgents.map(({ agent }) => {
          const linkedStream = sessionStreamByAgentId.get(agent.id);
          const rosterRoleId = agent.metadata?.rosterRoleId;
          const displayLabel = agent.metadata?.displayLabel ?? agent.name;
          return {
            id: agent.id,
            actor: displayLabel,
            roleId: rosterRoleId ?? agent.role,
            roleLabel: specialistsById.get(rosterRoleId ?? "")?.name ?? rosterRoleId ?? agent.role,
            status: linkedStream ? mapAgentStatus(linkedStream.session.acpStatus === "error" ? "ERROR" : agent.status) : mapAgentStatus(agent.status),
            lastUpdatedLabel: linkedStream?.lastUpdatedLabel ?? formatRelativeTime(agent.updatedAt ?? agent.createdAt),
            sessionId: linkedStream?.session.sessionId,
            preview: linkedStream?.preview ?? "Created and waiting for task dispatch",
            avatarLabel: avatarInitials(displayLabel),
          } satisfies TeamMemberItem;
        }),
      ];
    }

    const teamSpecialists = filterSpecialistsByCategory(specialists, "team")
      .sort((a, b) => {
        if (a.id === TEAM_LEAD_SPECIALIST_ID) return -1;
        if (b.id === TEAM_LEAD_SPECIALIST_ID) return 1;
        return a.name.localeCompare(b.name);
      });

    return teamSpecialists.map((specialist) => {
      const latest = specialist.id === TEAM_LEAD_SPECIALIST_ID
        ? (sessionStreams.find((stream) => stream.session.sessionId === sessionId) ?? latestSessionBySpecialistId.get(specialist.id))
        : latestSessionBySpecialistId.get(specialist.id);
      const latestHistory = latest ? historiesBySessionId[latest.session.sessionId] ?? [] : [];
      const latestCompletion = [...latestHistory].reverse().find((entry) => entry.update?.sessionUpdate === "task_completion");
      let status: TeamMemberStatus = "idle";

      if (specialist.id === TEAM_LEAD_SPECIALIST_ID && session) {
        status = session.acpStatus === "error" ? "blocked" : "working";
      } else if (latest?.session.acpStatus === "error" || normalizeTaskStatus(latestCompletion?.update?.taskStatus) === "blocked") {
        status = "blocked";
      } else if (normalizeTaskStatus(latestCompletion?.update?.taskStatus) === "done") {
        status = "done";
      } else if (normalizeTaskStatus(latestCompletion?.update?.taskStatus) === "waiting-review") {
        status = "reviewing";
      } else if (latest && !latestCompletion) {
        status = "working";
      }

      return {
        id: specialist.id,
        actor: latest ? getActorLabel(latest.session, specialistsById, agentsById) : specialist.name,
        roleId: specialist.id,
        roleLabel: specialist.name,
        status,
        lastUpdatedLabel: latest?.lastUpdatedLabel,
        sessionId: latest?.session.sessionId,
        preview: latest?.preview,
        avatarLabel: avatarInitials(latest ? getActorLabel(latest.session, specialistsById, agentsById) : specialist.name),
      };
    });
  }, [agentsById, createdAgents, historiesBySessionId, latestSessionBySpecialistId, session, sessionId, sessionStreams, sessionStreamByAgentId, specialists, specialistsById]);

  const memberCounts = useMemo(
    () => ({
      done: teamMembers.filter((member) => member.status === "done").length,
      active: teamMembers.filter((member) => member.status === "working" || member.status === "reviewing").length,
      blocked: teamMembers.filter((member) => member.status === "blocked").length,
    }),
    [teamMembers],
  );

  const pendingQuestionsBySessionId = useMemo(() => {
    const result = new Map<string, PendingSessionQuestion>();

    for (const [historySessionId, history] of Object.entries(historiesBySessionId)) {
      const pendingByToolCallId = new Map<string, PendingSessionQuestion>();

      for (const entry of history) {
        const update = entry.update;
        const toolCallId = update?.toolCallId;
        if (!toolCallId) continue;

        const askPayload = extractAskUserQuestionPayload(update);
        const hasAnswers = Boolean(askPayload?.answers && Object.keys(askPayload.answers).length > 0);
        const failedStatus = update?.status === "failed";

        if (askPayload) {
          if (failedStatus || hasAnswers) {
            pendingByToolCallId.delete(toolCallId);
            continue;
          }
          pendingByToolCallId.set(toolCallId, { ...askPayload, sessionId: historySessionId });
          continue;
        }

        if ((update?.status === "completed" || update?.status === "failed") && pendingByToolCallId.has(toolCallId)) {
          pendingByToolCallId.delete(toolCallId);
        }
      }

      const latestPending = [...pendingByToolCallId.values()].at(-1);
      if (latestPending) {
        result.set(historySessionId, latestPending);
      }
    }

    return result;
  }, [historiesBySessionId]);

  const handleSubmitSessionQuestion = useCallback(async (
    targetSessionId: string,
    toolCallId: string,
    response: Record<string, unknown>,
  ) => {
    const pending = pendingQuestionsBySessionId.get(targetSessionId);
    const responseText = Object.entries((response.answers as Record<string, string> | undefined) ?? {})
      .map(([question, answer]) => `${question}: ${answer}`)
      .join("\n");

    setHistoriesBySessionId((prev) => {
      const history = prev[targetSessionId] ?? [];
      return {
        ...prev,
        [targetSessionId]: history.map((entry) => (
          entry.update?.toolCallId === toolCallId
            ? {
              ...entry,
              update: {
                ...entry.update,
                status: "completed",
                rawInput: {
                  ...(entry.update?.rawInput ?? {}),
                  ...response,
                },
              },
            }
            : entry
        )),
      };
    });
    if (pending?.status === "completed") {
      void acp.promptSession(targetSessionId, responseText).catch(() => {});
    } else {
      void acp.respondToUserInputForSession(targetSessionId, toolCallId, response).catch(() => {});
    }
  }, [acp, pendingQuestionsBySessionId]);

  const deliverables = useMemo<DeliverableItem[]>(() => {
    const noteDeliverables = notesHook.notes.map((note) => {
      const sourceSession = note.sessionId ? allRunSessions.find((entry) => entry.sessionId === note.sessionId) : undefined;
      const ownerId = sourceSession ? resolveRosterSpecialistId(sourceSession, agentsById) ?? sourceSession.specialistId : undefined;
      return {
        id: `note-${note.id}`,
        label: inferDeliverableLabel(note, ownerId),
        title: note.title,
        owner: sourceSession ? getActorLabel(sourceSession, specialistsById, agentsById) : "Agent Lead",
        status:
          note.metadata.type === "spec"
            ? "approved"
            : normalizeTaskStatus(note.metadata.taskStatus) === "done"
              ? "approved"
              : normalizeTaskStatus(note.metadata.taskStatus) === "waiting-review"
                ? "review"
                : "draft",
        summary: summarizeText(note.content),
        sessionId: note.sessionId,
        updatedAt: new Date(note.updatedAt).getTime(),
      } satisfies DeliverableItem;
    });

    const sessionDeliverables = descendantSessions.flatMap((entry) => {
      const actor = getActorLabel(entry, specialistsById, agentsById);
      const history = historiesBySessionId[entry.sessionId] ?? [];
      const latestCompletion = [...history].reverse().find((item) => item.update?.sessionUpdate === "task_completion");
      if (!latestCompletion?.update) return [];
      return [{
        id: `session-${entry.sessionId}`,
        label: inferSessionDeliverableLabel(entry.specialistId),
        title: entry.name ?? actor,
        owner: actor,
        status:
          normalizeTaskStatus(latestCompletion.update.taskStatus) === "done"
            ? "approved"
            : normalizeTaskStatus(latestCompletion.update.taskStatus) === "waiting-review"
              ? "review"
              : "draft",
        summary: summarizeText(latestCompletion.update.completionSummary ?? extractHistoryText(latestCompletion.update)),
        sessionId: entry.sessionId,
        updatedAt: new Date(entry.createdAt).getTime(),
      } satisfies DeliverableItem];
    });

    return [...noteDeliverables, ...sessionDeliverables]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8);
  }, [agentsById, allRunSessions, descendantSessions, historiesBySessionId, notesHook.notes, specialistsById]);

  const completionByAgentId = useMemo(() => {
    const map = new Map<string, NonNullable<SessionHistoryEntry["update"]>>();
    for (const entry of rootHistory) {
      const update = entry.update;
      if (update?.sessionUpdate !== "task_completion" || typeof update.agentId !== "string") continue;
      map.set(update.agentId, update);
    }
    return map;
  }, [rootHistory]);

  const leadMessages = useMemo(
    () => buildTranscriptMessages(rootHistory, sessionId, { hideLowSignalAssistant: true }),
    [rootHistory, sessionId],
  );

  const sessionLanes = useMemo<SessionLaneItem[]>(() => {
    const leadStatus = session?.acpStatus === "error" ? "blocked" : "working";
    const leadSnippets = buildLaneSnippets(rootHistory.filter((entry) => {
      const type = entry.update?.sessionUpdate;
      return type === "user_message" || type === "agent_message" || type === "tool_call_update" || type === "task_completion";
    }), 4);

    const leadLane: SessionLaneItem = {
      id: `lane-${sessionId}`,
      sessionId,
      actor: specialistsById.get(TEAM_LEAD_SPECIALIST_ID)?.name ?? "Agent Lead",
      roleId: TEAM_LEAD_SPECIALIST_ID,
      roleLabel: specialistsById.get(TEAM_LEAD_SPECIALIST_ID)?.name ?? "Agent Lead",
      badge: "lead",
      sessionName: session?.name ?? sessionId,
      status: leadStatus,
      lastUpdatedLabel: selectedSessionStream?.session.sessionId === sessionId
        ? selectedSessionStream.lastUpdatedLabel
        : formatRelativeTime(session?.createdAt ?? new Date().toISOString()),
      provider: session?.provider,
      eventCount: rootHistory.length,
      snippets: leadSnippets,
      messages: leadMessages,
      pendingQuestion: pendingQuestionsBySessionId.get(sessionId) ?? null,
      isLead: true,
    };

    const childLanes = sessionStreams
      .filter((stream) => stream.session.parentSessionId)
      .map((stream) => {
        const history = historiesBySessionId[stream.session.sessionId] ?? [];
        const member = teamMembers.find((item) => item.sessionId === stream.session.sessionId);
        const completion = stream.session.routaAgentId ? completionByAgentId.get(stream.session.routaAgentId) : undefined;
        const roleId = resolveRosterSpecialistId(stream.session, agentsById) ?? stream.session.specialistId;
        const snippets = buildLaneSnippets(history, 4);
        if (completion?.completionSummary && !isLowSignalLeadMessage(completion.completionSummary)) {
          snippets.push({
            id: `${stream.session.sessionId}-report-back`,
            label: "Report back",
            text: completion.completionSummary,
            kind: "report",
            tone: normalizeTaskStatus(completion.taskStatus) === "blocked" ? "blocked" : "complete",
          });
        }
        return {
          id: `lane-${stream.session.sessionId}`,
          sessionId: stream.session.sessionId,
          actor: stream.actor,
          roleId,
          roleLabel: member?.roleLabel
            ?? specialistsById.get(roleId ?? "")?.name
            ?? stream.session.role
            ?? stream.session.specialistId
            ?? "Member",
          badge: stream.badge,
          sessionName: stream.session.name ?? stream.session.sessionId,
          status: member?.status ?? "working",
          lastUpdatedLabel: stream.lastUpdatedLabel,
          provider: stream.session.provider,
          eventCount: stream.eventCount,
          snippets: snippets.slice(-4),
          messages: buildTranscriptMessages(history, stream.session.sessionId),
          completionSummary: completion?.completionSummary,
          pendingQuestion: pendingQuestionsBySessionId.get(stream.session.sessionId) ?? null,
        } satisfies SessionLaneItem;
      })
      .sort((a, b) => {
        if (a.status === "working" && b.status !== "working") return -1;
        if (b.status === "working" && a.status !== "working") return 1;
        const aStream = sessionStreams.find((stream) => stream.session.sessionId === a.sessionId);
        const bStream = sessionStreams.find((stream) => stream.session.sessionId === b.sessionId);
        return (bStream?.lastUpdatedAt ?? 0) - (aStream?.lastUpdatedAt ?? 0) || a.actor.localeCompare(b.actor);
      });

    return [leadLane, ...childLanes];
  }, [agentsById, completionByAgentId, historiesBySessionId, leadMessages, pendingQuestionsBySessionId, rootHistory, selectedSessionStream, session, sessionId, sessionStreams, specialistsById, teamMembers]);
  const memberLaneByToolCallId = useMemo(() => {
    const toolCallMap = new Map<string, SessionLaneItem>();
    for (const entry of rootHistory) {
      const update = entry.update;
      if (!update || update.sessionUpdate !== "tool_call_update" || !update.toolCallId) continue;
      const toolLabel = getToolEventLabel(update as Record<string, unknown>);
      if (!toolLabel.includes("delegate_task")) continue;
      const targetRosterId = resolveDelegationRosterSpecialistId(update);
      const linkedStream = targetRosterId
        ? latestChildSessionByRosterId.get(targetRosterId)
        : undefined;
      const lane = linkedStream
        ? sessionLanes.find((item) => item.sessionId === linkedStream.session.sessionId)
        : undefined;
      if (lane) {
        toolCallMap.set(update.toolCallId, lane);
      }
    }
    return toolCallMap;
  }, [latestChildSessionByRosterId, rootHistory, sessionLanes]);

  const displayedLeadMessages = useMemo(
    () => (
      leadMessages.length > 0
        ? leadMessages
        : buildFallbackLeadMessages(objective, sessionId, sessionLanes, rootHistory)
    ),
    [leadMessages, objective, rootHistory, sessionId, sessionLanes],
  );

  const displayedMemberLaneByToolCallId = useMemo(() => {
    if (memberLaneByToolCallId.size > 0) return memberLaneByToolCallId;
    const fallbackMap = new Map<string, SessionLaneItem>();
    for (const lane of sessionLanes) {
      if (lane.isLead) continue;
      fallbackMap.set(`synthetic-delegate-${lane.sessionId}`, lane);
    }
    return fallbackMap;
  }, [memberLaneByToolCallId, sessionLanes]);

  if (!session) {
    return (
      <div className="desktop-theme flex h-screen items-center justify-center bg-desktop-bg-primary">
        <div className="text-sm text-desktop-text-secondary">Loading Team run...</div>
      </div>
    );
  }

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspace?.title ?? workspaceId}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId}
          activeWorkspaceTitle={workspace?.title ?? workspaceId}
          onSelect={(nextWorkspaceId) => router.push(`/workspace/${nextWorkspaceId}/team`)}
          onCreate={async (title) => {
            const nextWorkspace = await workspacesHook.createWorkspace(title);
            if (nextWorkspace) {
              router.push(`/workspace/${nextWorkspace.id}/team`);
            }
          }}
          loading={workspacesHook.loading}
          compact
        />
      )}
    >
      <div className="flex h-full flex-col overflow-hidden bg-desktop-bg-primary">
        <header className="shrink-0 border-b border-desktop-border px-4 py-3" data-testid="team-run-page-header">
          <div className="mx-auto flex w-full max-w-[1760px] items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                href={`/workspace/${workspaceId}/team`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Team
              </Link>
              <svg className="h-4 w-4 shrink-0 text-desktop-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-2.844.813a1.125 1.125 0 0 0 0 2.124l2.844.813.813 2.844a1.125 1.125 0 0 0 2.124 0l.813-2.844 2.844-.813a1.125 1.125 0 0 0 0-2.124l-2.844-.813-.813-2.844a1.125 1.125 0 0 0-2.124 0ZM18.259 8.715 18 9.75l-1.035.259a.75.75 0 0 0 0 1.482L18 11.75l.259 1.035a.75.75 0 0 0 1.482 0L20 11.75l1.035-.259a.75.75 0 0 0 0-1.482L20 9.75l-.259-1.035a.75.75 0 0 0-1.482 0ZM16.894 20.567 16.5 22.125l-1.558.394a.562.562 0 0 0 0 1.081l1.558.394.394 1.558a.562.562 0 0 0 1.081 0l.394-1.558 1.558-.394a.562.562 0 0 0 0-1.081l-1.558-.394-.394-1.558a.562.562 0 0 0-1.081 0Z" />
              </svg>
              <div className="min-w-0">
                <h1 className="truncate text-[13px] font-semibold text-desktop-text-primary">
                  {session.name ?? "Team run"}
                </h1>
                <p className="text-[11px] text-desktop-text-secondary">
                  Follow the lead session, spawned member sessions, and inline reports back to lead
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded border border-desktop-border px-2 py-1 text-[10px] text-desktop-text-secondary">
                <span>Session:</span>
                <code className="font-mono text-desktop-text-primary">{sessionId.slice(0, 8)}…</code>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded border border-desktop-border px-2 py-1 text-[10px] text-desktop-text-secondary">
                <span>{formatRelativeTime(session.createdAt)}</span>
                <span className="opacity-40">/</span>
                <span>{session.provider ?? "auto"}</span>
                <span className="opacity-40">/</span>
                <span>{acpConnected ? "live" : "reconnecting"}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href={`/workspace/${workspaceId}/team`}
                className="inline-flex items-center gap-1.5 rounded-md bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Team
              </Link>
              <button
                type="button"
                onClick={() => setRefreshKey((current) => current + 1)}
                className="rounded-md bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
              >
                Refresh
              </button>
              <Link
                href={`/workspace/${workspaceId}/sessions/${sessionId}`}
                className="rounded-md bg-desktop-accent px-2.5 py-1.5 text-[11px] font-medium text-desktop-accent-text transition-colors hover:opacity-90"
              >
                Open raw session
              </Link>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)_320px] xl:grid-cols-[300px_minmax(0,1fr)_340px]">
          <ObjectiveSidebarSection
            objective={objective}
            memberCounts={memberCounts}
            taskTree={taskTree}
            deliverables={deliverables}
            onFocusSession={focusSessionBlock}
          />

          <div className="flex min-h-0 flex-col">
            <SessionTimelineSection
              leadMessages={displayedLeadMessages}
              memberLaneByToolCallId={displayedMemberLaneByToolCallId}
              sessionLanes={sessionLanes}
              selectedSessionId={selectedSessionId}
              onSelectSession={focusSessionBlock}
              onOpenViewer={(nextSessionId) => setSelectedSessionForModal(nextSessionId)}
              onSubmitQuestion={handleSubmitSessionQuestion}
              sessionBlockRef={(nextSessionId, node) => {
                sessionBlockRefs.current[nextSessionId] = node;
              }}
            />

            <div className="border-t border-desktop-border bg-desktop-bg-primary px-3 py-2">
              <TiptapInput
                key={timelineInputKey}
                onSend={(text) => handleTimelinePrompt(text)}
                disabled={!acpConnected}
                loading={acpLoading}
                skills={[]}
                repoSkills={[]}
                providers={acpProviders}
                selectedProvider={acpSelectedProvider}
                onProviderChange={acpSetProvider}
                sessions={[]}
                repoSelection={null}
                onRepoChange={() => {}}
                agentRole={session.role}
              />
            </div>
          </div>

          <TeamMembersSection
            teamMembers={teamMembers}
            selectedSessionId={selectedSessionStream?.session.sessionId}
            onFocusSession={focusSessionBlock}
          />
        </div>
      </div>

      {selectedSessionForModal && selectedSessionStream && (
        <OverlayModal
          onClose={() => setSelectedSessionForModal(null)}
          title={`${selectedSessionStream.actor} Session`}
        >
          <div className="flex h-full min-h-0 bg-desktop-bg-primary">
            <div className="flex w-80 shrink-0 flex-col border-r border-desktop-border bg-desktop-bg-secondary">
              <div className="border-b border-desktop-border px-4 py-3">
                <div className="text-sm font-semibold text-desktop-text-primary">Run Sessions</div>
                <div className="mt-1 text-xs text-desktop-text-secondary">Shared session viewer reused from kanban/chat.</div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <div className="space-y-2">
                  {sessionStreams.map((stream) => {
                    const active = stream.session.sessionId === selectedSessionForModal;
                    return (
                      <button
                        key={stream.session.sessionId}
                        type="button"
                        onClick={() => setSelectedSessionForModal(stream.session.sessionId)}
                        className={`w-full rounded-2xl border p-3 text-left transition ${
                          active
                            ? "border-cyan-300 bg-cyan-50/80 dark:border-cyan-800 dark:bg-cyan-950/20"
                            : "border-desktop-border bg-desktop-bg-primary hover:border-cyan-300 hover:bg-desktop-bg-active/80"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-desktop-text-primary">{stream.actor}</div>
                            <div className="mt-1 truncate text-[11px] text-desktop-text-secondary">{stream.session.name ?? stream.session.sessionId}</div>
                          </div>
                          <span className="shrink-0 rounded-full border border-desktop-border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-desktop-text-secondary">
                            {stream.badge}
                          </span>
                        </div>
                        <div className="mt-3 line-clamp-3 text-xs leading-5 text-desktop-text-secondary">
                          {stream.preview ?? "No transcript content yet."}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <div className="border-b border-desktop-border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-desktop-text-secondary">
                  <span>{selectedSessionStream.session.name ?? selectedSessionStream.session.sessionId}</span>
                  <span className="opacity-40">/</span>
                  <span>{selectedSessionStream.badge}</span>
                  <span className="opacity-40">/</span>
                  <span>{selectedSessionStream.lastUpdatedLabel}</span>
                  <span className="opacity-40">/</span>
                  <Link
                    href={`/workspace/${workspaceId}/sessions/${selectedSessionStream.session.sessionId}`}
                    className="text-cyan-600 transition hover:text-cyan-500"
                  >
                    Open raw session
                  </Link>
                </div>
              </div>
              <div className="h-[calc(80vh-89px)]">
                <ChatPanel
                  acp={modalAcp}
                  activeSessionId={selectedSessionForModal}
                  onEnsureSession={async () => selectedSessionForModal}
                  onSelectSession={async (nextSessionId) => {
                    setSelectedSessionForModal(nextSessionId);
                    selectModalSession(nextSessionId);
                  }}
                  repoSelection={null}
                  onRepoChange={() => {}}
                  activeWorkspaceId={workspaceId}
                  agentRole={selectedSessionStream.session.role}
                />
              </div>
            </div>
          </div>
        </OverlayModal>
      )}
    </DesktopAppShell>
  );
}
