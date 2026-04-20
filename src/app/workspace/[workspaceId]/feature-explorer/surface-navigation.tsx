"use client";

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

export type SurfaceNavigationView = "capabilities" | "surfaces" | "apis" | "paths";

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
      const nodeId = `${parentId}/${segment}`;
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
          itemCount: (node.item ? 1 : 0) + children.reduce((sum, child) => sum + child.itemCount, 0),
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

export function getHttpMethodBadgeClass(method: string, density: "default" | "compact" = "default"): string {
  const sizeClass = density === "compact"
    ? "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-semibold"
    : "inline-flex items-center rounded-sm px-2 py-0.5 text-[10px] font-semibold";

  const toneClass = (() => {
    switch (method.trim().toUpperCase()) {
      case "GET":
        return "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/80 dark:bg-emerald-950/40 dark:text-emerald-200";
      case "POST":
        return "border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/80 dark:bg-sky-950/40 dark:text-sky-200";
      case "PUT":
        return "border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/80 dark:bg-indigo-950/40 dark:text-indigo-200";
      case "PATCH":
        return "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/80 dark:bg-amber-950/40 dark:text-amber-200";
      case "DELETE":
        return "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/80 dark:bg-rose-950/40 dark:text-rose-200";
      case "OPTIONS":
        return "border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200";
      case "HEAD":
        return "border border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/80 dark:bg-violet-950/40 dark:text-violet-200";
      default:
        return "border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200";
    }
  })();

  return `${sizeClass} ${toneClass}`;
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
                className={getHttpMethodBadgeClass(badge, density)}
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
  const paddingLeft = 8 + depth * 16;
  const isExpanded = expandedIds[node.id] ?? depth < defaultExpandedDepth;
  const isBranch = node.children.length > 0;
  const isSelectable = Boolean(node.item);
  const isActive = node.item?.key === activeSurfaceKey;
  const countLabel = isBranch ? String(node.itemCount) : "";
  const mappingLabel = node.item && node.item.kind !== "feature" && node.item.featureIds.length === 0
    ? unmappedLabel
    : "";
  const badges = node.item?.badges ?? [];
  const metrics = node.item?.metrics ?? [];
  const chipClass = "inline-flex items-center rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5 text-[9px] font-medium text-current/80";
  const toggleClass = isBranch
    ? "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border border-desktop-border bg-desktop-bg-primary font-mono text-[10px] text-desktop-text-secondary hover:text-desktop-text-primary"
    : "inline-flex h-4 w-4 shrink-0";

  return (
    <>
      <div
        className={`flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[11px] transition-colors ${
          isActive
            ? "bg-desktop-bg-active text-desktop-text-primary"
            : "text-desktop-text-secondary hover:bg-desktop-bg-primary/70 hover:text-desktop-text-primary"
        }`}
        style={{ paddingLeft }}
      >
        {isBranch ? (
          <button
            type="button"
            onClick={() => onToggleNode(node.id)}
            className={toggleClass}
            aria-label={isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
          >
            {isExpanded ? "-" : "+"}
          </button>
        ) : (
          <span className={toggleClass} aria-hidden="true" />
        )}
        {isSelectable ? (
          <button
            type="button"
            onClick={() => onSelectSurface(node.item!)}
            aria-label={node.item?.label ?? node.label}
            className={`min-w-0 flex-1 text-left ${
              isActive ? "text-desktop-text-primary" : "text-current"
            }`}
            title={node.item?.label ?? node.label}
          >
            <div className="flex min-w-0 items-start gap-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{node.label}</div>
                {node.item?.secondary ? (
                  <div className="truncate text-[10px] font-normal text-current/70">
                    {node.item.secondary}
                  </div>
                ) : null}
              </div>
            </div>
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate font-medium" title={node.label}>
            {node.label}
          </span>
        )}
        {badges.length || metrics.length || mappingLabel || countLabel ? (
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
            {badges.map((badge) => (
              <span key={badge} className={getHttpMethodBadgeClass(badge, "compact")}>
                {badge}
              </span>
            ))}
            {metrics.map((metric) => (
              <span key={metric.id} data-testid={metric.testId} className={chipClass}>
                {metric.value} {metric.label}
              </span>
            ))}
            {mappingLabel ? (
              <span className={chipClass}>{mappingLabel}</span>
            ) : null}
            {countLabel ? (
              <span className={chipClass}>{countLabel}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      {isBranch && isExpanded ? (
        <div className="space-y-0.5">
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
