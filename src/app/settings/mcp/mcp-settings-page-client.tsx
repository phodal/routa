"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { SettingsRouteShell } from "@/client/components/settings-route-shell";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { McpToolsExplorer } from "@/client/components/mcp-tools-explorer";
import { McpServersTab } from "@/client/components/settings-panel-mcp-tab";
import { Server } from "lucide-react";

type McpTab = "servers" | "tools";

const TAB_META: Array<{ key: McpTab; label: string; href: string }> = [
  { key: "servers", label: "Servers", href: "/settings/mcp?tab=servers" },
  { key: "tools", label: "Tools", href: "/settings/mcp?tab=tools" },
];

export function McpSettingsPageClient() {
  const searchParams = useSearchParams();
  const activeTab = useMemo<McpTab>(() => (
    searchParams.get("tab") === "tools" ? "tools" : "servers"
  ), [searchParams]);

  return (
    <SettingsRouteShell
      activeSettingsItem="mcp"
      title="MCP Servers"
      description="Manage Model Context Protocol servers, transports, and local integration points for your workspace."
      badgeLabel="Integration"
      contentClassName="flex h-full min-h-0 w-full flex-col"
      icon={(
        <Server className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
      )}
      summary={[
        { label: "Transport", value: "stdio / http / sse" },
        { label: "Scope", value: "Workspace integrations" },
      ]}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <SettingsPageHeader
          title={activeTab === "tools" ? "MCP Tools" : "MCP Servers"}
          metadata={[
            { label: "Transport", value: "stdio / http / sse" },
            { label: "Scope", value: activeTab === "tools" ? "Tool explorer" : "Workspace integrations" },
          ]}
          extra={(
            <div className="inline-flex rounded-full border border-desktop-border bg-desktop-bg-primary/60 p-1">
              {TAB_META.map((tab) => {
                const active = tab.key === activeTab;
                return (
                  <Link
                    key={tab.key}
                    href={tab.href}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? "bg-desktop-bg-secondary text-desktop-text-primary shadow-sm"
                        : "text-desktop-text-secondary hover:bg-desktop-bg-secondary/80 hover:text-desktop-text-primary"
                    }`}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </div>
          )}
        />
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {activeTab === "tools" ? (
            <McpToolsExplorer />
          ) : (
            <div className="border border-desktop-border bg-desktop-bg-secondary/70">
              <McpServersTab />
            </div>
          )}
        </div>
      </div>
    </SettingsRouteShell>
  );
}
