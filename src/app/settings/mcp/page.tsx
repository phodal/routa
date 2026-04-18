/**
 * Settings / Mcp - /settings/mcp
 * Settings page for managing MCP servers, tools, and transport-level configuration.
 */
import { Suspense } from "react";
import { McpSettingsPageClient } from "./mcp-settings-page-client";

export default function McpSettingsPage() {
  return (
    <Suspense fallback={null}>
      <McpSettingsPageClient />
    </Suspense>
  );
}
