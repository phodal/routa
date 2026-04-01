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
      title={t.settingsExtended.schedulesTitle}
      description={t.settingsExtended.schedulesDesc}
      badgeLabel={t.settingsExtended.schedulesBadge}
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
      <div className="space-y-6">
        <SettingsPageHeader title={t.settingsExtended.schedulesPageTitle} />
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-desktop-border bg-desktop-bg-secondary/70 px-3 py-2 text-[11px] text-desktop-text-secondary">
          <span className="font-medium text-desktop-text-primary">{t.settingsExtended.tickEndpoint}</span>
          <code className="rounded bg-desktop-bg-primary px-1.5 py-0.5 font-mono text-desktop-text-primary">/api/schedules/tick</code>
          <span>{t.settingsExtended.vercelCron}</span>
        </div>
        <SchedulePanel workspaceId={effectiveWorkspaceId || undefined} />
      </div>
    </SettingsRouteShell>
  );
}
