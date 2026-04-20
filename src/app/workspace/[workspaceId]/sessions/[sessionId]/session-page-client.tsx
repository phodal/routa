"use client";

/**
 * Workspace Session Page
 *
 * This is the main chat interface page when viewing a specific session within a workspace.
 * It contains the full chat experience with:
 * - Top bar: Logo, Workspace/Session context, Agent selector, protocol badges
 * - Left sidebar: Workspace switcher, Sessions list, Skills
 * - Center: Chat panel with messages and input
 * - Right sidebar (resizable): Task panel / CRAFTERs view
 *
 * Route: /workspace/[workspaceId]/sessions/[sessionId]
 */

import {useCallback, useEffect, useRef, useState} from "react";
import {useRouter, useSearchParams} from "next/navigation";
import {ChatPanel} from "@/client/components/chat-panel";
import {SpecialistManager} from "@/client/components/specialist-manager";
import {CraftersView} from "@/client/components/task-panel";
import {AgentInstallPanel} from "@/client/components/agent-install-panel";
import {LeftSidebar} from "./left-sidebar";
import {DesktopAppShell} from "@/client/components/desktop-app-shell";
import {WorkspaceSwitcher} from "@/client/components/workspace-switcher";
import {useWorkspaces, useCodebases} from "@/client/hooks/use-workspaces";
import {useAcp} from "@/client/hooks/use-acp";
import {useNotes} from "@/client/hooks/use-notes";
import type {RepoSelection} from "@/client/components/repo-picker";
import {storePendingPrompt} from "@/client/utils/pending-prompt";
import {DockerConfigModal, loadDefaultProviders, loadProviderConnectionConfig, getModelDefinitionByAlias} from "@/client/components/settings-panel";
import { useRealSessionParams } from "./use-real-session-params";
import { type AgentRole, type SpecialistOption, useSessionPageBootstrap } from "./use-session-page-bootstrap";
import { useSessionCrafters } from "./use-session-crafters";
import { RepoSlideSessionPanel } from "./repo-slide-session-panel";
import { Select } from "@/client/components/select";
import { useTranslation } from "@/i18n";
import { ChevronDown, Columns2, ScrollText, X } from "lucide-react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";


interface SessionRecord {
  sessionId: string;
  name?: string;
  cwd?: string;
  branch?: string;
  provider?: string;
  role?: string;
  modeId?: string;
  mcpProfile?: string;
  model?: string;
  specialistId?: string;
  acpStatus?: "connecting" | "ready" | "error";
  parentSessionId?: string;
  resumeCapabilities?: {
    supported: boolean;
    mode: "native" | "replay" | "both";
    supportsFork?: boolean;
    supportsList?: boolean;
  } | null;
}

interface TranscriptMessage {
  role: "user" | "assistant" | "thought" | "tool" | "plan" | "info" | "terminal";
  content: string;
  toolName?: string;
  toolStatus?: string;
}

const RESTORE_CONTEXT_MESSAGE_LIMIT = 12;
const RESTORE_CONTEXT_CHAR_LIMIT = 12000;

function isExpiredEmbeddedSessionFailure(message: string | null | undefined): boolean {
  return Boolean(
    message && message.includes("embedded ACP processes cannot be resumed on a different instance"),
  );
}

function isUnsupportedSessionLoadFailure(message: string | null | undefined): boolean {
  return Boolean(
    message && message.includes("session/load not supported"),
  );
}

function shouldRecreateSessionAfterResumeError(error: unknown): error is { message: string; code?: number } {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { message?: unknown; code?: unknown; name?: unknown };
  return (
    typeof candidate.message === "string"
    && (isExpiredEmbeddedSessionFailure(candidate.message) || isUnsupportedSessionLoadFailure(candidate.message))
    && (candidate.name === "AcpClientError" || typeof candidate.code === "number")
  );
}

function formatTranscriptLine(message: TranscriptMessage): string | null {
  const content = message.content.trim();
  if (!content) return null;

  switch (message.role) {
    case "user":
      return `User:\n${content}`;
    case "assistant":
      return `Assistant:\n${content}`;
    case "tool":
      return `Tool${message.toolName ? ` (${message.toolName}${message.toolStatus ? `, ${message.toolStatus}` : ""})` : ""}:\n${content}`;
    case "plan":
      return `Plan:\n${content}`;
    case "info":
      return `Info:\n${content}`;
    case "terminal":
      return `Terminal:\n${content}`;
    default:
      return null;
  }
}

