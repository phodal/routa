"use client";

import { ChevronDown, ChevronRight, Folder } from "lucide-react";

export type ExplorerSurfaceKind = "feature" | "page" | "contract-api" | "nextjs-api" | "rust-api";

export type ExplorerSurfaceMetric = {
  id: string;
  label: string;
  value: string;
  testId?: string;
};

export type ExplorerSurfaceItem = {
  key: string;
  kind: ExplorerSurfaceKind;
  label: string;
  secondary: string;
  badges?: string[];
  featureIds: string[];
  sourceFiles: string[];
  metrics?: ExplorerSurfaceMetric[];
  selectable: boolean;
};

export type ExplorerSection = {
  id: string;
  title: string;
  items: ExplorerSurfaceItem[];
  metrics?: ExplorerSurfaceMetric[];
};

export type SurfaceNavigationView = "sections" | "browser-url" | "nextjs-api" | "rust-api" | "path";

export type SurfaceTreeNode = {
  id: string;
  label: string;
  item?: ExplorerSurfaceItem;
  children: SurfaceTreeNode[];
  itemCount: number;
};

export function buildApiDeclaration(method: string, endpointPath: string): string {
  return `${method.trim().toUpperCase()} ${endpointPath.trim()}`.trim();
}

export function buildApiLookupKey(method: string, endpointPath: string): string {
  const normalizedPath = endpointPath
    .trim()
    .replace(/:[A-Za-z0-9_]+/g, "{}")
    .replace(/\{[^}]+\}/g, "{}");
  return `${method.trim().toUpperCase()} ${normalizedPath}`;
}

export function parseApiDeclaration(declaration: string): { method: string; path: string } {
  const [method, endpointPath] = declaration.trim().split(/\s+/, 2);
  return {
    method: method || "GET",
    path: endpointPath || declaration.trim(),
  };
}

export function matchesQuery(query: string, values: Array<string | undefined>): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return values.some((value) => value?.toLowerCase().includes(normalized));
}

export function dedupeFeatureIds(featureIds: string[]): string[] {
  return [...new Set(featureIds.filter(Boolean))];
}

export function splitBrowserRouteSegments(route: string): string[] {
  if (route === "/") {
    return ["/"];
  }

  return route
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment, index) => (index === 0 ? `/${segment}` : segment));
}

export function splitApiRouteSegments(declaration: string): string[] {
  const normalizedPath = declaration.trim().startsWith("/")
    ? declaration.trim()
    : parseApiDeclaration(declaration).path;
  const rawSegments = normalizedPath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const logicalSegments = rawSegments[0] === "api" && rawSegments.length > 1
    ? rawSegments.slice(1)
    : rawSegments;
  const pathSegments = logicalSegments.map((segment, index) => (index === 0 ? `/${segment}` : segment));

  return pathSegments;
}

