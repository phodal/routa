"use client";

/**
 * HomeInput - Task-first input component
 *
 * An operational input that prioritizes the user's immediate intent:
 * - TiptapInput for rich text, skills (/), file mentions (@)
 * - Inline control bar: Agent dropdown, Workspace pill, Repo/Branch pill
 * - Agent selection is lightweight — a small dropdown, not separate cards
 * - Context (workspace/repo) is always visible but non-intrusive
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { TiptapInput, type InputContext } from "./tiptap-input";
import { useAcp } from "../hooks/use-acp";
import { useSkills } from "../hooks/use-skills";
import { useWorkspaces, useCodebases } from "../hooks/use-workspaces";
import type { RepoSelection } from "./repo-picker";
import { storePendingPrompt } from "../utils/pending-prompt";
import { loadProviderConnectionConfig, getModelDefinitionByAlias, DockerConfigModal } from "./settings-panel";
import { desktopAwareFetch } from "../utils/diagnostics";
import { collectAccessibleRepoPaths } from "@/client/utils/repo-validation";
import { useTranslation } from "@/i18n";
import { Check, ChevronDown, Folder, CircleUser, Sun, Zap } from "lucide-react";


type AgentRole = "ROUTA" | "CRAFTER" | "DEVELOPER";
type BuiltInAgentRole = Extract<AgentRole, "ROUTA" | "CRAFTER">;
type FooterMetaMode = "default" | "repo-only";

export type HomeInputDispatchMode = "pending-prompt" | "direct-prompt";

interface HomeInputSessionConfig {
  role?: string;
  mcpProfile?: string;
  systemPrompt?: string | ((text: string) => string);
}

export interface LaunchModeConfig {
  id: string;
  label: string;
  description: string;
  placeholder?: string;
  defaultAgentRole?: BuiltInAgentRole;
  allowRoleSwitch?: boolean;
  allowCustomSpecialist?: boolean;
  lockedSpecialistId?: string;
  requireRepoSelection?: boolean;
  dispatchMode?: HomeInputDispatchMode;
  buildSessionUrl?: (workspaceId: string | null, sessionId: string) => string | null;
  sessionConfig?: HomeInputSessionConfig;
}

export function resolveHomeInputSpecialistId(options: {
  lockedSpecialistId?: string;
  allowCustomSpecialist: boolean;
  selectedSpecialistId: string | null;
}): string | null {
  return options.lockedSpecialistId ?? (
    options.allowCustomSpecialist ? options.selectedSpecialistId : null
  );
}

interface SpecialistSummary {
  id: string;
  name: string;
  description?: string;
  role?: string;
  defaultProvider?: string;
  model?: string;
}

interface HomeInputProps {
  /** Initial workspace ID (optional) */
  workspaceId?: string;
  /** Visual style variant */
  variant?: "default" | "hero";
  /** Footer metadata density below the input */
  footerMetaMode?: FooterMetaMode;
  /** Called when workspace selection changes */
  onWorkspaceChange?: (workspaceId: string | null) => void;
  onSessionCreated?: (
    sessionId: string,
    promptText: string,
    sessionContext?: { cwd?: string; branch?: string; repoName?: string },
  ) => void;
  /** Declarative launch modes used by the launcher surface */
  launchModes?: LaunchModeConfig[];
  /** Preselect a launcher mode, useful when entering from another surface */
  initialLaunchModeId?: string | null;
  /** Observe launcher mode changes */
  onLaunchModeChange?: (launchModeId: string) => void;
  /** Lock the input to a specific specialist and reuse its config */
  lockedSpecialistId?: string;
  /** Override the destination route after session creation */
  buildSessionUrl?: (workspaceId: string | null, sessionId: string) => string | null;
  /** Default built-in role to preselect on load */
  defaultAgentRole?: BuiltInAgentRole;
  /** When true, block session creation until a repository is explicitly selected */
  requireRepoSelection?: boolean;
  /** Externally triggered skill (e.g. from grid card click) */
  externalPendingSkill?: string | null;
  /** Called after the external skill has been consumed */
  onExternalSkillConsumed?: () => void;
  /** Skills to display as subtle suggestion pills below the input */
  displaySkills?: Array<{ name: string; description: string }>;
  /** Called when a skill pill is clicked */
  onSkillPillClick?: (name: string) => void;
  /** Legacy fallback for single-mode launchers. Prefer launchModes for new call sites. */
  extraSessionParams?: HomeInputSessionConfig;
}

