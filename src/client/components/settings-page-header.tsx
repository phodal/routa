"use client";

import type { ReactNode } from "react";

type SettingsPageHeaderProps = {
  title: string;
  description?: string;
  metadata?: Array<{ label: string; value: string }>;
  extra?: ReactNode;
};

export function SettingsPageHeader({
  title,
  description,
  metadata = [],
  extra,
}: SettingsPageHeaderProps) {
  return (
    <header className="border-b border-desktop-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] font-semibold text-desktop-text-primary">{title}</h1>
        </div>

        {extra || metadata.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {extra}
            {metadata.map((item) => (
              <div
                key={item.label}
                className="inline-flex items-center gap-1 rounded-full border border-desktop-border bg-desktop-bg-primary/50 px-2.5 py-1 text-[10px] font-medium text-desktop-text-secondary"
              >
                <span className="opacity-70">{item.label}:</span>
                <span className="font-semibold">{item.value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {description ? (
        <p className="mt-2 max-w-3xl text-[11px] leading-5 text-desktop-text-secondary">{description}</p>
      ) : null}
    </header>
  );
}
