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
import {useRouter, useParams} from "next/navigation";
import {SkillPanel} from "@/client/components/skill-panel";
import {ChatPanel} from "@/client/components/chat-panel";
import {SessionPanel} from "@/client/components/session-panel";
import {SpecialistManager} from "@/client/components/specialist-manager";
import {type CrafterAgent, type CrafterMessage, TaskPanel} from "@/client/components/task-panel";
import {CollaborativeTaskEditor} from "@/client/components/collaborative-task-editor";
import {AgentInstallPanel} from "@/client/components/agent-install-panel";
import {WorkspaceSwitcher} from "@/client/components/workspace-switcher";
import {CodebasePicker} from "@/client/components/codebase-picker";
import {useWorkspaces, useCodebases} from "@/client/hooks/use-workspaces";
import {useAcp} from "@/client/hooks/use-acp";
import {useSkills} from "@/client/hooks/use-skills";
import {useNotes} from "@/client/hooks/use-notes";
import type {RepoSelection} from "@/client/components/repo-picker";
import type {ParsedTask} from "@/client/utils/task-block-parser";
import {ProtocolBadge} from "@/app/protocol-badge";
import {consumePendingPrompt} from "@/client/utils/pending-prompt";
import {SettingsPanel, loadDefaultProviders, loadProviderConnectionConfig, getModelDefinitionByAlias} from "@/client/components/settings-panel";

type AgentRole = "CRAFTER" | "ROUTA" | "GATE" | "DEVELOPER";

/** Specialist loaded from DB for the agent selector */
interface SpecialistOption {
  id: string;
  name: string;
  role: AgentRole;
  model?: string;
}

/** Built-in roles always available in the selector */
const BUILTIN_ROLES: { value: AgentRole; label: string }[] = [
  { value: "CRAFTER", label: "CRAFTER" },
  { value: "ROUTA", label: "ROUTA" },
  { value: "GATE", label: "GATE" },
  { value: "DEVELOPER", label: "DEVELOPER" },
];

/**
 * Extract route params from URL pathname.
 * In static export mode, useParams() returns "__placeholder__" because that's what
 * was used in generateStaticParams(). We need to parse the actual URL instead.
 *
 * Returns { workspaceId, sessionId, isResolved } where isResolved indicates
 * whether the actual URL params have been parsed (vs still showing placeholder).
 */
function useRealParams() {
  const params = useParams();

  // Check if we're in static export mode with placeholder values
  const isPlaceholder =
    params.workspaceId === "__placeholder__" ||
    params.sessionId === "__placeholder__";

  // State to hold the resolved params
  const [realParams, setRealParams] = useState<{
    workspaceId: string;
    sessionId: string;
    isResolved: boolean;
  }>({
    // Start with placeholder values, will be resolved in useEffect
    workspaceId: params.workspaceId as string,
    sessionId: params.sessionId as string,
    // If not placeholder, consider it resolved immediately
    isResolved: !isPlaceholder,
  });

  // Resolve params on mount and when URL changes
  useEffect(() => {
    if (isPlaceholder) {
      // Static export mode - parse from URL
      const pathname = window.location.pathname;
      const match = pathname.match(/^\/workspace\/([^/]+)\/sessions\/([^/]+)/);
      if (match) {
        const newWorkspaceId = match[1];
        const newSessionId = match[2];
        // Only update if values changed to avoid unnecessary re-renders
        if (
          newWorkspaceId !== realParams.workspaceId ||
          newSessionId !== realParams.sessionId ||
          !realParams.isResolved
        ) {
          setRealParams({
            workspaceId: newWorkspaceId,
            sessionId: newSessionId,
            isResolved: true,
          });
        }
      }
    } else {
      // Normal mode - use Next.js params directly
      const newWorkspaceId = params.workspaceId as string;
      const newSessionId = params.sessionId as string;
      if (
        newWorkspaceId !== realParams.workspaceId ||
        newSessionId !== realParams.sessionId ||
        !realParams.isResolved
      ) {
        setRealParams({
          workspaceId: newWorkspaceId,
          sessionId: newSessionId,
          isResolved: true,
        });
      }
    }
  }, [params.workspaceId, params.sessionId, isPlaceholder, realParams]);

  return realParams;
}

