"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { ChatPanel } from "@/client/components/chat-panel";
import { getToolEventLabel } from "@/client/components/chat-panel/tool-call-name";
import { useAcp } from "@/client/hooks/use-acp";
import { type NoteData, useNotes } from "@/client/hooks/use-notes";
import { consumePendingPrompt } from "@/client/utils/pending-prompt";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { formatRelativeTime, OverlayModal } from "../../ui-components";
import type { SessionInfo } from "../../types";

interface SpecialistSummary {
  id: string;
  name: string;
  description?: string;
  role?: string;
}

type NormalizedTaskStatus = "not-started" | "in-progress" | "waiting-review" | "done" | "blocked";
type TeamMemberStatus = "idle" | "working" | "blocked" | "reviewing";
type CoordinationEventType = "plan" | "assign" | "revision" | "finding" | "complete" | "blocked";

interface TeamTaskNode {
  id: string;
  title: string;
  status: NormalizedTaskStatus;
  details?: string;
  children: TeamTaskNode[];
}

interface TeamActivityItem {
  id: string;
  type: CoordinationEventType;
  title: string;
  actor: string;
  target?: string;
  timestamp: string;
  summary?: string;
  sessionId?: string;
  memberSession?: {
    sessionId: string;
    actor: string;
    badge: string;
    preview?: string;
    lastUpdatedLabel: string;
  };
}

interface SessionStreamSummary {
  session: SessionInfo;
  actor: string;
  badge: string;
  preview?: string;
  eventCount: number;
  lastUpdatedLabel: string;
  lastUpdatedAt: number;
}

interface TeamMemberItem {
  specialist: SpecialistSummary;
  actor: string;
  status: TeamMemberStatus;
  lastUpdatedLabel?: string;
  sessionId?: string;
  preview?: string;
}

interface DeliverableItem {
  id: string;
  label: string;
  title: string;
  owner: string;
  status: "draft" | "review" | "approved";
  summary?: string;
  sessionId?: string;
  updatedAt: number;
}

interface SessionHistoryEntry {
  sessionId: string;
  update?: {
    sessionUpdate?: string;
    content?:
      | { type?: string; text?: string }
      | Array<{ type?: string; text?: string; content?: { type?: string; text?: string } }>;
    status?: string;
    title?: string;
    taskStatus?: string;
    completionSummary?: string;
    name?: string;
    error?: string;
    toolCallId?: string;
    rawInput?: Record<string, unknown>;
    rawOutput?: { output?: string };
  };
}

const TEAM_LEAD_SPECIALIST_ID = "team-agent-lead";

function normalizeTaskStatus(status?: string): NormalizedTaskStatus {
  const normalized = status?.toUpperCase();
  if (normalized === "COMPLETED" || normalized === "DONE") return "done";
  if (normalized === "IN_PROGRESS" || normalized === "RUNNING" || normalized === "CONFIRMED") return "in-progress";
  if (normalized === "REVIEW_REQUIRED" || normalized === "WAITING_REVIEW" || normalized === "NEEDS_REVIEW") return "waiting-review";
  if (normalized === "FAILED" || normalized === "BLOCKED" || normalized === "NEEDS_FIX") return "blocked";
  return "not-started";
}

function statusDotClass(status: TeamMemberStatus): string {
  switch (status) {
    case "working":
      return "bg-cyan-500";
    case "reviewing":
      return "bg-amber-500";
    case "blocked":
      return "bg-rose-500";
    default:
      return "bg-slate-400";
  }
}

function deliverableTone(status: DeliverableItem["status"]): string {
  if (status === "approved") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
  }
  if (status === "review") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300";
  }
  return "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300";
}

function activityTone(type: CoordinationEventType): string {
  switch (type) {
    case "plan":
      return "bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300";
    case "assign":
      return "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300";
    case "revision":
      return "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300";
    case "finding":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
    case "complete":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
    case "blocked":
      return "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300";
  }
}

function sessionBadge(session: SessionInfo): string {
  if (!session.parentSessionId) return "lead";
  return session.specialistId ?? session.role ?? session.provider ?? "session";
}

