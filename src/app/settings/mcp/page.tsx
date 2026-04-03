import { Suspense } from "react";
import { McpSettingsPageClient } from "./mcp-settings-page-client";

export default function McpSettingsPage() {
  return (
    <Suspense fallback={null}>
      <McpSettingsPageClient />
    </Suspense>
  );
}