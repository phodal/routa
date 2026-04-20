"use client";

import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson2,
  FileText,
  Folder,
} from "lucide-react";

import type { FileStat, FileTreeNode } from "./types";

export type TreeNodeStat = {
  changes: number;
  sessions: number;
  updatedAt: string;
};

export function flattenFiles(
  nodes: FileTreeNode[],
  acc: Record<string, FileTreeNode> = {},
): Record<string, FileTreeNode> {
  for (const node of nodes) {
    acc[node.id] = node;
    if (node.children?.length) {
      flattenFiles(node.children, acc);
    }
  }
  return acc;
}

function maxUpdatedAt(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  return right > left ? right : left;
}

export function buildTreeNodeStats(
  nodes: FileTreeNode[],
  fileStats: Record<string, FileStat>,
): Record<string, TreeNodeStat> {
  const statsByNodeId: Record<string, TreeNodeStat> = {};

  const visit = (node: FileTreeNode): TreeNodeStat => {
    if (node.kind === "file") {
      const stat = fileStats[node.path] ?? { changes: 0, sessions: 0, updatedAt: "" };
      statsByNodeId[node.id] = stat;
      return stat;
    }

    const aggregate = node.children.reduce<TreeNodeStat>(
      (acc, child) => {
        const childStat = visit(child);
        return {
          changes: acc.changes + childStat.changes,
          sessions: acc.sessions + childStat.sessions,
          updatedAt: maxUpdatedAt(acc.updatedAt, childStat.updatedAt),
        };
      },
      { changes: 0, sessions: 0, updatedAt: "" },
    );

    statsByNodeId[node.id] = aggregate;
    return aggregate;
  };

  for (const node of nodes) {
    visit(node);
  }

  return statsByNodeId;
}

export function buildSelectableFileIdsByNode(
  nodes: FileTreeNode[],
  acc: Record<string, string[]> = {},
): Record<string, string[]> {
  const visit = (node: FileTreeNode): string[] => {
    if (node.kind === "file") {
      acc[node.id] = [node.id];
      return acc[node.id];
    }

    const descendantFileIds = node.children.flatMap((child) => visit(child));
    acc[node.id] = descendantFileIds;
    return descendantFileIds;
  };

  for (const node of nodes) {
    visit(node);
  }

  return acc;
}

export function formatShortDate(iso: string): string {
  if (!iso || iso === "-") return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

export function TreeNodeRow({
  node,
  depth,
  expandedIds,
  activeFileId,
  selectedFileIds,
  treeNodeStats,
  selectableFileIdsByNode,
  onToggleNode,
  onToggleNodeSelection,
  onSetActiveFile,
}: {
  node: FileTreeNode;
  depth: number;
  expandedIds: Record<string, boolean>;
  activeFileId: string;
  selectedFileIds: string[];
  treeNodeStats: Record<string, TreeNodeStat>;
  selectableFileIdsByNode: Record<string, string[]>;
  onToggleNode: (nodeId: string) => void;
  onToggleNodeSelection: (nodeId: string) => void;
  onSetActiveFile: (fileId: string) => void;
}) {
  const paddingLeft = 12 + depth * 16;
  const stat = treeNodeStats[node.id];

  if (node.kind === "folder") {
    const isExpanded = expandedIds[node.id] ?? true;
    const descendantFileIds = selectableFileIdsByNode[node.id] ?? [];
    const isSelected = descendantFileIds.length > 0 && descendantFileIds.every((fileId) => selectedFileIds.includes(fileId));

    return (
      <>
        <div className="grid grid-cols-[minmax(0,1fr)_56px_72px_96px] items-center px-3 py-1 text-xs text-desktop-text-primary">
          <div className="flex items-center gap-1.5" style={{ paddingLeft }}>
            <input
              type="checkbox"
              data-testid={`feature-tree-select-${node.id}`}
              checked={isSelected}
              onChange={() => onToggleNodeSelection(node.id)}
              className="h-3.5 w-3.5 rounded border-black/15 bg-transparent dark:border-white/20"
            />
            <button
              onClick={() => onToggleNode(node.id)}
              className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-desktop-bg-active"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-desktop-text-secondary" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-desktop-text-secondary" />
              )}
              <Folder className="h-3.5 w-3.5 text-amber-400" />
              <span className="truncate text-[12px]">{node.name}</span>
            </button>
          </div>
          <div data-testid={`feature-tree-changes-${node.id}`} className="text-[11px] text-desktop-text-secondary">
            {stat?.changes ? stat.changes : "-"}
          </div>
          <div data-testid={`feature-tree-sessions-${node.id}`} className="text-[11px] text-desktop-text-secondary">
            {stat?.sessions ? stat.sessions : "-"}
          </div>
          <div data-testid={`feature-tree-updated-${node.id}`} className="text-[11px] text-desktop-text-secondary">
            {stat?.updatedAt ? formatShortDate(stat.updatedAt) : "-"}
          </div>
        </div>

        {isExpanded &&
          node.children?.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              activeFileId={activeFileId}
              selectedFileIds={selectedFileIds}
              treeNodeStats={treeNodeStats}
              selectableFileIdsByNode={selectableFileIdsByNode}
              onToggleNode={onToggleNode}
              onToggleNodeSelection={onToggleNodeSelection}
              onSetActiveFile={onSetActiveFile}
            />
          ))}
      </>
    );
  }

  const isActive = activeFileId === node.id;
  const isSelected = selectedFileIds.includes(node.id);

  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_56px_72px_96px] items-center px-3 py-1 text-xs transition-colors ${
        isActive ? "bg-desktop-bg-active" : "hover:bg-desktop-bg-secondary/40"
      }`}
    >
      <div className="flex items-center gap-1.5" style={{ paddingLeft }}>
        <input
          type="checkbox"
          data-testid={`feature-tree-select-${node.id}`}
          checked={isSelected}
          onChange={() => onToggleNodeSelection(node.id)}
          className="h-3.5 w-3.5 rounded border-black/15 bg-transparent dark:border-white/20"
        />
        <button
          type="button"
          data-testid={`feature-tree-activate-${node.id}`}
          onClick={() => onSetActiveFile(node.id)}
          className="flex min-w-0 items-center gap-1.5 text-left"
        >
          <FileIcon path={node.path} />
          <span className="truncate text-[12px] text-desktop-text-primary">{node.name}</span>
        </button>
      </div>
      <div className="text-[11px] text-desktop-text-secondary">{stat?.changes ?? "-"}</div>
      <div className="text-[11px] text-desktop-text-secondary">{stat?.sessions ?? "-"}</div>
      <div className="text-[11px] text-desktop-text-secondary">{stat?.updatedAt ? formatShortDate(stat.updatedAt) : "-"}</div>
    </div>
  );
}

export function FileIcon({ path }: { path: string }) {
  if (path.endsWith(".json")) return <FileJson2 className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
  if (path.endsWith(".md")) return <FileText className="h-3.5 w-3.5 shrink-0 text-violet-400" />;
  return <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />;
}