function resolveRosterSpecialistId(session: SessionInfo): string | undefined {
  const direct = session.specialistId;
  if (direct?.startsWith("team-")) return direct;

  const signature = `${session.specialistId ?? ""} ${session.role ?? ""} ${session.name ?? ""}`.toLowerCase();
  if (signature.includes("agent lead") || signature.includes("team-agent-lead")) return TEAM_LEAD_SPECIALIST_ID;
  if (signature.includes("qa") || signature.includes("gate")) return "team-qa";
  if (signature.includes("research")) return "team-researcher";
  if (signature.includes("frontend")) return "team-frontend-dev";
  if (signature.includes("backend")) return "team-backend-dev";
  if (signature.includes("review")) return "team-code-reviewer";
  if (signature.includes("ux") || signature.includes("design")) return "team-ux-designer";
  if (signature.includes("operations")) return "team-operations";
  if (signature.includes("general")) return "team-general-engineer";
  return undefined;
}

function getActorLabel(session: SessionInfo, specialistsById: Map<string, SpecialistSummary>): string {
  const rosterId = resolveRosterSpecialistId(session);
  return specialistsById.get(rosterId ?? session.specialistId ?? "")?.name ?? session.name ?? session.specialistId ?? session.role ?? "Agent";
}

function summarizeText(text?: string, max = 220): string | undefined {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function extractHistoryText(update?: SessionHistoryEntry["update"]): string | undefined {
  if (!update?.content) return undefined;
  if (!Array.isArray(update.content)) {
    return summarizeText(update.content.text);
  }

  const joined = update.content
    .map((item) => item.text ?? item.content?.text ?? "")
    .join(" ")
    .trim();
  return summarizeText(joined || undefined);
}

function resolveDelegationTarget(update?: SessionHistoryEntry["update"]): string | undefined {
  const rawInput = update?.rawInput;
  if (!rawInput) return undefined;

  const specialist = typeof rawInput.specialist === "string" ? rawInput.specialist : undefined;
  if (specialist?.startsWith("team-")) {
    return specialist
      .replace(/^team-/, "")
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  const additionalInstructions =
    typeof rawInput.additionalInstructions === "string" ? rawInput.additionalInstructions : undefined;
  const emphasizedRole = additionalInstructions?.match(/\*\*([^*]+)\*\*/)?.[1]?.trim();
  if (emphasizedRole) return emphasizedRole;

  if (!specialist) return undefined;
  switch (specialist.toLowerCase()) {
    case "crafter":
      return "Implementor";
    case "gate":
      return "Verifier";
    case "developer":
      return "Developer";
    default:
      return specialist;
  }
}

function resolveDelegationRosterSpecialistId(update?: SessionHistoryEntry["update"]): string | undefined {
  const rawInput = update?.rawInput;
  if (!rawInput) return undefined;

  const directSpecialist = typeof rawInput.specialist === "string" ? rawInput.specialist : undefined;
  if (directSpecialist?.startsWith("team-")) return directSpecialist;

  const hintText = [
    typeof rawInput.additionalInstructions === "string" ? rawInput.additionalInstructions : "",
    typeof rawInput.description === "string" ? rawInput.description : "",
  ]
    .join(" ")
    .toLowerCase();

  switch (directSpecialist?.toLowerCase()) {
    case "gate":
      return "team-qa";
    case "crafter":
    case "developer":
      if (hintText.includes("research")) return "team-researcher";
      if (hintText.includes("frontend")) return "team-frontend-dev";
      if (hintText.includes("backend")) return "team-backend-dev";
      if (hintText.includes("ux") || hintText.includes("design")) return "team-ux-designer";
      if (hintText.includes("review")) return "team-code-reviewer";
      return "team-general-engineer";
    default:
      return undefined;
  }
}

function flattenTaskTree(nodes: TeamTaskNode[]): TeamTaskNode[] {
  return nodes.flatMap((node) => [node, ...flattenTaskTree(node.children)]);
}

function inferDeliverableLabel(note: NoteData, ownerId?: string): string {
  const text = `${note.title} ${note.content}`.toLowerCase();
  if (note.metadata.type === "spec") return "spec draft";
  if (text.includes("ui") || text.includes("design")) return "ui proposal";
  if (ownerId?.includes("qa") || ownerId?.includes("review")) return "test report";
  if (ownerId?.includes("research")) return "findings";
  if (ownerId?.includes("front") || ownerId?.includes("back") || ownerId?.includes("general")) return "patch";
  return note.metadata.type === "task" ? "work package" : "team note";
}

function inferSessionDeliverableLabel(specialistId?: string): string {
  if (!specialistId) return "deliverable";
  if (specialistId.includes("research")) return "findings";
  if (specialistId.includes("qa") || specialistId.includes("review")) return "test report";
  if (specialistId.includes("ux")) return "ui proposal";
  if (specialistId.includes("front") || specialistId.includes("back") || specialistId.includes("general")) return "patch";
  return "deliverable";
}

function inferCompletionEvent(
  session: SessionInfo,
  actor: string,
  update: NonNullable<SessionHistoryEntry["update"]>,
): Pick<TeamActivityItem, "type" | "title" | "summary"> {
  const specialistId = session.specialistId ?? "";
  const taskStatus = normalizeTaskStatus(update.taskStatus);
  const summary = summarizeText(update.completionSummary ?? extractHistoryText(update));

  if (taskStatus === "blocked") {
    return { type: "blocked", title: `${actor} reported a blocker`, summary };
  }
  if (specialistId.includes("qa") || specialistId.includes("review")) {
    if (taskStatus === "waiting-review") {
      return { type: "revision", title: `${actor} requested revision`, summary };
    }
    return { type: "complete", title: `${actor} returned review`, summary };
  }
  if (specialistId.includes("research")) {
    return { type: "finding", title: `${actor} returned findings`, summary };
  }
  if (specialistId.includes("ux")) {
    return { type: "complete", title: `${actor} delivered UI proposal`, summary };
  }
  return { type: "complete", title: `${actor} marked phase complete`, summary };
}

function extractGoalFromPrompt(text?: string): string | undefined {
  const normalized = text?.trim();
  if (!normalized) return undefined;

  const markdownGoal = normalized.match(/(?:^|\n)##\s*Goal\s+([\s\S]*?)(?=\n##\s|\n@@@|$)/i)?.[1]?.trim();
  if (markdownGoal) {
    return summarizeText(markdownGoal, 320);
  }

  if (/routa coordinator|you plan, delegate, and verify/i.test(normalized)) {
    return undefined;
  }

  return summarizeText(normalized, 320);
}

function findObjectiveText(session: SessionInfo | null, rootHistory: SessionHistoryEntry[], notes: NoteData[]): string {
  const sessionName = session?.name?.replace(/^Team\s*-\s*/i, "").trim();
  if (sessionName && !/^team automation verifier$/i.test(sessionName)) {
    return sessionName;
  }

  const latestUserRequest = rootHistory.find((entry) => entry.update?.sessionUpdate === "user_message");
  const explicitRequest = extractGoalFromPrompt(extractHistoryText(latestUserRequest?.update));
  if (explicitRequest) return explicitRequest;

  const specNote = notes
    .filter((note) => note.metadata.type === "spec")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  if (specNote?.content.trim()) {
    return extractGoalFromPrompt(specNote.content) ?? summarizeText(specNote.content, 320) ?? specNote.content;
  }

  return session?.name ?? "Team objective not captured yet.";
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
    connect: connectAcp,
    prompt: acpPrompt,
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
  const [historiesBySessionId, setHistoriesBySessionId] = useState<Record<string, SessionHistoryEntry[]>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedSessionForModal, setSelectedSessionForModal] = useState<string | null>(null);
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
    const controller = new AbortController();

    (async () => {
      try {
        const [sessionRes, sessionsRes, specialistsRes] = await Promise.all([
          desktopAwareFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store", signal: controller.signal }),
          desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`, { cache: "no-store", signal: controller.signal }),
          desktopAwareFetch("/api/specialists", { cache: "no-store", signal: controller.signal }),
        ]);
        const sessionData = await sessionRes.json().catch(() => ({}));
        const sessionsData = await sessionsRes.json().catch(() => ({}));
        const specialistsData = await specialistsRes.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        setSession((sessionData?.session ?? null) as SessionInfo | null);
        setWorkspaceSessions(Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : []);
        setSpecialists(Array.isArray(specialistsData?.specialists) ? specialistsData.specialists : []);
      } catch {
        if (controller.signal.aborted) return;
        setSession(null);
        setWorkspaceSessions([]);
        setSpecialists([]);
      }
    })();

    return () => controller.abort();
  }, [refreshKey, sessionId, workspaceId]);

  const workspace = workspacesHook.workspaces.find((item) => item.id === workspaceId);
  const specialistsById = useMemo(
    () => new Map(specialists.map((specialist) => [specialist.id, specialist])),
    [specialists],
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

  const flatTasks = useMemo(() => flattenTaskTree(taskTree), [taskTree]);
  const taskCounts = useMemo(
    () => ({
      total: flatTasks.length,
      done: flatTasks.filter((task) => task.status === "done").length,
      active: flatTasks.filter((task) => task.status === "in-progress" || task.status === "waiting-review").length,
      blocked: flatTasks.filter((task) => task.status === "blocked").length,
    }),
    [flatTasks],
  );

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
          actor: getActorLabel(entry, specialistsById),
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
  }, [allRunSessions, historiesBySessionId, sessionId, specialistsById]);

  const selectedSessionStream = useMemo(
    () => sessionStreams.find((item) => item.session.sessionId === selectedSessionForModal) ?? null,
    [selectedSessionForModal, sessionStreams],
  );

  const sessionStreamsBySessionId = useMemo(
    () => new Map(sessionStreams.map((stream) => [stream.session.sessionId, stream])),
    [sessionStreams],
  );

  const latestChildSessionByRosterId = useMemo(() => {
    const map = new Map<string, SessionStreamSummary>();
    for (const stream of sessionStreams) {
      if (!stream.session.parentSessionId) continue;
      const rosterId = resolveRosterSpecialistId(stream.session);
      if (!rosterId && !stream.session.specialistId) continue;
      map.set(rosterId ?? stream.session.specialistId ?? stream.session.sessionId, stream);
    }
    return map;
  }, [sessionStreams]);

  const rootHistory = useMemo(
    () => historiesBySessionId[sessionId] ?? [],
    [historiesBySessionId, sessionId],
  );
  const objective = useMemo(() => findObjectiveText(session, rootHistory, notesHook.notes), [notesHook.notes, rootHistory, session]);

  const coordinationItems = useMemo<TeamActivityItem[]>(() => {
    const items: Array<TeamActivityItem & { sortKey: number }> = [];
    const leadName = specialistsById.get(TEAM_LEAD_SPECIALIST_ID)?.name ?? "Agent Lead";

    const requestEntry = rootHistory.find((entry) => entry.update?.sessionUpdate === "user_message");
    if (requestEntry && session) {
      items.push({
        id: `${session.sessionId}-objective`,
        type: "plan",
        title: "Objective set",
        actor: "User",
        target: leadName,
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
        const linkedStream = targetRosterId ? latestChildSessionByRosterId.get(targetRosterId) : undefined;
        items.push({
          id: `${sessionId}-delegate-${index}`,
          type: update.status === "failed" ? "blocked" : "assign",
          title: update.status === "failed" ? `Dispatch failed for ${target}` : `Task assigned to ${target}`,
          actor: leadName,
          target,
          timestamp: formatRelativeTime(session.createdAt),
          summary: summarizeText(
            typeof update.rawInput?.additionalInstructions === "string"
              ? update.rawInput.additionalInstructions
              : update.rawOutput?.output,
          ),
          sessionId: linkedStream?.session.sessionId ?? session.sessionId,
          memberSession: linkedStream ? {
            sessionId: linkedStream.session.sessionId,
            actor: linkedStream.actor,
            badge: linkedStream.badge,
            preview: linkedStream.preview,
            lastUpdatedLabel: linkedStream.lastUpdatedLabel,
          } : undefined,
          sortKey,
        });
      }
    });

    for (const child of descendantSessions) {
      const actor = getActorLabel(child, specialistsById);
      const childCreatedAt = new Date(child.createdAt).getTime();

      items.push({
        id: `${child.sessionId}-opened`,
        type: "assign",
        title: `Opened session for ${actor}`,
        actor: leadName,
        target: actor,
        timestamp: formatRelativeTime(child.createdAt),
        summary: summarizeText(child.name ?? child.specialistId ?? child.role ?? child.provider),
        sessionId: child.sessionId,
        memberSession: sessionStreamsBySessionId.get(child.sessionId) ? {
          sessionId: child.sessionId,
          actor,
          badge: sessionBadge(child),
          preview: sessionStreamsBySessionId.get(child.sessionId)?.preview,
          lastUpdatedLabel: sessionStreamsBySessionId.get(child.sessionId)?.lastUpdatedLabel ?? formatRelativeTime(child.createdAt),
        } : undefined,
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
            timestamp: formatRelativeTime(child.createdAt),
            summary: completion.summary,
            sessionId: child.sessionId,
            memberSession: sessionStreamsBySessionId.get(child.sessionId) ? {
              sessionId: child.sessionId,
              actor,
              badge: sessionBadge(child),
              preview: sessionStreamsBySessionId.get(child.sessionId)?.preview,
              lastUpdatedLabel: sessionStreamsBySessionId.get(child.sessionId)?.lastUpdatedLabel ?? formatRelativeTime(child.createdAt),
            } : undefined,
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
            timestamp: formatRelativeTime(child.createdAt),
            summary: summarizeText(update.error),
            sessionId: child.sessionId,
            memberSession: sessionStreamsBySessionId.get(child.sessionId) ? {
              sessionId: child.sessionId,
              actor,
              badge: sessionBadge(child),
              preview: sessionStreamsBySessionId.get(child.sessionId)?.preview,
              lastUpdatedLabel: sessionStreamsBySessionId.get(child.sessionId)?.lastUpdatedLabel ?? formatRelativeTime(child.createdAt),
            } : undefined,
            sortKey,
          });
        }
      });
    }

    return items
      .sort((a, b) => b.sortKey - a.sortKey)
      .slice(0, 24)
      .map(({ sortKey: _sortKey, ...item }) => item);
  }, [descendantSessions, historiesBySessionId, latestChildSessionByRosterId, notesHook.notes, rootHistory, session, sessionId, sessionStreamsBySessionId, specialistsById]);

  const latestSessionBySpecialistId = useMemo(() => {
    const map = new Map<string, SessionStreamSummary>();
    for (const stream of sessionStreams) {
      const specialistId = resolveRosterSpecialistId(stream.session);
      if (!specialistId) continue;
      if (!map.has(specialistId)) {
        map.set(specialistId, stream);
      }
    }
    return map;
  }, [sessionStreams]);

  const teamMembers = useMemo<TeamMemberItem[]>(() => {
    const teamSpecialists = specialists
      .filter((specialist) => specialist.id.startsWith("team-"))
      .sort((a, b) => {
        if (a.id === TEAM_LEAD_SPECIALIST_ID) return -1;
        if (b.id === TEAM_LEAD_SPECIALIST_ID) return 1;
        return a.name.localeCompare(b.name);
      });

    return teamSpecialists.map((specialist) => {
      const latest = latestSessionBySpecialistId.get(specialist.id);
      const latestHistory = latest ? historiesBySessionId[latest.session.sessionId] ?? [] : [];
      const latestCompletion = [...latestHistory].reverse().find((entry) => entry.update?.sessionUpdate === "task_completion");
      let status: TeamMemberStatus = "idle";

      if (specialist.id === TEAM_LEAD_SPECIALIST_ID && session) {
        status = session.acpStatus === "error" ? "blocked" : "working";
      } else if (latest?.session.acpStatus === "error" || normalizeTaskStatus(latestCompletion?.update?.taskStatus) === "blocked") {
        status = "blocked";
      } else if (normalizeTaskStatus(latestCompletion?.update?.taskStatus) === "waiting-review") {
        status = "reviewing";
      } else if (latest && !latestCompletion) {
        status = "working";
      }

      return {
        specialist,
        actor: specialist.name,
        status,
        lastUpdatedLabel: latest?.lastUpdatedLabel,
        sessionId: latest?.session.sessionId,
        preview: latest?.preview,
      };
    });
  }, [historiesBySessionId, latestSessionBySpecialistId, session, specialists]);

  const deliverables = useMemo<DeliverableItem[]>(() => {
    const noteDeliverables = notesHook.notes.map((note) => {
      const sourceSession = note.sessionId ? allRunSessions.find((entry) => entry.sessionId === note.sessionId) : undefined;
      const ownerId = sourceSession ? resolveRosterSpecialistId(sourceSession) ?? sourceSession.specialistId : undefined;
      return {
        id: `note-${note.id}`,
        label: inferDeliverableLabel(note, ownerId),
        title: note.title,
        owner: sourceSession ? getActorLabel(sourceSession, specialistsById) : "Agent Lead",
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
      const actor = getActorLabel(entry, specialistsById);
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
  }, [allRunSessions, descendantSessions, historiesBySessionId, notesHook.notes, specialistsById]);

  const reviewTargetSessionId = useMemo(() => {
    const reviewingMember = teamMembers.find((member) => member.status === "reviewing" && member.sessionId);
    if (reviewingMember?.sessionId) return reviewingMember.sessionId;
    const qaMember = teamMembers.find((member) => member.specialist.id.includes("qa") && member.sessionId);
    return qaMember?.sessionId ?? sessionId;
  }, [sessionId, teamMembers]);

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
        <header className="shrink-0 border-b border-desktop-border bg-desktop-bg-secondary/95">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <Link
                  href={`/workspace/${workspaceId}/team`}
                  className="inline-flex items-center gap-2 rounded-lg border border-desktop-border px-2.5 py-1.5 text-[12px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                  Team
                </Link>
                <div className="h-4 w-px bg-desktop-border" />
                <div className="min-w-0">
                  <h1 className="truncate text-sm font-semibold text-desktop-text-primary">
                    {session.name ?? "Team run"}
                  </h1>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-desktop-text-secondary">
                    <span>{formatRelativeTime(session.createdAt)}</span>
                    <span className="opacity-40">/</span>
                    <span>{session.provider ?? "auto"}</span>
                    <span className="opacity-40">/</span>
                    <span>{session.specialistId ?? TEAM_LEAD_SPECIALIST_ID}</span>
                    <span className="opacity-40">/</span>
                    <span>{acpConnected ? "live" : "reconnecting"}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRefreshKey((current) => current + 1)}
                className="rounded-lg border border-desktop-border px-3 py-1.5 text-[12px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
              >
                Refresh
              </button>
              <Link
                href={`/workspace/${workspaceId}/sessions/${sessionId}`}
                className="rounded-lg bg-desktop-accent px-3 py-1.5 text-[12px] font-medium text-desktop-accent-text transition-colors hover:opacity-90"
              >
                Open raw session
              </Link>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
          <section className="min-h-0 overflow-hidden border-r border-desktop-border bg-desktop-bg-secondary">
            <div className="border-b border-desktop-border px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-desktop-text-muted">Objective</div>
              <div className="mt-3 rounded-2xl border border-desktop-border bg-desktop-bg-primary p-4">
                <div className="text-sm leading-6 text-desktop-text-primary">{objective}</div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <MetricChip label="Done" value={taskCounts.done} tone="emerald" />
                <MetricChip label="Active" value={taskCounts.active} tone="cyan" />
                <MetricChip label="Blocked" value={taskCounts.blocked} tone="rose" />
              </div>
            </div>

            <div className="border-b border-desktop-border px-4 py-3">
              <h2 className="text-sm font-semibold text-desktop-text-primary">Plan / Task Tree</h2>
              <p className="mt-1 text-xs text-desktop-text-secondary">Lead decomposition and current execution state.</p>
            </div>
            <div className="h-[calc(100%-216px)] overflow-y-auto px-3 py-3">
              {taskTree.length === 0 ? (
                <EmptyPanel message="No task notes yet." />
              ) : (
                <div className="space-y-1">
                  {taskTree.map((node) => <TaskTreeNode key={node.id} node={node} />)}
                </div>
              )}
            </div>
          </section>

          <section className="min-h-0 overflow-hidden bg-desktop-bg-primary">
            <div className="border-b border-desktop-border px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-desktop-text-primary">Coordination Feed</h2>
                  <p className="mt-1 text-xs text-desktop-text-secondary">
                    Supervision events only: planning, delegation, review, findings, and completion.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-desktop-text-secondary">
                  <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1">
                    {coordinationItems.length} events
                  </span>
                  <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1">
                    {sessionStreams.length} sessions
                  </span>
                </div>
              </div>
            </div>

            <div className="h-[calc(100%-73px)] overflow-y-auto px-5 py-5">
              {coordinationItems.length === 0 ? (
                <EmptyPanel message="No coordination events yet." />
              ) : (
                <div className="space-y-4">
                  {coordinationItems.map((item, index) => (
                    <CoordinationFeedItem
                      key={item.id}
                      item={item}
                      isLast={index === coordinationItems.length - 1}
                      onInspectSession={item.sessionId ? () => setSelectedSessionForModal(item.sessionId ?? null) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside className="min-h-0 overflow-hidden border-l border-desktop-border bg-desktop-bg-secondary">
            <div className="border-b border-desktop-border px-4 py-3">
              <h2 className="text-sm font-semibold text-desktop-text-primary">Team Panel</h2>
              <p className="mt-1 text-xs text-desktop-text-secondary">
                Team supervision, outputs, and live controls routed into shared session UI.
              </p>
            </div>

            <div className="h-[calc(100%-73px)] overflow-y-auto p-4">
              <div className="space-y-4">
                <PanelCard title="Team Members">
                  <div className="space-y-2">
                    {teamMembers.map((member) => (
                      <button
                        key={member.specialist.id}
                        type="button"
                        onClick={() => member.sessionId && setSelectedSessionForModal(member.sessionId)}
                        disabled={!member.sessionId}
                        className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition ${
                          member.sessionId
                            ? "hover:bg-desktop-bg-active/80"
                            : "cursor-default opacity-80"
                        }`}
                      >
                        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-desktop-bg-active text-xs font-semibold text-desktop-text-primary">
                          {member.actor
                            .split(" ")
                            .map((part) => part.charAt(0))
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                          <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-desktop-bg-secondary ${statusDotClass(member.status)}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-medium text-desktop-text-primary">{member.actor}</div>
                            <span className="shrink-0 text-[11px] capitalize text-desktop-text-secondary">{member.status}</span>
                          </div>
                          <div className="mt-0.5 truncate text-xs text-desktop-text-secondary">{member.specialist.id}</div>
                          {member.preview && (
                            <div className="mt-2 line-clamp-2 text-xs leading-5 text-desktop-text-muted">{member.preview}</div>
                          )}
                          {member.lastUpdatedLabel && (
                            <div className="mt-2 text-[11px] text-desktop-text-muted">{member.lastUpdatedLabel}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </PanelCard>

                <PanelCard title="Deliverables">
                  <div className="space-y-2">
                    {deliverables.length === 0 ? (
                      <EmptyPanel message="No notes or deliverables yet." />
                    ) : (
                      deliverables.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => item.sessionId && setSelectedSessionForModal(item.sessionId)}
                          disabled={!item.sessionId}
                          className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition ${
                            item.sessionId
                              ? "hover:bg-desktop-bg-active/80"
                              : "cursor-default"
                          }`}
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-desktop-bg-active text-[11px] font-semibold uppercase tracking-[0.14em] text-desktop-text-primary">
                            {item.label.slice(0, 2)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate text-sm font-medium text-desktop-text-primary">{item.label}</div>
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${deliverableTone(item.status)}`}>
                                {item.status}
                              </span>
                            </div>
                            <div className="mt-1 truncate text-xs text-desktop-text-secondary">{item.title}</div>
                            <div className="mt-1 text-[11px] text-desktop-text-muted">{item.owner}</div>
                            {item.summary && (
                              <div className="mt-2 line-clamp-2 text-xs leading-5 text-desktop-text-muted">{item.summary}</div>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </PanelCard>

                <PanelCard title="Controls">
                  <div className="space-y-2">
                    <ControlButton
                      title="Pause run"
                      description="Pause API is not wired yet. Use the raw session for manual intervention."
                      disabled
                    />
                    <ControlButton
                      title="Ask lead to revise plan"
                      description="Open the lead session in the shared chat UI and send revision guidance."
                      onClick={() => setSelectedSessionForModal(sessionId)}
                    />
                    <ControlButton
                      title="Add context"
                      description="Open the lead session and append missing requirements or repo context."
                      onClick={() => setSelectedSessionForModal(sessionId)}
                    />
                    <ControlButton
                      title="Escalate review"
                      description="Jump to the current QA or review session when a phase needs scrutiny."
                      onClick={() => setSelectedSessionForModal(reviewTargetSessionId)}
                    />
                    <Link
                      href={`/workspace/${workspaceId}/sessions/${sessionId}`}
                      className="mt-2 flex items-center gap-2 rounded-2xl border border-desktop-border px-3 py-3 text-sm text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75l6 6 13.5-13.5" />
                      </svg>
                      Continue in raw session
                    </Link>
                  </div>
                </PanelCard>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {selectedSessionStream && (
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

function MetricChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "cyan" | "rose";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
      : tone === "rose"
        ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
        : "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300";
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-[0.12em]">{label}</div>
    </div>
  );
}

function TaskTreeNode({
  node,
  level = 0,
}: {
  node: TeamTaskNode;
  level?: number;
}) {
  return (
    <div>
      <div
        className="rounded-2xl border border-transparent px-3 py-2 transition-colors hover:border-desktop-border hover:bg-desktop-bg-active/70"
        style={{ marginLeft: level * 16 }}
      >
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <TaskStatusGlyph status={node.status} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className={`text-sm ${node.status === "done" ? "text-desktop-text-muted line-through" : "text-desktop-text-primary"}`}>
                {node.title}
              </div>
              <TaskStatusPill status={node.status} />
            </div>
            {node.details && (
              <div className="mt-1 line-clamp-2 text-xs leading-5 text-desktop-text-secondary">
                {node.details}
              </div>
            )}
          </div>
        </div>
      </div>
      {node.children.map((child) => (
        <TaskTreeNode key={child.id} node={child} level={level + 1} />
      ))}
    </div>
  );
}

function TaskStatusGlyph({
  status,
}: {
  status: NormalizedTaskStatus;
}) {
  if (status === "done") {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
    );
  }
  if (status === "in-progress") {
    return <div className="h-5 w-5 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />;
  }
  if (status === "waiting-review") {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12S5.25 6.75 12 6.75 21.75 12 21.75 12 18.75 17.25 12 17.25 2.25 12 2.25 12z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
        </svg>
      </div>
    );
  }
  if (status === "blocked") {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 4.5h.008v.008H12v-.008z" />
        </svg>
      </div>
    );
  }
  return <div className="h-5 w-5 rounded-full border-2 border-slate-400" />;
}

function TaskStatusPill({ status }: { status: NormalizedTaskStatus }) {
  const tone =
    status === "done"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
      : status === "in-progress"
        ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300"
        : status === "waiting-review"
          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
          : status === "blocked"
            ? "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
            : "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${tone}`}>
      {status.replace("-", " ")}
    </span>
  );
}

function CoordinationFeedItem({
  item,
  isLast,
  onInspectSession,
}: {
  item: TeamActivityItem;
  isLast: boolean;
  onInspectSession?: () => void;
}) {
  return (
    <div className="relative">
      {!isLast && (
        <div className="absolute bottom-[-18px] left-[13px] top-10 w-px bg-desktop-border" />
      )}
      <div className="flex gap-3">
        <div className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold ${activityTone(item.type)}`}>
          {item.type[0].toUpperCase()}
        </div>
        <div className="min-w-0 flex-1 rounded-2xl border border-desktop-border bg-desktop-bg-secondary p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-desktop-text-primary">{item.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-desktop-text-secondary">
                <span>{item.actor}</span>
                {item.target && (
                  <>
                    <span className="opacity-40">→</span>
                    <span>{item.target}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onInspectSession && (
                <button
                  type="button"
                  onClick={onInspectSession}
                  className="rounded-full border border-desktop-border px-2.5 py-1 text-[11px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                >
                  Inspect session
                </button>
              )}
              <span className="text-[11px] text-desktop-text-muted">{item.timestamp}</span>
            </div>
          </div>
          {item.summary && (
            <div className="mt-3 rounded-xl border border-desktop-border bg-desktop-bg-primary px-3 py-2 text-sm leading-6 text-desktop-text-secondary">
              {item.summary}
            </div>
          )}
          {item.memberSession && (
            <button
              type="button"
              onClick={onInspectSession}
              className="mt-3 flex w-full items-start justify-between gap-3 rounded-xl border border-desktop-border bg-desktop-bg-primary px-3 py-3 text-left transition hover:bg-desktop-bg-active/70"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-desktop-text-muted">Member session</span>
                  <span className="rounded-full border border-desktop-border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-desktop-text-secondary">
                    {item.memberSession.badge}
                  </span>
                </div>
                <div className="mt-2 text-sm font-medium text-desktop-text-primary">{item.memberSession.actor}</div>
                <div className="mt-1 line-clamp-2 text-xs leading-5 text-desktop-text-secondary">
                  {item.memberSession.preview ?? item.memberSession.sessionId}
                </div>
              </div>
              <div className="shrink-0 text-[11px] text-desktop-text-muted">{item.memberSession.lastUpdatedLabel}</div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PanelCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary">
      <div className="border-b border-desktop-border px-4 py-3 text-sm font-semibold text-desktop-text-primary">
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function ControlButton({
  title,
  description,
  disabled = false,
  onClick,
}: {
  title: string;
  description: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
        disabled
          ? "cursor-not-allowed border-desktop-border bg-desktop-bg-secondary/70 text-desktop-text-muted"
          : "border-desktop-border bg-desktop-bg-primary hover:bg-desktop-bg-active/80"
      }`}
    >
      <div className="text-sm font-medium text-desktop-text-primary">{title}</div>
      <div className="mt-1 text-xs leading-5 text-desktop-text-secondary">{description}</div>
    </button>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-6 text-center text-sm text-desktop-text-secondary">
      {message}
    </div>
  );
}
