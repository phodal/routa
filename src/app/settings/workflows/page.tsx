/**
 * Settings / Workflows - /settings/workflows
 * Settings page for defining reusable workflows and reviewing workflow-focused execution configuration.
 */
"use client";

import { useTranslation } from "@/i18n";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { WorkflowPanel } from "@/client/components/workflow-panel";
import { Workflow } from "lucide-react";


export default function WorkflowSettingsPage() {
  const { t } = useTranslation();
  return (
    <SettingsRouteShell
      activeSettingsItem="workflows"
      title={t.settingsExtended.workflowsTitle}
      description={t.settingsExtended.workflowsDesc}
      badgeLabel={t.settingsExtended.workflowsBadge}
      contentClassName="flex h-full min-h-0 w-full flex-col"
      icon={(
        <Workflow className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
      )}
      summary={[
        { label: t.settingsExtended.focusLabel, value: t.settingsExtended.focusValue },
        { label: t.settingsExtended.outputLabel, value: t.settingsExtended.outputValue },
      ]}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <SettingsPageHeader
          title={t.settingsExtended.workflowsTitle}
          metadata={[
            { label: t.settingsExtended.focusLabel, value: t.settingsExtended.focusValue },
            { label: t.settingsExtended.outputLabel, value: t.settingsExtended.outputValue },
          ]}
        />
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          <WorkflowPanel />
        </div>
      </div>
    </SettingsRouteShell>
  );
}