function buildCrossInstanceRestorePrompt(session: SessionRecord, messages: TranscriptMessage[]): string {
  const recent = messages
    .filter((message) => message.role !== "thought")
    .map(formatTranscriptLine)
    .filter((value): value is string => Boolean(value))
    .slice(-RESTORE_CONTEXT_MESSAGE_LIMIT);

  let transcript = recent.join("\n\n");
  if (transcript.length > RESTORE_CONTEXT_CHAR_LIMIT) {
    transcript = transcript.slice(transcript.length - RESTORE_CONTEXT_CHAR_LIMIT).trimStart();
  }

  return [
    "You are continuing a previous Routa Codex session because the original embedded ACP runtime belongs to another expired instance.",
    "Treat the transcript below as prior conversation state. Continue from it instead of starting over.",
    `Previous session ID: ${session.sessionId}`,
    session.name ? `Previous session name: ${session.name}` : null,
    session.cwd ? `Working directory: ${session.cwd}` : null,
    session.branch ? `Branch: ${session.branch}` : null,
    "",
    "Transcript excerpt:",
    transcript || "(No transcript content was available. Ask the user what to continue.)",
    "",
    "First turn requirements:",
    "1. Briefly acknowledge that the prior context was restored.",
    "2. Identify the latest unfinished task or decision from the transcript.",
    "3. Continue the work directly without re-summarizing everything.",
  ].filter(Boolean).join("\n");
}

/** Built-in roles always available in the selector */
const BUILTIN_ROLES: { value: AgentRole; label: string }[] = [
  { value: "CRAFTER", label: "CRAFTER" },
  { value: "ROUTA", label: "ROUTA" },
  { value: "GATE", label: "GATE" },
  { value: "DEVELOPER", label: "DEVELOPER" },
];

