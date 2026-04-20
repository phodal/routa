"use client";

import Link from "next/link";
import React from "react";
import { usePathname } from "next/navigation";
import {
  Calendar,
  CircleUser,
  Monitor,
  MonitorUp,
  Server,
  Workflow,
} from "lucide-react";

import { useTranslation } from "@/i18n";
import { HarnessMark } from "./harness-mark";

interface AdvancedNavMenuProps {
  workspaceId?: string | null;
  collapsed?: boolean;
  buttonClassName?: string;
  className?: string;
}

interface AdvancedNavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
}

interface AdvancedNavSection {
  id: string;
  label: string;
  items: AdvancedNavItem[];
}

export function AdvancedNavMenu({
  workspaceId,
  collapsed = false,
  buttonClassName,
  className,
}: AdvancedNavMenuProps) {
  const pathname = usePathname();
  const { t } = useTranslation();

  const normalizedWorkspaceId = workspaceId?.trim() || null;
  const settingsHarnessHref = normalizedWorkspaceId
    ? `/settings/harness?workspaceId=${encodeURIComponent(normalizedWorkspaceId)}`
    : "/settings/harness";
  const settingsFluencyHref = normalizedWorkspaceId
    ? `/settings/fluency?workspaceId=${encodeURIComponent(normalizedWorkspaceId)}`
    : "/settings/fluency";

  const sections: AdvancedNavSection[] = [
    {
      id: "metrics",
      label: t.nav.advancedGroupMetrics,
      items: [
        {
          id: "harness",
          label: t.nav.harness,
          href: settingsHarnessHref,
          icon: <HarnessMark className="h-4 w-4" title="" />,
        },
        {
          id: "fluency",
          label: t.nav.fluency,
          href: settingsFluencyHref,
          icon: <MonitorUp className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} />,
        },
      ],
    },
    {
      id: "customize",
      label: t.nav.advancedGroupCustomize,
      items: [
        {
          id: "workflows",
          label: t.nav.workflows,
          href: "/settings/workflows",
          icon: <Workflow className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} />,
        },
        {
          id: "specialists",
          label: t.nav.specialists,
          href: "/settings/specialists",
          icon: <CircleUser className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} />,
        },
      ],
    },
    {
      id: "tools",
      label: t.nav.advancedGroupTools,
      items: [
        {
          id: "mcp",
          label: t.nav.mcpServers,
          href: "/settings/mcp",
          icon: <Server className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} />,
        },
        {
          id: "schedules",
          label: t.nav.schedules,
          href: "/settings/schedules",
          icon: <Calendar className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} />,
        },
      ],
    },
    {
      id: "other",
      label: t.nav.advancedGroupOther,
      items: [
        {
          id: "debug",
          label: t.nav.debug,
          href: "/traces",
          icon: <Monitor className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} />,
        },
      ],
    },
  ];

  const isActive = (href: string) => {
    const hrefPath = href.split("?")[0]?.split("#")[0] ?? href;
    if (hrefPath === "/") {
      return pathname === "/";
    }
    return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
  };

  const collapsedLinkClassName = buttonClassName ?? "h-10 w-10 px-0 py-0 justify-center";
  const expandedLinkClassName = buttonClassName ?? "h-11 w-full gap-3 px-3 py-0 text-sm font-medium justify-start";

  return (
    <div className={className ?? ""}>
      {sections.map((section) => (
        <div key={section.id} className={collapsed ? "contents" : "mb-3 last:mb-0"}>
          {!collapsed ? (
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary/60">
              {section.label}
            </div>
          ) : null}
          <div className={collapsed ? "flex flex-col items-center gap-1" : "space-y-1"}>
            {section.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`relative flex items-center rounded-xl transition-colors ${
                    collapsed ? collapsedLinkClassName : expandedLinkClassName
                  } ${
                    active
                      ? "bg-desktop-bg-active text-desktop-accent"
                      : "text-desktop-text-secondary hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
                  }`}
                  title={collapsed ? `${section.label} / ${item.label}` : item.label}
                >
                  {active && <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-desktop-accent" />}
                  {item.icon}
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