export function HomeInput({
  workspaceId: propWorkspaceId,
  variant = "default",
  footerMetaMode = "default",
  onWorkspaceChange,
  onSessionCreated,
  launchModes,
  initialLaunchModeId,
  onLaunchModeChange,
  lockedSpecialistId,
  buildSessionUrl,
  defaultAgentRole = "ROUTA",
  requireRepoSelection = false,
  externalPendingSkill,
  onExternalSkillConsumed,
  displaySkills,
  onSkillPillClick: _onSkillPillClick,
  extraSessionParams,
}: HomeInputProps) {
  const router = useRouter();
  const acp = useAcp();
  const skillsHook = useSkills();
  const workspacesHook = useWorkspaces();
  const { t } = useTranslation();

  const normalizedLaunchModes = React.useMemo<LaunchModeConfig[]>(() => {
    if (launchModes && launchModes.length > 0) {
      return launchModes.map((mode) => ({
        defaultAgentRole: mode.defaultAgentRole ?? "ROUTA",
        allowRoleSwitch: mode.allowRoleSwitch ?? true,
        allowCustomSpecialist: mode.allowCustomSpecialist ?? true,
        requireRepoSelection: mode.requireRepoSelection ?? false,
        dispatchMode: mode.dispatchMode ?? "pending-prompt",
        ...mode,
      }));
    }

    return [{
      id: "default",
      label: t.common.session,
      description: t.home.directDesc,
      defaultAgentRole,
      allowRoleSwitch: true,
      allowCustomSpecialist: true,
      requireRepoSelection,
      dispatchMode: extraSessionParams ? "direct-prompt" : "pending-prompt",
      buildSessionUrl,
      lockedSpecialistId,
      sessionConfig: extraSessionParams,
    }];
  }, [buildSessionUrl, defaultAgentRole, extraSessionParams, launchModes, lockedSpecialistId, requireRepoSelection, t.common.session, t.home.directDesc]);

  const [activeLaunchModeId, setActiveLaunchModeId] = useState<string>(() => {
    const requestedModeId = initialLaunchModeId ?? normalizedLaunchModes[0]?.id ?? "default";
    return normalizedLaunchModes.some((mode) => mode.id === requestedModeId)
      ? requestedModeId
      : (normalizedLaunchModes[0]?.id ?? "default");
  });

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(propWorkspaceId ?? null);
  const { codebases } = useCodebases(selectedWorkspaceId ?? "");
  const [accessibleCodebasePaths, setAccessibleCodebasePaths] = useState<Set<string>>(new Set());

  const [selectedRole, setSelectedRole] = useState<AgentRole>(defaultAgentRole);
  const [repoSelection, setRepoSelection] = useState<RepoSelection | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const repoSelectionRef = useRef<RepoSelection | null>(null);
  const [pendingSkill, setPendingSkill] = useState<string | null>(null);

  // Specialists
  const [specialists, setSpecialists] = useState<SpecialistSummary[]>([]);
  const [selectedSpecialistId, setSelectedSpecialistId] = useState<string | null>(null);
  const [showSpecialistDropdown, setShowSpecialistDropdown] = useState(false);
  const specialistDropdownRef = useRef<HTMLDivElement>(null);

  // Dropdown states
  const [showWorkspaceDropdown, setShowWorkspaceDropdown] = useState(false);
  const wsDropdownRef = useRef<HTMLDivElement>(null);

  const activeLaunchMode = normalizedLaunchModes.find((mode) => mode.id === activeLaunchModeId) ?? normalizedLaunchModes[0];
  const effectiveLockedSpecialistId = activeLaunchMode?.lockedSpecialistId ?? lockedSpecialistId;
  const allowRoleSwitch = activeLaunchMode?.allowRoleSwitch ?? true;
  const allowCustomSpecialist = activeLaunchMode?.allowCustomSpecialist ?? true;
  const effectiveRequireRepoSelection = activeLaunchMode?.requireRepoSelection ?? requireRepoSelection;
  const effectiveDispatchMode = activeLaunchMode?.dispatchMode ?? (extraSessionParams ? "direct-prompt" : "pending-prompt");
  const effectiveBuildSessionUrl = activeLaunchMode?.buildSessionUrl ?? buildSessionUrl;
  const activeSessionConfig = activeLaunchMode?.sessionConfig ?? extraSessionParams;
  const effectiveFooterMetaMode = footerMetaMode;
  const effectivePlaceholder = activeLaunchMode?.placeholder ?? t.home.inputPlaceholder;
  const effectiveDefaultAgentRole = activeLaunchMode?.defaultAgentRole ?? defaultAgentRole;
  const effectiveSelectedSpecialistId = resolveHomeInputSpecialistId({
    lockedSpecialistId: effectiveLockedSpecialistId,
    allowCustomSpecialist,
    selectedSpecialistId,
  });

  // Sync with external workspaceId prop
  useEffect(() => {
    if (propWorkspaceId && propWorkspaceId !== selectedWorkspaceId) {
      setSelectedWorkspaceId(propWorkspaceId);
    }
  }, [propWorkspaceId, selectedWorkspaceId]);

  useEffect(() => {
    setSelectedRole(effectiveDefaultAgentRole);
  }, [effectiveDefaultAgentRole]);

  useEffect(() => {
    if (!allowCustomSpecialist && !effectiveLockedSpecialistId && selectedSpecialistId) {
      setSelectedSpecialistId(null);
    }
  }, [allowCustomSpecialist, effectiveLockedSpecialistId, selectedSpecialistId]);

  useEffect(() => {
    if (!normalizedLaunchModes.some((mode) => mode.id === activeLaunchModeId)) {
      setActiveLaunchModeId(normalizedLaunchModes[0]?.id ?? "default");
    }
  }, [activeLaunchModeId, normalizedLaunchModes]);

  useEffect(() => {
    if (!initialLaunchModeId) return;
    if (!normalizedLaunchModes.some((mode) => mode.id === initialLaunchModeId)) return;
    if (initialLaunchModeId === activeLaunchModeId) return;
    setActiveLaunchModeId(initialLaunchModeId);
  }, [activeLaunchModeId, initialLaunchModeId, normalizedLaunchModes]);

  useEffect(() => {
    if (!activeLaunchMode) return;
    onLaunchModeChange?.(activeLaunchMode.id);
  }, [activeLaunchMode, onLaunchModeChange]);

  // Auto-select first workspace if none selected
  useEffect(() => {
    if (!selectedWorkspaceId && workspacesHook.workspaces.length > 0) {
      const first = workspacesHook.workspaces[0].id;
      setSelectedWorkspaceId(first);
      onWorkspaceChange?.(first);
    }
  }, [workspacesHook.workspaces, selectedWorkspaceId, onWorkspaceChange]);

  const handleWorkspaceChange = useCallback(
    (wsId: string | null) => {
      setSelectedWorkspaceId(wsId);
      onWorkspaceChange?.(wsId);
      setShowWorkspaceDropdown(false);
    },
    [onWorkspaceChange],
  );

  // Load specialists
  useEffect(() => {
    desktopAwareFetch("/api/specialists")
      .then((r) => r.ok ? r.json() : { specialists: [] })
      .then((data) => setSpecialists(data.specialists ?? []))
      .catch(() => {});
  }, []);

  // Close specialist dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (specialistDropdownRef.current && !specialistDropdownRef.current.contains(e.target as Node)) {
        setShowSpecialistDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Auto-connect ACP
  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acp.connected, acp.loading]);

  // Load repo skills when selection changes
  useEffect(() => {
    if (repoSelection?.path) {
      skillsHook.loadRepoSkills(repoSelection.path);
    } else {
      skillsHook.clearRepoSkills();
    }
    // Only depend on the path, not the entire skillsHook object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoSelection?.path]);

  useEffect(() => {
    repoSelectionRef.current = repoSelection;
  }, [repoSelection]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const nextPaths = await collectAccessibleRepoPaths(codebases.map((codebase) => codebase.repoPath));
      if (!cancelled) {
        setAccessibleCodebasePaths(nextPaths);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [codebases]);

  // Auto-select default codebase
  useEffect(() => {
    const validCodebases = codebases.filter((codebase) => accessibleCodebasePaths.has(codebase.repoPath));
    if (validCodebases.length === 0) {
      if (repoSelectionRef.current && codebases.some((codebase) => codebase.repoPath === repoSelectionRef.current?.path)) {
        repoSelectionRef.current = null;
        setRepoSelection(null);
      }
      return;
    }

    const def = validCodebases.find((c) => c.isDefault) ?? validCodebases[0];
    const nextSelection = {
      path: def.repoPath,
      branch: def.branch ?? "",
      name: def.label ?? def.repoPath.split("/").pop() ?? "",
    };
    repoSelectionRef.current = nextSelection;
    setRepoSelection(nextSelection);
  }, [accessibleCodebasePaths, codebases]);

  const handleRepoSelectionChange = useCallback((selection: RepoSelection | null) => {
    repoSelectionRef.current = selection;
    setRepoSelection(selection);
  }, []);

  // Handle external pending skill from grid
  useEffect(() => {
    if (externalPendingSkill) {
      setPendingSkill(externalPendingSkill);
      onExternalSkillConsumed?.();
    }
  }, [externalPendingSkill, onExternalSkillConsumed]);

  // Click outside to close workspace dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wsDropdownRef.current && !wsDropdownRef.current.contains(e.target as Node)) {
        setShowWorkspaceDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSend = useCallback(
    async (text: string, context: InputContext) => {
      if (!text.trim() || !acp.connected) return;
      if (isSubmittingRef.current) return;
      isSubmittingRef.current = true;
      setIsSubmitting(true);

      try {
        const idempotencyKey = `home-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const wsId = selectedWorkspaceId ?? undefined;
        const effectiveRepoSelection = repoSelectionRef.current;
        const effectiveCwd = context.cwd ?? effectiveRepoSelection?.path;
        if (effectiveRequireRepoSelection && !effectiveCwd) {
          return;
        }
        const effectiveSpecialistId = resolveHomeInputSpecialistId({
          lockedSpecialistId: effectiveLockedSpecialistId,
          allowCustomSpecialist,
          selectedSpecialistId,
        });
        const selectedSpec = effectiveSpecialistId ? specialists.find((s) => s.id === effectiveSpecialistId) : undefined;
        const effectiveProvider = context.provider ?? selectedSpec?.defaultProvider ?? acp.selectedProvider;
        const conn = loadProviderConnectionConfig(effectiveProvider);
        const modelAliasOrName = context.model ?? selectedSpec?.model ?? conn.model;
        const def = modelAliasOrName ? getModelDefinitionByAlias(modelAliasOrName) : undefined;
        // When a custom specialist is selected, use the specialist's role
        const effectiveRole = activeSessionConfig?.role ?? (selectedSpec?.role as typeof selectedRole) ?? selectedRole;
        const resolvedSystemPrompt = typeof activeSessionConfig?.systemPrompt === "function"
          ? activeSessionConfig.systemPrompt(text)
          : activeSessionConfig?.systemPrompt;
        const result = await acp.createSession(
          effectiveCwd,
          effectiveProvider,
          context.mode,
          effectiveRole,
          wsId,
          def ? def.modelName : modelAliasOrName,
          idempotencyKey,
          effectiveSpecialistId ?? undefined,
          undefined,
          def?.baseUrl ?? conn.baseUrl,
          def?.apiKey ?? conn.apiKey,
          effectiveRepoSelection?.branch,
          undefined,
          undefined,
          activeSessionConfig?.mcpProfile as Parameters<typeof acp.createSession>[14],
          resolvedSystemPrompt,
        );

        if (result?.sessionId) {
          const promptText = context.skill ? `/${context.skill} ${text}` : text;
          const pendingPrompt = context.skill
            ? {
                text,
                skillName: context.skill,
                skillRepoPath: effectiveCwd,
              }
            : text;
          const url = effectiveBuildSessionUrl
            ? effectiveBuildSessionUrl(wsId ?? null, result.sessionId)
            : wsId
              ? `/workspace/${wsId}/sessions/${result.sessionId}`
              : `/workspace/${result.sessionId}`;
          if (effectiveDispatchMode === "direct-prompt") {
            void acp.promptSession(result.sessionId, promptText).catch((error) => {
              console.error("[HomeInput] Failed to send direct prompt:", error);
            });
          } else {
            storePendingPrompt(result.sessionId, pendingPrompt);
          }
          onSessionCreated?.(result.sessionId, promptText, {
            cwd: effectiveCwd,
            branch: effectiveRepoSelection?.branch,
            repoName: effectiveRepoSelection?.name,
          });
          if (url) {
            router.push(url);
          }
        }
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [acp, activeSessionConfig, allowCustomSpecialist, effectiveBuildSessionUrl, effectiveDispatchMode, effectiveLockedSpecialistId, effectiveRequireRepoSelection, router, onSessionCreated, selectedRole, selectedSpecialistId, selectedWorkspaceId, specialists],
  );

  const activeWorkspace = workspacesHook.workspaces.find((w) => w.id === selectedWorkspaceId);
  const selectedSpecialist = effectiveSelectedSpecialistId
    ? specialists.find((s) => s.id === effectiveSelectedSpecialistId)
    : undefined;
  const specialistLocked = Boolean(effectiveLockedSpecialistId);
  const isHero = variant === "hero";
  const shellClass = isHero
    ? "relative rounded-[28px] border border-blue-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(239,246,255,0.98))] shadow-[0_34px_100px_-44px_rgba(37,99,235,0.28)] transition-colors group-focus-within:border-blue-400 dark:border-slate-800 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] dark:group-focus-within:border-blue-400/70"
    : "relative rounded-2xl border border-slate-200 bg-white shadow-sm transition-colors group-focus-within:border-amber-400/50 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none dark:group-focus-within:border-amber-500/30";
  const shellGlowClass = isHero
    ? "absolute -inset-3 rounded-[34px] bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.24),transparent_42%),radial-gradient(circle_at_85%_30%,rgba(96,165,250,0.18),transparent_38%)] opacity-0 blur-2xl transition-opacity duration-500 pointer-events-none group-focus-within:opacity-100"
    : "absolute -inset-1 rounded-2xl bg-gradient-to-r from-amber-500/20 via-amber-400/10 to-blue-500/20 opacity-0 blur-xl transition-opacity duration-500 pointer-events-none group-focus-within:opacity-100";
  const bottomBarClass = isHero
    ? "flex flex-wrap items-center gap-1.5 overflow-visible rounded-b-[27px] border-t border-blue-100 bg-blue-50/80 px-3 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/88"
    : "flex flex-wrap items-center gap-1.5 overflow-visible border-t border-slate-100 px-3 py-2 dark:border-slate-800";
  const skillPillClass = isHero
    ? "group shrink-0 flex w-[160px] flex-col gap-0.5 rounded-xl border border-blue-100/95 bg-white/94 px-3 py-2 text-left transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50/70 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-blue-700/40 dark:hover:bg-slate-900"
    : "group shrink-0 flex w-[140px] flex-col gap-0.5 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-left transition-all hover:border-amber-300/60 hover:bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:border-amber-700/40 dark:hover:bg-slate-950";
  const showLaunchModeSelector = normalizedLaunchModes.length > 1;
  const fixedRoleLabel = selectedRole === "ROUTA" ? t.home.multiAgent : t.home.crafter;

  return (
    <div className={`w-full ${isHero ? "max-w-none" : "mx-auto max-w-2xl"}`}>
      {showLaunchModeSelector && (
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          {normalizedLaunchModes.map((mode) => {
            const isActive = mode.id === activeLaunchMode?.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setActiveLaunchModeId(mode.id)}
                className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white shadow-sm dark:border-amber-400 dark:bg-amber-400 dark:text-slate-950"
                    : "border-black/6 bg-white/70 text-slate-700 hover:bg-white dark:border-white/8 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                }`}
              >
                <div className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${isActive ? "text-white/80 dark:text-slate-950/70" : "text-slate-500 dark:text-slate-500"}`}>
                  {mode.label}
                </div>
                <div className={`mt-1 text-[12px] leading-5 ${isActive ? "text-white dark:text-slate-950" : "text-slate-500 dark:text-slate-400"}`}>
                  {mode.description}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Input container with ambient glow on focus */}
      <div className="group relative" id="home-input-container">
        {/* Glow effect */}
        <div className={shellGlowClass} />

        <div className={shellClass}>
          {/* TiptapInput */}
          <TiptapInput
            onSend={handleSend}
            placeholder={effectivePlaceholder}
            disabled={!acp.connected || isSubmitting || (effectiveRequireRepoSelection && !repoSelection?.path)}
            loading={isSubmitting}
            skills={skillsHook.skills}
            repoSkills={skillsHook.repoSkills}
            providers={acp.providers}
            selectedProvider={acp.selectedProvider}
            onProviderChange={acp.setProvider}
            repoSelection={repoSelection}
            onRepoChange={handleRepoSelectionChange}
            additionalRepos={codebases
              .filter((codebase) => accessibleCodebasePaths.has(codebase.repoPath))
              .map((codebase) => ({
              name: codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath,
              path: codebase.repoPath,
              branch: codebase.branch,
            }))}
            repoPathDisplay="hidden"
            agentRole={selectedRole}
            onFetchModels={acp.listProviderModels}
            pendingSkill={pendingSkill}
            onSkillInserted={() => setPendingSkill(null)}
            variant={variant}
          />

          {/* ─── Bottom Control Bar ─────────────────────────────────── */}
          <div className={bottomBarClass}>
            {effectiveSelectedSpecialistId ? (
              /* ── Specialist mode: show specialist pill as primary selector ── */
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                  <CircleUser className="w-3.5 h-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                  <span className="max-w-35 truncate">
                    {selectedSpecialist?.name ?? t.home.customSpecialist}
                  </span>
                  {!specialistLocked && (
                    <button
                      type="button"
                      onClick={() => setSelectedSpecialistId(null)}
                      className="ml-0.5 text-amber-400 transition-colors hover:text-amber-700 dark:hover:text-amber-200"
                      title="Switch to built-in role"
                      aria-label={t.common.clearSpecialist}
                    >
                      ×
                    </button>
                  )}
                </div>
                {!specialistLocked && allowCustomSpecialist && specialists.length > 1 && (
                  <div className="relative" ref={specialistDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowSpecialistDropdown((v) => !v)}
                      className="flex items-center gap-1 rounded-lg border border-transparent px-1.5 py-1 text-xs text-slate-500 transition-all hover:border-slate-200 hover:bg-slate-100 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-800"
                      title="Switch specialist"
                    >
                      <ChevronDown className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                    </button>
                    {showSpecialistDropdown && (
                      <div className="absolute bottom-full left-0 z-50 mb-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
                        <div className="p-1 max-h-48 overflow-y-auto">
                          {specialists.map((s) => (
                            <button key={s.id} onClick={() => { setSelectedSpecialistId(s.id); setShowSpecialistDropdown(false); }}
                              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                                s.id === selectedSpecialistId ? "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-300" : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                              }`}>
                              <div className="font-medium truncate">{s.name}</div>
                              {s.description && <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">{s.description}</div>}
                              {s.defaultProvider && <div className="text-[10px] text-slate-300 dark:text-slate-600 mt-0.5 font-mono">provider:{s.defaultProvider}</div>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : !allowRoleSwitch ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                <Zap className="w-3.5 h-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
                <span>{fixedRoleLabel}</span>
              </div>
            ) : (
              /* ── Built-in role mode: segmented toggle + optional specialist picker ── */
              <>
                <div className="flex items-center gap-0.5 rounded-[18px] border border-blue-100 bg-white/88 p-1 shadow-[0_10px_28px_-22px_rgba(37,99,235,0.42)] dark:border-slate-800 dark:bg-slate-900" role="group" aria-label={t.common.agentMode}>
                  <button type="button" onClick={() => setSelectedRole("ROUTA")}
                    title="Multi-agent orchestration — spawns specialized agents for complex multi-step tasks (Routa)"
                    className={`flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-xs font-medium transition-all ${
                      selectedRole === "ROUTA"
                        ? "bg-blue-600 text-white shadow-[0_14px_26px_-18px_rgba(37,99,235,0.68)] dark:bg-blue-500 dark:text-white"
                        : "text-slate-500 hover:bg-blue-50/70 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-300"
                    }`}>
                    <Sun className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={selectedRole === "ROUTA" ? 2.5 : 2}/>
                    {t.home.multiAgent}
                  </button>
                  <button type="button" onClick={() => setSelectedRole("CRAFTER")}
                    title="Single-agent implementation — best for focused coding tasks (Crafter)"
                    className={`flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-xs font-medium transition-all ${
                      selectedRole === "CRAFTER"
                        ? "bg-amber-500 text-white shadow-[0_14px_26px_-18px_rgba(245,158,11,0.65)] dark:bg-amber-500 dark:text-white"
                        : "text-slate-500 hover:bg-amber-50/70 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-300"
                    }`}>
                    <Zap className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={selectedRole === "CRAFTER" ? 2.5 : 2}/>
                    {t.home.crafter}
                  </button>
                </div>

                {/* Custom Specialist — shown as an additive option when specialists exist */}
                {allowCustomSpecialist && specialists.length > 0 && (
                  <>
                    <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
                    <div className="relative" ref={specialistDropdownRef}>
                      <button type="button" onClick={() => setShowSpecialistDropdown((v) => !v)}
                        className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-500 transition-all hover:border-amber-300 hover:bg-slate-100 hover:text-amber-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-amber-700 dark:hover:bg-slate-800 dark:hover:text-amber-300"
                        title="Use a custom specialist instead">
                        <CircleUser className="w-3.5 h-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                        Custom
                        <ChevronDown className="w-2.5 h-2.5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                      </button>
                      {showSpecialistDropdown && (
                        <div className="absolute bottom-full left-0 z-50 mb-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
                          <div className="px-2 pt-2 pb-1">
                            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{t.settings.specialists}</p>
                          </div>
                          <div className="max-h-48 overflow-y-auto border-t border-slate-100 p-1 dark:border-slate-800">
                            {specialists.map((s) => (
                              <button key={s.id} onClick={() => { setSelectedSpecialistId(s.id); setShowSpecialistDropdown(false); }}
                                className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-700 transition-colors hover:bg-amber-50 hover:text-amber-700 dark:text-slate-300 dark:hover:bg-amber-950/20 dark:hover:text-amber-300">
                                <div className="font-medium truncate">{s.name}</div>
                                {s.description && <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">{s.description}</div>}
                                {s.role && <div className="text-[10px] text-slate-300 dark:text-slate-600 mt-0.5 font-mono">{s.role}</div>}
                                {s.defaultProvider && <div className="text-[10px] text-slate-300 dark:text-slate-600 mt-0.5 font-mono">provider:{s.defaultProvider}</div>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {/* Workspace Pill */}
            {workspacesHook.workspaces.length > 0 && (
              <div className="relative" ref={wsDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowWorkspaceDropdown((v) => !v)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#1c1f2e] border border-transparent hover:border-slate-200 dark:hover:border-[#2a2d3d] transition-all"
                >
                  <Folder className="w-3.5 h-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                  <span className="max-w-30 truncate">
                    {activeWorkspace?.title ?? t.workspace.workspaces}
                  </span>
                  <ChevronDown className="w-2.5 h-2.5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                </button>

                {showWorkspaceDropdown && (
                  <div className="absolute bottom-full left-0 mb-1 w-52 rounded-xl border border-slate-200 dark:border-[#1c1f2e] bg-white dark:bg-[#181b26] shadow-xl z-50 overflow-hidden">
                    <div className="p-1 max-h-48 overflow-y-auto">
                      {workspacesHook.workspaces.map((ws) => (
                        <button
                          key={ws.id}
                          onClick={() => handleWorkspaceChange(ws.id)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 ${
                            ws.id === selectedWorkspaceId
                              ? "bg-amber-50 dark:bg-amber-900/15 text-amber-700 dark:text-amber-400"
                              : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1f2233]"
                          }`}
                        >
                          <Folder className="w-3.5 h-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                          {ws.title}
                          {ws.id === selectedWorkspaceId && (
                            <Check className="w-3.5 h-3.5 ml-auto text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Spacer */}
            <div className="hidden flex-1 sm:block" />

            {/* Keyboard hint */}
            <span className="hidden sm:inline text-[11px] text-slate-400 dark:text-slate-500">
              <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-[#1c1f2e] font-mono text-[10px]">
                ⏎
              </kbd>{" "}
              send
            </span>
          </div>
        </div>
      </div>

      {/* ─── Mode Tips ──────────────────────────────────────────────── */}
      <div className="mt-1.5 min-h-5 px-1">
        {repoSelection?.path && (
          <div className="mb-1 flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
            <span className="font-medium text-slate-500 dark:text-slate-400">
              {t.home.repoPath}
            </span>
            <span className="font-mono truncate" title={repoSelection.path}>
              {repoSelection.path}
            </span>
          </div>
        )}
        {effectiveFooterMetaMode === "default" && activeLaunchMode?.description ? (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
            <span className="flex h-2 w-2 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800">
              <span className="h-1 w-1 rounded-full bg-slate-500" />
            </span>
            <span>{activeLaunchMode.description}</span>
          </div>
        ) : effectiveFooterMetaMode === "default" && effectiveSelectedSpecialistId ? (
          (() => {
            const spec = selectedSpecialist;
            return (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                <span className="flex h-2 w-2 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                  <span className="h-1 w-1 rounded-full bg-amber-500" />
                </span>
                <span className="font-medium text-amber-600 dark:text-amber-400">{spec?.name}</span>
                {spec?.role && <><span className="text-slate-300 dark:text-slate-700">·</span><span className="font-mono text-[9px]">{spec.role}</span></>}
              </div>
            );
          })()
        ) : effectiveFooterMetaMode === "default" && selectedRole === "ROUTA" ? (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
            <span className="w-2 h-2 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <span className="h-1 w-1 rounded-full bg-amber-500" />
            </span>
            <span>{t.home.multiAgentDesc}</span>
          </div>
        ) : effectiveFooterMetaMode === "default" ? (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
            <span className="flex h-2 w-2 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800">
              <span className="h-1 w-1 rounded-full bg-slate-500" />
            </span>
            <span>{t.home.directDesc}</span>
          </div>
        ) : null}
      </div>

      {/* ─── Skills — horizontal scroll row ─────────────────────── */}
      {displaySkills && displaySkills.length > 0 && (
        <div className="mt-2 -mx-0.5">
          <div className="flex gap-1.5 overflow-x-auto pb-0 scrollbar-none" style={{ scrollbarWidth: "none" }}>
            {displaySkills.map((skill) => (
              <button
                key={skill.name}
                type="button"
                onClick={() => setPendingSkill(skill.name)}
                className={skillPillClass}
              >
                <span className={`text-[11px] font-mono font-medium transition-colors truncate ${
                  isHero
                    ? "text-slate-500 group-hover:text-sky-600 dark:text-slate-400 dark:group-hover:text-sky-300"
                    : "text-slate-500 group-hover:text-amber-600 dark:text-slate-400 dark:group-hover:text-amber-400"
                }`}>
                  /{skill.name}
                </span>
                {skill.description && (
                  <span className={`text-[10px] leading-snug line-clamp-1 ${
                    isHero ? "text-slate-400 dark:text-slate-500" : "text-slate-400 dark:text-slate-600"
                  }`}>
                    {skill.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── Docker Config Modal ──────────────────────────────────── */}
      <DockerConfigModal
        open={!!acp.dockerConfigError}
        errorMessage={acp.dockerConfigError ?? ""}
        onClose={() => acp.clearDockerConfigError()}
        onSaved={() => {
          acp.clearDockerConfigError();
          // Input text is still in TiptapInput — user can re-submit
        }}
      />
    </div>
  );
}
