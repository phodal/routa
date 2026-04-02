import { Suspense } from "react";
import { useTranslation } from "@/i18n";
import { McpSettingsPageClient } from "./mcp-settings-page-client";

export default function McpSettingsPage() {
  const { t } = useTranslation();

  return (
    <Suspense fallback={null}>
      <McpSettingsPageClient />
    </Suspense>
  );
}