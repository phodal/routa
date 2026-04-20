"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, FileJson2, FileText } from "lucide-react";

import { FileIcon } from "./feature-explorer-file-tree";

export function InlineStatPill({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/30 px-2 py-1 text-[10px]">
      <div className="uppercase tracking-[0.08em] text-desktop-text-secondary">{label}</div>
      <div className="mt-0.5 text-right text-[11px] font-semibold text-desktop-text-primary">{value}</div>
    </div>
  );
}

export function FeatureStructureSection({
  title,
  count,
  collapsed,
  onToggle,
  toolbar,
  children,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-sm border border-desktop-border bg-desktop-bg-primary">
      <div className="flex items-center justify-between gap-3 border-b border-desktop-border bg-desktop-bg-secondary/30 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary hover:text-desktop-text-primary"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{title}</span>
          <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal text-desktop-text-primary">
            {count}
          </span>
        </button>
        {toolbar}
      </div>
      {!collapsed ? <div className="space-y-2 p-3">{children}</div> : null}
    </section>
  );
}

export function FeatureRouteRow({
  page,
}: {
  page: {
    route: string;
    title?: string;
    description?: string;
    sourceFile?: string;
  };
}) {
  return (
    <div className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/20 px-3 py-2">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />
        <div className="min-w-0 flex-1">
          <div className="break-all text-[12px] font-medium text-desktop-text-primary">{page.route}</div>
          {page.title ? (
            <div className="mt-0.5 text-[11px] text-desktop-text-primary">{page.title}</div>
          ) : null}
          {page.description ? (
            <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">{page.description}</div>
          ) : null}
          {page.sourceFile ? (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-desktop-text-secondary">
              <FileIcon path={page.sourceFile} />
              <span className="break-all">{page.sourceFile}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function FeatureApiRow({
  api,
  implementationLabel,
}: {
  api: {
    group?: string;
    method: string;
    endpoint: string;
    description?: string;
    nextjsSourceFiles?: string[];
    rustSourceFiles?: string[];
    implementationSources?: Array<{
      label: string;
      sourceFiles: string[];
    }>;
  };
  implementationLabel: string;
}) {
  const implementationGroups = [
    ...(api.implementationSources ?? []),
    ...(api.nextjsSourceFiles?.length
      ? [{ label: "Next.js API", sourceFiles: api.nextjsSourceFiles }]
      : []),
    ...(api.rustSourceFiles?.length
      ? [{ label: "Rust API", sourceFiles: api.rustSourceFiles }]
      : []),
  ].map((group) => ({
    ...group,
    sourceFiles: [...new Set(group.sourceFiles)],
  })).filter((group) => group.sourceFiles.length > 0);

  return (
    <div className="rounded-sm border border-desktop-border bg-desktop-bg-secondary/20 px-3 py-2">
      <div className="flex items-start gap-2">
        <FileJson2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm border border-desktop-accent/30 bg-desktop-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-desktop-accent">
              {api.method}
            </span>
            <span className="break-all text-[12px] font-medium text-desktop-text-primary">{api.endpoint}</span>
            {api.group ? (
              <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5 text-[10px] text-desktop-text-secondary">
                {api.group}
              </span>
            ) : null}
          </div>
          {api.description ? (
            <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">{api.description}</div>
          ) : null}
          {implementationGroups.length > 0 ? (
            <div className="mt-2 space-y-2">
              {implementationGroups.map((group) => (
                <div
                  key={`${api.method}:${api.endpoint}:${group.label}`}
                  className="rounded-sm border border-desktop-border/80 bg-desktop-bg-primary px-2.5 py-2"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-desktop-text-secondary">
                    {implementationLabel}: {group.label}
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {group.sourceFiles.map((sourceFile) => (
                      <SimpleSourceFileRow key={`${group.label}:${sourceFile}`} path={sourceFile} compact />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function SimpleSourceFileRow({
  path,
  compact = false,
}: {
  path: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-start gap-2 rounded-sm border border-desktop-border bg-desktop-bg-secondary/20 ${compact ? "px-2 py-1.5" : "px-3 py-2"}`}>
      <FileIcon path={path} />
      <span className="break-all text-[11px] text-desktop-text-primary">{path}</span>
    </div>
  );
}
