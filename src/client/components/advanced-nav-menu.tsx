"use client";

import Link from "next/link";
import React from "react";
import { usePathname } from "next/navigation";
import {
  Calendar,
  ChevronDown,
  CircleUser,
  Monitor,
  MonitorUp,
  MoreHorizontal,
  Server,
  Share2,
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

export function AdvancedNavMenu({
  workspaceId,
  collapsed = false,
  buttonClassName,
  className,
}: AdvancedNavMenuProps) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const normalizedWorkspaceId = workspaceId?.trim() || null;
  const fallbackWorkspaceId = normalizedWorkspaceId || "default";
  const workspaceBaseHref = `/workspace/${fallbackWorkspaceId}`;
  const settingsHarnessHref = normalizedWorkspaceId
    ? `/settings/harness?workspaceId=${encodeURIComponent(normalizedWorkspaceId)}`
    : "/settings/harness";
  const settingsFluencyHref = normalizedWorkspaceId
    ? `/settings/fluency?workspaceId=${encodeURIComponent(normalizedWorkspaceId)}`
    : "/settings/fluency";

  const items: AdvancedNavItem[] = [
    {
      id: "team",
      label: t.nav.team,
      href: `${workspaceBaseHref}/team`,
      icon: <Share2 className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} />,
    },
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
    {
      id: "debug",
      label: t.nav.debug,
      href: "/traces",
      icon: <Monitor className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} />,
    },
  ];

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  const isActive = (href: string) => {
    const hrefPath = href.split("?")[0]?.split("#")[0] ?? href;
    if (hrefPath === "/") {
      return pathname === "/";
    }
    return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
  };

  const menuActive = items.some((item) => isActive(item.href));
  const menuPositionClass = collapsed ? "left-full bottom-0 ml-1 w-56" : "left-0 right-0 bottom-full mb-1";

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.nav.advanced}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex items-center rounded-md border border-desktop-border text-xs font-medium transition-colors ${buttonClassName ?? "h-8 px-2 py-1"} ${
          menuActive || open
            ? "bg-desktop-bg-active text-desktop-accent"
            : "text-desktop-text-secondary hover:border-desktop-accent/40 hover:bg-desktop-bg-active/60 hover:text-desktop-text-primary"
        }`}
      >
        <MoreHorizontal className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} />
        {!collapsed ? (
          <>
            <span className="ml-1.5 mr-1.5">{t.nav.advanced}</span>
            <ChevronDown className={`h-3 w-3 opacity-70 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} />
          </>
        ) : null}
      </button>

      {open ? (
        <div className={`absolute z-30 ${menuPositionClass} rounded-lg border border-desktop-border bg-desktop-bg-secondary/95 p-1 text-[11px] shadow-lg backdrop-blur`}>
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-secondary">
            {t.nav.advanced}
          </div>
          {items.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`mb-0.5 last:mb-0 flex items-center gap-2 rounded-md px-2 py-2 transition-colors ${
                  active
                    ? "bg-desktop-bg-active text-desktop-accent"
                    : "text-desktop-text-secondary hover:bg-desktop-bg-active/80 hover:text-desktop-text-primary"
                }`}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}