"use client";

import { useMemo, useState } from "react";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";

export default function HarnessSettingsPage() {
  const workspacesHook = useWorkspaces();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const workspaceId = selectedWorkspaceId || workspacesHook.workspaces[0]?.id || "";
  const { codebases } = useCodebases(workspaceId);
  const [selectedCodebaseId, setSelectedCodebaseId] = useState("");

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

  return (
    <SettingsRouteShell
      title="Harness"
      description="Harness visualization placeholder."
      badgeLabel="AI Health"
      workspaceId={workspaceId}
      workspaceTitle={activeWorkspaceTitle}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId || null}
          activeWorkspaceTitle={activeWorkspaceTitle}
          onSelect={setSelectedWorkspaceId}
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
      icon={(
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75v10.5m5.25-5.25H6.75m10.35-3.3L12 3.75m-5.25 10.95L3 12m18 0l-3.75-2.1M7.5 17.25L3 12m18 0-4.5 2.25M8.25 7.5a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0z" />
        </svg>
      )}
      summary={[
        { label: "Status", value: "Placeholder only" },
        { label: "Next", value: "Visualize entrix fitness" },
      ]}
    >
      <div className="space-y-6">
        <div className="space-y-4">
          <SettingsPageHeader
            title="Harness"
            description="Workspace stays in the top bar. This section keeps only the repository selector for the upcoming entrix fitness visualization."
            metadata={[
              { label: "Workspace", value: activeWorkspaceTitle ?? "Unselected" },
              { label: "Status", value: "Empty implementation" },
            ]}
          />

          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/70 p-4 shadow-sm">
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-0">
                <label className="mb-1 block text-xs font-semibold text-desktop-text-secondary">Repository</label>
                <select
                  value={activeCodebase?.id ?? ""}
                  onChange={(event) => {
                    setSelectedCodebaseId(event.target.value);
                  }}
                  className="min-w-80 rounded-lg border border-desktop-border bg-white px-3 py-2 text-sm text-desktop-text-primary"
                  disabled={codebases.length === 0 || !workspaceId || workspacesHook.loading}
                >
                  <option value="">Select repository</option>
                  {codebases.map((codebase) => (
                    <option key={codebase.id} value={codebase.id}>
                      {codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-0">
                <div className="text-xs text-desktop-text-secondary">Selected repository path</div>
                <div className="mt-1 max-w-[420px] text-sm font-mono text-desktop-text-primary">
                  {activeCodebase?.repoPath ?? "No repository selected"}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-dashed border-desktop-border bg-desktop-bg-secondary/40 px-5 py-8 text-sm text-desktop-text-secondary shadow-sm">
          Fitness visualization placeholder.
        </div>
      </div>
    </SettingsRouteShell>
  );
}
