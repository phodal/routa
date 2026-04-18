/**
 * Settings / Webhooks - /settings/webhooks
 * Settings page for configuring GitHub webhook ingestion and inspecting the webhook endpoint used by Routa.
 */
"use client";

import { Link2 } from "lucide-react";

import { GitHubWebhookPanel } from "@/client/components/github-webhook-panel";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { useTranslation } from "@/i18n";

export default function WebhookSettingsPage() {
  const { t } = useTranslation();

  return (
    <SettingsRouteShell
      title={t.settings.webhooksPageTitle}
      description={t.settings.webhooksPageDescription}
      badgeLabel="GitHub"
      icon={(
        <Link2 className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
      )}
      contentClassName="flex h-full min-h-0 w-full flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <SettingsPageHeader
          title={t.settings.webhooksPageTitle}
          metadata={[
            { label: t.settings.webhookUrl, value: "/api/webhooks/github" },
          ]}
        />
        <div className="min-h-0 flex-1 overflow-hidden px-4 py-4">
          <div className="h-full border border-desktop-border bg-desktop-bg-primary">
            <GitHubWebhookPanel />
          </div>
        </div>
      </div>
    </SettingsRouteShell>
  );
}