export function splitPathSegments(sourcePath: string): string[] {
  return sourcePath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function buildSurfaceTree(
  entries: Array<{ nodeId: string; segments: string[]; item: ExplorerSurfaceItem }>,
): SurfaceTreeNode[] {
  type MutableSurfaceTreeNode = {
    id: string;
    label: string;
    item?: ExplorerSurfaceItem;
    children: Map<string, MutableSurfaceTreeNode>;
  };

  const roots = new Map<string, MutableSurfaceTreeNode>();

  for (const entry of entries) {
    if (entry.segments.length === 0) {
      roots.set(entry.nodeId, {
        id: entry.nodeId,
        label: entry.item.label,
        item: entry.item,
        children: new Map(),
      });
      continue;
    }

    let level = roots;
    let parentId = "root";

    for (const [index, segment] of entry.segments.entries()) {
      const isLeaf = index === entry.segments.length - 1;
      const nodeId = `${parentId}/${segment}:${isLeaf ? entry.nodeId : index}`;
      const existing = level.get(nodeId);

      if (existing) {
        if (isLeaf) {
          existing.item = entry.item;
        }
        level = existing.children;
        parentId = nodeId;
        continue;
      }

      const created: MutableSurfaceTreeNode = {
        id: nodeId,
        label: segment,
        ...(isLeaf ? { item: entry.item } : {}),
        children: new Map(),
      };
      level.set(nodeId, created);
      level = created.children;
      parentId = nodeId;
    }
  }

  const finalize = (nodes: Map<string, MutableSurfaceTreeNode>): SurfaceTreeNode[] =>
    [...nodes.values()]
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((node) => {
        const children = finalize(node.children);
        return {
          id: node.id,
          label: node.label,
          ...(node.item ? { item: node.item } : {}),
          children,
          itemCount: node.item ? 1 : children.reduce((sum, child) => sum + child.itemCount, 0),
        };
      });

  return finalize(roots);
}

function sortHttpMethods(left: string, right: string): number {
  const methodOrder = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];
  const leftIndex = methodOrder.indexOf(left);
  const rightIndex = methodOrder.indexOf(right);
  if (leftIndex === -1 && rightIndex === -1) {
    return left.localeCompare(right);
  }
  if (leftIndex === -1) {
    return 1;
  }
  if (rightIndex === -1) {
    return -1;
  }
  return leftIndex - rightIndex;
}

