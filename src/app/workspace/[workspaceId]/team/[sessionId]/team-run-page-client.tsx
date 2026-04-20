"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import type { ChatMessage } from "@/client/components/chat-panel/types";
import { getToolEventLabel } from "@/client/components/chat-panel/tool-call-name";
import { TiptapInput } from "@/client/components/tiptap-input";
import { useAcp } from "@/client/hooks/use-acp";
import { useNotes } from "@/client/hooks/use-notes";
import { consumePendingPrompt } from "@/client/utils/pending-prompt";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { RepoSelection } from "@/client/components/repo-picker";
import type { AcpSessionNotification } from "@/core/store/acp-session-store";
import {
  historyNotificationsToMessages,
  hydrateTranscriptMessages,
  type SessionTranscriptPayload,
} from "@/core/session-transcript";
import { filterSpecialistsByCategory } from "@/client/utils/specialist-categories";
import { formatRelativeTime } from "../../ui-components";
import type { SessionInfo } from "../../types";
import {
  avatarInitials,
  buildLaneSnippets,
  extractAskUserQuestionPayload,
  extractDelegationSessionId,
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
import { TeamRunSessionModal } from "./team-run-session-modal";
import { TeamRunPageHeader } from "./team-run-page-header";
import { useRealTeamRunParams } from "./use-real-team-run-params";
import { useTranslation } from "@/i18n";


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

function delegationRoleMatchesSession(targetRosterId: string, child: SessionInfo): boolean {
  const normalizedRole = (child.role ?? "").toUpperCase();
  if (targetRosterId === "team-qa") {
    return normalizedRole === "GATE";
  }
  if (targetRosterId === "team-code-reviewer") {
    return normalizedRole === "GATE" || normalizedRole === "DEVELOPER";
  }
  if (targetRosterId === TEAM_LEAD_SPECIALIST_ID) {
    return normalizedRole === "ROUTA";
  }
  return normalizedRole === "CRAFTER" || normalizedRole === "DEVELOPER";
}

export function TeamRunPageClient() {
  const { t } = useTranslation();
  const router = useRouter();
  const { workspaceId, sessionId, isResolved } = useRealTeamRunParams();

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
  const { codebases } = useCodebases(workspaceId);
  const notesHook = useNotes(workspaceId, sessionId);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [workspaceSessions, setWorkspaceSessions] = useState<SessionInfo[]>([]);
  const [teamRuns, setTeamRuns] = useState<SessionInfo[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistSummary[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [historiesBySessionId, setHistoriesBySessionId] = useState<Record<string, SessionHistoryEntry[]>>({});
  const [messagesBySessionId, setMessagesBySessionId] = useState<Record<string, ChatMessage[]>>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string>(sessionId);
  const [selectedSessionForModal, setSelectedSessionForModal] = useState<string | null>(null);
  const [timelineInputKey, setTimelineInputKey] = useState(0);
  const [repoSelection, setRepoSelection] = useState<RepoSelection | null>(null);
  const [isSwitchingTeamRun, setIsSwitchingTeamRun] = useState(false);
  const sessionBlockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastUpdateIndexRef = useRef(0);
  const pendingPromptSentRef = useRef<Set<string>>(new Set());
  const pendingPromptTextRef = useRef<string | null>(null);
  const contextKeyRef = useRef(`${workspaceId}:${sessionId}`);
  const metadataRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadataRefreshInFlightRef = useRef(false);
  const metadataRefreshQueuedRef = useRef(false);
  const transcriptRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRefreshInFlightRef = useRef(false);
  const pendingTranscriptSessionIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setIsSwitchingTeamRun(true);
    contextKeyRef.current = `${workspaceId}:${sessionId}`;
  }, [sessionId, workspaceId]);

  useEffect(() => {
    if (!acpConnected && !acpLoading) {
      void connectAcp();
    }
  }, [acpConnected, acpLoading, connectAcp]);

  useEffect(() => {
    if (!isResolved || !acpConnected || !session || session.sessionId !== sessionId || sessionId === "__placeholder__") {
      return;
    }
    if (acp.sessionId === sessionId) return;
    selectSession(sessionId);
  }, [acp.sessionId, acpConnected, isResolved, selectSession, session, sessionId]);

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

  useEffect(() => {
    if (!session?.provider) return;
    acpSetProvider(session.provider);
  }, [acpSetProvider, session?.provider]);

  useEffect(() => {
    if (session?.cwd) {
      setRepoSelection((currentSelection) => {
        const nextSelection: RepoSelection = {
          path: session.cwd,
          branch: session.branch ?? "",
          name: session.cwd.split("/").pop() ?? session.cwd,
        };

        if (
          currentSelection?.path === nextSelection.path
          && currentSelection?.branch === nextSelection.branch
          && currentSelection?.name === nextSelection.name
        ) {
          return currentSelection;
        }

        return nextSelection;
      });
      return;
    }

    if (codebases.length === 0) return;
    const defaultCodebase = codebases.find((codebase) => codebase.isDefault) ?? codebases[0];
    setRepoSelection((currentSelection) => {
      const nextSelection: RepoSelection = {
        path: defaultCodebase.repoPath,
        branch: defaultCodebase.branch ?? "",
        name: defaultCodebase.label ?? defaultCodebase.repoPath.split("/").pop() ?? defaultCodebase.repoPath,
      };

      if (
        currentSelection?.path === nextSelection.path
        && currentSelection?.branch === nextSelection.branch
        && currentSelection?.name === nextSelection.name
      ) {
        return currentSelection;
      }

      return nextSelection;
    });
  // NOTE: `repoSelection` is intentionally excluded from deps.
  // This effect syncs repoSelection FROM session/codebases data on mount or
  // when session metadata changes — it must NOT re-fire when the user switches
  // branches locally, or it would overwrite the new branch with session.branch.
  }, [codebases, session?.branch, session?.cwd]);

  const fetchSpecialists = useCallback(async () => {
    const response = await desktopAwareFetch("/api/specialists", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (contextKeyRef.current !== `${workspaceId}:${sessionId}`) return;
    setSpecialists(Array.isArray(data?.specialists) ? data.specialists : []);
  }, [sessionId, workspaceId]);

  const fetchRunMetadata = useCallback(async () => {
    const contextKey = `${workspaceId}:${sessionId}`;
    const [sessionRes, sessionsRes, teamRunsRes, agentsRes] = await Promise.all([
      desktopAwareFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" }),
      desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }),
      desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&surface=team`, { cache: "no-store" }),
      desktopAwareFetch(`/api/agents?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }),
    ]);

    const sessionData = await sessionRes.json().catch(() => ({}));
    const sessionsData = await sessionsRes.json().catch(() => ({}));
    const teamRunsData = await teamRunsRes.json().catch(() => ({}));
    const agentsData = await agentsRes.json().catch(() => ({}));

    if (contextKeyRef.current !== contextKey) return;
    if (sessionData?.session) {
      setSession(sessionData.session as SessionInfo);
    }
    if (Array.isArray(sessionsData?.sessions)) {
      setWorkspaceSessions(sessionsData.sessions);
    }
    if (Array.isArray(teamRunsData?.sessions)) {
      setTeamRuns(teamRunsData.sessions);
    }
    if (Array.isArray(agentsData?.agents)) {
      setAgents(agentsData.agents);
    }
    setIsSwitchingTeamRun(false);
  }, [sessionId, workspaceId]);

  const fetchSessionTranscripts = useCallback(async (targetSessionIds: string[]) => {
    const uniqueSessionIds = [...new Set(targetSessionIds.filter(Boolean))];
    if (uniqueSessionIds.length === 0) return;

    const contextKey = `${workspaceId}:${sessionId}`;
    const transcriptEntries = await Promise.all(
      uniqueSessionIds.map(async (targetSessionId) => {
        const response = await desktopAwareFetch(
          `/api/sessions/${encodeURIComponent(targetSessionId)}/transcript`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({})) as Partial<SessionTranscriptPayload>;
        return {
          sessionId: targetSessionId,
          history: Array.isArray(data?.history) ? data.history as SessionHistoryEntry[] : [],
          messages: hydrateTranscriptMessages(Array.isArray(data?.messages) ? data.messages : []),
        };
      }),
    );

    if (contextKeyRef.current !== contextKey) return;

    setHistoriesBySessionId((prev) => ({
      ...prev,
      ...Object.fromEntries(transcriptEntries.map((entry) => [entry.sessionId, entry.history])),
    }));
    setMessagesBySessionId((prev) => ({
      ...prev,
      ...Object.fromEntries(transcriptEntries.map((entry) => [entry.sessionId, entry.messages])),
    }));
  }, [sessionId, workspaceId]);

  const flushMetadataRefresh = useCallback(async () => {
    if (metadataRefreshInFlightRef.current) {
      metadataRefreshQueuedRef.current = true;
      return;
    }

    metadataRefreshInFlightRef.current = true;
    metadataRefreshQueuedRef.current = false;

    try {
      await fetchRunMetadata();
    } catch {
      // keep existing session view while attempting to refresh metadata.
      // If this load is still for the current context, we only surface loading state naturally
      // when no session has ever been resolved.
    } finally {
      metadataRefreshInFlightRef.current = false;
      setIsSwitchingTeamRun(false);
      if (metadataRefreshQueuedRef.current) {
        metadataRefreshQueuedRef.current = false;
        void flushMetadataRefresh();
      }
    }
  }, [fetchRunMetadata]);

  const requestMetadataRefresh = useCallback((delayMs = 250) => {
    if (metadataRefreshTimerRef.current) {
      clearTimeout(metadataRefreshTimerRef.current);
    }

    metadataRefreshTimerRef.current = setTimeout(() => {
      metadataRefreshTimerRef.current = null;
      void flushMetadataRefresh();
    }, delayMs);
  }, [flushMetadataRefresh]);

  const flushTranscriptRefresh = useCallback(async () => {
    if (transcriptRefreshInFlightRef.current) {
      return;
    }

    const targetSessionIds = [...pendingTranscriptSessionIdsRef.current];
    if (targetSessionIds.length === 0) return;

    pendingTranscriptSessionIdsRef.current.clear();
    transcriptRefreshInFlightRef.current = true;

    try {
      await fetchSessionTranscripts(targetSessionIds);
    } catch {
      if (contextKeyRef.current === `${workspaceId}:${sessionId}`) {
        setHistoriesBySessionId((prev) => {
          const next = { ...prev };
          for (const targetSessionId of targetSessionIds) {
            delete next[targetSessionId];
          }
          return next;
        });
        setMessagesBySessionId((prev) => {
          const next = { ...prev };
          for (const targetSessionId of targetSessionIds) {
            delete next[targetSessionId];
          }
          return next;
        });
      }
    } finally {
      transcriptRefreshInFlightRef.current = false;
      if (pendingTranscriptSessionIdsRef.current.size > 0) {
        void flushTranscriptRefresh();
      }
    }
  }, [fetchSessionTranscripts, sessionId, workspaceId]);

  const requestTranscriptRefresh = useCallback((targetSessionIds: string[], delayMs = 200) => {
    for (const targetSessionId of targetSessionIds) {
      if (targetSessionId) {
        pendingTranscriptSessionIdsRef.current.add(targetSessionId);
      }
    }

    if (pendingTranscriptSessionIdsRef.current.size === 0) return;

    if (transcriptRefreshTimerRef.current) {
      clearTimeout(transcriptRefreshTimerRef.current);
    }

    transcriptRefreshTimerRef.current = setTimeout(() => {
      transcriptRefreshTimerRef.current = null;
      void flushTranscriptRefresh();
    }, delayMs);
  }, [flushTranscriptRefresh]);

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
    lastUpdateIndexRef.current = 0;
    const pendingTranscriptSessionIds = pendingTranscriptSessionIdsRef.current;
    pendingTranscriptSessionIds.clear();

    void fetchSpecialists();
    void flushMetadataRefresh();

    return () => {
      if (metadataRefreshTimerRef.current) {
        clearTimeout(metadataRefreshTimerRef.current);
        metadataRefreshTimerRef.current = null;
      }
      if (transcriptRefreshTimerRef.current) {
        clearTimeout(transcriptRefreshTimerRef.current);
        transcriptRefreshTimerRef.current = null;
      }
      pendingTranscriptSessionIds.clear();
    };
  }, [fetchSpecialists, flushMetadataRefresh, sessionId, workspaceId]);

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
    const sessionIdsToLoad = session ? [session.sessionId, ...descendantSessions.map((entry) => entry.sessionId)] : [];
    if (sessionIdsToLoad.length === 0) return;
    requestTranscriptRefresh(sessionIdsToLoad, 0);
  }, [descendantSessions, requestTranscriptRefresh, session]);

  useEffect(() => {
    if (!acpUpdates.length) {
      lastUpdateIndexRef.current = 0;
      return;
    }

    const startIndex = lastUpdateIndexRef.current > acpUpdates.length ? 0 : lastUpdateIndexRef.current;
    const pending = acpUpdates.slice(startIndex);
    if (!pending.length) return;
    lastUpdateIndexRef.current = acpUpdates.length;

    const normalizedPending = pending.map((entry) => ({
      sessionId,
      update: ((entry as Record<string, unknown>).update ?? entry) as SessionHistoryEntry["update"],
    })) as SessionHistoryEntry[];

    setHistoriesBySessionId((prev) => {
      const existing = prev[sessionId] ?? [];
      const merged = existing.concat(normalizedPending);
      setMessagesBySessionId((prevMessages) => ({
        ...prevMessages,
        [sessionId]: historyNotificationsToMessages(merged as AcpSessionNotification[], sessionId),
      }));
      return {
        ...prev,
        [sessionId]: merged,
      };
    });

    const shouldRefreshTeamStructure = normalizedPending.some((entry) => {
      const update = entry.update;
      const kind = update?.sessionUpdate;
      if (!kind) return false;
      if (kind === "tool_call" || kind === "tool_call_update") {
        const toolLabel = getToolEventLabel(update as Record<string, unknown>);
        return (
          toolLabel.includes("create_agent")
          || toolLabel.includes("delegate_task")
          || toolLabel.includes("delegate_task_to_agent")
          || toolLabel.includes("report_to_parent")
          || toolLabel.includes("set_agent_name")
        );
      }
      return kind !== "agent_message_chunk" && kind !== "agent_thought_chunk";
    });

    if (shouldRefreshTeamStructure) {
      requestMetadataRefresh();
      const descendantSessionIds = descendantSessions.map((entry) => entry.sessionId);
      if (descendantSessionIds.length > 0) {
        requestTranscriptRefresh(descendantSessionIds);
      }
    }
  }, [acpUpdates, descendantSessions, requestMetadataRefresh, requestTranscriptRefresh, sessionId]);

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

  const rootHistory = useMemo(
    () => historiesBySessionId[sessionId] ?? [],
    [historiesBySessionId, sessionId],
  );

  const delegatedRosterIdsBySessionId = useMemo(() => {
    const map = new Map<string, string>();
    const pendingDelegations: string[] = [];

    for (const entry of rootHistory) {
      const update = entry.update;
      if (!update || update.sessionUpdate !== "tool_call_update") continue;
      const toolLabel = getToolEventLabel(update as Record<string, unknown>);
      if (!toolLabel.includes("delegate_task")) continue;
      const targetRosterId = resolveDelegationRosterSpecialistId(update);
      if (!targetRosterId) continue;
      const delegatedSessionId = extractDelegationSessionId(update);
      if (delegatedSessionId) {
        map.set(delegatedSessionId, targetRosterId);
        continue;
      }
      if (update.status === "in_progress" || update.status === "completed") {
        pendingDelegations.push(targetRosterId);
      }
    }

    if (pendingDelegations.length === 0) {
      return map;
    }

    const unmatchedChildren = [...descendantSessions]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .filter((child) => !map.has(child.sessionId));

    for (const targetRosterId of pendingDelegations) {
      const nextMatchIndex = unmatchedChildren.findIndex((child) => delegationRoleMatchesSession(targetRosterId, child));
      if (nextMatchIndex < 0) continue;
      const [matchedChild] = unmatchedChildren.splice(nextMatchIndex, 1);
      if (matchedChild) {
        map.set(matchedChild.sessionId, targetRosterId);
      }
    }

    return map;
  }, [descendantSessions, rootHistory]);

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
          actor: getActorLabel(entry, specialistsById, agentsById, delegatedRosterIdsBySessionId),
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
  }, [agentsById, allRunSessions, delegatedRosterIdsBySessionId, historiesBySessionId, sessionId, specialistsById]);

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
      const rosterId = resolveRosterSpecialistId(stream.session, agentsById, delegatedRosterIdsBySessionId);
      if (!rosterId && !stream.session.specialistId) continue;
      map.set(rosterId ?? stream.session.specialistId ?? stream.session.sessionId, stream);
    }
    return map;
  }, [agentsById, delegatedRosterIdsBySessionId, sessionStreams]);

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
            targetRosterId ?? resolveRosterSpecialistId(linkedStream?.session ?? session, agentsById, delegatedRosterIdsBySessionId),
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
      const actor = getActorLabel(child, specialistsById, agentsById, delegatedRosterIdsBySessionId);
      const childRoleId = resolveRosterSpecialistId(child, agentsById, delegatedRosterIdsBySessionId) ?? child.specialistId;
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
  }, [agentsById, delegatedRosterIdsBySessionId, descendantSessions, historiesBySessionId, latestChildSessionByRosterId, notesHook.notes, rootHistory, session, sessionId, sessionStreamsBySessionId, specialistsById]);

  const latestSessionBySpecialistId = useMemo(() => {
    const map = new Map<string, SessionStreamSummary>();
    for (const stream of sessionStreams) {
      const specialistId = resolveRosterSpecialistId(stream.session, agentsById, delegatedRosterIdsBySessionId);
      if (!specialistId) continue;
      if (!map.has(specialistId)) {
        map.set(specialistId, stream);
      }
    }
    return map;
  }, [agentsById, delegatedRosterIdsBySessionId, sessionStreams]);

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
        actor: latest ? getActorLabel(latest.session, specialistsById, agentsById, delegatedRosterIdsBySessionId) : specialist.name,
        roleId: specialist.id,
        roleLabel: specialist.name,
        status,
        lastUpdatedLabel: latest?.lastUpdatedLabel,
        sessionId: latest?.session.sessionId,
        preview: latest?.preview,
        avatarLabel: avatarInitials(latest ? getActorLabel(latest.session, specialistsById, agentsById, delegatedRosterIdsBySessionId) : specialist.name),
      };
    });
  }, [agentsById, createdAgents, delegatedRosterIdsBySessionId, historiesBySessionId, latestSessionBySpecialistId, session, sessionId, sessionStreams, sessionStreamByAgentId, specialists, specialistsById]);

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
      const ownerId = sourceSession
        ? resolveRosterSpecialistId(sourceSession, agentsById, delegatedRosterIdsBySessionId) ?? sourceSession.specialistId
        : undefined;
      return {
        id: `note-${note.id}`,
        label: inferDeliverableLabel(note, ownerId),
        title: note.title,
        owner: sourceSession ? getActorLabel(sourceSession, specialistsById, agentsById, delegatedRosterIdsBySessionId) : "Agent Lead",
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
      const actor = getActorLabel(entry, specialistsById, agentsById, delegatedRosterIdsBySessionId);
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
  }, [agentsById, allRunSessions, delegatedRosterIdsBySessionId, descendantSessions, historiesBySessionId, notesHook.notes, specialistsById]);

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
    () => (messagesBySessionId[sessionId] ?? []).filter((message) => {
      if (message.role === "assistant" && isLowSignalLeadMessage(message.content)) {
        return false;
      }
      if (message.role === "info" && !message.content.trim()) {
        return false;
      }
      return true;
    }),
    [messagesBySessionId, sessionId],
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
        const roleId = resolveRosterSpecialistId(stream.session, agentsById, delegatedRosterIdsBySessionId) ?? stream.session.specialistId;
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
          messages: messagesBySessionId[stream.session.sessionId] ?? [],
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
  }, [agentsById, completionByAgentId, delegatedRosterIdsBySessionId, historiesBySessionId, leadMessages, messagesBySessionId, pendingQuestionsBySessionId, rootHistory, selectedSessionStream, session, sessionId, sessionStreams, specialistsById, teamMembers]);
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

  const selectedTeamRun = useMemo(
    () => teamRuns.find((run) => run.sessionId === sessionId) ?? teamRuns[0],
    [teamRuns, sessionId],
  );
  const isActiveSessionReady = session?.sessionId === sessionId;
  const selectedTeamRunName = isActiveSessionReady
    ? (session?.name ?? sessionId)
    : (selectedTeamRun?.name ?? sessionId);
  const showRunLoadingState = !isActiveSessionReady;

  const handleSwitchTeamRun = useCallback((nextSessionId: string) => {
    if (nextSessionId === sessionId) return;
    router.push(`/workspace/${workspaceId}/team/${nextSessionId}`);
  }, [router, sessionId, workspaceId]);

  const handleRefreshTeamRun = useCallback(() => {
    requestMetadataRefresh(0);
    requestTranscriptRefresh([sessionId, ...descendantSessions.map((entry) => entry.sessionId)], 0);
  }, [descendantSessions, requestMetadataRefresh, requestTranscriptRefresh, sessionId]);

  const handleSelectSessionForModal = useCallback((nextSessionId: string) => {
    setSelectedSessionForModal(nextSessionId);
    void selectModalSession(nextSessionId);
  }, [selectModalSession]);

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
        <TeamRunPageHeader
          workspaceId={workspaceId}
          selectedSessionId={sessionId}
          selectedSessionName={selectedTeamRunName}
          teamRuns={teamRuns}
          isSwitchingTeamRun={isSwitchingTeamRun}
          backLabel={t.common.back}
          refreshLabel={t.common.refresh || "Refresh"}
          openLabel={t.team.openSession}
          activeLabel={t.team.active}
          waitingLabel={t.team.waitingForDelegation}
          onRefresh={handleRefreshTeamRun}
          onSwitchTeamRun={handleSwitchTeamRun}
        />

        <div className="grid min-h-0 flex-1 lg:grid-cols-[248px_minmax(0,1fr)_280px] xl:grid-cols-[260px_minmax(0,1fr)_300px]">
          <ObjectiveSidebarSection
            objective={objective}
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

            <div className="shrink-0 border-t border-desktop-border bg-desktop-bg-primary px-3 py-2">
              <TiptapInput
                key={timelineInputKey}
                onSend={(text) => handleTimelinePrompt(text)}
                disabled={!acpConnected || showRunLoadingState}
                loading={acpLoading}
                skills={[]}
                repoSkills={[]}
                providers={acpProviders}
                selectedProvider={acpSelectedProvider}
                onProviderChange={acpSetProvider}
                sessions={[]}
                activeSessionMode={session?.modeId}
                repoSelection={repoSelection}
                onRepoChange={setRepoSelection}
                additionalRepos={codebases.map((codebase) => ({
                  name: codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath,
                  path: codebase.repoPath,
                  branch: codebase.branch,
                }))}
                onFetchModels={acp.listProviderModels}
                agentRole={session?.role}
                placeholder={showRunLoadingState ? t.team.loadingTeamRun : undefined}
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
        <TeamRunSessionModal
          workspaceId={workspaceId}
          selectedSessionForModal={selectedSessionForModal}
          selectedSessionStream={selectedSessionStream}
          sessionStreams={sessionStreams}
          modalAcp={modalAcp}
          title={selectedSessionStream.actor}
          sessionStreamsLabel={t.team.teamRuns}
          openLabel={t.team.openSession}
          noTranscriptLabel={t.team.noTranscriptYet}
          onClose={() => setSelectedSessionForModal(null)}
          onSelectSession={handleSelectSessionForModal}
        />
      )}
    </DesktopAppShell>
  );
}
