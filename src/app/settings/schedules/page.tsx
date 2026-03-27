"use client";

import { useState } from "react";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { SchedulePanel } from "@/client/components/schedule-panel";

export default function SchedulesSettingsPage() {
  const workspacesHook = useWorkspaces();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const effectiveWorkspaceId = selectedWorkspaceId || workspacesHook.workspaces[0]?.id || "";

  return (
    <SettingsRouteShell
      title="Schedules"
      description="Run agents automatically on a recurring cron schedule. Use this for audits, cleanup, sync, and regular maintenance jobs."
      badgeLabel="Background jobs"
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={effectiveWorkspaceId || null}
          activeWorkspaceTitle={workspacesHook.workspaces.find((workspace) => workspace.id === effectiveWorkspaceId)?.title}
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
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3.75v3m10.5-3v3M4.5 8.25h15m-14.25 9h5.25m-5.25 0V6.75A2.25 2.25 0 016.75 4.5h10.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25H6.75a2.25 2.25 0 01-2.25-2.25z" />
        </svg>
      )}
      summary={[
        { label: "Trigger", value: "Cron-driven automation" },
        { label: "Runtime", value: "Background execution" },
      ]}
    >
      <div className="space-y-6">
        <SettingsPageHeader
          title="Schedules"
          description="Run agents automatically on a recurring cron schedule. Jobs are scoped to the selected workspace."
          metadata={[
            { label: "Trigger", value: "Cron-driven automation" },
            { label: "Runtime", value: "Background execution" },
          ]}
        />
        <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm text-blue-700 shadow-sm dark:border-blue-900/30 dark:bg-blue-900/10 dark:text-blue-400">
          <span className="font-semibold">Tick endpoint:</span>{" "}
          <code className="rounded bg-blue-100 px-1 py-0.5 font-mono dark:bg-blue-900/30">/api/schedules/tick</code>
          <span className="ml-2">Production can trigger it with Vercel Cron; local runs use the in-process scheduler.</span>
        </div>
        <SchedulePanel workspaceId={effectiveWorkspaceId || undefined} />
      </div>
    </SettingsRouteShell>
  );
}