export function SessionPageClient() {
  const router = useRouter();
  const { workspaceId, sessionId, isResolved } = useRealParams();

  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState<AgentRole>("ROUTA");
  const [selectedSpecialistId, setSelectedSpecialistId] = useState<string | null>(null);
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [showAgentToast, setShowAgentToast] = useState(false);
  const [repoSelection, setRepoSelection] = useState<RepoSelection | null>(null);
  const [routaTasks, setRoutaTasks] = useState<ParsedTask[]>([]);

  // ── Workspace state ───────────────────────────────────────────────────
  const workspacesHook = useWorkspaces();
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(workspaceId);
  const { codebases } = useCodebases(workspaceId);

  // Auto-select default codebase as repo when workspace changes
  useEffect(() => {
    if (codebases.length === 0) return;
    const def = codebases.find((c) => c.isDefault) ?? codebases[0];
    setRepoSelection({ path: def.repoPath, branch: def.branch ?? "", name: def.label ?? def.repoPath.split("/").pop() ?? "" });
  }, [codebases]);

  const handleCodebaseSelect = useCallback((repoPath: string) => {
    const codebase = codebases.find((c) => c.repoPath === repoPath);
    if (codebase) {
      setRepoSelection({ path: codebase.repoPath, branch: codebase.branch ?? "", name: codebase.label ?? codebase.repoPath.split("/").pop() ?? "" });
    }
  }, [codebases]);

  const handleWorkspaceSelect = useCallback((wsId: string) => {
    setActiveWorkspaceId(wsId);
    router.push(`/workspace/${wsId}`);
  }, [router]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const ws = await workspacesHook.createWorkspace(title);
    if (ws) router.push(`/workspace/${ws.id}`);
  }, [workspacesHook, router]);

  const acp = useAcp();
  const skillsHook = useSkills();
  const notesHook = useNotes(workspaceId, sessionId);

  // ── Collaborative editing panel view ──────────────────────────────────
  const [taskPanelMode, setTaskPanelMode] = useState<"tasks" | "collab">("tasks");

  // ── Resizable right sidebar state ────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  // ── Resizable left sidebar state ──────────────────────────────────
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(280);
  const [isLeftResizing, setIsLeftResizing] = useState(false);
  const leftResizeStartXRef = useRef(0);
  const leftResizeStartWidthRef = useRef(0);

  // ── Left sidebar collapse ──────────────────────────────────────────
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false);

  // ── Mobile sidebar toggle ──────────────────────────────────────────
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [showAgentInstallPopup, setShowAgentInstallPopup] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [showSpecialistManager, setShowSpecialistManager] = useState(false);

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

  // ── Load custom specialists for agent selector ──────────────────────
  useEffect(() => {
    const loadSpecialists = async () => {
      try {
        const res = await fetch("/api/specialists");
        if (res.ok) {
          const data = await res.json();
          const items: SpecialistOption[] = (data.specialists || [])
            .filter((s: any) => s.enabled !== false)
            .map((s: any) => ({
              id: s.id,
              name: s.name,
              role: s.role as AgentRole,
              model: s.model,
            }));
          setSpecialists(items);
        }
      } catch {
        // Specialists are optional — DB may not have the table yet
      }
    };
    loadSpecialists();
  }, [showSpecialistManager]); // Reload when specialist manager closes

  // ── CRAFTERs view state ──────────────────────────────────────────────
  const [crafterAgents, setCrafterAgents] = useState<CrafterAgent[]>([]);
  const [activeCrafterId, setActiveCrafterId] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState(1);

  // ── Tool mode state ──────────────────────────────────────────────────
  const [toolMode, setToolMode] = useState<"essential" | "full">("essential");

  // Track last processed update index for child agent routing
  const lastChildUpdateIndexRef = useRef(0);
  const lastSessionRenameUpdateIndexRef = useRef(0);

  // Auto-connect on mount so providers are loaded immediately
  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Select the session from URL on mount
  useEffect(() => {
    // Wait for params to be resolved and not be placeholder
    if (!isResolved || sessionId === "__placeholder__") return;
    if (sessionId && acp.connected) {
      acp.selectSession(sessionId);
    }
  }, [sessionId, acp.connected, acp.selectSession, isResolved]);

  // Restore session metadata (role, provider, model) when navigating to an existing session
  const sessionMetadataLoadedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Wait for params to be resolved and not be placeholder
    if (!isResolved || sessionId === "__placeholder__") return;
    if (!sessionId || !acp.connected) return;
    // Only fetch once per session
    if (sessionMetadataLoadedRef.current.has(sessionId)) return;
    sessionMetadataLoadedRef.current.add(sessionId);

    fetch(`/api/sessions/${sessionId}`)
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!data?.session) return;
        const { role, provider } = data.session;
        // Restore agent role if stored
        if (role && ["CRAFTER", "ROUTA", "GATE", "DEVELOPER"].includes(role)) {
          setSelectedAgent(role as AgentRole);
        }
        // Restore provider
        if (provider) {
          acp.setProvider(provider);
        }
        console.log(`[SessionPage] Restored session metadata: role=${role}, provider=${provider}`);
      })
      .catch((err) => {
        console.warn("[SessionPage] Failed to restore session metadata:", err);
      });
  }, [sessionId, acp.connected, acp.setProvider, isResolved]);

  // Track if we've already sent the pending prompt for this session
  const pendingPromptSentRef = useRef<Set<string>>(new Set());

  // Check for and send pending prompt after session is selected
  useEffect(() => {
    if (!sessionId || !acp.connected || acp.loading) return;

    // Only send once per session per page load
    if (pendingPromptSentRef.current.has(sessionId)) return;

    // Check for pending prompt from home page navigation
    const pendingText = consumePendingPrompt(sessionId);
    if (pendingText) {
      console.log(`[SessionPage] Found pending prompt for session ${sessionId}, sending...`);
      pendingPromptSentRef.current.add(sessionId);

      // Small delay to ensure ACP connection is fully ready
      const timer = setTimeout(() => {
        acp.prompt(pendingText);
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [sessionId, acp.connected, acp.loading, acp.prompt]);

  // Load global tool mode on mount
  useEffect(() => {
    fetch("/api/mcp/tools")
      .then((res) => res.json())
      .then((data) => {
        if (data?.globalMode) {
          setToolMode(data.globalMode);
        }
      })
      .catch(() => {});
  }, []);

  // Toggle tool mode handler
  const handleToolModeToggle = useCallback(async (checked: boolean) => {
    const newMode = checked ? "essential" : "full";
    setToolMode(newMode);
    try {
      await fetch("/api/mcp/tools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
    } catch (error) {
      console.error("Failed to toggle tool mode:", error);
    }
  }, []);

  // Load repo skills when repo selection changes
  useEffect(() => {
    if (repoSelection?.path) {
      skillsHook.loadRepoSkills(repoSelection.path);
    } else {
      skillsHook.clearRepoSkills();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoSelection?.path]);

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

  // ── Route child agent SSE updates to crafter agents ──────────────────
  useEffect(() => {
    const updates = acp.updates;
    if (!updates.length) {
      lastChildUpdateIndexRef.current = 0;
      return;
    }

    const startIndex =
      lastChildUpdateIndexRef.current > updates.length
        ? 0
        : lastChildUpdateIndexRef.current;
    const pending = updates.slice(startIndex);
    if (!pending.length) return;
    lastChildUpdateIndexRef.current = updates.length;

    setCrafterAgents((prev) => {
      let updated = [...prev];
      let changed = false;

      for (const notification of pending) {
        const raw = notification as Record<string, unknown>;
        const update = (raw.update ?? raw) as Record<string, unknown>;
        const childAgentId = (update.childAgentId ?? raw.childAgentId) as string | undefined;

        if (!childAgentId) continue;

        const agentIdx = updated.findIndex((a) => a.id === childAgentId);
        if (agentIdx < 0) continue;

        const agent = { ...updated[agentIdx] };
        const messages = [...agent.messages];
        const kind = update.sessionUpdate as string | undefined;

        if (!kind) continue;
        changed = true;

        const extractText = (): string => {
          const content = update.content as { type: string; text?: string } | undefined;
          if (content?.text) return content.text;
          if (typeof update.text === "string") return update.text as string;
          return "";
        };

        switch (kind) {
          case "agent_message_chunk": {
            const text = extractText();
            if (!text) break;
            // Find or create streaming message
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && lastMsg.role === "assistant" && !lastMsg.toolName) {
              messages[messages.length - 1] = { ...lastMsg, content: lastMsg.content + text };
            } else {
              messages.push({
                id: crypto.randomUUID(),
                role: "assistant",
                content: text,
                timestamp: new Date(),
              });
            }
            break;
          }

          case "agent_thought_chunk": {
            const text = extractText();
            if (!text) break;
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && lastMsg.role === "thought") {
              messages[messages.length - 1] = { ...lastMsg, content: lastMsg.content + text };
            } else {
              messages.push({
                id: crypto.randomUUID(),
                role: "thought",
                content: text,
                timestamp: new Date(),
              });
            }
            break;
          }

          case "tool_call": {
            const toolCallId = update.toolCallId as string | undefined;
            const title = (update.title as string) ?? "tool";
            const status = (update.status as string) ?? "running";
            messages.push({
              id: toolCallId ?? crypto.randomUUID(),
              role: "tool",
              content: title,
              timestamp: new Date(),
              toolName: title,
              toolStatus: status,
            });
            break;
          }

          case "tool_call_update": {
            const toolCallId = update.toolCallId as string | undefined;
            const status = update.status as string | undefined;
            if (toolCallId) {
              const idx = messages.findIndex((m) => m.id === toolCallId || (m.role === "tool" && m.toolName === (update.title as string)));
              if (idx >= 0) {
                messages[idx] = {
                  ...messages[idx],
                  toolStatus: status ?? messages[idx].toolStatus,
                };
              }
            }
            break;
          }

          case "completed":
          case "ended": {
            agent.status = "completed";
            break;
          }

          case "task_completion": {
            // Orchestrator sends this when a child agent finishes (success or error)
            const taskStatus = update.taskStatus as string | undefined;
            const summary = update.completionSummary as string | undefined;
            if (taskStatus === "NEEDS_FIX" || taskStatus === "BLOCKED" || taskStatus === "FAILED") {
              agent.status = "error";
              if (summary) {
                messages.push({
                  id: crypto.randomUUID(),
                  role: "info",
                  content: `Error: ${summary}`,
                  timestamp: new Date(),
                });
              }
            } else {
              agent.status = "completed";
              if (summary) {
                messages.push({
                  id: crypto.randomUUID(),
                  role: "info",
                  content: summary,
                  timestamp: new Date(),
                });
              }
            }
            break;
          }

          default:
            break;
        }

        agent.messages = messages;
        updated[agentIdx] = agent;
      }

      return changed ? updated : prev;
    });
  }, [acp.updates]);

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
      const res = await fetch(`/api/sessions/${sid}/history`);
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
      const resp = await fetch(`/api/sessions/${sid}`);
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
        await fetch(`/api/sessions/${sid}`, { method: "DELETE" });
      } catch (e) {
        console.error("Failed to delete empty session", e);
      }
    }
  }, [isSessionEmpty]);

  /** Resolve effective provider + model + connection config: explicit > per-role default > global selection */
  const resolveAgentConfig = useCallback((explicitProvider?: string) => {
    const defaults = loadDefaultProviders();
    const roleConfig = defaults[selectedAgent];
    const effectiveProvider = explicitProvider || roleConfig?.provider || acp.selectedProvider;
    const modelAliasOrName = roleConfig?.model;
    const def = modelAliasOrName ? getModelDefinitionByAlias(modelAliasOrName) : undefined;
    const conn = loadProviderConnectionConfig(effectiveProvider);
    return {
      provider: effectiveProvider,
      model: def ? def.modelName : (modelAliasOrName ?? conn.model),
      baseUrl: def?.baseUrl ?? conn.baseUrl,
      apiKey: def?.apiKey ?? conn.apiKey,
    };
  }, [selectedAgent, acp.selectedProvider]);

  const handleCreateSession = useCallback(
    async (provider: string) => {
      await ensureConnected();

      // Delete previous empty session before creating new one
      await deleteEmptySession(sessionId);

      const cwd = repoSelection?.path ?? undefined;
      const branch = repoSelection?.branch || undefined;
      // Always pass the selected role - don't skip CRAFTER
      const role = selectedAgent;
      const { provider: effectiveProvider, model: resolvedModel, baseUrl, apiKey } = resolveAgentConfig(provider);
      console.log(`[handleCreateSession] Creating session: provider=${effectiveProvider}, model=${resolvedModel}, role=${role}, specialistId=${selectedSpecialistId}`);
      const result = await acp.createSession(cwd, effectiveProvider, undefined, role, workspaceId, resolvedModel, undefined, selectedSpecialistId ?? undefined, baseUrl, apiKey, branch);
      if (result?.sessionId) {
        router.push(`/workspace/${workspaceId}/sessions/${result.sessionId}`);
      }
    },
    [acp, ensureConnected, repoSelection, selectedAgent, selectedSpecialistId, sessionId, deleteEmptySession, workspaceId, router, resolveAgentConfig]
  );

  const handleSelectSession = useCallback(
    async (newSessionId: string) => {
      await ensureConnected();

      // Delete previous empty session before switching
      await deleteEmptySession(sessionId);

      acp.selectSession(newSessionId);
      router.push(`/workspace/${workspaceId}/sessions/${newSessionId}`);
    },
    [acp, ensureConnected, sessionId, deleteEmptySession, workspaceId, router]
  );

  const ensureSessionForChat = useCallback(async (cwd?: string, provider?: string, modeId?: string, model?: string): Promise<string | null> => {
    await ensureConnected();
    // Always use the current session from URL
    if (sessionId) return sessionId;

    // Fallback: create a new session
    const role = selectedAgent;
    const { provider: effectiveProvider, model: resolvedModel, baseUrl, apiKey } = resolveAgentConfig(provider);
    // Explicit model (from chat input) takes priority over per-role model config
    const effectiveModel = model ?? resolvedModel;
    const branch = repoSelection?.branch || undefined;
    console.log(`[ensureSessionForChat] Creating session: provider=${effectiveProvider}, role=${role}, model=${effectiveModel}, specialistId=${selectedSpecialistId}`);
    const result = await acp.createSession(cwd, effectiveProvider, modeId, role, workspaceId, effectiveModel, undefined, selectedSpecialistId ?? undefined, baseUrl, apiKey, branch);
    if (result?.sessionId) {
      router.push(`/workspace/${workspaceId}/sessions/${result.sessionId}`);
      return result.sessionId;
    }
    return null;
  }, [acp, sessionId, ensureConnected, selectedAgent, selectedSpecialistId, workspaceId, router, resolveAgentConfig]);

  const handleLoadSkill = useCallback(async (name: string): Promise<string | null> => {
    const skill = await skillsHook.loadSkill(name, repoSelection?.path);
    return skill?.content ?? null;
  }, [skillsHook, repoSelection?.path]);

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

  // ── Routa Task Panel Handlers ─────────────────────────────────────────
  const handleTasksDetected = useCallback(async (tasks: ParsedTask[]) => {
    setRoutaTasks(tasks);

    // Auto-save tasks to Notes system for collaborative editing
    for (const task of tasks) {
      const taskContent = [
        task.objective && `## Objective\n${task.objective}`,
        task.scope && `## Scope\n${task.scope}`,
        task.definitionOfDone && `## Definition of Done\n${task.definitionOfDone}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      try {
        await notesHook.createNote({
          noteId: `task-${task.id}`,
          title: task.title,
          content: taskContent,
          type: "task",
          sessionId: sessionId,
          metadata: { taskStatus: "PENDING" },
        });
      } catch {
        // Note may already exist, try updating
        await notesHook.updateNote(`task-${task.id}`, {
          title: task.title,
          content: taskContent,
        });
      }
    }

    // Auto-switch to collab mode when tasks are detected
    if (tasks.length > 0) {
      setTaskPanelMode("collab");
    }
  }, [notesHook, sessionId]);

  /**
   * Call a Routa MCP tool via the /api/mcp endpoint.
   * Handles auto-initialization and retries on stale sessions.
   */
  const mcpSessionRef = useRef<string | null>(null);

  const initMcpSession = useCallback(async (): Promise<string | null> => {
    const initRes = await fetch("/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Routa-Workspace-Id": workspaceId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "routa-ui", version: "0.1.0" },
        },
      }),
    });
    const mcpSessionId = initRes.headers.get("mcp-session-id");
    if (mcpSessionId) {
      mcpSessionRef.current = mcpSessionId;
      console.log(`[MCP] Session initialized: ${mcpSessionId} (workspace: ${workspaceId})`);
    }
    return mcpSessionId;
  }, [workspaceId]);

  const callMcpTool = useCallback(async (toolName: string, args: Record<string, unknown>) => {
    // Ensure MCP session is initialized
    if (!mcpSessionRef.current) {
      await initMcpSession();
    }

    const doCall = async () => {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "Routa-Workspace-Id": workspaceId,
          ...(mcpSessionRef.current ? { "Mcp-Session-Id": mcpSessionRef.current } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: { name: toolName, arguments: args },
        }),
      });

      // Update session ref if server auto-initialized a new session
      const newSessionId = res.headers.get("mcp-session-id");
      if (newSessionId && newSessionId !== mcpSessionRef.current) {
        console.log(`[MCP] Session updated by server: ${newSessionId}`);
        mcpSessionRef.current = newSessionId;
      }

      return res.json();
    };

    let data = await doCall();

    // If we got a "not initialized" error or "tool not found" (stale session),
    // re-initialize and retry once
    const isStaleSession =
      (data.error?.code === -32000 && data.error?.message?.includes("not initialized")) ||
      (data.error?.code === -32602 && data.error?.message?.includes("not found"));
    if (isStaleSession) {
      console.log(`[MCP] Session stale (${data.error?.code}: ${data.error?.message}), re-initializing...`);
      mcpSessionRef.current = null;
      await initMcpSession();
      data = await doCall();
    }

    if (data.error) throw new Error(data.error.message || "MCP tool call failed");
    return data.result;
  }, [initMcpSession, workspaceId]);

  const handleConfirmAllTasks = useCallback(() => {
    setRoutaTasks((prev) =>
      prev.map((t) => (t.status === "pending" ? { ...t, status: "confirmed" as const } : t))
    );
  }, []);

  const handleConfirmTask = useCallback((taskId: string) => {
    setRoutaTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: "confirmed" as const } : t))
    );
  }, []);

  const handleEditTask = useCallback((taskId: string, updated: Partial<ParsedTask>) => {
    setRoutaTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, ...updated } : t))
    );
  }, []);

  /**
   * Execute a single task by creating it in the MCP task store
   * and delegating to a CRAFTER agent.
   * Returns the created CrafterAgent info.
   */
  const handleExecuteTask = useCallback(async (taskId: string): Promise<CrafterAgent | null> => {
    const task = routaTasks.find((t) => t.id === taskId);
    if (!task) return null;

    // Mark as running
    setRoutaTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: "running" as const } : t))
    );

    try {
      // 1. Create task in MCP task store
      const createResult = await callMcpTool("create_task", {
        title: task.title,
        objective: task.objective,
        scope: task.scope || undefined,
        sessionId,
        acceptanceCriteria: task.definitionOfDone
          ? task.definitionOfDone.split("\n").filter(Boolean).map((l) => l.replace(/^\d+[.)]\s*/, "").trim())
          : undefined,
      });

      // Extract created taskId from result
      const resultText = createResult?.content?.[0]?.text ?? "{}";
      let mcpTaskId: string | undefined;
      try {
        const parsed = JSON.parse(resultText);
        mcpTaskId = parsed.taskId ?? parsed.id;
      } catch {
        const m = resultText.match(/"(?:taskId|id)"\s*:\s*"([^"]+)"/);
        mcpTaskId = m?.[1];
      }

      let agentId: string | undefined;
      let childSessionId: string | undefined;
      let delegationError: string | undefined;

      if (!mcpTaskId) {
        console.warn("[TaskPanel] Could not extract taskId from create_task result:", resultText);
        delegationError = `Failed to create task in MCP store. Raw: ${resultText.slice(0, 200)}`;
      } else {
        // 2. Delegate to a CRAFTER agent
        try {
          const delegateResult = await callMcpTool("delegate_task_to_agent", {
            taskId: mcpTaskId,
            callerAgentId: "routa-ui",
            callerSessionId: sessionId,
            specialist: "CRAFTER",
          });

          // Extract agent info from delegation result
          const delegateText = delegateResult?.content?.[0]?.text ?? "{}";
          try {
            const parsed = JSON.parse(delegateText);
            agentId = parsed.agentId;
            childSessionId = parsed.sessionId;
            if (parsed.error) delegationError = parsed.error;
          } catch {
            const agentMatch = delegateText.match(/"agentId"\s*:\s*"([^"]+)"/);
            const sessionMatch = delegateText.match(/"sessionId"\s*:\s*"([^"]+)"/);
            const errorMatch = delegateText.match(/"error"\s*:\s*"([^"]+)"/);
            agentId = agentMatch?.[1];
            childSessionId = sessionMatch?.[1];
            if (errorMatch) delegationError = errorMatch[1];
          }
        } catch (delegateErr) {
          delegationError = delegateErr instanceof Error ? delegateErr.message : String(delegateErr);
          console.warn("[TaskPanel] delegate_task_to_agent failed:", delegateErr);
        }
      }

      // 3. Create CrafterAgent record
      const initialStatus = delegationError ? "error" : "running";
      const initialMessages: CrafterMessage[] = delegationError
        ? [{ id: crypto.randomUUID(), role: "info", content: `Delegation failed: ${delegationError}`, timestamp: new Date() }]
        : [];
      const crafterAgent: CrafterAgent = {
        id: agentId ?? `crafter-${taskId}`,
        sessionId: childSessionId ?? "",
        taskId,
        taskTitle: task.title,
        status: initialStatus,
        messages: initialMessages,
      };

      setCrafterAgents((prev) => [...prev, crafterAgent]);

      // Auto-select this agent if concurrency is 1
      if (concurrency === 1) {
        setActiveCrafterId(crafterAgent.id);
      } else if (!activeCrafterId) {
        setActiveCrafterId(crafterAgent.id);
      }

      // Mark status based on delegation outcome
      setRoutaTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: delegationError ? ("confirmed" as const) : ("completed" as const) }
            : t
        )
      );

      return crafterAgent;
    } catch (err) {
      console.error("[TaskPanel] Task execution failed:", err);
      setRoutaTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: "confirmed" as const } : t))
      );
      return null;
    }
  }, [routaTasks, sessionId, callMcpTool, concurrency, activeCrafterId]);

  /**
   * Execute all confirmed tasks with configurable concurrency.
   */
  const handleExecuteAllTasks = useCallback(async (requestedConcurrency: number) => {
    const confirmedTasks = routaTasks.filter((t) => t.status === "confirmed");
    if (confirmedTasks.length === 0) return;

    const effectiveConcurrency = Math.min(requestedConcurrency, confirmedTasks.length);

    if (effectiveConcurrency <= 1) {
      // Sequential execution - auto-switch to each agent's view
      for (const task of confirmedTasks) {
        const agent = await handleExecuteTask(task.id);
        if (agent) {
          setActiveCrafterId(agent.id);
        }
      }
    } else {
      // Parallel execution with concurrency limit
      const queue = [...confirmedTasks];
      const runBatch = async () => {
        const batch = queue.splice(0, effectiveConcurrency);
        const promises = batch.map((task) => handleExecuteTask(task.id));
        const results = await Promise.allSettled(promises);
        // Select the first agent from the batch
        for (const result of results) {
          if (result.status === "fulfilled" && result.value) {
            setActiveCrafterId(result.value.id);
            break;
          }
        }
      };

      while (queue.length > 0) {
        await runBatch();
      }
    }
  }, [routaTasks, handleExecuteTask]);

  const handleSelectCrafter = useCallback((agentId: string) => {
    setActiveCrafterId(agentId);
  }, []);

  const handleConcurrencyChange = useCallback((n: number) => {
    setConcurrency(n);
  }, []);

  /**
   * Abort a running CRAFTER agent by sending session/cancel to the child session.
   */
  const handleAbortCrafter = useCallback(async (agentId: string, childSessionId: string) => {
    if (!childSessionId) return;
    try {
      await fetch("/api/acp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "session/cancel",
          params: { sessionId: childSessionId },
        }),
      });
      console.log(`[SessionPage] Aborted CRAFTER agent ${agentId} (session: ${childSessionId})`);
    } catch (err) {
      console.error("[SessionPage] Failed to abort CRAFTER:", err);
    }
    // Update UI regardless of API success
    setCrafterAgents((prev) =>
      prev.map((a) =>
        a.id === agentId
          ? {
              ...a,
              status: "error" as const,
              messages: [
                ...a.messages,
                {
                  id: crypto.randomUUID(),
                  role: "info" as const,
                  content: "Aborted by user",
                  timestamp: new Date(),
                },
              ],
            }
          : a
      )
    );
    // Reset the associated task back to "confirmed" so it can be re-run
    const agent = crafterAgents.find((a) => a.id === agentId);
    if (agent?.taskId) {
      setRoutaTasks((prev) =>
        prev.map((t) => (t.id === agent.taskId ? { ...t, status: "confirmed" as const } : t))
      );
    }
  }, [crafterAgents]);

  /**
   * Manually mark a CRAFTER agent as done without waiting for report_to_parent.
   */
  const handleMarkDoneCrafter = useCallback((agentId: string) => {
    setCrafterAgents((prev) =>
      prev.map((a) =>
        a.id === agentId
          ? {
              ...a,
              status: "completed" as const,
              messages: [
                ...a.messages,
                {
                  id: crypto.randomUUID(),
                  role: "info" as const,
                  content: "Marked as done by user",
                  timestamp: new Date(),
                },
              ],
            }
          : a
      )
    );
    const agent = crafterAgents.find((a) => a.id === agentId);
    if (agent?.taskId) {
      setRoutaTasks((prev) =>
        prev.map((t) => (t.id === agent.taskId ? { ...t, status: "completed" as const } : t))
      );
    }
  }, [crafterAgents]);

  /**
   * Execute a single collaborative task note by creating it in the MCP task store
   * and delegating to a CRAFTER agent.
   */
  const handleExecuteNoteTask = useCallback(async (noteId: string): Promise<CrafterAgent | null> => {
    const note = notesHook.notes.find((n) => n.id === noteId);
    if (!note) return null;

    // Enforce concurrency limit: if concurrency=1 and another task is running, skip
    if (concurrency <= 1) {
      const runningTask = notesHook.notes.find(
        (n) => n.id !== noteId && n.metadata.type === "task" && n.metadata.taskStatus === "IN_PROGRESS"
      );
      if (runningTask) {
        console.warn(`[CollabEditor] Concurrency limit reached (${concurrency}). Task "${runningTask.title}" is still running.`);
        return null;
      }
    }

    // Mark note as in-progress
    await notesHook.updateNote(noteId, {
      metadata: { ...note.metadata, taskStatus: "IN_PROGRESS" },
    });

    try {
      // 1. Create task in MCP task store
      const createResult = await callMcpTool("create_task", {
        title: note.title,
        objective: note.content || note.title,
        workspaceId,
        sessionId,
      });

      const resultText = createResult?.content?.[0]?.text ?? "{}";
      let mcpTaskId: string | undefined;
      try {
        const parsed = JSON.parse(resultText);
        mcpTaskId = parsed.taskId ?? parsed.id;
      } catch {
        const m = resultText.match(/"(?:taskId|id)"\s*:\s*"([^"]+)"/);
        mcpTaskId = m?.[1];
      }

      let agentId: string | undefined;
      let childSessionId: string | undefined;
      let delegationError: string | undefined;

      if (!mcpTaskId) {
        console.warn("[CollabEditor] Could not extract taskId for note:", noteId);
        delegationError = `Failed to create task in MCP task store. Raw result: ${resultText.slice(0, 200)}`;
      } else {
        try {
          const delegateResult = await callMcpTool("delegate_task_to_agent", {
            taskId: mcpTaskId,
            callerAgentId: "routa-ui",
            callerSessionId: sessionId,
            specialist: "CRAFTER",
          });
          const delegateText = delegateResult?.content?.[0]?.text ?? "{}";
          try {
            const parsed = JSON.parse(delegateText);
            agentId = parsed.agentId;
            childSessionId = parsed.sessionId;
            // Check for error in the MCP tool result
            if (parsed.error) {
              delegationError = parsed.error;
            }
          } catch {
            const agentMatch = delegateText.match(/"agentId"\s*:\s*"([^"]+)"/);
            const sessionMatch = delegateText.match(/"sessionId"\s*:\s*"([^"]+)"/);
            const errorMatch = delegateText.match(/"error"\s*:\s*"([^"]+)"/);
            agentId = agentMatch?.[1];
            childSessionId = sessionMatch?.[1];
            if (errorMatch) delegationError = errorMatch[1];
          }
        } catch (delegateErr) {
          delegationError = delegateErr instanceof Error ? delegateErr.message : String(delegateErr);
          console.warn("[CollabEditor] delegate_task_to_agent failed:", delegateErr);
        }
      }

      // Determine initial status: if delegation returned an error, mark as error
      const initialStatus = delegationError ? "error" : "running";
      const initialMessages: CrafterMessage[] = delegationError
        ? [{
            id: crypto.randomUUID(),
            role: "info",
            content: `Delegation failed: ${delegationError}`,
            timestamp: new Date(),
          }]
        : [];

      const crafterAgent: CrafterAgent = {
        id: agentId ?? `crafter-collab-${noteId}`,
        sessionId: childSessionId ?? "",
        taskId: noteId,
        taskTitle: note.title,
        status: initialStatus,
        messages: initialMessages,
      };

      // If delegation failed, also mark the task note as FAILED
      if (delegationError) {
        await notesHook.updateNote(noteId, {
          metadata: { ...note.metadata, taskStatus: "FAILED" },
        });
      }

      setCrafterAgents((prev) => [...prev, crafterAgent]);
      if (!activeCrafterId) setActiveCrafterId(crafterAgent.id);

      return crafterAgent;
    } catch (err) {
      console.error("[CollabEditor] Note task execution failed:", err);
      await notesHook.updateNote(noteId, {
        metadata: { ...note.metadata, taskStatus: "PENDING" },
      });
      return null;
    }
  }, [notesHook, workspaceId, sessionId, callMcpTool, activeCrafterId, concurrency]);

  /**
   * Execute all pending collaborative task notes with configurable concurrency.
   */
  const handleExecuteAllNoteTasks = useCallback(async (requestedConcurrency: number) => {
    const pendingNotes = notesHook.notes.filter(
      (n) => n.metadata.type === "task" && (!n.metadata.taskStatus || n.metadata.taskStatus === "PENDING")
    );
    if (pendingNotes.length === 0) return;

    const effectiveConcurrency = Math.min(requestedConcurrency, pendingNotes.length);

    if (effectiveConcurrency <= 1) {
      for (const note of pendingNotes) {
        const agent = await handleExecuteNoteTask(note.id);
        if (agent) setActiveCrafterId(agent.id);
      }
    } else {
      const queue = [...pendingNotes];
      while (queue.length > 0) {
        const batch = queue.splice(0, effectiveConcurrency);
        const results = await Promise.allSettled(batch.map((n) => handleExecuteNoteTask(n.id)));
        for (const result of results) {
          if (result.status === "fulfilled" && result.value) {
            setActiveCrafterId(result.value.id);
            break;
          }
        }
      }
    }
  }, [notesHook, handleExecuteNoteTask]);

  // Notes are now pre-filtered by useNotes(workspaceId, sessionId)
  // - Task notes: only those with matching sessionId
  // - Spec/general notes: workspace-wide (no sessionId) or matching sessionId
  const sessionNotes = notesHook.notes;
  const hasCollabNotes = sessionNotes.some((n) => n.metadata.type === "task" || n.metadata.type === "spec");
  const showTaskPanel = true;

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
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0f1117]">
        <div className="text-gray-400 dark:text-gray-500">Loading...</div>
      </div>
    );
  }

  // For non-default workspaces, require workspace to exist
  if (!workspace && !isDefaultWorkspace) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0f1117]">
        <div className="text-gray-400 dark:text-gray-500">Loading...</div>
      </div>
    );
  }

  // Create a fallback workspace object for "default"
  const effectiveWorkspace = workspace ?? {
    id: "default",
    title: "Default Workspace",
    status: "active" as const,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-[#0f1117]">
      {/* ─── Top Bar ──────────────────────────────────────────────── */}
      <header className="h-[52px] shrink-0 bg-white dark:bg-[#161922] border-b border-gray-200 dark:border-gray-800 flex items-center px-3 md:px-4 gap-2 md:gap-4 z-10">
        {/* Mobile hamburger */}
        <button
          onClick={() => setShowMobileSidebar(!showMobileSidebar)}
          className="md:hidden w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {showMobileSidebar ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>

        {/* Logo - links back to workspace */}
        <a href={`/workspace/${workspaceId}`} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <img
            src="/logo.svg"
            alt="Routa"
            width={28}
            height={28}
            className="rounded-lg"
          />
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 hidden sm:inline">
            Routa
          </span>
        </a>

        {/* Workspace context */}
        <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
        <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:inline truncate max-w-[120px]">
          {effectiveWorkspace.title}
        </span>

        {/* Agent selector */}
        <div className="relative">
          <select
            value={selectedSpecialistId ? `specialist:${selectedSpecialistId}` : selectedAgent}
            onChange={(e) => handleAgentChange(e.target.value)}
            className="appearance-none pl-2.5 pr-6 py-0.5 text-xs font-medium rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] text-gray-900 dark:text-gray-100 cursor-pointer focus:ring-1 focus:ring-blue-500"
          >
            {/* Built-in roles */}
            {BUILTIN_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
            {/* Custom specialists from DB */}
            {specialists.length > 0 && (
              <optgroup label="Custom Specialists">
                {specialists.map((s) => (
                  <option key={s.id} value={`specialist:${s.id}`}>
                    {s.name}{s.model ? ` (${s.model})` : ""}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <svg className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Protocol badges (hidden on small screens) */}
        <div className="hidden lg:flex items-center gap-2">
          <ProtocolBadge name="MCP" endpoint="/api/mcp" />
          <ProtocolBadge name="ACP" endpoint="/api/acp" />
        </div>

        {/* Tool Mode Toggle */}
        <label className="hidden md:flex items-center gap-1.5 cursor-pointer select-none" title={`Tool Mode: ${toolMode === "essential" ? "Essential (7 tools)" : "Full (34 tools)"}`}>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">Full</span>
          <div className="relative">
            <input
              type="checkbox"
              checked={toolMode === "essential"}
              onChange={(e) => handleToolModeToggle(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-7 h-3.5 bg-gray-300 dark:bg-gray-600 rounded-full peer peer-checked:bg-purple-500 transition-colors" />
            <div className="absolute left-0.5 top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform peer-checked:translate-x-3.5" />
          </div>
          <span className="text-[10px] text-purple-600 dark:text-purple-400 font-medium">Essential</span>
        </label>

        {/* MCP Tools link */}
        <a
          href="/mcp-tools"
          className="hidden md:inline-flex px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-900/20 text-[11px] font-medium text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
        >
          MCP Tools
        </a>

        {/* Traces link */}
        <a
          href="/traces"
          className="hidden md:inline-flex px-2.5 py-1 rounded-md bg-purple-50 dark:bg-purple-900/20 text-[11px] font-medium text-purple-600 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
        >
          Traces
        </a>
      </header>

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
        <aside
          className={`shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#13151d] flex flex-col relative transition-[width] duration-200
            ${showMobileSidebar ? "fixed inset-y-[52px] left-0 z-40 shadow-2xl overflow-y-auto" : "hidden md:flex overflow-hidden"}
          `}
          style={{ width: isLeftSidebarCollapsed ? "44px" : `${leftSidebarWidth}px` }}
        >
          {isLeftSidebarCollapsed ? (
            /* ─── Collapsed sidebar: icon-only strip ─────────────── */
            <div className="flex flex-col items-center py-2 gap-2 h-full">
              {/* Expand button */}
              <button
                onClick={() => setIsLeftSidebarCollapsed(false)}
                className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                title="Expand sidebar"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </button>

              {/* New session button */}
              <button
                onClick={() => handleCreateSession("")}
                disabled={acp.providers.length === 0 || !acp.selectedProvider}
                className="p-1.5 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="New Session"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>

              <div className="flex-1" />

              {/* Settings button */}
              <button
                onClick={() => setShowSettingsPanel(true)}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title="Settings"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          ) : (
            /* ─── Expanded sidebar ────────────────────────────────── */
            <>
          {/* Workspace section */}
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <svg className="w-3.5 h-3.5 text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                {effectiveWorkspace.title}
              </span>
              {codebases.length > 0 && repoSelection && (
                <>
                  <span className="text-gray-300 dark:text-gray-600">/</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {repoSelection.name ?? repoSelection.path.split("/").pop()}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              <WorkspaceSwitcher
                workspaces={workspacesHook.workspaces}
                activeWorkspaceId={workspaceId}
                onSelect={handleWorkspaceSelect}
                onCreate={handleWorkspaceCreate}
                loading={workspacesHook.loading}
                compact
              />
              {/* Collapse button */}
              <button
                onClick={() => setIsLeftSidebarCollapsed(true)}
                className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                title="Collapse sidebar"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Sessions header + New Session */}
          <div className="px-3 py-2 flex items-center justify-between border-b border-gray-100 dark:border-gray-800">
            <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Sessions</span>
            <button
              onClick={() => handleCreateSession("")}
              disabled={acp.providers.length === 0 || !acp.selectedProvider}
              className="px-2 py-0.5 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + New
            </button>
          </div>

          {/* Sessions - scrollable with max height */}
          <div className="flex-1 min-h-0 max-h-[50%] overflow-y-auto">
            <SessionPanel
              selectedSessionId={sessionId}
              onSelect={handleSelectSession}
              refreshKey={refreshKey}
              workspaceId={workspaceId}
              onSessionDeleted={(deletedId) => {
                if (sessionId === deletedId) {
                  router.push(`/workspace/${workspaceId}`);
                }
              }}
            />
          </div>

          {/* Divider */}
          <div className="mx-3 my-1 border-t border-gray-100 dark:border-gray-800 shrink-0" />

          {/* Skills - scrollable, takes remaining space */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <SkillPanel
              skillsHook={skillsHook}
            />
          </div>

          {/* Bottom actions */}
          <div className="p-2 border-t border-gray-100 dark:border-gray-800 space-y-1">
            <button
              ref={installAgentsButtonRef}
              onClick={() => setShowAgentInstallPopup(true)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Install Agents
            </button>
            <button
              type="button"
              onClick={() => setShowSettingsPanel(true)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>
          </div>

            </>
          )}

          {/* Left sidebar resize handle */}
          <div
            className="left-resize-handle hidden md:block"
            onMouseDown={handleLeftResizeStart}
          >
            <div className="resize-indicator" />
          </div>
        </aside>

        {/* ─── Chat Area ──────────────────────────────────────────── */}
        <main className="flex-1 min-w-0">
          <ChatPanel
            acp={acp}
            activeSessionId={sessionId}
            onEnsureSession={ensureSessionForChat}
            onSelectSession={handleSelectSession}
            skills={skillsHook.skills}
            repoSkills={skillsHook.repoSkills}
            onLoadSkill={handleLoadSkill}
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
          />
        </main>

        {/* ─── Right Panel: Routa Sub-Tasks (Resizable) ───────────── */}
        {showTaskPanel && (
          <aside
            className="shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-[#13151d] flex flex-col overflow-hidden relative"
            style={{ width: `${sidebarWidth}px` }}
          >
            {/* Resize handle */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-20 hover:bg-indigo-500/30 active:bg-indigo-500/50 transition-colors group"
              onMouseDown={handleResizeStart}
            >
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-gray-300 dark:bg-gray-600 group-hover:bg-indigo-400 group-active:bg-indigo-500 transition-colors" />
            </div>

            {/* When collaborative notes exist, show Collab Edit directly; otherwise show TaskPanel */}
            {hasCollabNotes ? (
              <CollaborativeTaskEditor
                notes={sessionNotes}
                connected={notesHook.connected}
                onUpdateNote={notesHook.updateNote}
                onDeleteNote={notesHook.deleteNote}
                workspaceId={workspaceId}
                crafterAgents={crafterAgents}
                activeCrafterId={activeCrafterId}
                onSelectCrafter={handleSelectCrafter}
                onExecuteTask={handleExecuteNoteTask}
                onExecuteAll={handleExecuteAllNoteTasks}
                concurrency={concurrency}
                onConcurrencyChange={handleConcurrencyChange}
              />
            ) : (
              <TaskPanel
                tasks={routaTasks}
                onConfirmAll={handleConfirmAllTasks}
                onExecuteAll={handleExecuteAllTasks}
                onConfirmTask={handleConfirmTask}
                onEditTask={handleEditTask}
                onExecuteTask={handleExecuteTask}
                crafterAgents={crafterAgents}
                activeCrafterId={activeCrafterId}
                onSelectCrafter={handleSelectCrafter}
                concurrency={concurrency}
                onConcurrencyChange={handleConcurrencyChange}
                onAbortCrafter={handleAbortCrafter}
                onMarkDoneCrafter={handleMarkDoneCrafter}
              />
            )}
          </aside>
        )}
      </div>

      {/* ─── Resize overlay (prevents iframe/content interference) ─── */}
      {(isResizing || isLeftResizing) && (
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
            className="relative w-full max-w-5xl h-[80vh] bg-white dark:bg-[#161922] border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-11 px-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div id="agent-install-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Install Agents
                </div>
                <a
                  href="/settings/agents"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  Open in new tab
                </a>
              </div>
              <button
                ref={agentInstallCloseRef}
                type="button"
                onClick={() => setShowAgentInstallPopup(false)}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                title="Close (Esc)"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
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
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium shadow-lg animate-fade-in">
          ROUTA mode: Coordinator will plan, delegate to CRAFTER agents, and verify with GATE.
        </div>
      )}

      {/* ─── Settings Panel ──────────────────────────────────────── */}
      <SettingsPanel
        open={showSettingsPanel}
        onClose={() => setShowSettingsPanel(false)}
        providers={acp.providers}
      />

      {/* ─── Specialist Manager ──────────────────────────────────── */}
      <SpecialistManager
        open={showSpecialistManager}
        onClose={() => setShowSpecialistManager(false)}
      />
    </div>
  );
}