export function buildGroupedApiItems({
  kind,
  apis,
  query,
  resolveFeatureIds,
}: {
  kind: Extract<ExplorerSurfaceKind, "contract-api" | "nextjs-api" | "rust-api">;
  apis: Array<{
    method: string;
    path: string;
    domain?: string;
    summary?: string;
    sourceFiles?: string[];
  }>;
  query: string;
  resolveFeatureIds: (method: string, path: string) => string[];
}): ExplorerSurfaceItem[] {
  const groups = new Map<string, {
    path: string;
    methods: Set<string>;
    featureIds: Set<string>;
    sourceFiles: Set<string>;
    searchValues: Set<string>;
  }>();

  for (const api of apis) {
    const path = api.path.trim();
    const method = api.method.trim().toUpperCase();
    const group = groups.get(path) ?? {
      path,
      methods: new Set<string>(),
      featureIds: new Set<string>(),
      sourceFiles: new Set<string>(),
      searchValues: new Set<string>(),
    };

    group.methods.add(method);
    for (const featureId of resolveFeatureIds(method, path)) {
      group.featureIds.add(featureId);
    }
    for (const sourceFile of api.sourceFiles ?? []) {
      group.sourceFiles.add(sourceFile);
    }
    for (const value of [api.domain, api.summary]) {
      if (value) {
        group.searchValues.add(value);
      }
    }

    groups.set(path, group);
  }

  return [...groups.values()]
    .filter((group) => matchesQuery(query, [group.path, ...group.methods, ...group.sourceFiles, ...group.searchValues]))
    .map((group) => {
      const badges = [...group.methods].sort(sortHttpMethods);
      return {
        key: `${kind}:${group.path}`,
        kind,
        label: group.path,
        secondary: badges.join(", "),
        badges,
        featureIds: dedupeFeatureIds([...group.featureIds]),
        sourceFiles: [...group.sourceFiles].sort((left, right) => left.localeCompare(right)),
        selectable: true,
      } satisfies ExplorerSurfaceItem;
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function surfaceKindBadge(kind: ExplorerSurfaceKind): string {
  switch (kind) {
    case "feature":
      return "FT";
    case "page":
      return "PG";
    case "contract-api":
      return "API";
    case "nextjs-api":
      return "NX";
    case "rust-api":
      return "RS";
  }
}

export function ExplorerSurfaceCard({
  item,
  isActive,
  onSelect,
  unmappedLabel,
  labelOverride,
  density = "default",
}: {
  item: ExplorerSurfaceItem;
  isActive: boolean;
  onSelect: () => void;
  unmappedLabel: string;
  labelOverride?: string;
  density?: "default" | "compact";
}) {
  const mappingLabel = item.kind !== "feature" && item.featureIds.length === 0 ? unmappedLabel : "";
  const chipClass = density === "compact"
    ? "inline-flex items-center rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5 text-[9px] font-medium text-current/80"
    : "inline-flex items-center rounded-sm border border-desktop-border bg-desktop-bg-primary px-2 py-0.5 text-[10px] font-medium text-current/80";
  const methodChipClass = density === "compact"
    ? "inline-flex items-center rounded-sm border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[9px] font-semibold text-sky-700 dark:border-sky-900/80 dark:bg-sky-950/40 dark:text-sky-200"
    : "inline-flex items-center rounded-sm border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:border-sky-900/80 dark:bg-sky-950/40 dark:text-sky-200";

  return (
    <button
      onClick={onSelect}
      title={labelOverride ?? item.label}
      className={`w-full rounded-sm border px-2.5 ${density === "compact" ? "py-0.5" : "py-1"} text-left transition-colors ${
        isActive
          ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
          : "border-transparent text-desktop-text-secondary hover:border-desktop-border hover:bg-desktop-bg-primary/70 hover:text-desktop-text-primary"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-[12px] font-medium">
          {labelOverride ?? item.label}
        </div>
        {item.badges?.length || item.metrics?.length || mappingLabel ? (
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
            {item.badges?.map((badge) => (
              <span
                key={badge}
                className={methodChipClass}
              >
                {badge}
              </span>
            ))}
            {item.metrics?.map((metric) => (
              <span
                key={metric.id}
                data-testid={metric.testId}
                className={chipClass}
              >
                {metric.value} {metric.label}
              </span>
            ))}
            {mappingLabel ? (
              <span className={chipClass}>{mappingLabel}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </button>
  );
}

export function SurfaceTreeRow({
  node,
  depth,
  activeSurfaceKey,
  expandedIds,
  onSelectSurface,
  onToggleNode,
  unmappedLabel,
  defaultExpandedDepth = Number.POSITIVE_INFINITY,
}: {
  node: SurfaceTreeNode;
  depth: number;
  activeSurfaceKey: string;
  expandedIds: Record<string, boolean>;
  onSelectSurface: (item: ExplorerSurfaceItem) => void;
  onToggleNode: (nodeId: string) => void;
  unmappedLabel: string;
  defaultExpandedDepth?: number;
}) {
  const paddingLeft = 8 + depth * 14;

  if (!node.item) {
    const isExpanded = expandedIds[node.id] ?? depth < defaultExpandedDepth;

    return (
      <>
        <button
          type="button"
          onClick={() => onToggleNode(node.id)}
          className="flex w-full items-center gap-1.5 rounded-sm px-2 py-0.5 text-left text-[11px] font-medium text-desktop-text-secondary hover:bg-desktop-bg-primary/70 hover:text-desktop-text-primary"
          style={{ paddingLeft }}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <Folder className="h-3.5 w-3.5 text-amber-400" />
          <span className="truncate">{node.label}</span>
          <span className="ml-auto rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5 text-[9px] font-medium text-current/80">
            {node.itemCount}
          </span>
        </button>
        {isExpanded ? (
          <div className="space-y-1">
            {node.children.map((child) => (
              <SurfaceTreeRow
                key={child.id}
                node={child}
                depth={depth + 1}
                activeSurfaceKey={activeSurfaceKey}
                expandedIds={expandedIds}
                onSelectSurface={onSelectSurface}
                onToggleNode={onToggleNode}
                unmappedLabel={unmappedLabel}
                defaultExpandedDepth={defaultExpandedDepth}
              />
            ))}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div style={{ paddingLeft }}>
      <ExplorerSurfaceCard
        item={node.item}
        isActive={node.item.key === activeSurfaceKey}
        onSelect={() => onSelectSurface(node.item!)}
        unmappedLabel={unmappedLabel}
        labelOverride={node.label}
        density="compact"
      />
    </div>
  );
}
