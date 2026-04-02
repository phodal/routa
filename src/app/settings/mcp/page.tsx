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

export default function McpSettingsPage() {
  const searchParams = useSearchParams();
  const activeTab = useMemo<McpTab>(() => (
    searchParams.get("tab") === "tools" ? "tools" : "servers"
  ), [searchParams]);

  return (
    <SettingsRouteShell
      title="MCP Servers"
      description="Manage Model Context Protocol servers, transports, and local integration points for your workspace."
      badgeLabel="Integration"
      icon={(
        <Server className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
      )}
      summary={[
        { label: "Transport", value: "stdio / http / sse" },
        { label: "Scope", value: "Workspace integrations" },
      ]}
    >
      <div className="space-y-4">
        <SettingsPageHeader
          title={activeTab === "tools" ? "MCP Tools" : "MCP Servers"}
          description={activeTab === "tools"
            ? "Inspect routa-coordination tools, switch essential/full mode, and execute focused MCP checks without leaving settings."
            : "Manage Model Context Protocol servers, transports, and local integration points for your workspace."}
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
        {activeTab === "tools" ? (
          <McpToolsExplorer />
        ) : (
          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/70 shadow-sm">
            <McpServersTab />
          </div>
        )}
      </div>
    </SettingsRouteShell>
  );
}
