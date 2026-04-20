/**
 * Settings / Specialists - /settings/specialists
 * Settings page for configuring specialist personas, bindings, and model-aware specialist behavior.
 */
"use client";

import { useState } from "react";

import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SpecialistsTab } from "@/client/components/settings-panel-specialists-tab";
import { loadModelDefinitions } from "@/client/components/settings-panel-shared";
import { CircleUser } from "lucide-react";
import { useTranslation } from "@/i18n";


export default function SpecialistsSettingsPage() {
  const [modelDefs] = useState(() => loadModelDefinitions());
  const { t } = useTranslation();

  return (
    <SettingsRouteShell
      activeSettingsItem="specialists"
      title={t.nav.specialists}
      description={t.settingsExtended.specialistsDesc}
      badgeLabel={t.settingsExtended.specialistsBadge}
      icon={(
        <CircleUser className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
      )}
      summary={[
        { label: t.settingsExtended.specialistsPurposeLabel, value: t.settingsExtended.specialistsPurposeValue },
        { label: t.settingsExtended.specialistsBindingLabel, value: t.settingsExtended.specialistsBindingValue },
      ]}
      contentClassName="flex h-full min-h-0 w-full flex-col"
    >
      <SpecialistsTab modelDefs={modelDefs} />
    </SettingsRouteShell>
  );
}
