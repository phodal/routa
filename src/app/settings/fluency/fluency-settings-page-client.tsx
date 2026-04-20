"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { FitnessAnalysisPanel } from "@/client/components/fitness-analysis-panel";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";
import { loadRepoSelection, saveRepoSelection } from "@/client/utils/repo-selection-storage";
import { useTranslation } from "@/i18n";

type FluencySettingsPageClientProps = {
  defaultRepoPath?: string;
};

export function FluencySettingsPageClient({ defaultRepoPath }: FluencySettingsPageClientProps) {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const workspacesHook = useWorkspaces();
  const requestedWorkspaceId = searchParams.get("workspaceId") ?? "";
  const requestedCodebaseId = searchParams.get("codebaseId") ?? "";
  const requestedRepoPath = searchParams.get("repoPath") ?? "";
  const initialRequestedRepoPath = requestedRepoPath || (requestedCodebaseId ? "" : (defaultRepoPath ?? ""));

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(requestedWorkspaceId);
  const workspaceId = selectedWorkspaceId || requestedWorkspaceId || workspacesHook.workspaces[0]?.id || "";
  const { codebases } = useCodebases(workspaceId);
  const [selectedCodebaseId, setSelectedCodebaseId] = useState(requestedCodebaseId);
  const [initialRepoPath, setInitialRepoPath] = useState(initialRequestedRepoPath);
  const [selectedRepoOverrideState, setSelectedRepoOverrideState] = useState<{
    workspaceId: string;
    selection: RepoSelection | null;
  }>({
    workspaceId: "",
    selection: null,
  });
  const persistedRepoSelection = useMemo(
    () => (requestedRepoPath || requestedCodebaseId ? null : loadRepoSelection("fluency", workspaceId)),
    [requestedCodebaseId, requestedRepoPath, workspaceId],
  );
  const selectedRepoOverride = selectedRepoOverrideState.workspaceId === workspaceId
    ? selectedRepoOverrideState.selection
    : null;
  const effectiveRepoOverride = selectedRepoOverride ?? persistedRepoSelection;

  const activeWorkspaceTitle = useMemo(() => {
    return workspacesHook.workspaces.find((workspace) => workspace.id === workspaceId)?.title
      ?? workspacesHook.workspaces[0]?.title
      ?? undefined;
  }, [workspaceId, workspacesHook.workspaces]);

  const activeCodebase = useMemo(() => {
    const effectiveCodebaseId = codebases.some((codebase) => codebase.id === selectedCodebaseId)
      ? selectedCodebaseId
      : (codebases.find((codebase) => codebase.isDefault)?.id ?? codebases[0]?.id ?? "");
    return codebases.find((codebase) => codebase.id === effectiveCodebaseId) ?? null;
  }, [codebases, selectedCodebaseId]);

  const matchedSelectedCodebase = useMemo(() => {
    const selectedPath = effectiveRepoOverride?.path ?? initialRepoPath;
    if (!selectedPath) {
      return activeCodebase;
    }

    return codebases.find((codebase) => (
      codebase.repoPath === selectedPath
      && (effectiveRepoOverride?.branch ? (codebase.branch ?? "") === effectiveRepoOverride.branch : true)
    )) ?? codebases.find((codebase) => codebase.repoPath === selectedPath)
      ?? null;
  }, [activeCodebase, codebases, effectiveRepoOverride, initialRepoPath]);

  const activeRepoSelection = useMemo(() => {
    if (effectiveRepoOverride) {
      return effectiveRepoOverride;
    }
    if (initialRepoPath) {
      const matchedCodebase = codebases.find((codebase) => codebase.repoPath === initialRepoPath);
      return {
        name: matchedCodebase?.label ?? initialRepoPath.split("/").pop() ?? initialRepoPath,
        path: initialRepoPath,
        branch: matchedCodebase?.branch ?? "",
      } satisfies RepoSelection;
    }
    if (!activeCodebase) {
      return null;
    }

    return {
      name: activeCodebase.label ?? activeCodebase.repoPath.split("/").pop() ?? activeCodebase.repoPath,
      path: activeCodebase.repoPath,
      branch: activeCodebase.branch ?? "",
    } satisfies RepoSelection;
  }, [activeCodebase, codebases, effectiveRepoOverride, initialRepoPath]);

  const activeRepoCodebaseId = matchedSelectedCodebase?.id;
  const activeWorkspaceStatus = activeWorkspaceTitle || workspaceId || "-";
  const activeRepoBranch = activeRepoSelection?.branch?.trim() ?? "";
  const activeRepoStatus = activeRepoSelection?.path
    ? (activeRepoBranch ? `${activeRepoSelection.name} (${activeRepoBranch})` : activeRepoSelection.name)
    : t.settings.repository;

  useEffect(() => {
    if (requestedRepoPath || requestedCodebaseId) {
      return;
    }

    saveRepoSelection("fluency", workspaceId, activeRepoSelection);
  }, [activeRepoSelection, requestedCodebaseId, requestedRepoPath, workspaceId]);

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={activeWorkspaceTitle}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId || null}
          activeWorkspaceTitle={activeWorkspaceTitle}
          onSelect={(nextWorkspaceId) => {
            setSelectedWorkspaceId(nextWorkspaceId);
            setSelectedCodebaseId("");
            setInitialRepoPath("");
            setSelectedRepoOverrideState({ workspaceId: nextWorkspaceId, selection: null });
          }}
          onCreate={async (title) => {
            const workspace = await workspacesHook.createWorkspace(title);
            if (workspace) {
              setSelectedWorkspaceId(workspace.id);
            }
          }}
          loading={workspacesHook.loading}
          compact
          desktop
        />
      )}
      titleBarRight={(
        <div className="flex flex-wrap items-center gap-2">
          <span className="desktop-badge">{t.settings.diagnosticsBeta}</span>
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
              {t.settings.repository}
            </span>
            <RepoPicker
              value={activeRepoSelection}
              onChange={(selection) => {
                setInitialRepoPath("");
                setSelectedRepoOverrideState({ workspaceId, selection });
                if (!selection) {
                  setSelectedCodebaseId("");
                  return;
                }

                const matchedCodebase = codebases.find((codebase) => (
                  codebase.repoPath === selection.path
                  && (selection.branch ? (codebase.branch ?? "") === selection.branch : true)
                )) ?? codebases.find((codebase) => codebase.repoPath === selection.path)
                  ?? codebases.find((codebase) => (
                    (codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath) === selection.name
                  ));

                setSelectedCodebaseId(matchedCodebase?.id ?? "");
              }}
              pathDisplay="hidden"
              additionalRepos={codebases.map((codebase) => ({
                name: codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath,
                path: codebase.repoPath,
                branch: codebase.branch ?? "",
              }))}
            />
          </div>
        </div>
      )}
    >
      <div className="flex h-full min-h-0 overflow-hidden bg-desktop-bg-primary text-desktop-text-primary" data-testid="fluency-console-root">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-desktop-border bg-desktop-bg-secondary/50 px-4 py-2 text-[11px] text-desktop-text-secondary">
            <span>{t.workspace.workspaceLabel} </span>
            <span className="text-desktop-text-primary">{activeWorkspaceStatus}</span>
            <span className="mx-2 text-desktop-text-tertiary">|</span>
            <span>{t.settings.repository}: </span>
            <span className="text-desktop-text-primary">{activeRepoSelection?.name ?? "-"}</span>
            <span className="mx-2 text-desktop-text-tertiary">|</span>
            <span className="truncate">{activeRepoSelection?.path ?? "-"}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-desktop-bg-primary desktop-scrollbar">
            <FitnessAnalysisPanel
              workspaceId={workspaceId}
              codebaseId={activeRepoCodebaseId}
              repoPath={activeRepoSelection?.path}
            />
          </div>

          <div className="flex h-6 shrink-0 items-center justify-between bg-desktop-accent px-3 text-[10px] text-desktop-accent-text">
            <div className="flex items-center gap-3">
              <span>{activeWorkspaceStatus}</span>
            </div>
            <div className="flex items-center gap-3">
              <span>{activeRepoStatus}</span>
            </div>
          </div>
        </div>
      </div>
    </DesktopAppShell>
  );
}
