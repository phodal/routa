"use client";

import React from "react";
import Link from "next/link";

import { ProtocolBadge } from "@/app/protocol-badge";
import { useTranslation, type Locale, SUPPORTED_LOCALES } from "@/i18n";
import { getStoredThemePreference, resolveThemePreference, setThemePreference, subscribeToThemePreference, type ResolvedTheme, type ThemePreference } from "@/client/utils/theme";

import { DockerStatusIndicator } from "./docker-status-indicator";
import { McpStatusIndicator } from "./mcp-status-indicator";
import { ChevronDown, ChevronRight, Check, Moon, Settings, Sun } from "lucide-react";


interface ShellHeaderControlsProps {
  className?: string;
  showProtocolBadges?: boolean;
}

const LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  zh: "中文",
};

const THEME_OPTIONS: ThemePreference[] = ["light", "dark", "system"];

export function ShellHeaderControls({
  className = "",
  showProtocolBadges = true,
}: ShellHeaderControlsProps) {
  const { t, locale, setLocale } = useTranslation();
  const themeSnapshot = React.useSyncExternalStore(
    (onStoreChange) => subscribeToThemePreference(() => onStoreChange()),
    () => {
      const nextThemePreference = getStoredThemePreference();
      const nextResolvedTheme = resolveThemePreference(nextThemePreference);
      return `${nextThemePreference}:${nextResolvedTheme}` as const;
    },
    () => "system:light",
  );
  const [themePreference, resolvedTheme] = themeSnapshot.split(":") as [ThemePreference, ResolvedTheme];

  const getThemeLabel = (preference: ThemePreference) => {
    if (preference === "light") return t.settings.light;
    if (preference === "dark") return t.settings.dark;
    return t.settings.system;
  };

  const themeDotClass = resolvedTheme === "dark" ? "text-sky-300" : "text-amber-500";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="hidden lg:flex">
        <DockerStatusIndicator />
      </div>
      <div className="hidden lg:flex">
        <McpStatusIndicator />
      </div>
      {showProtocolBadges ? (
        <div className="hidden lg:flex items-center gap-2">
          <ProtocolBadge name="ACP" endpoint="/api/acp" />
        </div>
      ) : null}
      <div className="relative group">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1 rounded-md border border-desktop-border px-2 py-1 text-xs font-medium text-desktop-text-secondary transition-colors hover:border-desktop-accent/40 hover:text-desktop-text-primary hover:bg-desktop-bg-active/60"
        >
          <Settings className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
          <span>{t.settings.title}</span>
          <ChevronDown className="h-3 w-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
        </button>
        <div className="invisible absolute right-0 top-full z-20 mt-1 min-w-48 translate-y-1 rounded-lg border border-desktop-border bg-desktop-bg-secondary/95 p-1 text-[11px] opacity-0 shadow-lg backdrop-blur transition-all duration-150 group-hover:visible group-hover:opacity-100 group-hover:translate-y-0">
          <Link
            href="/settings"
            className="mb-1 block rounded-md border border-transparent px-2 py-1.5 font-semibold text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary hover:border-desktop-border"
          >
            {t.settings.title}
          </Link>
          <div className="border-t border-desktop-border/70" />
          <div className="relative group/language">
            <button
              type="button"
              className="mt-1 inline-flex w-full items-center justify-between rounded-md border border-transparent px-2 py-1.5 text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary hover:border-desktop-border"
            >
              <span>{t.settings.language}</span>
              <ChevronRight className="h-3 w-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            </button>
            <div className="invisible absolute right-full top-0 z-30 mr-1 min-w-24 rounded-md border border-desktop-border bg-desktop-bg-secondary/95 p-1 text-[11px] shadow-lg backdrop-blur opacity-0 transition-all duration-150 group-hover/language:visible group-hover/language:opacity-100">
              {SUPPORTED_LOCALES.map((item) => {
                const selected = item === locale;
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setLocale(item);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors ${
                      selected
                        ? "bg-desktop-bg-active text-desktop-text-primary"
                        : "text-desktop-text-secondary hover:bg-desktop-bg-active/80"
                    }`}
                  >
                    <span>{LOCALE_LABELS[item]}</span>
                    {selected ? <Check className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="relative group/theme">
            <button
              type="button"
              className="mt-1 inline-flex w-full items-center justify-between rounded-md border border-transparent px-2 py-1.5 text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary hover:border-desktop-border"
            >
              <span>{t.settings.theme}</span>
              <ChevronRight className="h-3 w-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            </button>
            <div className="invisible absolute right-full top-0 z-30 mr-1 min-w-28 rounded-md border border-desktop-border bg-desktop-bg-secondary/95 p-1 text-[11px] shadow-lg backdrop-blur opacity-0 transition-all duration-150 group-hover/theme:visible group-hover/theme:opacity-100">
              {THEME_OPTIONS.map((option) => {
                const active = themePreference === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setThemePreference(option);
                    }}
                    className={`mb-0.5 last:mb-0 flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors ${
                      active ? "bg-desktop-bg-active text-desktop-text-primary" : "text-desktop-text-secondary hover:bg-desktop-bg-active/80"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {option === "light" ? (
                        <Sun className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
                      ) : option === "dark" ? (
                        <Moon className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
                      ) : (
                        <span className={`inline-flex h-3 w-3 items-center justify-center rounded-full border border-current text-[8px] leading-none ${themeDotClass}`}>◉</span>
                      )}
                      <span>{getThemeLabel(option)}</span>
                    </span>
                    {active ? <Check className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
