"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { SettingsPanel } from "@/client/components/settings-panel";
import type { SettingsTab } from "@/client/components/settings-panel-shared";
import { useTranslation } from "@/i18n";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { Settings } from "lucide-react";


interface ProviderOption {
  id: string;
  name: string;
  status?: string;
}

export function SettingsPageClient() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const requestedTab = searchParams.get("tab");
  const initialTab = isSettingsTab(requestedTab) ? requestedTab : undefined;
  // Preserve workspace context so sidebar navigation stays within the same workspace.
  const workspaceId = searchParams.get("workspaceId") || null;

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const res = await desktopAwareFetch("/api/providers");
        if (res.ok) {
          const data = await res.json();
          setProviders(data.providers ?? []);
        }
      } catch (error) {
        console.error("Failed to fetch providers:", error);
      }
    };

    void fetchProviders();
  }, []);

  const handleClose = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(workspaceId ? `/workspace/${workspaceId}/sessions` : "/");
  };

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceSwitcher={(
        <div className="flex items-center gap-1.5 rounded-xl border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] text-desktop-text-primary">
          <Settings className="h-3 w-3 text-desktop-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          <span>{t.settings.title}</span>
        </div>
      )}
    >
      <SettingsPanel
        key={initialTab ?? "providers"}
        open={true}
        onClose={handleClose}
        providers={providers}
        initialTab={initialTab}
        variant="page"
      />
    </DesktopAppShell>
  );
}

function isSettingsTab(value: string | null): value is SettingsTab {
  return value === "providers"
    || value === "registry"
    || value === "roles"
    || value === "models"
    || value === "webhooks";
}
