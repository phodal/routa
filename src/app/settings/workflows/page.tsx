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
      title={t.settingsExtended.workflowsTitle}
      description={t.settingsExtended.workflowsDesc}
      badgeLabel={t.settingsExtended.workflowsBadge}
      icon={(
        <Workflow className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
      )}
      summary={[
        { label: t.settingsExtended.focusLabel, value: t.settingsExtended.focusValue },
        { label: t.settingsExtended.outputLabel, value: t.settingsExtended.outputValue },
      ]}
    >
      <div className="space-y-6">
        <SettingsPageHeader
          title={t.settingsExtended.workflowsTitle}
          description={t.settingsExtended.workflowsDesc}
          metadata={[
            { label: t.settingsExtended.focusLabel, value: t.settingsExtended.focusValue },
            { label: t.settingsExtended.outputLabel, value: t.settingsExtended.outputValue },
          ]}
        />

        <WorkflowPanel />
      </div>
    </SettingsRouteShell>
  );
}