export function SessionPageClient() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { workspaceId, sessionId, isResolved } = useRealSessionParams();
  const isEmbedMode = searchParams.get("embed") === "true";
  const repoSlideSource = searchParams.get("source") === "reposlide";
  const repoSlideCodebaseId = searchParams.get("codebaseId");

  const [refreshKey, setRefreshKey] = useState(0);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentRole>("ROUTA");
  const [selectedSpecialistId, setSelectedSpecialistId] = useState<string | null>(null);
  const [showAgentToast, setShowAgentToast] = useState(false);
  const [repoSelection, setRepoSelection] = useState<RepoSelection | null>(null);
  const [activeSessionRecord, setActiveSessionRecord] = useState<SessionRecord | null>(null);
  const [isResumingSession, setIsResumingSession] = useState(false);

  // ── Workspace state ───────────────────────────────────────────────────
  const workspacesHook = useWorkspaces();
  const { codebases } = useCodebases(workspaceId);

  // Auto-select default codebase as repo when workspace changes
  useEffect(() => {
    if (codebases.length === 0) return;
    const def = codebases.find((c) => c.isDefault) ?? codebases[0];
    setRepoSelection({ path: def.repoPath, branch: def.branch ?? "", name: def.label ?? def.repoPath.split("/").pop() ?? "" });
  }, [codebases]);

  const handleWorkspaceSelect = useCallback((wsId: string) => {
    router.push(`/workspace/${wsId}/sessions`);
  }, [router]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const ws = await workspacesHook.createWorkspace(title);
    if (ws) router.push(`/workspace/${ws.id}/sessions`);
  }, [workspacesHook, router]);

  const acp = useAcp();
  const {
    connected: acpConnected,
    loading: acpLoading,
    sessionId: acpSessionId,
    updates: acpUpdates,
    selectedProvider: acpSelectedProvider,
    connect: acpConnect,
    selectSession: acpSelectSession,
    setProvider: acpSetProvider,
    resumeSession: acpResumeSession,
    prompt: acpPrompt,
  } = acp;
  const notesHook = useNotes(workspaceId, sessionId);

  // ── Resizable right sidebar state ────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(480);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  // ── Resizable left sidebar state ──────────────────────────────────
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(320);
  const [isLeftResizing, setIsLeftResizing] = useState(false);
  const leftResizeStartXRef = useRef(0);
  const leftResizeStartWidthRef = useRef(0);



  // ── Left sidebar collapse ──────────────────────────────────────────
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false);

  // ── Mobile sidebar toggle ──────────────────────────────────────────
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [showAgentInstallPopup, setShowAgentInstallPopup] = useState(false);
  const [showSpecialistManager, setShowSpecialistManager] = useState(false);
  // Docker error popup state
  const [dockerErrorMessage, setDockerErrorMessage] = useState<string | null>(null);
  // Input text to restore when a docker session fails before prompt was sent
  const [dockerRetryText, setDockerRetryText] = useState<string | null>(null);
  const navigationTargetRef = useRef<string | null>(null);
  const displaySessionId = focusedSessionId ?? sessionId;

  const {
    specialists,
  } = useSessionPageBootstrap({
    showSpecialistManager,
    sessionId,
    displaySessionId,
    isResolved,
    acpConnected,
    acpLoading,
    acpSessionId,
    acpUpdates,
    acpSelectedProvider,
    acpConnect,
    acpSelectSession,
    acpSetProvider,
    acpPrompt,
    setSelectedAgent,
    setDockerErrorMessage,
    setDockerRetryText,
  });

  // Handle custom events for specialist manager
  useEffect(() => {
    const handleOpenSpecialistManager = () => setShowSpecialistManager(true);
    window.addEventListener('open-specialist-manager', handleOpenSpecialistManager);
    return () => {
      window.removeEventListener('open-specialist-manager', handleOpenSpecialistManager);
    };
  }, []);
  const agentInstallCloseRef = useRef<HTMLButtonElement>(null);
  const installAgentsButtonRef = useRef<HTMLButtonElement>(null);
  const lastSessionRenameUpdateIndexRef = useRef(0);


  // Agent Install popup: body scroll lock + Escape to close
  useEffect(() => {
    if (!showAgentInstallPopup) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowAgentInstallPopup(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showAgentInstallPopup]);

  // Agent Install popup: focus close button when open, restore focus when close
  const prevAgentPopupRef = useRef(false);
  useEffect(() => {
    if (showAgentInstallPopup) {
      prevAgentPopupRef.current = true;
      const t = requestAnimationFrame(() => agentInstallCloseRef.current?.focus());
      return () => cancelAnimationFrame(t);
    }
    if (prevAgentPopupRef.current) {
      prevAgentPopupRef.current = false;
      installAgentsButtonRef.current?.focus({ preventScroll: true });
    }
  }, [showAgentInstallPopup]);

  // ── Resize handlers (right sidebar) ──────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = resizeStartXRef.current - e.clientX;
      const newWidth = Math.max(280, Math.min(960, resizeStartWidthRef.current + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizing]);

  // ── Resize handlers (left sidebar) ──────────────────────────────────
  const handleLeftResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsLeftResizing(true);
    leftResizeStartXRef.current = e.clientX;
    leftResizeStartWidthRef.current = leftSidebarWidth;
  }, [leftSidebarWidth]);

  useEffect(() => {
    if (!isLeftResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - leftResizeStartXRef.current;
      const newWidth = Math.max(200, Math.min(450, leftResizeStartWidthRef.current + delta));
      setLeftSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsLeftResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isLeftResizing]);

  const bumpRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Refresh session list when backend reports a session title rename.
  useEffect(() => {
    if (!acp.updates.length) {
      lastSessionRenameUpdateIndexRef.current = 0;
      return;
    }

    const startIndex =
      lastSessionRenameUpdateIndexRef.current > acp.updates.length
        ? 0
        : lastSessionRenameUpdateIndexRef.current;
    const pending = acp.updates.slice(startIndex);
    if (!pending.length) return;
    lastSessionRenameUpdateIndexRef.current = acp.updates.length;

    const hasRename = pending.some((notification) => {
      const raw = notification as Record<string, unknown>;
      const update = (raw.update ?? raw) as Record<string, unknown>;
      return update.sessionUpdate === "session_renamed";
    });

    if (hasRename) {
      bumpRefresh();
    }
  }, [acp.updates, bumpRefresh]);

  const ensureConnected = useCallback(async () => {
    if (!acp.connected) {
      await acp.connect();
    }
  }, [acp]);

  // Check if a session is empty (only has session_start event or no messages)
  const isSessionEmpty = useCallback(async (sid: string): Promise<boolean> => {
    try {
      const res = await desktopAwareFetch(`/api/sessions/${sid}/history`);
      const data = await res.json();
      const history = data?.history ?? [];

      // Empty if no history or only has session_start notification
      if (history.length === 0) return true;

      // Check if only session_start exists (no user messages)
      const hasUserMessage = history.some((item: any) =>
        item?.update?.sessionUpdate === "user_message"
      );

      return !hasUserMessage;
    } catch (e) {
      console.error("Failed to check session emptiness", e);
      return false;
    }
  }, []);

  // Delete empty session if it exists
  const deleteEmptySession = useCallback(async (sid: string | null) => {
    if (!sid) return;

    // Never delete child sessions (they belong to a parent orchestration)
    // Also never delete ROUTA-role sessions (they are long-running orchestrators)
    try {
      const resp = await desktopAwareFetch(`/api/sessions/${sid}`);
      if (resp.ok) {
        const sessionData = await resp.json();
        if (sessionData?.session?.parentSessionId) {
          console.log(`[deleteEmptySession] Skipping child session: ${sid} (parent: ${sessionData.session.parentSessionId})`);
          return;
        }
        if (sessionData?.session?.role === "ROUTA") {
          console.log(`[deleteEmptySession] Skipping ROUTA orchestrator session: ${sid}`);
          return;
        }
      }
    } catch {
      // If we can't check, proceed with caution
    }

    const isEmpty = await isSessionEmpty(sid);
    if (isEmpty) {
      console.log(`[deleteEmptySession] Deleting empty session: ${sid}`);
      try {
        await desktopAwareFetch(`/api/sessions/${sid}`, { method: "DELETE" });
      } catch (e) {
        console.error("Failed to delete empty session", e);
      }
    }
  }, [isSessionEmpty]);

  /** Resolve effective provider + model + connection config: explicit > specialist defaults > per-role default > global selection */
  const resolveAgentConfig = useCallback((
    role: AgentRole = selectedAgent,
    explicitProvider?: string,
    explicitModel?: string,
    specialist?: SpecialistOption | null,
  ) => {
    const defaults = loadDefaultProviders();
    const roleConfig = defaults[role];
    const effectiveProvider = explicitProvider
      || specialist?.defaultProvider
      || roleConfig?.provider
      || acp.selectedProvider;
    const modelAliasOrName = explicitModel
      ?? (explicitProvider ? roleConfig?.model : (specialist?.model ?? roleConfig?.model));
    const def = modelAliasOrName ? getModelDefinitionByAlias(modelAliasOrName) : undefined;
    const conn = loadProviderConnectionConfig(effectiveProvider);
    return {
      provider: effectiveProvider,
      model: def ? def.modelName : (modelAliasOrName ?? conn.model),
      baseUrl: def?.baseUrl ?? conn.baseUrl,
      apiKey: def?.apiKey ?? conn.apiKey,
    };
  }, [selectedAgent, acp.selectedProvider]);

  const buildSessionHref = useCallback((targetSessionId: string, focusId?: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (focusId && focusId !== targetSessionId) {
      params.set("focus", focusId);
    } else {
      params.delete("focus");
    }

    const query = params.toString();
    return `/workspace/${workspaceId}/sessions/${targetSessionId}${query ? `?${query}` : ""}`;
  }, [searchParams, workspaceId]);

  const fetchSessionRecord = useCallback(async (targetSessionId: string): Promise<SessionRecord | null> => {
    const response = await desktopAwareFetch(`/api/sessions/${targetSessionId}`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    return (data?.session ?? null) as SessionRecord | null;
  }, []);

  const fetchSessionTranscript = useCallback(async (targetSessionId: string): Promise<TranscriptMessage[]> => {
    const response = await desktopAwareFetch(`/api/sessions/${targetSessionId}/transcript`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load transcript for session ${targetSessionId}`);
    }
    const data = await response.json();
    return Array.isArray(data?.messages) ? data.messages as TranscriptMessage[] : [];
  }, []);

  useEffect(() => {
    if (!displaySessionId || displaySessionId === "__placeholder__") {
      setActiveSessionRecord(null);
      return;
    }

    let cancelled = false;
    fetchSessionRecord(displaySessionId)
      .then((record) => {
        if (!cancelled) {
          setActiveSessionRecord(record);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActiveSessionRecord(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [displaySessionId, fetchSessionRecord]);

  const resolveSessionNavigationTarget = useCallback(async (targetSessionId: string) => {
    const session = await fetchSessionRecord(targetSessionId);
    if (session?.parentSessionId) {
      return {
        routeSessionId: session.parentSessionId,
        focusedSessionId: session.sessionId,
      };
    }

    return {
      routeSessionId: targetSessionId,
      focusedSessionId: null,
    };
  }, [fetchSessionRecord]);

  useEffect(() => {
    if (!isResolved || sessionId === "__placeholder__") return;

    let cancelled = false;

    const syncSessionRoute = async () => {
      const target = await resolveSessionNavigationTarget(sessionId);
      if (cancelled) return;

      const focusFromQuery = searchParams.get("focus");
      const nextFocusedSessionId = target.focusedSessionId ?? (focusFromQuery && focusFromQuery !== target.routeSessionId ? focusFromQuery : null);
      setFocusedSessionId(nextFocusedSessionId);

      if (target.routeSessionId === sessionId) {
        navigationTargetRef.current = null;
        return;
      }

      const nextHref = buildSessionHref(target.routeSessionId, target.focusedSessionId);
      if (navigationTargetRef.current === nextHref) {
        return;
      }
      navigationTargetRef.current = nextHref;
      router.replace(nextHref);
    };

    syncSessionRoute().catch((error) => {
      console.warn("[SessionPage] Failed to resolve session navigation target:", error);
    });

    return () => {
      cancelled = true;
    };
  }, [buildSessionHref, isResolved, resolveSessionNavigationTarget, router, searchParams, sessionId]);

  const handleCreateSession = useCallback(
    async (provider: string) => {
      await ensureConnected();

      // Delete previous empty session before creating new one
      await deleteEmptySession(sessionId);

      const cwd = repoSelection?.path ?? undefined;
      const branch = repoSelection?.branch || undefined;
      const selectedSpec = selectedSpecialistId
        ? specialists.find((specialist) => specialist.id === selectedSpecialistId)
        : null;
      const role = selectedSpec?.role ?? selectedAgent;
      const {
        provider: effectiveProvider,
        model: resolvedModel,
        baseUrl,
        apiKey,
      } = resolveAgentConfig(role, provider, undefined, selectedSpec);
      console.log(`[handleCreateSession] Creating session: provider=${effectiveProvider}, model=${resolvedModel}, role=${role}, specialistId=${selectedSpecialistId}`);
      const result = await acp.createSession(cwd, effectiveProvider, undefined, role, workspaceId, resolvedModel, undefined, selectedSpecialistId ?? undefined, undefined, baseUrl, apiKey, branch);
      if (result?.sessionId) {
        router.push(`/workspace/${workspaceId}/sessions/${result.sessionId}`);
      }
    },
    [acp, ensureConnected, repoSelection, selectedAgent, selectedSpecialistId, sessionId, deleteEmptySession, workspaceId, router, resolveAgentConfig, specialists]
  );

  const handleSelectSession = useCallback(
    async (newSessionId: string) => {
      await ensureConnected();

      const target = await resolveSessionNavigationTarget(newSessionId);

      // Delete previous empty session before switching
      await deleteEmptySession(sessionId);

      setFocusedSessionId(target.focusedSessionId);
      acp.selectSession(target.focusedSessionId ?? target.routeSessionId);
      router.push(buildSessionHref(target.routeSessionId, target.focusedSessionId));
    },
    [acp, buildSessionHref, deleteEmptySession, ensureConnected, resolveSessionNavigationTarget, router, sessionId]
  );

  const handleResumeCurrentSession = useCallback(async () => {
    if (!displaySessionId || !activeSessionRecord?.cwd) return;
    await ensureConnected();
    setIsResumingSession(true);
    try {
      const resumed = await acpResumeSession(
        displaySessionId,
        activeSessionRecord.cwd,
        { throwOnError: true },
      );
      if (resumed?.sessionId) {
        bumpRefresh();
      }
    } catch (error) {
      if (!shouldRecreateSessionAfterResumeError(error)) {
        throw error;
      }

      const transcript = await fetchSessionTranscript(displaySessionId);
      const recreated = await acp.createSession(
        activeSessionRecord.cwd,
        "codex",
        activeSessionRecord.modeId,
        activeSessionRecord.role,
        workspaceId,
        activeSessionRecord.model,
        undefined,
        activeSessionRecord.specialistId,
        undefined,
        undefined,
        undefined,
        activeSessionRecord.branch,
      );

      if (!recreated?.sessionId) {
        return;
      }

      const restorePrompt = buildCrossInstanceRestorePrompt(activeSessionRecord, transcript);
      storePendingPrompt(recreated.sessionId, restorePrompt);
      router.push(`/workspace/${workspaceId}/sessions/${recreated.sessionId}`);
    } finally {
      setIsResumingSession(false);
    }
  }, [
    activeSessionRecord,
    acp,
    acpResumeSession,
    bumpRefresh,
    displaySessionId,
    ensureConnected,
    fetchSessionTranscript,
    router,
    workspaceId,
  ]);

  const ensureSessionForChat = useCallback(async (cwd?: string, provider?: string, modeId?: string, model?: string): Promise<string | null> => {
    await ensureConnected();
    // Always use the current session from URL
    if (sessionId) return sessionId;

    // Fallback: create a new session
    const selectedSpec = selectedSpecialistId
      ? specialists.find((specialist) => specialist.id === selectedSpecialistId)
      : null;
    const role = selectedSpec?.role ?? selectedAgent;
    const {
      provider: effectiveProvider,
      model: effectiveModel,
      baseUrl,
      apiKey,
    } = resolveAgentConfig(role, provider, model, selectedSpec);
    const branch = repoSelection?.branch || undefined;
    console.log(`[ensureSessionForChat] Creating session: provider=${effectiveProvider}, role=${role}, model=${effectiveModel}, specialistId=${selectedSpecialistId}`);
    const result = await acp.createSession(cwd, effectiveProvider, modeId, role, workspaceId, effectiveModel, undefined, selectedSpecialistId ?? undefined, undefined, baseUrl, apiKey, branch);
    if (result?.sessionId) {
      router.push(`/workspace/${workspaceId}/sessions/${result.sessionId}`);
      return result.sessionId;
    }
    return null;
  }, [acp, sessionId, ensureConnected, selectedAgent, selectedSpecialistId, workspaceId, router, resolveAgentConfig, repoSelection?.branch, specialists]);

  const handleAgentChange = useCallback((value: string) => {
    // Check if selecting a custom specialist (prefixed with "specialist:")
    if (value.startsWith("specialist:")) {
      const specId = value.slice("specialist:".length);
      const spec = specialists.find((s) => s.id === specId);
      if (spec) {
        console.log(`[handleAgentChange] Selecting specialist: ${spec.name} (id=${specId}, role=${spec.role})`);
        setSelectedAgent(spec.role);
        setSelectedSpecialistId(specId);
      }
    } else {
      // Built-in role selected
      const role = value as AgentRole;
      console.log(`[handleAgentChange] Changing agent role to: ${role}`);
      setSelectedAgent(role);
      setSelectedSpecialistId(null);
      if (role === "ROUTA") {
        setShowAgentToast(true);
        setTimeout(() => setShowAgentToast(false), 2500);
      }
    }
  }, [specialists]);

  const {
    routaTasks,
    crafterAgents,
    activeCrafterId,
    concurrency,
    handleTasksDetected,
    handleConfirmAllTasks,
    handleConfirmTask,
    handleEditTask,
    handleExecuteTask,
    handleExecuteAllTasks,
    handleSelectCrafter,
    handleSelectNoteTask,
    handleConcurrencyChange,
    handleExecuteProviderNoteTask,
    handleOpenOrExecuteNoteTask,
    handleExecuteAllNoteTasks,
    handleExecuteSelectedNoteTasks,
    handleUpdateAgentMessages,
  } = useSessionCrafters({
    sessionId,
    workspaceId,
    isResolved,
    acpConnected,
    acpUpdates,
    notesHook,
    repoSelection,
    focusedSessionId,
    setFocusedSessionId,
    bumpRefresh,
    resolveAgentConfig,
  });

  // Notes are now pre-filtered by useNotes(workspaceId, sessionId)
  // - Task notes: only those with matching sessionId
  // - Spec/general notes: workspace-wide (no sessionId) or matching sessionId
  const sessionNotes = notesHook.notes;
  const hasCollabNotes = sessionNotes.some((n) => n.metadata.type === "task" || n.metadata.type === "spec");

  // Verify workspace exists, redirect to home if not
  // Allow "default" as a special workspace ID that always exists
  const workspace = workspacesHook.workspaces.find((w) => w.id === workspaceId);
  const isDefaultWorkspace = workspaceId === "default";

  useEffect(() => {
    // Don't redirect if:
    // - URL params not yet resolved (static export mode)
    // - Still loading workspaces
    // - Workspace found in list
    // - Using "default" workspace (always allowed)
    if (!isResolved) return; // Wait for URL params to be parsed
    if (!workspacesHook.loading && !workspace && !isDefaultWorkspace) {
      router.push("/");
    }
  }, [workspace, workspacesHook.loading, router, isDefaultWorkspace, isResolved, workspaceId]);

  // Show loading state while URL params are being resolved (static export mode)
  // or while workspaces are loading
  if (!isResolved || (workspacesHook.loading && !isDefaultWorkspace)) {
    return (
      <div className="desktop-theme h-screen flex items-center justify-center bg-[var(--dt-bg-primary)]">
        <div className="text-[var(--dt-text-secondary)]">{t.common.loading}</div>
      </div>
    );
  }

  // For non-default workspaces, require workspace to exist
  if (!workspace && !isDefaultWorkspace) {
    return (
      <div className="desktop-theme h-screen flex items-center justify-center bg-[var(--dt-bg-primary)]">
        <div className="text-[var(--dt-text-secondary)]">{t.common.loading}</div>
      </div>
    );
  }

  // Create a fallback workspace object for "default"
  const _effectiveWorkspace = workspace ?? {
    id: "default",
    title: "Default Workspace",
    status: "active" as const,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const isPlanningSession = activeSessionRecord?.mcpProfile === "kanban-planning";
  const agentSelector = (
    <div className="relative">
      <Select
        value={selectedSpecialistId ? `specialist:${selectedSpecialistId}` : selectedAgent}
        onChange={(e) => handleAgentChange(e.target.value)}
        className="appearance-none rounded-xl border border-desktop-border bg-desktop-bg-secondary py-1.5 pl-2.5 pr-7 text-[11px] font-medium text-desktop-text-primary cursor-pointer focus:ring-1 focus:ring-desktop-accent"
      >
        {BUILTIN_ROLES.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
        {specialists.length > 0 && (
          <optgroup label={t.common.customSpecialists}>
            {specialists.map((s) => (
              <option key={s.id} value={`specialist:${s.id}`}>
                {s.name}{s.model ? ` (${s.model})` : ""}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-desktop-text-secondary pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
    </div>
  );
  const sessionTitleBarRight = (
    <>
      {agentSelector}
      {activeSessionRecord?.resumeCapabilities?.supported && activeSessionRecord?.cwd && (
        <button
          type="button"
          onClick={() => void handleResumeCurrentSession()}
          disabled={isResumingSession || acp.loading}
          className="inline-flex rounded-xl border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] font-medium text-desktop-text-primary transition-colors hover:bg-desktop-bg-active disabled:cursor-not-allowed disabled:opacity-60"
          title={t.sessions.resumeHint}
        >
          {isResumingSession || acp.loading ? t.sessions.resuming : t.sessions.resume}
        </button>
      )}
    </>
  );

  const sessionPageContent = (
    <div className={`desktop-theme flex min-w-0 flex-col bg-[var(--dt-bg-primary)] ${isEmbedMode ? "h-screen embed-mode" : "h-full"}`}>

      {isPlanningSession && !isEmbedMode ? (
        <div className="border-b border-black/6 bg-[#f7f3ea] px-5 py-4 dark:border-white/8 dark:bg-[#10161d]">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
                {t.workspace.planningSessionTitle}
              </div>
              <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                {t.workspace.planningSessionDescription}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => router.push(`/workspace/${workspaceId}/sessions`)}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
              >
                <ScrollText className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} />
                {t.nav.sessions}
              </button>
              <button
                type="button"
                onClick={() => router.push(`/workspace/${workspaceId}/kanban`)}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
              >
                <Columns2 className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} />
                {t.workspace.goToBoard}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── Main Area ────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Mobile sidebar overlay */}
        {showMobileSidebar && (
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setShowMobileSidebar(false)}
          />
        )}

        {/* ─── Left Sidebar ──────────────────────────────────────── */}
        {!isEmbedMode && (
          <LeftSidebar
            isCollapsed={isLeftSidebarCollapsed}
            onToggleCollapse={() => setIsLeftSidebarCollapsed((v) => !v)}
            width={leftSidebarWidth}
            showMobileSidebar={showMobileSidebar}
            onResizeStart={handleLeftResizeStart}
            sessionId={sessionId}
            focusedSessionId={focusedSessionId}
            workspaceId={workspaceId}
            refreshKey={refreshKey}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSession}
            codebases={codebases}
            repoSelection={repoSelection}
            hasProviders={acp.providers.length > 0}
            hasSelectedProvider={!!acp.selectedProvider}
            routaTasks={routaTasks}
            onConfirmAllTasks={handleConfirmAllTasks}
            onExecuteAllTasks={handleExecuteAllTasks}
            onConfirmTask={handleConfirmTask}
            onEditTask={handleEditTask}
            onExecuteTask={handleExecuteTask}
            concurrency={concurrency}
            onConcurrencyChange={handleConcurrencyChange}
            hasCollabNotes={hasCollabNotes}
            sessionNotes={sessionNotes}
            notesConnected={notesHook.connected}
            onUpdateNote={notesHook.updateNote}
            onDeleteNote={notesHook.deleteNote}
            onExecuteNoteTask={handleExecuteProviderNoteTask}
            onExecuteQuickAccessNoteTask={handleOpenOrExecuteNoteTask}
            onExecuteAllNoteTasks={handleExecuteAllNoteTasks}
            onExecuteSelectedNoteTasks={handleExecuteSelectedNoteTasks}
            crafterAgents={crafterAgents}
            onSelectNoteTask={handleSelectNoteTask}
          />
        )}

        {/* ─── Chat Area ──────────────────────────────────────────── */}
        <div className="flex flex-1 min-w-0 flex-col">
          {repoSlideSource && (
            <RepoSlideSessionPanel
              workspaceId={workspaceId}
              sessionId={displaySessionId}
              codebaseId={repoSlideCodebaseId}
            />
          )}
          <ChatPanel
            acp={acp}
            activeSessionId={displaySessionId}
            traceSessionId={displaySessionId}
            onEnsureSession={ensureSessionForChat}
            onSelectSession={handleSelectSession}
            repoSelection={repoSelection}
            onRepoChange={setRepoSelection}
            onTasksDetected={handleTasksDetected}
            agentRole={selectedAgent}
            onAgentRoleChange={(role) => handleAgentChange(role as AgentRole)}
            onCreateSession={handleCreateSession}
            workspaces={workspacesHook.workspaces}
            activeWorkspaceId={workspaceId}
            onWorkspaceChange={handleWorkspaceSelect}
            codebases={codebases}
            inputPrefill={dockerRetryText}
            onInputPrefillConsumed={() => setDockerRetryText(null)}
          />
        </div>

        {/* ─── Right Sidebar: CRAFTERs running status ─────────────── */}
        {!isEmbedMode && crafterAgents.length > 0 && (
          <>
            {/* Right sidebar resize handle */}
            <div
              className="hidden md:flex items-center justify-center w-1 cursor-col-resize hover:bg-[var(--dt-accent)]/30 active:bg-[var(--dt-accent)]/50 transition-colors group shrink-0"
              onMouseDown={handleResizeStart}
            >
              <div className="w-0.5 h-8 rounded-full bg-[var(--dt-border)] group-hover:bg-[var(--dt-accent)] group-active:bg-[var(--dt-accent)] transition-colors" />
            </div>
            <aside
              className="hidden md:flex shrink-0 border-l border-[var(--dt-border)] bg-[var(--dt-bg-primary)] flex-col overflow-hidden"
              style={{ width: `${sidebarWidth}px` }}
            >
              {/* CRAFTER agents header */}
              <div className="px-3 py-2 border-b border-[var(--dt-border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--dt-text-primary)]">
                    {t.sessions.craftersLabel}
                  </span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--dt-bg-active)] text-[var(--dt-accent)]">
                    {crafterAgents.length}
                  </span>
                </div>
                {/* Concurrency control */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium text-[var(--dt-text-secondary)] uppercase tracking-wider">
                    {t.sessions.concurrencyLabel}
                  </span>
                  <div className="flex items-center rounded-md border border-[var(--dt-border)] overflow-hidden">
                    {[1, 2].map((n) => (
                      <button
                        key={n}
                        onClick={() => handleConcurrencyChange(n)}
                        className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${
                          concurrency === n
                            ? "bg-[var(--dt-accent)] text-[var(--dt-accent-text)]"
                            : "bg-[var(--dt-bg-primary)] text-[var(--dt-text-secondary)] hover:bg-[var(--dt-bg-active)]"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {/* CRAFTERs content */}
              <CraftersView
                agents={crafterAgents}
                activeCrafterId={activeCrafterId}
                onSelectCrafter={handleSelectCrafter}
                onUpdateAgentMessages={handleUpdateAgentMessages}
              />
            </aside>
          </>
        )}
      </div>

      {/* ─── Resize overlay (prevents iframe/content interference) ─── */}
      {(isLeftResizing || isResizing) && (
        <div className="fixed inset-0 z-50 cursor-col-resize" />
      )}

      {/* ─── Agent Install Popup ─────────────────────────────────────── */}
      {showAgentInstallPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="agent-install-title"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowAgentInstallPopup(false)}
            aria-hidden="true"
          />
          <div
            className="relative w-full max-w-5xl h-[80vh] bg-[var(--dt-bg-primary)] border border-[var(--dt-border)] rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-11 px-4 border-b border-[var(--dt-border)] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div id="agent-install-title" className="text-sm font-semibold text-[var(--dt-text-primary)]">
                  {t.sessions.installAgents}
                </div>
                <a
                  href="/settings/agents"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-[var(--dt-text-secondary)] hover:text-[var(--dt-text-primary)] transition-colors"
                >
                  {t.sessions.openInNewTab}
                </a>
              </div>
              <button
                ref={agentInstallCloseRef}
                type="button"
                onClick={() => setShowAgentInstallPopup(false)}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--dt-bg-active)] text-[var(--dt-text-secondary)] hover:text-[var(--dt-text-primary)] transition-colors"
                title={t.common.closeEsc}
                aria-label={t.common.close}
              >
                <X className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
              </button>
            </div>
            <div className="h-[calc(80vh-44px)]">
              <AgentInstallPanel />
            </div>
          </div>
        </div>
      )}

      {/* ─── Agent Toast ──────────────────────────────────────────── */}
      {showAgentToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-[var(--dt-text-primary)] text-[var(--dt-accent-text)] text-sm font-medium shadow-lg animate-fade-in">
          {t.common.routaModeToast}
        </div>
      )}

      {/* ─── Docker Config Modal ─────────────────────────────────── */}
      <DockerConfigModal
        open={!!dockerErrorMessage}
        errorMessage={dockerErrorMessage ?? ""}
        onClose={() => setDockerErrorMessage(null)}
        onSaved={(apiKey) => {
          setDockerErrorMessage(null);
          // Re-store pending text so the pending-prompt effect can re-send after reconnect
          if (dockerRetryText && sessionId) {
            storePendingPrompt(sessionId, dockerRetryText);
          }
          // The input will be pre-filled in the TiptapInput via dockerRetryText state
          void apiKey; // used by saveProviderConnections inside DockerConfigModal
        }}
      />

      {/* ─── Specialist Manager ──────────────────────────────────── */}
      <SpecialistManager
        open={showSpecialistManager}
        onClose={() => setShowSpecialistManager(false)}
      />
    </div>
  );

  if (isEmbedMode) {
    return sessionPageContent;
  }

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceSwitcher={
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId}
          onSelect={handleWorkspaceSelect}
          onCreate={handleWorkspaceCreate}
          loading={workspacesHook.loading}
          compact
        />
      }
      titleBarRight={sessionTitleBarRight}
    >
      {sessionPageContent}
    </DesktopAppShell>
  );
}
