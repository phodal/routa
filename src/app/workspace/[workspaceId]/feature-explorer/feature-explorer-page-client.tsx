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
  FeatureSurfaceApi,
  FeatureSurfaceImplementationApi,
  FeatureSurfacePage,
  FileTreeNode,
  InspectorTab,
} from "./types";
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

function collectLeafIds(node: FileTreeNode, acc: string[] = []): string[] {
  if (node.kind === "file") {
    acc.push(node.id);
    return acc;
  }
  for (const child of node.children ?? []) {
    collectLeafIds(child, acc);
  }
  return acc;
}

function featureCodeBadge(featureId: string): string {
  const parts = featureId.split("-");
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return featureId.slice(0, 2).toUpperCase();
}

function formatShortDate(iso: string): string {
  if (!iso || iso === "-") return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

type ExplorerSurfaceKind = "feature" | "page" | "contract-api" | "nextjs-api" | "rust-api";

type ExplorerSurfaceItem = {
  key: string;
  kind: ExplorerSurfaceKind;
  label: string;
  secondary: string;
  featureIds: string[];
  sourceFiles: string[];
  selectable: boolean;
};

type ExplorerSection = {
  id: string;
  title: string;
  items: ExplorerSurfaceItem[];
};

function buildApiDeclaration(method: string, endpointPath: string): string {
  return `${method.trim().toUpperCase()} ${endpointPath.trim()}`.trim();
}

function buildApiLookupKey(method: string, endpointPath: string): string {
  const normalizedPath = endpointPath
    .trim()
    .replace(/:[A-Za-z0-9_]+/g, "{}")
    .replace(/\{[^}]+\}/g, "{}");
  return `${method.trim().toUpperCase()} ${normalizedPath}`;
}

function parseApiDeclaration(declaration: string): { method: string; path: string } {
  const [method, endpointPath] = declaration.trim().split(/\s+/, 2);
  return {
    method: method || "GET",
    path: endpointPath || declaration.trim(),
  };
}

function matchesQuery(query: string, values: Array<string | undefined>): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return values.some((value) => value?.toLowerCase().includes(normalized));
}

function dedupeFeatureIds(featureIds: string[]): string[] {
  return [...new Set(featureIds.filter(Boolean))];
}

