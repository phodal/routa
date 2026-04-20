"use client";

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Tag,
  Globe,
  MapPin,
} from "lucide-react";
import type { GitRefsResult, GitRef } from "./types";

interface RefsTreeProps {
  refs: GitRefsResult | null;
  activeBranches: string[];
  onToggleBranch: (name: string) => void;
}

interface TreeNodeProps {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  count?: number;
}

function gitRefKey(gitRef: GitRef): string {
  return gitRef.remote ? `${gitRef.remote}/${gitRef.name}` : gitRef.name;
}

function TreeNode({ label, icon, children, defaultOpen = true, count }: TreeNodeProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-[#1a1d29]"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        {icon}
        <span className="flex-1 text-left">{label}</span>
        {count != null && (
          <span className="text-[10px] font-normal tabular-nums text-slate-400 dark:text-slate-500">
            {count}
          </span>
        )}
      </button>
      {open && <div className="ml-2">{children}</div>}
    </div>
  );
}

function RefItem({
  gitRef,
  active,
  onClick,
}: {
  gitRef: GitRef;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-1.5 rounded px-2 py-0.75 text-left text-[11px] transition-colors ${
        active
          ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#1a1d29]"
      }`}
      title={gitRef.remote ? `${gitRef.remote}/${gitRef.name}` : gitRef.name}
    >
      {gitRef.isCurrent && (
        <MapPin className="h-2.5 w-2.5 shrink-0 text-emerald-500" />
      )}
      <span className="truncate">
        {gitRefKey(gitRef)}
      </span>
    </button>
  );
}

export function RefsTree({ refs, activeBranches, onToggleBranch }: RefsTreeProps) {
  if (!refs) {
    return (
      <div className="px-2 py-4 text-center text-[11px] text-slate-400 dark:text-slate-500">
        Loading…
      </div>
    );
  }
  const headRef = refs.head;

  // Group remote branches by remote name
  const remoteGroups = new Map<string, GitRef[]>();
  for (const r of refs.remote) {
    const remote = r.remote ?? "origin";
    const list = remoteGroups.get(remote) ?? [];
    list.push(r);
    remoteGroups.set(remote, list);
  }

  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto py-1 text-[11px]">
      {/* HEAD */}
      {headRef && (
        <TreeNode
          label="HEAD"
          icon={<MapPin className="h-3 w-3 shrink-0 text-emerald-500" />}
          defaultOpen
        >
          <RefItem
            gitRef={headRef}
            active={activeBranches.includes(gitRefKey(headRef))}
            onClick={() => onToggleBranch(gitRefKey(headRef))}
          />
        </TreeNode>
      )}

      {/* Local branches */}
      <TreeNode
        label="Local"
        icon={<GitBranch className="h-3 w-3 shrink-0 text-blue-500" />}
        count={refs.local.length}
        defaultOpen
      >
        {refs.local.map((r) => (
          <RefItem
            key={r.name}
            gitRef={r}
            active={activeBranches.includes(gitRefKey(r))}
            onClick={() => onToggleBranch(gitRefKey(r))}
          />
        ))}
      </TreeNode>

      {/* Remote branches grouped by remote */}
      <TreeNode
        label="Remote"
        icon={<Globe className="h-3 w-3 shrink-0 text-violet-500" />}
        count={refs.remote.length}
        defaultOpen={false}
      >
        {Array.from(remoteGroups.entries()).map(([remote, branches]) => (
          <TreeNode
            key={remote}
            label={remote}
            icon={<Globe className="h-2.5 w-2.5 shrink-0 text-violet-400" />}
            count={branches.length}
          >
            {branches.map((r) => (
              <RefItem
                key={`${r.remote}/${r.name}`}
                gitRef={r}
                active={activeBranches.includes(gitRefKey(r))}
                onClick={() => onToggleBranch(gitRefKey(r))}
              />
            ))}
          </TreeNode>
        ))}
      </TreeNode>

      {/* Tags */}
      {refs.tags.length > 0 && (
        <TreeNode
          label="Tags"
          icon={<Tag className="h-3 w-3 shrink-0 text-amber-500" />}
          count={refs.tags.length}
          defaultOpen={false}
        >
          {refs.tags.map((r) => (
            <RefItem
              key={r.name}
              gitRef={r}
              active={activeBranches.includes(gitRefKey(r))}
              onClick={() => onToggleBranch(gitRefKey(r))}
            />
          ))}
        </TreeNode>
      )}
    </div>
  );
}
