"use client";

import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { WorkflowPanel } from "@/client/components/workflow-panel";
import { Workflow } from "lucide-react";
import { useTranslation } from "@/i18n";


export default function WorkflowSettingsPage() {
  const { t } = useTranslation();

  return (
    <SettingsRouteShell
      title={t.nav.workflows}
      description={t.workflows.description}
      badgeLabel={t.workflows.automation}
      icon={(
        <Workflow className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
      )}
      summary={[
        { label: t.workflows.focus, value: t.workflows.reusableAutomationFlows },
        { label: t.workflows.output, value: t.workflows.tasksAndGraphExecution },
      ]}
    >
      <div className="space-y-6">
        <SettingsPageHeader
          title={t.nav.workflows}
          description={t.workflows.description}
          metadata={[
            { label: t.workflows.focus, value: t.workflows.reusableAutomationFlows },
            { label: t.workflows.output, value: t.workflows.tasksAndGraphExecution },
          ]}
        />

        <WorkflowPanel />
      </div>
    </SettingsRouteShell>
  );
}