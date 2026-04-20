"use client";

import Link from "next/link";
import { useTranslation } from "@/i18n";

import type { SettingsTab } from "./settings-panel-shared";

interface SettingsCenterNavProps {
  activeItem?: SettingsNavItem;
}

export type SettingsNavItem =
  | SettingsTab
  | "specialists"
  | "mcp"
  | "workflows"
  | "schedules";

export function SettingsCenterNav({ activeItem }: SettingsCenterNavProps) {
  const { t } = useTranslation();
  const configItems: Array<{ key: SettingsNavItem; label: string; href: string }> = [
    { key: "providers", label: t.settings.providers, href: "/settings?tab=providers" },
    { key: "registry", label: t.settings.registry, href: "/settings?tab=registry" },
    { key: "roles", label: t.settings.roleDefaults, href: "/settings?tab=roles" },
    { key: "models", label: t.settings.models, href: "/settings?tab=models" },
    { key: "webhooks", label: t.settings.webhooks, href: "/settings?tab=webhooks" },
  ];
  const workspaceToolItems: Array<{ key: SettingsNavItem; label: string; href: string }> = [
    { key: "specialists", label: t.nav.specialists, href: "/settings/specialists" },
    { key: "mcp", label: t.nav.mcpServers, href: "/settings/mcp" },
    { key: "workflows", label: t.nav.workflows, href: "/settings/workflows" },
    { key: "schedules", label: t.nav.schedules, href: "/settings/schedules" },
  ];

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-desktop-border bg-desktop-bg-secondary px-4 py-5">
      <div className="mt-4 space-y-6">
        <NavGroup
          label={t.settings.config}
          items={configItems.map((item) => ({
            ...item,
            active: activeItem === item.key,
          }))}
        />
        <NavGroup
          label={t.settings.workspaceTools}
          items={workspaceToolItems.map((item) => ({
            ...item,
            active: activeItem === item.key,
          }))}
        />
      </div>
    </aside>
  );
}

function NavGroup({
  label,
  items,
}: {
  label: string;
  items: Array<{ key: string; label: string; href: string; active: boolean }>;
}) {
  return (
    <div>
      <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-tertiary">
        {label}
      </p>
      <div className="mt-2 space-y-1">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={`flex items-center rounded-xl px-3 py-2 text-sm transition-colors ${
              item.active
                ? "bg-desktop-bg-active text-desktop-accent"
                : "text-desktop-text-secondary hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
