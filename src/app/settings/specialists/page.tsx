"use client";

import { useState } from "react";

import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { SpecialistsTab } from "@/client/components/settings-panel-specialists-tab";
import { loadModelDefinitions } from "@/client/components/settings-panel-shared";
import { CircleUser } from "lucide-react";
import { useTranslation } from "@/i18n";


export default function SpecialistsSettingsPage() {
  const { t } = useTranslation();
  const [modelDefs] = useState(() => loadModelDefinitions());

  return (
    <SettingsRouteShell
      title={t.settings.specialists}
      description={t.settings.specialistsDescription}
      badgeLabel={t.settings.executionRoles}
      icon={(
        <CircleUser className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
      )}
      summary={[
        { label: t.settings.purpose, value: t.settings.focusedExecutionPersonas },
        { label: t.settings.binding, value: t.settings.promptModelPairing },
      ]}
    >
      <div className="space-y-4">
        <SettingsPageHeader
          title={t.settings.specialists}
          description={t.settings.specialistsDescription}
          metadata={[
            { label: t.settings.purpose, value: t.settings.focusedExecutionPersonas },
            { label: t.settings.binding, value: t.settings.promptModelPairing },
          ]}
        />
        <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/70 shadow-sm">
          <SpecialistsTab modelDefs={modelDefs} />
        </div>
      </div>
    </SettingsRouteShell>
  );
}