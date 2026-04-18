/**
 * Settings / Agents - /settings/agents
 * Settings page for installing, discovering, and managing ACP-compatible agent runtimes.
 */
"use client";

import { Bot } from "lucide-react";

import { AgentInstallPanel } from "@/client/components/agent-install-panel";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { useTranslation } from "@/i18n";

export default function AgentSettingsPage() {
  const { t } = useTranslation();

  return (
    <SettingsRouteShell
      title={t.agents.agentInstallation}
      description={t.agents.installAndManage}
      badgeLabel="ACP"
      icon={(
        <Bot className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
      )}
      contentClassName="flex h-full min-h-0 w-full flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <SettingsPageHeader
          title={t.agents.agentInstallation}
          extra={(
            <a
              href="https://agentclientprotocol.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-full border border-desktop-border bg-desktop-bg-primary/50 px-2.5 py-1 text-[10px] font-medium text-desktop-text-secondary transition hover:bg-desktop-bg-active hover:text-desktop-text-primary"
            >
              {t.agents.learnAboutACP}
            </a>
          )}
        />
        <div className="min-h-0 flex-1 overflow-hidden px-4 py-4">
          <div className="h-full border border-desktop-border bg-desktop-bg-primary">
            <AgentInstallPanel embedded />
          </div>
        </div>
      </div>
    </SettingsRouteShell>
  );
}
