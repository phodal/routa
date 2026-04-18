"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Braces,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson2,
  FileText,
  FlaskConical,
  Folder,
  ImageIcon,
  Search,
} from "lucide-react";

import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { loadRepoSelection, saveRepoSelection } from "@/client/utils/repo-selection-storage";
import { useTranslation } from "@/i18n";

import type {
  ApiDetail,
  CapabilityGroup,
  FeatureDetail,
  FeatureSurfacePage,
  FileTreeNode,
  InspectorTab,
} from "./types";
import {
  type ExplorerSection,
  type ExplorerSurfaceItem,
  type SurfaceNavigationView,
  type SurfaceTreeNode,
  ExplorerSurfaceCard,
  SurfaceTreeRow,
  buildGroupedApiItems,
  buildApiLookupKey,
  buildSurfaceTree,
  dedupeFeatureIds,
  matchesQuery,
  parseApiDeclaration,
  splitApiRouteSegments,
  splitBrowserRouteSegments,
  splitPathSegments,
  surfaceKindBadge,
} from "./surface-navigation";
import { useFeatureExplorerData } from "./use-feature-explorer-data";

function loadInitialRepoSelection(workspaceId: string): RepoSelection | null {
  return loadRepoSelection("featureExplorer", workspaceId);
}

function flattenFiles(nodes: FileTreeNode[], acc: Record<string, FileTreeNode> = {}): Record<string, FileTreeNode> {
  for (const node of nodes) {
    acc[node.id] = node;
    if (node.children?.length) {
      flattenFiles(node.children, acc);
    }
  }
  return acc;
}

type TreeNodeStat = {
  changes: number;
  sessions: number;
  updatedAt: string;
};

function maxUpdatedAt(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  return right > left ? right : left;
}

