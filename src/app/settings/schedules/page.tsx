"use client";

import { useState } from "react";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { Select } from "@/client/components/select";
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
        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary px-5 py-4 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-muted">Workspace</p>
              <p className="mt-1 text-sm text-desktop-text-secondary">
                Schedules are scoped to a workspace. Pick the target workspace before creating or editing jobs.
              </p>
            </div>
            <div className="w-full max-w-sm">
              <Select
                value={effectiveWorkspaceId}
                onChange={(event) => setSelectedWorkspaceId(event.target.value)}
                disabled={workspacesHook.loading || workspacesHook.workspaces.length === 0}
                className="w-full rounded-xl border border-desktop-border bg-desktop-bg-primary px-3 py-2 text-sm text-desktop-text-primary outline-none transition focus:border-desktop-accent/60 focus:ring-2 focus:ring-desktop-accent/20"
              >
                {workspacesHook.workspaces.length === 0 ? (
                  <option value="">No active workspace</option>
                ) : (
                  workspacesHook.workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.title}
                    </option>
                  ))
                )}
              </Select>
            </div>
          </div>
        </div>
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
