"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { FitnessAnalysisPanel } from "@/client/components/fitness-analysis-panel";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";

export function FluencySettingsPageClient() {
  const searchParams = useSearchParams();
  const workspacesHook = useWorkspaces();
  const requestedWorkspaceId = searchParams.get("workspaceId") ?? "";
  const requestedCodebaseId = searchParams.get("codebaseId") ?? "";
  const requestedRepoPath = searchParams.get("repoPath") ?? "";

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(requestedWorkspaceId);
  const workspaceId = selectedWorkspaceId || requestedWorkspaceId || workspacesHook.workspaces[0]?.id || "";
  const { codebases } = useCodebases(workspaceId);
  const [selectedCodebaseId, setSelectedCodebaseId] = useState(requestedCodebaseId);
  const [initialRepoPath, setInitialRepoPath] = useState(requestedRepoPath);
  const [selectedRepoOverride, setSelectedRepoOverride] = useState<RepoSelection | null>(null);

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
    if (!selectedRepoOverride) {
      return activeCodebase;
    }

    return codebases.find((codebase) => (
      codebase.repoPath === selectedRepoOverride.path
      && (selectedRepoOverride.branch ? (codebase.branch ?? "") === selectedRepoOverride.branch : true)
    )) ?? codebases.find((codebase) => codebase.repoPath === selectedRepoOverride.path)
      ?? null;
  }, [activeCodebase, codebases, selectedRepoOverride]);

  const activeRepoSelection = useMemo(() => {
    if (selectedRepoOverride) {
      return selectedRepoOverride;
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
  }, [activeCodebase, codebases, initialRepoPath, selectedRepoOverride]);

  const activeRepoCodebaseId = matchedSelectedCodebase?.id;
  const selectedRepoLabel = activeRepoSelection?.name ?? activeCodebase?.label ?? "Repository";

  return (
    <SettingsRouteShell
      title="Fluency（试验性）"
      description="Experimental fluency analysis for generic and orchestrator profiles."
      badgeLabel="Experimental"
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
            setSelectedRepoOverride(null);
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
          title="Fluency（试验性）"
          description="把 fluency 从 Harness 里拆出来单独看，避免和 fitness governance 混在一起。"
          metadata={[
            { label: "Profiles", value: "Generic + Agent Orchestrator" },
            { label: "Status", value: "Experimental / unreliable" },
          ]}
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
                    setSelectedRepoOverride(selection);
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
          codebaseLabel={selectedRepoLabel}
        />
      </div>
    </SettingsRouteShell>
  );
}
