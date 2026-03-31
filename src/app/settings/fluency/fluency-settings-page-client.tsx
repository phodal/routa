"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { FitnessAnalysisPanel } from "@/client/components/fitness-analysis-panel";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";
import { loadRepoSelection, saveRepoSelection } from "@/client/utils/repo-selection-storage";

type FluencySettingsPageClientProps = {
  defaultRepoPath?: string;
};

export function FluencySettingsPageClient({ defaultRepoPath }: FluencySettingsPageClientProps) {
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

  useEffect(() => {
    if (requestedRepoPath || requestedCodebaseId) {
      return;
    }

    saveRepoSelection("fluency", workspaceId, activeRepoSelection);
  }, [activeRepoSelection, requestedCodebaseId, requestedRepoPath, workspaceId]);

  return (
    <SettingsRouteShell
      title="Fluency"
      description="Analyze repository fluency, blockers, and next actions across the default profiles."
      badgeLabel="Diagnostics beta"
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
    >
      <div className="space-y-4">
        <SettingsPageHeader
          title="Fluency"
          description=""
          metadata={[]}
          extra={(
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                  Repository
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
        />

        <FitnessAnalysisPanel
          workspaceId={workspaceId}
          codebaseId={activeRepoCodebaseId}
          repoPath={activeRepoSelection?.path}
        />
      </div>
    </SettingsRouteShell>
  );
}
