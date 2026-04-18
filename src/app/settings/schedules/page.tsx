/**
 * Settings / Schedules - /settings/schedules
 * Workspace-aware schedule management page for triggers, recurring runs, and schedule tick diagnostics.
 */
"use client";

import { useState } from "react";
import { useTranslation } from "@/i18n";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { SchedulePanel } from "@/client/components/schedule-panel";
import { Calendar } from "lucide-react";


export default function SchedulesSettingsPage() {
  const { t } = useTranslation();
  const workspacesHook = useWorkspaces();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const effectiveWorkspaceId = selectedWorkspaceId || workspacesHook.workspaces[0]?.id || "";

  return (
    <SettingsRouteShell
      activeSettingsItem="schedules"
      title={t.settingsExtended.schedulesTitle}
      description={t.settingsExtended.schedulesDesc}
      badgeLabel={t.settingsExtended.schedulesBadge}
      contentClassName="flex h-full min-h-0 w-full flex-col"
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
        <Calendar className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
      )}
      summary={[
        { label: t.settingsExtended.triggerLabel, value: t.settingsExtended.triggerValue },
        { label: t.settingsExtended.runtimeLabel, value: t.settingsExtended.runtimeValue },
      ]}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <SettingsPageHeader
          title={t.settingsExtended.schedulesPageTitle}
          metadata={[
            { label: t.settingsExtended.triggerLabel, value: t.settingsExtended.triggerValue },
            { label: t.settingsExtended.runtimeLabel, value: t.settingsExtended.runtimeValue },
          ]}
          extra={(
            <div className="inline-flex items-center gap-2 rounded-full border border-desktop-border bg-desktop-bg-primary/50 px-2.5 py-1 text-[10px] font-medium text-desktop-text-secondary">
              <span className="opacity-70">{t.settingsExtended.tickEndpoint}:</span>
              <code className="font-mono text-desktop-text-primary">/api/schedules/tick</code>
            </div>
          )}
        />
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          <SchedulePanel workspaceId={effectiveWorkspaceId || undefined} />
        </div>
      </div>
    </SettingsRouteShell>
  );
}