function surfaceKindBadge(kind: ExplorerSurfaceKind): string {
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
  const [featureId, setFeatureId] = useState<string>("");
  const [selectedSurfaceKey, setSelectedSurfaceKey] = useState<string>("");
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
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
          selectable: true,
        };
      }),
    [capabilityGroups, featureMetadataById, features, query],
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
    () => surfaceIndex.contractApis
      .filter((api) => matchesQuery(query, [api.method, api.path, api.domain, api.summary]))
      .map((api: FeatureSurfaceApi): ExplorerSurfaceItem => {
        const declaration = buildApiDeclaration(api.method, api.path);
        const lookupKey = buildApiLookupKey(api.method, api.path);
        return {
          key: `contract-api:${declaration}`,
          kind: "contract-api",
          label: declaration,
          secondary: api.summary || api.domain,
          featureIds: dedupeFeatureIds(apiFeatureMap.get(lookupKey) ?? []),
          sourceFiles: [],
          selectable: true,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
    [apiFeatureMap, query, surfaceIndex.contractApis],
  );
  const nextjsApiItems = useMemo<ExplorerSurfaceItem[]>(
    () => surfaceIndex.nextjsApis
      .filter((api) => matchesQuery(query, [api.method, api.path, api.domain, ...api.sourceFiles]))
      .map((api: FeatureSurfaceImplementationApi): ExplorerSurfaceItem => {
        const declaration = buildApiDeclaration(api.method, api.path);
        const lookupKey = buildApiLookupKey(api.method, api.path);
        return {
          key: `nextjs-api:${declaration}`,
          kind: "nextjs-api",
          label: declaration,
          secondary: api.sourceFiles[0] ?? api.domain,
          featureIds: dedupeFeatureIds(apiFeatureMap.get(lookupKey) ?? []),
          sourceFiles: api.sourceFiles,
          selectable: true,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
    [apiFeatureMap, query, surfaceIndex.nextjsApis],
  );
  const rustApiItems = useMemo<ExplorerSurfaceItem[]>(
    () => surfaceIndex.rustApis
      .filter((api) => matchesQuery(query, [api.method, api.path, api.domain, ...api.sourceFiles]))
      .map((api: FeatureSurfaceImplementationApi): ExplorerSurfaceItem => {
        const declaration = buildApiDeclaration(api.method, api.path);
        const lookupKey = buildApiLookupKey(api.method, api.path);
        return {
          key: `rust-api:${declaration}`,
          kind: "rust-api",
          label: declaration,
          secondary: api.sourceFiles[0] ?? api.domain,
          featureIds: dedupeFeatureIds(apiFeatureMap.get(lookupKey) ?? []),
          sourceFiles: api.sourceFiles,
          selectable: true,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
    [apiFeatureMap, query, surfaceIndex.rustApis],
  );
  const explorerSections = useMemo<ExplorerSection[]>(
    () => [
      { id: "features", title: t.featureExplorer.featureSection, items: featureItems },
      { id: "pages", title: t.featureExplorer.pageSection, items: pageItems },
      { id: "contract-apis", title: t.featureExplorer.contractApiSection, items: contractApiItems },
      { id: "nextjs-apis", title: t.featureExplorer.nextjsApiSection, items: nextjsApiItems },
      { id: "rust-apis", title: t.featureExplorer.rustApiSection, items: rustApiItems },
    ].filter((section) => section.items.length > 0),
    [
      contractApiItems,
      featureItems,
      nextjsApiItems,
      pageItems,
      rustApiItems,
      t.featureExplorer.contractApiSection,
      t.featureExplorer.featureSection,
      t.featureExplorer.nextjsApiSection,
      t.featureExplorer.pageSection,
      t.featureExplorer.rustApiSection,
    ],
  );
  const explorerItemsByKey = useMemo(() => {
    const entries = explorerSections.flatMap((section) => section.items.map((item) => [item.key, item] as const));
    return new Map(entries);
  }, [explorerSections]);
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
          <section className="grid min-h-0 flex-1 xl:grid-cols-[260px_minmax(0,1fr)_460px] 2xl:grid-cols-[300px_minmax(0,1fr)_520px]">
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
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <div className="px-3 py-4 text-xs text-desktop-text-secondary">Loading…</div>
                ) : error ? (
                  <div className="px-3 py-4 text-xs text-red-400">{error}</div>
                ) : explorerSections.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-desktop-text-secondary">
                    {t.featureExplorer.noFeatureMatches}
                  </div>
                ) : (
                  <div className="space-y-3 px-2 pb-3 pt-2">
                    {explorerSections.map((section) => (
                      <div key={section.id}>
                        <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                          <span>{section.title}</span>
                          <span>{section.items.length}</span>
                        </div>
                        <div className="space-y-1">
                          {section.items.map((item) => {
                            const isActive = item.key === activeSurfaceKey;
                            const firstFeatureId = item.featureIds[0] ?? "";
                            const featureBadge = firstFeatureId ? featureCodeBadge(firstFeatureId) : "";
                            const mappingLabel = item.kind === "feature"
                              ? ""
                              : firstFeatureId
                                ? item.featureIds.length > 1
                                  ? `${featureBadge}+${item.featureIds.length - 1}`
                                  : featureBadge
                                : t.featureExplorer.unmappedLabel;
                            return (
                              <button
                                key={item.key}
                                onClick={() => handleSelectSurface(item)}
                                className={`w-full rounded-sm border px-2 py-1.5 text-left transition-colors ${
                                  isActive
                                    ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
                                    : "border-transparent text-desktop-text-secondary hover:border-desktop-border hover:bg-desktop-bg-primary/70 hover:text-desktop-text-primary"
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  <span className={`inline-flex h-5 min-w-7 items-center justify-center rounded-sm border px-1 text-[9px] font-semibold ${
                                    isActive
                                      ? "border-desktop-accent bg-desktop-bg-primary text-desktop-text-primary"
                                      : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary"
                                  }`}>
                                    {item.kind === "feature" ? featureCodeBadge(firstFeatureId) : surfaceKindBadge(item.kind)}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-[12px] font-medium">
                                      {item.label}
                                    </div>
                                    {item.secondary ? (
                                      <div className="mt-0.5 truncate text-[10px] text-current/75">
                                        {item.secondary}
                                      </div>
                                    ) : null}
                                  </div>
                                  {mappingLabel ? (
                                    <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5 text-[9px] font-medium text-current/80">
                                      {mappingLabel}
                                    </span>
                                  ) : null}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
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
                        fileStats={fileStats}
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
        {selectedApi.group || selectedApi.description || nextjsSources.length > 0 || rustSources.length > 0 ? (
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
            {nextjsSources.length > 0 ? (
              <div className="mt-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                  Next.js
                </div>
                <div className="mt-1 space-y-1">
                  {nextjsSources.map((sourceFile) => (
                    <div key={sourceFile} className="break-all text-[11px] text-desktop-text-secondary">
                      {sourceFile}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {rustSources.length > 0 ? (
              <div className="mt-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                  Rust
                </div>
                <div className="mt-1 space-y-1">
                  {rustSources.map((sourceFile) => (
                    <div key={sourceFile} className="break-all text-[11px] text-desktop-text-secondary">
                      {sourceFile}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
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
  fileStats,
  onToggleNode,
  onToggleFileSelection,
  onSetActiveFile,
}: {
  node: FileTreeNode;
  depth: number;
  expandedIds: Record<string, boolean>;
  activeFileId: string;
  selectedFileIds: string[];
  fileStats: Record<string, { changes: number; sessions: number; updatedAt: string }>;
  onToggleNode: (nodeId: string) => void;
  onToggleFileSelection: (fileId: string) => void;
  onSetActiveFile: (fileId: string) => void;
}) {
  const paddingLeft = 12 + depth * 16;

  if (node.kind === "folder") {
    const isExpanded = expandedIds[node.id] ?? true;
    const leafIds = collectLeafIds(node);
    const selectedLeafCount = leafIds.filter((id) => selectedFileIds.includes(id)).length;

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
          <div className="text-[11px] text-desktop-text-secondary">-</div>
          <div className="text-[11px] text-desktop-text-secondary">
            {selectedLeafCount > 0 ? selectedLeafCount : "-"}
          </div>
          <div className="text-[11px] text-desktop-text-secondary">-</div>
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
              fileStats={fileStats}
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
  const stat = fileStats[node.path];

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