function buildTreeNodeStats(
  nodes: FileTreeNode[],
  fileStats: Record<string, { changes: number; sessions: number; updatedAt: string }>,
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

function formatShortDate(iso: string): string {
  if (!iso || iso === "-") return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

function humanizeImplementationLabel(label: string): string {
  if (!label) {
    return "Implementation";
  }
  if (label === "nextjs") {
    return "Next.js";
  }
  if (label === "springMvc") {
    return "Spring MVC";
  }

  return label
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function FeatureExplorerPageClient({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const workspacesHook = useWorkspaces();
  const { codebases } = useCodebases(workspaceId);

  const workspace = workspacesHook.workspaces.find((item) => item.id === workspaceId) ?? null;
  const workspaceRepos = useMemo(
    () =>
      codebases.map((codebase) => ({
        name: codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath,
        path: codebase.repoPath,
        branch: codebase.branch ?? "",
      })),
    [codebases],
  );
  const [repoSelectionOverrides, setRepoSelectionOverrides] = useState<Record<string, RepoSelection | null>>(() => {
    const initialSelection = loadInitialRepoSelection(workspaceId);
    return initialSelection ? { [workspaceId]: initialSelection } : {};
  });
  const hasRepoSelectionOverride = Object.prototype.hasOwnProperty.call(repoSelectionOverrides, workspaceId);
  const manualRepoSelection = hasRepoSelectionOverride
    ? (repoSelectionOverrides[workspaceId] ?? null)
    : loadInitialRepoSelection(workspaceId);
  const fallbackRepoSelection = workspaceRepos[0] ?? null;
  const effectiveRepoSelection = manualRepoSelection ?? fallbackRepoSelection;
  const repoRefreshKey = `${effectiveRepoSelection?.path ?? ""}:${effectiveRepoSelection?.branch ?? ""}`;

  useEffect(() => {
    saveRepoSelection("featureExplorer", workspaceId, manualRepoSelection);
  }, [manualRepoSelection, workspaceId]);

  const {
    loading,
    error,
    capabilityGroups,
    features,
    surfaceIndex,
    featureDetail,
    featureDetailLoading,
    initialFeatureId,
    fetchFeatureDetail,
  } = useFeatureExplorerData({
    workspaceId,
    repoPath: effectiveRepoSelection?.path,
    refreshKey: repoRefreshKey,
  });

  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("context");
  const [middleView, setMiddleView] = useState<"list" | "tree">("tree");
  const [surfaceNavigationView, setSurfaceNavigationView] = useState<SurfaceNavigationView>("sections");
  const [featureId, setFeatureId] = useState<string>("");
  const [selectedSurfaceKey, setSelectedSurfaceKey] = useState<string>("");
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [surfaceSectionCollapsed, setSurfaceSectionCollapsed] = useState<Record<string, boolean>>({});
  const [surfaceTreeExpandedIds, setSurfaceTreeExpandedIds] = useState<Record<string, boolean>>({});
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [activeFileId, setActiveFileId] = useState<string>("");

  // Derive effective feature ID: user-selected or auto-initialized from hook
  const effectiveFeatureId = featureId || initialFeatureId;
  const featureMetadata = useMemo(
    () => surfaceIndex.metadata?.features ?? [],
    [surfaceIndex.metadata],
  );
  const featureSummaryById = useMemo(
    () => new Map(features.map((feature) => [feature.id, feature])),
    [features],
  );
  const featureMetadataById = useMemo(
    () => new Map(featureMetadata.map((feature) => [feature.id, feature])),
    [featureMetadata],
  );
  const pageFeatureMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const metadataItem of featureMetadata) {
      for (const route of metadataItem.pages ?? []) {
        const current = map.get(route) ?? [];
        current.push(metadataItem.id);
        map.set(route, current);
      }
    }
    for (const page of surfaceIndex.pages) {
      if (!page.sourceFile) {
        continue;
      }
      for (const metadataItem of featureMetadata) {
        if (!(metadataItem.sourceFiles ?? []).includes(page.sourceFile)) {
          continue;
        }
        const current = map.get(page.route) ?? [];
        current.push(metadataItem.id);
        map.set(page.route, current);
      }
    }
    return map;
  }, [featureMetadata, surfaceIndex.pages]);
  const apiFeatureMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const metadataItem of featureMetadata) {
      for (const declaration of metadataItem.apis ?? []) {
        const parsedDeclaration = parseApiDeclaration(declaration);
        const lookupKey = buildApiLookupKey(parsedDeclaration.method, parsedDeclaration.path);
        const current = map.get(lookupKey) ?? [];
        current.push(metadataItem.id);
        map.set(lookupKey, current);
      }
    }

    for (const implementationApi of [...surfaceIndex.nextjsApis, ...surfaceIndex.rustApis]) {
      const lookupKey = buildApiLookupKey(implementationApi.method, implementationApi.path);
      for (const metadataItem of featureMetadata) {
        if (!(metadataItem.sourceFiles ?? []).some((sourceFile) => implementationApi.sourceFiles.includes(sourceFile))) {
          continue;
        }
        const current = map.get(lookupKey) ?? [];
        current.push(metadataItem.id);
        map.set(lookupKey, current);
      }
    }
    return map;
  }, [featureMetadata, surfaceIndex.nextjsApis, surfaceIndex.rustApis]);

  const featureItems = useMemo<ExplorerSurfaceItem[]>(
    () => features
      .filter((feature) => matchesQuery(query, [feature.name, feature.summary, feature.id]))
      .sort((left, right) => {
        if (right.sessionCount !== left.sessionCount) {
          return right.sessionCount - left.sessionCount;
        }
        if (right.changedFiles !== left.changedFiles) {
          return right.changedFiles - left.changedFiles;
        }
        return left.name.localeCompare(right.name);
      })
      .map((feature): ExplorerSurfaceItem => {
        const metadataItem = featureMetadataById.get(feature.id);
        const sourceFiles = metadataItem?.sourceFiles ?? [];
        return {
          key: `feature:${feature.id}`,
          kind: "feature",
          label: feature.name,
          secondary: capabilityGroups.find((group) => group.id === feature.group)?.name ?? feature.group,
          featureIds: [feature.id],
          sourceFiles,
          metrics: [
            {
              id: "sessions",
              label: t.featureExplorer.sessionsLabel,
              value: String(feature.sessionCount),
              testId: `feature-metric-sessions-${feature.id}`,
            },
            {
              id: "files",
              label: t.featureExplorer.filesLabel,
              value: String(feature.changedFiles),
              testId: `feature-metric-files-${feature.id}`,
            },
          ],
          selectable: true,
        };
      }),
    [capabilityGroups, featureMetadataById, features, query, t.featureExplorer.filesLabel, t.featureExplorer.sessionsLabel],
  );
  const pageItems = useMemo<ExplorerSurfaceItem[]>(
    () => surfaceIndex.pages
      .filter((page) => matchesQuery(query, [page.route, page.title, page.description, page.sourceFile]))
      .map((page: FeatureSurfacePage): ExplorerSurfaceItem => {
        const featureIds = dedupeFeatureIds(pageFeatureMap.get(page.route) ?? []);
        return {
          key: `page:${page.route}`,
          kind: "page",
          label: page.route,
          secondary: page.title || page.sourceFile,
          featureIds,
          sourceFiles: page.sourceFile ? [page.sourceFile] : [],
          selectable: true,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
    [pageFeatureMap, query, surfaceIndex.pages],
  );
  const contractApiItems = useMemo<ExplorerSurfaceItem[]>(
    () => buildGroupedApiItems({
      kind: "contract-api",
      apis: surfaceIndex.contractApis,
      query,
      resolveFeatureIds: (method, path) => dedupeFeatureIds(apiFeatureMap.get(buildApiLookupKey(method, path)) ?? []),
    }),
    [apiFeatureMap, query, surfaceIndex.contractApis],
  );
  const nextjsApiItems = useMemo<ExplorerSurfaceItem[]>(
    () => buildGroupedApiItems({
      kind: "nextjs-api",
      apis: surfaceIndex.nextjsApis,
      query,
      resolveFeatureIds: (method, path) => dedupeFeatureIds(apiFeatureMap.get(buildApiLookupKey(method, path)) ?? []),
    }),
    [apiFeatureMap, query, surfaceIndex.nextjsApis],
  );
  const rustApiItems = useMemo<ExplorerSurfaceItem[]>(
    () => buildGroupedApiItems({
      kind: "rust-api",
      apis: surfaceIndex.rustApis,
      query,
      resolveFeatureIds: (method, path) => dedupeFeatureIds(apiFeatureMap.get(buildApiLookupKey(method, path)) ?? []),
    }),
    [apiFeatureMap, query, surfaceIndex.rustApis],
  );
  const explorerSections = useMemo<ExplorerSection[]>(
    () => [
      {
        id: "features",
        title: t.featureExplorer.featureSection,
        items: featureItems,
        metrics: [
          {
            id: "sessions",
            label: t.featureExplorer.sessionsLabel,
            value: String(
              featureItems.reduce(
                (sum, item) => sum + (featureSummaryById.get(item.featureIds[0] ?? "")?.sessionCount ?? 0),
                0,
              ),
            ),
            testId: "feature-section-metric-sessions",
          },
        ],
      },
      { id: "pages", title: t.featureExplorer.pageSection, items: pageItems },
      { id: "contract-apis", title: t.featureExplorer.contractApiSection, items: contractApiItems },
      { id: "nextjs-apis", title: t.featureExplorer.nextjsApiSection, items: nextjsApiItems },
      { id: "rust-apis", title: t.featureExplorer.rustApiSection, items: rustApiItems },
    ].filter((section) => section.items.length > 0),
    [
      contractApiItems,
      featureItems,
      featureSummaryById,
      nextjsApiItems,
      pageItems,
      rustApiItems,
      t.featureExplorer.contractApiSection,
      t.featureExplorer.featureSection,
      t.featureExplorer.nextjsApiSection,
      t.featureExplorer.pageSection,
      t.featureExplorer.rustApiSection,
      t.featureExplorer.sessionsLabel,
    ],
  );
  const surfaceNavigationOptions = useMemo(
    () => [
      { id: "sections" as const, label: t.featureExplorer.sectionView },
      { id: "browser-url" as const, label: t.featureExplorer.browserUrlView },
      { id: "nextjs-api" as const, label: t.featureExplorer.nextjsApiSection },
      { id: "rust-api" as const, label: t.featureExplorer.rustApiSection },
      { id: "path" as const, label: t.featureExplorer.pathView },
    ],
    [
      t.featureExplorer.browserUrlView,
      t.featureExplorer.nextjsApiSection,
      t.featureExplorer.pathView,
      t.featureExplorer.rustApiSection,
      t.featureExplorer.sectionView,
    ],
  );
  const surfaceTreeSection = useMemo(() => {
    if (surfaceNavigationView === "sections") {
      return null;
    }

    if (surfaceNavigationView === "browser-url") {
      return {
        id: "browser-url",
        title: t.featureExplorer.browserUrlView,
        nodes: buildSurfaceTree(
          pageItems.map((item) => ({
            nodeId: item.key,
            segments: splitBrowserRouteSegments(item.label),
            item,
          })),
        ),
      };
    }

    if (surfaceNavigationView === "nextjs-api") {
      return {
        id: "nextjs-api-tree",
        title: t.featureExplorer.nextjsApiSection,
        nodes: buildSurfaceTree(
          nextjsApiItems.map((item) => ({
            nodeId: item.key,
            segments: splitApiRouteSegments(item.label),
            item,
          })),
        ),
      };
    }

    if (surfaceNavigationView === "rust-api") {
      return {
        id: "rust-api-tree",
        title: t.featureExplorer.rustApiSection,
        nodes: buildSurfaceTree(
          rustApiItems.map((item) => ({
            nodeId: item.key,
            segments: splitApiRouteSegments(item.label),
            item,
          })),
        ),
      };
    }

    return {
      id: "path-tree",
      title: t.featureExplorer.pathView,
      nodes: buildSurfaceTree(
        [...pageItems, ...contractApiItems, ...nextjsApiItems, ...rustApiItems].flatMap((item) => {
          const sourcePaths = item.sourceFiles.length > 0 ? item.sourceFiles : [item.label];
          return sourcePaths.map((sourcePath) => ({
            nodeId: `${item.key}:${sourcePath}`,
            segments: [...splitPathSegments(sourcePath), item.label],
            item,
          }));
        }),
      ),
    };
  }, [
    contractApiItems,
    nextjsApiItems,
    pageItems,
    rustApiItems,
    surfaceNavigationView,
    t.featureExplorer.browserUrlView,
    t.featureExplorer.nextjsApiSection,
    t.featureExplorer.pathView,
    t.featureExplorer.rustApiSection,
  ]);
  const sectionTreeNodesById = useMemo<Record<string, SurfaceTreeNode[]>>(
    () => ({
      pages: buildSurfaceTree(
        pageItems.map((item) => ({
          nodeId: item.key,
          segments: splitBrowserRouteSegments(item.label),
          item,
        })),
      ),
      "contract-apis": buildSurfaceTree(
        contractApiItems.map((item) => ({
          nodeId: item.key,
          segments: splitApiRouteSegments(item.label),
          item,
        })),
      ),
      "nextjs-apis": buildSurfaceTree(
        nextjsApiItems.map((item) => ({
          nodeId: item.key,
          segments: splitApiRouteSegments(item.label),
          item,
        })),
      ),
      "rust-apis": buildSurfaceTree(
        rustApiItems.map((item) => ({
          nodeId: item.key,
          segments: splitApiRouteSegments(item.label),
          item,
        })),
      ),
    }),
    [contractApiItems, nextjsApiItems, pageItems, rustApiItems],
  );
  const explorerItemsByKey = useMemo(() => {
    const treeItems = surfaceTreeSection
      ? (function collect(nodes: SurfaceTreeNode[], acc: ExplorerSurfaceItem[] = []): ExplorerSurfaceItem[] {
          for (const node of nodes) {
            if (node.item) {
              acc.push(node.item);
            }
            if (node.children.length > 0) {
              collect(node.children, acc);
            }
          }
          return acc;
        }(surfaceTreeSection.nodes))
      : [];
    const entries = [...explorerSections.flatMap((section) => section.items), ...treeItems]
      .map((item) => [item.key, item] as const);
    return new Map(entries);
  }, [explorerSections, surfaceTreeSection]);
  const resolvedSurfaceKey = selectedSurfaceKey && explorerItemsByKey.has(selectedSurfaceKey)
    ? selectedSurfaceKey
    : (effectiveFeatureId ? `feature:${effectiveFeatureId}` : "");

  const selectedSurface = useMemo(() => {
    if (resolvedSurfaceKey) {
      return explorerItemsByKey.get(resolvedSurfaceKey) ?? null;
    }
    return null;
  }, [explorerItemsByKey, resolvedSurfaceKey]);
  const surfaceOnlySelection = Boolean(
    selectedSurface && selectedSurface.kind !== "feature" && selectedSurface.featureIds.length === 0,
  );

  const fileTree = useMemo(() => (surfaceOnlySelection ? [] : featureDetail?.fileTree ?? []), [featureDetail, surfaceOnlySelection]);
  const fileStats = useMemo(
    () => (surfaceOnlySelection ? {} : featureDetail?.fileStats ?? {}),
    [featureDetail, surfaceOnlySelection],
  );
  const flatMap = useMemo(() => flattenFiles(fileTree), [fileTree]);
  const treeNodeStats = useMemo(() => buildTreeNodeStats(fileTree, fileStats), [fileTree, fileStats]);

  // Flat file list sorted by sessions desc, then changes desc
  const sessionSortedFiles = useMemo(() => {
    const leafFiles = Object.values(flatMap).filter((n) => n.kind === "file");
    return leafFiles.sort((a, b) => {
      const sa = fileStats[a.path];
      const sb = fileStats[b.path];
      const sessionsA = sa?.sessions ?? 0;
      const sessionsB = sb?.sessions ?? 0;
      if (sessionsB !== sessionsA) return sessionsB - sessionsA;
      const changesA = sa?.changes ?? 0;
      const changesB = sb?.changes ?? 0;
      return changesB - changesA;
    });
  }, [flatMap, fileStats]);

  const activeFile = flatMap[activeFileId] ?? null;
  const activeFeature = features.find((f) => f.id === effectiveFeatureId);
  const activeGroup = activeFeature
    ? capabilityGroups.find((group) => group.id === activeFeature.group) ?? null
    : null;
  const activeSurfaceKey = selectedSurface?.key ?? (effectiveFeatureId ? `feature:${effectiveFeatureId}` : "");
  const selectedSurfaceFeatureNames = useMemo(
    () => (selectedSurface?.featureIds ?? []).map(
      (id) => featureSummaryById.get(id)?.name ?? featureMetadataById.get(id)?.name ?? id,
    ),
    [featureMetadataById, featureSummaryById, selectedSurface],
  );
  const middleHeadingDetail = selectedSurface?.kind === "feature"
    ? activeFeature?.name ?? ""
    : selectedSurface
      ? `${selectedSurface.label}${selectedSurfaceFeatureNames[0] ? ` -> ${selectedSurfaceFeatureNames[0]}` : ""}`
      : "";

  const handleWorkspaceSelect = (nextWorkspaceId: string) => {
    router.push(`/workspace/${encodeURIComponent(nextWorkspaceId)}/feature-explorer`);
  };

  const handleWorkspaceCreate = async (title: string) => {
    const created = await workspacesHook.createWorkspace(title);
    if (created?.id) {
      router.push(`/workspace/${encodeURIComponent(created.id)}/feature-explorer`);
    }
  };

  const handleRepoSelectionChange = (selection: RepoSelection | null) => {
    setRepoSelectionOverrides((prev) => ({ ...prev, [workspaceId]: selection }));
  };

  const applyFileAutoSelect = (detail: FeatureDetail) => {
    const flat = flattenFiles(detail.fileTree);
    const firstFile = Object.values(flat).find((n) => n.kind === "file");
    if (firstFile) {
      setActiveFileId(firstFile.id);
      setSelectedFileIds([firstFile.id]);
      const expanded: Record<string, boolean> = {};
      for (const node of Object.values(flat)) {
        if (node.kind === "folder") {
          expanded[node.id] = true;
        }
      }
      setExpandedIds(expanded);
    }
  };

  // Auto-select first file when initial detail loads from hook
  const [prevDetailId, setPrevDetailId] = useState<string>("");
  useEffect(() => {
    if (featureDetail && featureDetail.id !== prevDetailId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- legitimate initialization of derived selection state
      setPrevDetailId(featureDetail.id);
      applyFileAutoSelect(featureDetail);
    }
  }, [featureDetail, prevDetailId]);

  const handleSelectFeature = (nextFeatureId: string) => {
    setFeatureId(nextFeatureId);
    setInspectorTab("context");
    setSelectedFileIds([]);
    setActiveFileId("");
    setExpandedIds({});
    fetchFeatureDetail(nextFeatureId).then((detail) => {
      if (detail) applyFileAutoSelect(detail);
    });
  };
  const handleSelectSurface = (item: ExplorerSurfaceItem) => {
    setSelectedSurfaceKey(item.key);
    setInspectorTab("context");

    if (item.kind === "feature") {
      handleSelectFeature(item.featureIds[0] ?? "");
      return;
    }

    if (item.featureIds[0]) {
      handleSelectFeature(item.featureIds[0]);
      return;
    }

    setSelectedFileIds([]);
    setActiveFileId("");
    setExpandedIds({});
  };

  const handleToggleNode = (nodeId: string) => {
    setExpandedIds((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }));
  };

  const handleToggleSurfaceSection = (sectionId: string) => {
    setSurfaceSectionCollapsed((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const handleToggleSurfaceTreeNode = (nodeId: string) => {
    setSurfaceTreeExpandedIds((prev) => ({ ...prev, [nodeId]: !(prev[nodeId] ?? true) }));
  };

  const handleToggleFileSelection = (fileId: string) => {
    setSelectedFileIds((prev) =>
      prev.includes(fileId) ? prev.filter((item) => item !== fileId) : [...prev, fileId],
    );
    setActiveFileId(fileId);
  };

  const handleClearSelection = () => {
    setSelectedFileIds([]);
  };

  const handleContinue = () => {
    router.push(`/workspace/${encodeURIComponent(workspaceId)}/sessions`);
  };

  const handleCopyContext = async () => {
    const payload = {
      featureId: effectiveFeatureId,
      selectedFiles: selectedFileIds.map((id) => flatMap[id]?.path).filter(Boolean),
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  };

  const handleApiRequest = async (method: string, apiPath: string) => {
    try {
      const response = await desktopAwareFetch(apiPath, { method });
      return await response.text();
    } catch (err) {
      return err instanceof Error ? err.message : t.featureExplorer.requestFailed;
    }
  };

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspace?.title ?? workspaceId}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId}
          activeWorkspaceTitle={workspace?.title ?? workspaceId}
          onSelect={handleWorkspaceSelect}
          onCreate={handleWorkspaceCreate}
          loading={workspacesHook.loading}
          compact
          desktop
        />
      )}
    >
      <div className="flex h-full min-h-0 bg-desktop-bg-primary">
        <main className="flex min-w-0 flex-1">
          <section className="grid min-h-0 flex-1 xl:grid-cols-[360px_minmax(0,1fr)_500px] 2xl:grid-cols-[420px_minmax(0,1fr)_560px]">
            {/* ── Left panel: Feature list ── */}
            <aside className="flex min-h-0 flex-col border-r border-desktop-border bg-desktop-bg-secondary/20">
              <div className="border-b border-desktop-border px-3 py-2">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span>{t.featureExplorer.codebase}</span>
                </div>
                <RepoPicker
                  value={effectiveRepoSelection}
                  onChange={handleRepoSelectionChange}
                  additionalRepos={workspaceRepos}
                  pathDisplay="below-muted"
                />
              </div>
              <div className="border-b border-desktop-border px-3 py-2">
                <label className="flex items-center gap-2 rounded-sm border border-desktop-border bg-desktop-bg-primary px-2.5 py-1.5 text-xs text-desktop-text-secondary">
                  <Search className="h-3.5 w-3.5" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t.featureExplorer.searchPlaceholder}
                    className="w-full bg-transparent text-xs text-desktop-text-primary outline-none placeholder:text-desktop-text-secondary"
                  />
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {surfaceNavigationOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSurfaceNavigationView(option.id)}
                      className={`rounded-sm border px-2 py-1 text-[10px] font-medium ${
                        surfaceNavigationView === option.id
                          ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
                          : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary hover:text-desktop-text-primary"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <div className="px-3 py-4 text-xs text-desktop-text-secondary">Loading…</div>
                ) : error ? (
                  <div className="px-3 py-4 text-xs text-red-400">{error}</div>
                ) : explorerSections.length === 0 && !surfaceTreeSection ? (
                  <div className="px-3 py-4 text-xs text-desktop-text-secondary">
                    {t.featureExplorer.noFeatureMatches}
                  </div>
                ) : (
                  <div className="space-y-3 px-2 pb-3 pt-2">
                    {explorerSections
                      .filter((section) => surfaceNavigationView === "sections" || section.id === "features")
                      .map((section) => {
                        const collapsed = surfaceSectionCollapsed[section.id] ?? false;
                        const sectionTreeNodes = surfaceNavigationView === "sections" ? (sectionTreeNodesById[section.id] ?? []) : [];
                        return (
                          <div key={section.id}>
                            <button
                              type="button"
                              onClick={() => handleToggleSurfaceSection(section.id)}
                              className="mb-1 flex w-full items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary hover:text-desktop-text-primary"
                            >
                              <span className="flex items-center gap-1.5">
                                {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                <span>{section.title}</span>
                              </span>
                              <div className="flex items-center gap-1">
                                {section.metrics?.map((metric) => (
                                  <span
                                    key={metric.id}
                                    data-testid={metric.testId}
                                    className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal text-current/80"
                                  >
                                    {metric.value} {metric.label}
                                  </span>
                                ))}
                                <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal text-current/80">
                                  {section.items.length} {t.featureExplorer.itemsLabel}
                                </span>
                              </div>
                            </button>
                            {!collapsed ? (
                              sectionTreeNodes.length > 0 ? (
                                <div className="space-y-1">
                                  {sectionTreeNodes.map((node) => (
                                    <SurfaceTreeRow
                                      key={node.id}
                                      node={node}
                                      depth={0}
                                      activeSurfaceKey={activeSurfaceKey}
                                      expandedIds={surfaceTreeExpandedIds}
                                      onSelectSurface={handleSelectSurface}
                                      onToggleNode={handleToggleSurfaceTreeNode}
                                      unmappedLabel={t.featureExplorer.unmappedLabel}
                                      defaultExpandedDepth={0}
                                    />
                                  ))}
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  {section.items.map((item) => (
                                    <ExplorerSurfaceCard
                                      key={item.key}
                                      item={item}
                                      isActive={item.key === activeSurfaceKey}
                                      onSelect={() => handleSelectSurface(item)}
                                      unmappedLabel={t.featureExplorer.unmappedLabel}
                                    />
                                  ))}
                                </div>
                              )
                            ) : null}
                          </div>
                        );
                      })}

                    {surfaceTreeSection ? (
                      <div>
                        <button
                          type="button"
                          onClick={() => handleToggleSurfaceSection(surfaceTreeSection.id)}
                          className="mb-1 flex w-full items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary hover:text-desktop-text-primary"
                        >
                          <span className="flex items-center gap-1.5">
                            {(surfaceSectionCollapsed[surfaceTreeSection.id] ?? false)
                              ? <ChevronRight className="h-3.5 w-3.5" />
                              : <ChevronDown className="h-3.5 w-3.5" />}
                            <span>{surfaceTreeSection.title}</span>
                          </span>
                          <span>{surfaceTreeSection.nodes.reduce((sum, node) => sum + node.itemCount, 0)}</span>
                        </button>
                        {!(surfaceSectionCollapsed[surfaceTreeSection.id] ?? false) ? (
                          <div className="space-y-1">
                            {surfaceTreeSection.nodes.map((node) => (
                              <SurfaceTreeRow
                                key={node.id}
                                node={node}
                                depth={0}
                                activeSurfaceKey={activeSurfaceKey}
                                expandedIds={surfaceTreeExpandedIds}
                                onSelectSurface={handleSelectSurface}
                                onToggleNode={handleToggleSurfaceTreeNode}
                                unmappedLabel={t.featureExplorer.unmappedLabel}
                                defaultExpandedDepth={0}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </aside>

            {/* ── Middle panel: File tree ── */}
            <section className="flex min-h-0 flex-col border-r border-desktop-border bg-desktop-bg-primary">
              <div className="flex items-center justify-between border-b border-desktop-border px-3 py-2">
                <div>
                  <div className="text-xs font-semibold text-desktop-text-secondary">
                    {t.featureExplorer.filesHeading}
                  </div>
                  {middleHeadingDetail ? (
                    <div className="mt-0.5 truncate text-[10px] text-desktop-text-secondary">
                      {middleHeadingDetail}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setMiddleView("list")}
                    className={`rounded-sm px-1.5 py-0.5 text-[9px] font-medium ${middleView === "list" ? "bg-desktop-bg-active text-desktop-text-primary" : "text-desktop-text-secondary hover:text-desktop-text-primary"}`}
                  >
                    {t.featureExplorer.listView}
                  </button>
                  <button
                    onClick={() => setMiddleView("tree")}
                    className={`rounded-sm px-1.5 py-0.5 text-[9px] font-medium ${middleView === "tree" ? "bg-desktop-bg-active text-desktop-text-primary" : "text-desktop-text-secondary hover:text-desktop-text-primary"}`}
                  >
                    {t.featureExplorer.treeView}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between border-b border-desktop-border bg-desktop-bg-secondary/40 px-3 py-1.5">
                <div className="grid flex-1 grid-cols-[minmax(0,1fr)_56px_72px_96px] text-[10px] font-semibold uppercase tracking-[0.08em] text-desktop-text-secondary">
                  <div>{t.featureExplorer.nameColumn}</div>
                  <div>{t.featureExplorer.changeColumn}</div>
                  <div>{t.featureExplorer.sessionsColumn}</div>
                  <div>{t.featureExplorer.updatedColumn}</div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {featureDetailLoading ? (
                  <div className="px-3 py-4 text-xs text-desktop-text-secondary">Loading…</div>
                ) : fileTree.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-desktop-text-secondary">
                    {t.featureExplorer.noFilesSelected}
                  </div>
                ) : middleView === "list" ? (
                  <div className="divide-y divide-desktop-border">
                    {sessionSortedFiles.map((node) => {
                      const stat = fileStats[node.path];
                      const isActive = activeFileId === node.id;
                      const isSelected = selectedFileIds.includes(node.id);
                      return (
                        <div
                          key={node.id}
                          className={`grid grid-cols-[minmax(0,1fr)_56px_72px_96px] items-center px-3 py-1 text-xs transition-colors ${
                            isActive ? "bg-desktop-bg-active" : "hover:bg-desktop-bg-secondary/40"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleFileSelection(node.id)}
                              className="h-3.5 w-3.5 rounded border-black/15 bg-transparent dark:border-white/20"
                            />
                            <button onClick={() => setActiveFileId(node.id)} className="flex min-w-0 items-center gap-1.5 text-left">
                              <FileIcon path={node.path} />
                              <span className="break-all text-[12px] text-desktop-text-primary" title={node.path}>{node.path}</span>
                            </button>
                          </div>
                          <div className="text-[11px] text-desktop-text-secondary">{stat?.changes ?? "-"}</div>
                          <div className="text-[11px] text-desktop-text-secondary">{stat?.sessions ?? "-"}</div>
                          <div className="text-[11px] text-desktop-text-secondary">{stat?.updatedAt ? formatShortDate(stat.updatedAt) : "-"}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="divide-y divide-desktop-border">
                    {fileTree.map((node) => (
                      <TreeNodeRow
                        key={node.id}
                        node={node}
                        depth={0}
                        expandedIds={expandedIds}
                        activeFileId={activeFileId}
                        selectedFileIds={selectedFileIds}
                        treeNodeStats={treeNodeStats}
                        onToggleNode={handleToggleNode}
                        onToggleFileSelection={handleToggleFileSelection}
                        onSetActiveFile={setActiveFileId}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-desktop-border bg-desktop-bg-secondary/20 px-3 py-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="truncate text-[11px] text-desktop-text-secondary">
                    {selectedFileIds.length}f
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleClearSelection}
                      className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-2 py-1 text-[11px] text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                    >
                      {t.featureExplorer.clearSelection}
                    </button>
                    <button
                      onClick={handleContinue}
                      className="inline-flex items-center gap-1 rounded-sm border border-desktop-accent bg-desktop-bg-active px-2 py-1 text-[11px] text-desktop-text-primary hover:bg-desktop-bg-primary"
                    >
                      {t.featureExplorer.continueAction}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* ── Right panel: Inspector ── */}
            <aside className="flex min-h-0 flex-col bg-desktop-bg-secondary/10">
              <div className="border-b border-desktop-border px-3 py-2">
                <div className="flex items-center gap-1.5">
                  {([
                    { id: "context" as const, label: t.featureExplorer.contextTab, icon: FileText },
                    { id: "screenshot" as const, label: t.featureExplorer.screenshotTab, icon: ImageIcon },
                    { id: "api" as const, label: t.featureExplorer.apiTab, icon: FlaskConical },
                  ]).map((tab) => {
                    const Icon = tab.icon;
                    const isScreenshot = tab.id === "screenshot";
                    return (
                      <button
                        key={tab.id}
                        onClick={() => (!isScreenshot ? setInspectorTab(tab.id) : null)}
                        className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          inspectorTab === tab.id
                            ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
                            : isScreenshot
                              ? "cursor-not-allowed border-desktop-border bg-desktop-bg-primary/30 text-desktop-text-secondary/60"
                              : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {inspectorTab === "context" && (
                  <ContextPanel
                    activeFile={activeFile}
                    activeGroup={activeGroup}
                    featureDetail={surfaceOnlySelection ? null : featureDetail}
                    selectedSurface={selectedSurface}
                    selectedSurfaceFeatureNames={selectedSurfaceFeatureNames}
                    t={t}
                  />
                )}

                {inspectorTab === "screenshot" && (
                  <ScreenshotPanel featureDetail={surfaceOnlySelection ? null : featureDetail} t={t} />
                )}

                {inspectorTab === "api" && (
                  <ApiPanel
                    featureDetail={surfaceOnlySelection ? null : featureDetail}
                    t={t}
                    onRequest={handleApiRequest}
                  />
                )}
              </div>

              <div className="border-t border-desktop-border bg-desktop-bg-secondary/20 px-3 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => router.push(`/workspace/${encodeURIComponent(workspaceId)}/sessions`)}
                    className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-2 py-1 text-[11px] text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                  >
                    {t.featureExplorer.openSessions}
                  </button>
                  <button
                    onClick={handleCopyContext}
                    className="rounded-sm border border-desktop-accent bg-desktop-bg-active px-2 py-1 text-[11px] text-desktop-text-primary hover:bg-desktop-bg-primary"
                  >
                    {t.featureExplorer.copyContext}
                  </button>
                </div>
              </div>
            </aside>
          </section>
        </main>
      </div>
    </DesktopAppShell>
  );
}

/* ── Context Panel ── */
function ContextPanel({
  activeFile,
  activeGroup,
  featureDetail,
  selectedSurface,
  selectedSurfaceFeatureNames,
  t,
}: {
  activeFile: FileTreeNode | null;
  activeGroup: CapabilityGroup | null;
  featureDetail: FeatureDetail | null;
  selectedSurface: ExplorerSurfaceItem | null;
  selectedSurfaceFeatureNames: string[];
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (!featureDetail && !selectedSurface) {
    return <div className="text-xs text-desktop-text-secondary">-</div>;
  }

  return (
    <div className="space-y-2">
      {selectedSurface ? (
        <ContextSection title={t.featureExplorer.selectedSurface}>
          <div className="space-y-3">
            <div>
              <div className="text-[13px] font-semibold text-desktop-text-primary">{selectedSurface.label}</div>
              {selectedSurface.secondary ? (
                <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">{selectedSurface.secondary}</div>
              ) : null}
            </div>

            <div className="grid gap-px overflow-hidden rounded-sm border border-desktop-border bg-desktop-border sm:grid-cols-2">
              <MetricCell label={t.featureExplorer.state} value={surfaceKindBadge(selectedSurface.kind)} />
              <MetricCell
                label={t.featureExplorer.linkedFeatures}
                value={selectedSurfaceFeatureNames.length > 0 ? String(selectedSurfaceFeatureNames.length) : t.featureExplorer.unmappedLabel}
              />
            </div>

            {selectedSurfaceFeatureNames.length > 0 ? (
              <div className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2.5 py-2 text-[11px] leading-5 text-desktop-text-secondary">
                <span className="font-medium text-desktop-text-primary">{t.featureExplorer.linkedFeatures}: </span>
                {selectedSurfaceFeatureNames.join(", ")}
              </div>
            ) : null}

            {selectedSurface.sourceFiles.length > 0 ? (
              <div className="space-y-1">
                <div className="text-[10px] font-medium text-desktop-text-secondary">{t.featureExplorer.sourceFilesLabel}</div>
                {selectedSurface.sourceFiles.map((sourceFile) => (
                  <div
                    key={sourceFile}
                    className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-secondary"
                  >
                    {sourceFile}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </ContextSection>
      ) : null}

      {featureDetail ? (
        <ContextSection title={t.featureExplorer.featureSummary}>
          <div className="space-y-3">
            <div>
              <div className="text-[13px] font-semibold text-desktop-text-primary">{featureDetail.name}</div>
              <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">{featureDetail.summary}</div>
            </div>

            <div className="grid gap-px overflow-hidden rounded-sm border border-desktop-border bg-desktop-border sm:grid-cols-2">
              <MetricCell label={t.featureExplorer.capabilityGroup} value={activeGroup?.name ?? featureDetail.group} />
              <MetricCell label={t.featureExplorer.statusLabel} value={featureDetail.status} />
              <MetricCell label={t.featureExplorer.sourceFilesLabel} value={String(featureDetail.sourceFiles.length)} />
              <MetricCell label={t.featureExplorer.sessionsLabel} value={String(featureDetail.sessionCount)} />
            </div>

            {activeGroup?.description ? (
              <div className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2.5 py-2 text-[11px] leading-5 text-desktop-text-secondary">
                <span className="font-medium text-desktop-text-primary">{t.featureExplorer.groupDescription}: </span>
                {activeGroup.description}
              </div>
            ) : null}
          </div>
        </ContextSection>
      ) : null}

      {activeFile && (
        <ContextSection title={t.featureExplorer.activeFile}>
          <div className="flex items-center gap-2 text-desktop-text-primary">
            <FileIcon path={activeFile.path} />
            <span className="truncate text-xs font-semibold">{activeFile.name}</span>
          </div>
          <div className="mt-1 break-all text-[10px] text-desktop-text-secondary">
            {activeFile.path}
          </div>
        </ContextSection>
      )}

      <ContextSection title={t.featureExplorer.selectedFileSignals}>
        <div className="space-y-2">
          <div>
            <div className="text-[10px] font-medium text-desktop-text-secondary">{t.featureExplorer.sessionEvidence}</div>
            <div className="mt-1 rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-secondary">
              {activeFile ? t.featureExplorer.pendingImplementation : t.featureExplorer.noFilesSelected}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-medium text-desktop-text-secondary">{t.featureExplorer.toolHistory}</div>
            <div className="mt-1 rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-secondary">
              {activeFile ? t.featureExplorer.pendingImplementation : t.featureExplorer.noFilesSelected}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-medium text-desktop-text-secondary">{t.featureExplorer.promptHistory}</div>
            <div className="mt-1 rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-secondary">
              {activeFile ? t.featureExplorer.pendingImplementation : t.featureExplorer.noFilesSelected}
            </div>
          </div>
        </div>
      </ContextSection>

      {featureDetail ? (
        <ContextSection title={t.featureExplorer.sourceFilesLabel}>
          <div className="space-y-1">
            {featureDetail.sourceFiles.map((sourceFile) => (
              <div
                key={sourceFile}
                className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-secondary"
              >
                {sourceFile}
              </div>
            ))}
          </div>
        </ContextSection>
      ) : null}

      {featureDetail && featureDetail.relatedFeatures.length > 0 && (
        <ContextSection title={t.featureExplorer.relatedFiles}>
          <div className="space-y-1">
            {featureDetail.relatedFeatures.map((relId) => (
              <div
                key={relId}
                className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-secondary"
              >
                {relId}
              </div>
            ))}
          </div>
        </ContextSection>
      )}
    </div>
  );
}

function ScreenshotPanel({
  featureDetail,
  t,
}: {
  featureDetail: FeatureDetail | null;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (!featureDetail) {
    return <div className="text-xs text-desktop-text-secondary">-</div>;
  }

  return (
    <ContextSection title={t.featureExplorer.screenshotTab}>
      <div className="space-y-2">
        <div className="text-[11px] text-desktop-text-secondary">{t.featureExplorer.screenshotComingSoon}</div>
        <div className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2.5 py-2 text-[11px] text-desktop-text-secondary">
          {featureDetail.pageDetails?.length || featureDetail.pages.length > 0
            ? t.featureExplorer.pendingImplementation
            : t.featureExplorer.noPagesDeclared}
        </div>
      </div>
    </ContextSection>
  );
}

/* ── API Panel ── */
function ApiPanel({
  featureDetail,
  t,
  onRequest,
}: {
  featureDetail: FeatureDetail | null;
  t: ReturnType<typeof useTranslation>["t"];
  onRequest: (method: string, path: string) => Promise<string>;
}) {
  const [selectedApiIdx, setSelectedApiIdx] = useState(0);
  const [responseBody, setResponseBody] = useState("");
  const [requestState, setRequestState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const fallbackApiDetails: ApiDetail[] = featureDetail?.apis.map((declaration): ApiDetail => {
    const [method, endpoint] = declaration.split(/\s+/, 2);
    if (endpoint) {
      return { group: "", method, endpoint, description: "" };
    }
    return { group: "", method: "GET", endpoint: declaration, description: "" };
  }) ?? [];
  const apiDetails: ApiDetail[] = featureDetail?.apiDetails ?? fallbackApiDetails;

  if (!featureDetail || apiDetails.length === 0) {
    return <div className="text-xs text-desktop-text-secondary">-</div>;
  }

  const selectedApi: ApiDetail = apiDetails[selectedApiIdx] ?? apiDetails[0] ?? {
    group: "",
    method: "GET",
    endpoint: "",
    description: "",
  };
  const method = selectedApi.method;
  const apiPath = selectedApi.endpoint;
  const nextjsSources: string[] = [...new Set(selectedApi.nextjsSourceFiles ?? [])];
  const rustSources: string[] = [...new Set(selectedApi.rustSourceFiles ?? [])];
  const implementationSourceGroups = (selectedApi.implementationSources ?? [])
    .map((entry) => ({
      label: entry.label,
      sourceFiles: [...new Set(entry.sourceFiles)],
    }))
    .filter((entry) => entry.sourceFiles.length > 0);
  const resolvedImplementationSourceGroups = implementationSourceGroups.length > 0
    ? implementationSourceGroups
    : [
      ...(nextjsSources.length > 0 ? [{ label: "nextjs", sourceFiles: nextjsSources }] : []),
      ...(rustSources.length > 0 ? [{ label: "rust", sourceFiles: rustSources }] : []),
    ];

  const methodTone = method === "GET"
    ? "border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-200"
    : method === "POST"
      ? "border-sky-300/70 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/12 dark:text-sky-200"
      : "border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-200";

  const handleRequest = async () => {
    setRequestState("loading");
    try {
      const result = await onRequest(method, apiPath);
      setResponseBody(result);
      setRequestState("done");
    } catch {
      setRequestState("error");
    }
  };

  return (
    <div className="space-y-2">
      <ContextSection title={t.featureExplorer.apiTab}>
        <select
          value={selectedApiIdx}
          onChange={(e) => {
            setSelectedApiIdx(Number(e.target.value));
            setResponseBody("");
            setRequestState("idle");
          }}
          className="w-full rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-primary outline-none"
        >
          {apiDetails.map((api, idx) => (
            <option key={`${api.method}-${api.endpoint}`} value={idx}>{`${api.method} ${api.endpoint}`}</option>
          ))}
        </select>
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <span className={`rounded-sm border px-2 py-0.5 font-semibold ${methodTone}`}>
            {method}
          </span>
          <code className="truncate text-desktop-text-secondary">{apiPath}</code>
        </div>
        {selectedApi.group || selectedApi.description || resolvedImplementationSourceGroups.length > 0 ? (
          <div className="mt-2 rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2.5 py-2">
            {selectedApi.group ? (
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                {selectedApi.group}
              </div>
            ) : null}
            {selectedApi.description ? (
              <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">
                {selectedApi.description}
              </div>
            ) : null}
            {resolvedImplementationSourceGroups.map((entry) => (
              <div key={entry.label} className="mt-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                  {humanizeImplementationLabel(entry.label)}
                </div>
                <div className="mt-1 space-y-1">
                  {entry.sourceFiles.map((sourceFile) => (
                    <div key={sourceFile} className="break-all text-[11px] text-desktop-text-secondary">
                      {sourceFile}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </ContextSection>

      <ContextSection title={t.featureExplorer.requestBody}>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRequest}
            className="inline-flex items-center gap-1 rounded-sm border border-desktop-accent bg-desktop-bg-active px-2 py-1 text-[10px] text-desktop-text-primary"
          >
            <Braces className="h-3 w-3" />
            {t.featureExplorer.tryLiveRequest}
          </button>
          <span className="text-[10px] text-desktop-text-secondary">{requestState}</span>
        </div>
      </ContextSection>

      {responseBody && (
        <ContextSection title={t.featureExplorer.response}>
          <pre className="overflow-x-auto rounded-sm border border-desktop-border bg-desktop-bg-secondary p-2 text-[11px] leading-5 text-desktop-text-primary">
            {responseBody}
          </pre>
        </ContextSection>
      )}
    </div>
  );
}

/* ── Tree Node Row ── */
function TreeNodeRow({
  node,
  depth,
  expandedIds,
  activeFileId,
  selectedFileIds,
  treeNodeStats,
  onToggleNode,
  onToggleFileSelection,
  onSetActiveFile,
}: {
  node: FileTreeNode;
  depth: number;
  expandedIds: Record<string, boolean>;
  activeFileId: string;
  selectedFileIds: string[];
  treeNodeStats: Record<string, TreeNodeStat>;
  onToggleNode: (nodeId: string) => void;
  onToggleFileSelection: (fileId: string) => void;
  onSetActiveFile: (fileId: string) => void;
}) {
  const paddingLeft = 12 + depth * 16;
  const stat = treeNodeStats[node.id];

  if (node.kind === "folder") {
    const isExpanded = expandedIds[node.id] ?? true;

    return (
      <>
        <div className="grid grid-cols-[minmax(0,1fr)_56px_72px_96px] items-center px-3 py-1 text-xs text-desktop-text-primary">
          <button
            onClick={() => onToggleNode(node.id)}
            className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-desktop-bg-active"
            style={{ paddingLeft }}
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-desktop-text-secondary" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-desktop-text-secondary" />
            )}
            <Folder className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[12px]">{node.name}</span>
          </button>
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
              onToggleNode={onToggleNode}
              onToggleFileSelection={onToggleFileSelection}
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
          checked={isSelected}
          onChange={() => onToggleFileSelection(node.id)}
          className="h-3.5 w-3.5 rounded border-black/15 bg-transparent dark:border-white/20"
        />
        <button onClick={() => onSetActiveFile(node.id)} className="flex min-w-0 items-center gap-1.5 text-left">
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

/* ── Shared components ── */
function ContextSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-sm border border-desktop-border bg-desktop-bg-primary p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
        {title}
      </div>
      {children}
    </section>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-desktop-bg-primary px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
        {label}
      </div>
      <div className="mt-1 text-[12px] font-medium text-desktop-text-primary">{value}</div>
    </div>
  );
}

function FileIcon({ path }: { path: string }) {
  if (path.endsWith(".json")) return <FileJson2 className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
  if (path.endsWith(".md")) return <FileText className="h-3.5 w-3.5 shrink-0 text-violet-400" />;
  return <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />;
}
