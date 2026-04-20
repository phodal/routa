"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
} from "lucide-react";

import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useAcp } from "@/client/hooks/use-acp";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { saveRepoSelection } from "@/client/utils/repo-selection-storage";
import { useTranslation } from "@/i18n";

import type {
  AggregatedSelectionSession,
  FeatureDetail,
} from "./types";
import {
  buildSessionAnalysisSessionName,
  type FeatureExplorerUrlState,
  loadInitialRepoSelection,
  readFeatureExplorerUrlState,
  replaceFeatureExplorerUrlState,
} from "./feature-explorer-client-helpers";
import { FileIcon, flattenFiles, formatShortDate, TreeNodeRow } from "./feature-explorer-file-tree";
import { FeatureApiRow, FeatureRouteRow, FeatureStructureSection, InlineStatPill, SimpleSourceFileRow } from "./feature-explorer-structure-sections";
import { FeatureExplorerDrawers, FeatureExplorerInspectorPane } from "./feature-explorer-secondary-ui";
import { buildSessionAnalysisPrompt } from "./session-analysis";
import {
  type ExplorerSurfaceItem,
  type SurfaceNavigationView,
  SurfaceTreeRow,
} from "./surface-navigation";
import { useFeatureExplorerData } from "./use-feature-explorer-data";
import { useFeatureExplorerViewModel } from "./use-feature-explorer-view-model";

export function FeatureExplorerPageClient({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const inferredGroupId = "inferred-surfaces";
  const router = useRouter();
  const { t, locale } = useTranslation();
  const workspacesHook = useWorkspaces();
  const { codebases } = useCodebases(workspaceId);

  const workspace = workspacesHook.workspaces.find((item) => item.id === workspaceId) ?? null;
  const analysisAcp = useAcp();
  const analysisAcpConnected = analysisAcp.connected;
  const analysisAcpLoading = analysisAcp.loading;
  const connectAnalysisAcp = analysisAcp.connect;
  const analysisProviders = analysisAcp.providers;
  const analysisSelectedProvider = analysisAcp.selectedProvider;
  const setAnalysisProvider = analysisAcp.setProvider;
  const selectAnalysisSession = analysisAcp.selectSession;
  const promptAnalysisSession = analysisAcp.promptSession;
  const workspaceRepos = useMemo(
    () =>
      codebases.map((codebase) => ({
        name: codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath,
        path: codebase.repoPath,
        branch: codebase.branch ?? "",
      })),
    [codebases],
  );
  const [repoSelectionOverrides, setRepoSelectionOverrides] = useState<Record<string, RepoSelection | null>>({});
  const [generateRefreshCounter, setGenerateRefreshCounter] = useState(0);
  const [isRefreshingFeatureTree, setIsRefreshingFeatureTree] = useState(false);
  const hasRepoSelectionOverride = Object.prototype.hasOwnProperty.call(repoSelectionOverrides, workspaceId);
  const manualRepoSelection = hasRepoSelectionOverride
    ? (repoSelectionOverrides[workspaceId] ?? null)
    : null;
  const fallbackRepoSelection = workspaceRepos[0] ?? null;
  const effectiveRepoSelection = manualRepoSelection ?? fallbackRepoSelection;
  const repoRefreshKey = `${effectiveRepoSelection?.path ?? ""}:${effectiveRepoSelection?.branch ?? ""}:${generateRefreshCounter}`;

  useEffect(() => {
    if (hasRepoSelectionOverride) {
      return;
    }

    setRepoSelectionOverrides((prev) => ({
      ...prev,
      [workspaceId]: loadInitialRepoSelection(workspaceId),
    }));
  }, [hasRepoSelectionOverride, workspaceId]);

  useEffect(() => {
    if (!hasRepoSelectionOverride) {
      return;
    }

    saveRepoSelection("featureExplorer", workspaceId, manualRepoSelection);
  }, [hasRepoSelectionOverride, manualRepoSelection, workspaceId]);

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

  useEffect(() => {
    if (!loading) {
      setIsRefreshingFeatureTree(false);
    }
  }, [loading]);

  const [middleView, setMiddleView] = useState<"list" | "tree">("tree");
  const [surfaceNavigationView, setSurfaceNavigationView] = useState<SurfaceNavigationView>("capabilities");
  const [initialUrlState, setInitialUrlState] = useState<FeatureExplorerUrlState>({ featureId: "", filePath: "" });
  const [featureId, setFeatureId] = useState<string>("");
  const [selectedSurfaceKey, setSelectedSurfaceKey] = useState<string>("");
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [surfaceSectionCollapsed, setSurfaceSectionCollapsed] = useState<Record<string, boolean>>({});
  const [surfaceTreeExpandedIds, setSurfaceTreeExpandedIds] = useState<Record<string, boolean>>({});
  const [structureSectionCollapsed, setStructureSectionCollapsed] = useState<Record<string, boolean>>({});
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [activeFileId, setActiveFileId] = useState<string>("");
  const [desiredFilePath, setDesiredFilePath] = useState<string>("");
  const [hasResolvedInitialUrlSelection, setHasResolvedInitialUrlSelection] = useState(false);
  const [hasHydratedClientState, setHasHydratedClientState] = useState(false);
  const [isWideLayout, setIsWideLayout] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(320);
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
  const [isSessionAnalysisDrawerOpen, setIsSessionAnalysisDrawerOpen] = useState(false);
  const [isGenerateDrawerOpen, setIsGenerateDrawerOpen] = useState(false);
  const [isStartingSessionAnalysis, setIsStartingSessionAnalysis] = useState(false);
  const [sessionAnalysisError, setSessionAnalysisError] = useState<string | null>(null);
  const [analysisSessionId, setAnalysisSessionId] = useState<string | null>(null);
  const [analysisSessionName, setAnalysisSessionName] = useState("");
  const [analysisSessionProviderId, setAnalysisSessionProviderId] = useState("");
  const [isAnalysisSessionPaneOpen, setIsAnalysisSessionPaneOpen] = useState(false);
  const resizeContainerRef = useRef<HTMLElement | null>(null);

  const effectiveFeatureId = featureId || initialFeatureId;
  const {
    activeFeature,
    activeFile,
    activeSurfaceKey,
    capabilityTreeNodes,
    curatedFeatureCount,
    featureApiDetails,
    featurePageDetails,
    featureSidebarGroups,
    featureSourceFiles,
    fileStats,
    fileTree,
    flatMap,
    inferredFeatureCount,
    middleHeadingDetail,
    repositoryStatusTone,
    resolvedFeatureDetail,
    selectedFilePaths,
    selectedScopeSessions,
    selectedSurface,
    selectedSurfaceFeatureNames,
    selectableFileIdsByNode,
    sessionSortedFiles,
    surfaceNavigationOptions,
    surfaceOnlySelection,
    surfaceTreeSection,
    treeNodeStats,
  } = useFeatureExplorerViewModel({
    activeFileId,
    capabilityGroups,
    effectiveFeatureId,
    featureDetail,
    features,
    inferredGroupId,
    messages: t.featureExplorer,
    query,
    selectedFileIds,
    selectedSurfaceKey,
    surfaceIndex,
    surfaceNavigationView,
  });
  const analysisSessionProviderName = useMemo(
    () => analysisProviders.find((provider) => provider.id === analysisSessionProviderId)?.name ?? analysisSessionProviderId,
    [analysisProviders, analysisSessionProviderId],
  );
  const capabilityGroupMetrics = useMemo(
    () => capabilityTreeNodes.reduce<Record<string, { pages: number; apis: number; files: number }>>((acc, node) => {
      acc[node.id.replace("capability:", "")] = node.children.reduce(
        (groupTotals, child) => ({
          pages: groupTotals.pages + Number(child.item?.metrics?.find((metric) => metric.id === "pages")?.value ?? 0),
          apis: groupTotals.apis + Number(child.item?.metrics?.find((metric) => metric.id === "apis")?.value ?? 0),
          files: groupTotals.files + Number(child.item?.metrics?.find((metric) => metric.id === "files")?.value ?? 0),
        }),
        { pages: 0, apis: 0, files: 0 },
      );
      return acc;
    }, {}),
    [capabilityTreeNodes],
  );

  useEffect(() => {
    const urlState = readFeatureExplorerUrlState();
    setInitialUrlState(urlState);
    setFeatureId(urlState.featureId);
    setDesiredFilePath(urlState.filePath);
    setHasResolvedInitialUrlSelection(urlState.featureId === "");
    setHasHydratedClientState(true);
  }, [workspaceId]);

  useEffect(() => {
    const syncWideLayout = () => {
      if (typeof window === "undefined") {
        return;
      }

      const nextIsWide = window.innerWidth >= 1280;
      setIsWideLayout(nextIsWide);

      if (window.innerWidth >= 1536) {
        setLeftPanelWidth((prev) => Math.max(prev, 380));
        setRightPanelWidth((prev) => Math.max(prev, 400));
      }
    };

    syncWideLayout();
    window.addEventListener("resize", syncWideLayout);
    return () => window.removeEventListener("resize", syncWideLayout);
  }, []);

  useEffect(() => {
    setStructureSectionCollapsed({
      files: false,
      pages: true,
      apis: true,
    });
  }, [effectiveFeatureId]);

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

  const applyFileAutoSelect = (detail: FeatureDetail, preferredFilePath = "") => {
    const flat = flattenFiles(detail.fileTree);
    const leafFiles = Object.values(flat).filter((node) => node.kind === "file");
    const nextFile = (preferredFilePath
      ? leafFiles.find((node) => node.path === preferredFilePath)
      : null) ?? leafFiles[0];

    if (nextFile) {
      setActiveFileId(nextFile.id);
      setSelectedFileIds([nextFile.id]);
      setDesiredFilePath(nextFile.path);
      const expanded: Record<string, boolean> = {};
      for (const node of Object.values(flat)) {
        if (node.kind === "folder") {
          expanded[node.id] = true;
        }
      }
      setExpandedIds(expanded);
      return;
    }

    setActiveFileId("");
    setSelectedFileIds([]);
    setDesiredFilePath("");
  };

  // Auto-select first file when initial detail loads from hook
  const [prevDetailId, setPrevDetailId] = useState<string>("");
  useEffect(() => {
    if (resolvedFeatureDetail && resolvedFeatureDetail.id !== prevDetailId) {
      setPrevDetailId(resolvedFeatureDetail.id);
      applyFileAutoSelect(
        resolvedFeatureDetail,
        resolvedFeatureDetail.id === effectiveFeatureId ? desiredFilePath : "",
      );
    }
  }, [desiredFilePath, effectiveFeatureId, prevDetailId, resolvedFeatureDetail]);

  useEffect(() => {
    if (!hasHydratedClientState || hasResolvedInitialUrlSelection || !initialUrlState.featureId || loading || featureDetailLoading) {
      return;
    }

    if (resolvedFeatureDetail?.id === initialUrlState.featureId) {
      setHasResolvedInitialUrlSelection(true);
      return;
    }

    fetchFeatureDetail(initialUrlState.featureId).then((detail) => {
      if (detail) {
        applyFileAutoSelect(detail, initialUrlState.filePath);
      }
      setHasResolvedInitialUrlSelection(true);
    });
  }, [
    featureDetailLoading,
    fetchFeatureDetail,
    hasResolvedInitialUrlSelection,
    initialUrlState.featureId,
    initialUrlState.filePath,
    hasHydratedClientState,
    loading,
    resolvedFeatureDetail,
  ]);

  useEffect(() => {
    if (!hasHydratedClientState || !hasResolvedInitialUrlSelection) {
      return;
    }

    replaceFeatureExplorerUrlState({
      featureId: effectiveFeatureId,
      filePath: activeFile?.path ?? "",
    });
  }, [activeFile?.path, effectiveFeatureId, hasHydratedClientState, hasResolvedInitialUrlSelection]);

  const handleSelectFeature = (nextFeatureId: string) => {
    setFeatureId(nextFeatureId);
    setSelectedFileIds([]);
    setActiveFileId("");
    setDesiredFilePath("");
    setExpandedIds({});
    fetchFeatureDetail(nextFeatureId).then((detail) => {
      if (detail) applyFileAutoSelect(detail);
    });
  };
  const handleSelectSurface = (item: ExplorerSurfaceItem) => {
    setSelectedSurfaceKey(item.key);

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
    setSurfaceTreeExpandedIds((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }));
  };

  const handleToggleStructureSection = (sectionId: string) => {
    setStructureSectionCollapsed((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const startColumnResize = (panel: "left" | "right") => {
    if (!isWideLayout || typeof window === "undefined") {
      return;
    }

    const container = resizeContainerRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const minLeftWidth = 260;
    const maxLeftWidth = Math.min(520, rect.width - rightPanelWidth - 360);
    const minRightWidth = 300;
    const maxRightWidth = Math.min(560, rect.width - leftPanelWidth - 360);

    const handlePointerMove = (event: PointerEvent) => {
      if (panel === "left") {
        const nextWidth = Math.max(minLeftWidth, Math.min(maxLeftWidth, event.clientX - rect.left));
        setLeftPanelWidth(nextWidth);
        return;
      }

      const nextWidth = Math.max(minRightWidth, Math.min(maxRightWidth, rect.right - event.clientX));
      setRightPanelWidth(nextWidth);
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleSetActiveFile = (fileId: string) => {
    setActiveFileId(fileId);
    setDesiredFilePath(flatMap[fileId]?.path ?? "");
  };

  const handleActivateFile = (fileId: string) => {
    handleSetActiveFile(fileId);
    setSelectedFileIds(fileId ? [fileId] : []);
  };

  const handleToggleNodeSelection = (nodeId: string) => {
    const targetFileIds = selectableFileIdsByNode[nodeId] ?? [];
    if (targetFileIds.length === 0) {
      return;
    }

    const isRemoving = targetFileIds.every((fileId) => selectedFileIds.includes(fileId));
    const nextSelectedIds = isRemoving
      ? selectedFileIds.filter((fileId) => !targetFileIds.includes(fileId))
      : [...new Set([...selectedFileIds, ...targetFileIds])];

    setSelectedFileIds(nextSelectedIds);

    if (!isRemoving) {
      handleSetActiveFile(targetFileIds[0] ?? "");
      return;
    }

    if (activeFileId && targetFileIds.includes(activeFileId)) {
      const nextActiveFileId = nextSelectedIds[0] ?? "";
      if (nextActiveFileId) {
        handleSetActiveFile(nextActiveFileId);
      } else {
        setActiveFileId("");
        setDesiredFilePath("");
      }
    }
  };

  useEffect(() => {
    if (!isSessionAnalysisDrawerOpen) {
      return;
    }

    if (selectedFilePaths.length === 0 || selectedScopeSessions.length === 0) {
      setIsSessionAnalysisDrawerOpen(false);
    }
  }, [isSessionAnalysisDrawerOpen, selectedFilePaths.length, selectedScopeSessions.length]);

  useEffect(() => {
    if ((!isSessionAnalysisDrawerOpen && !isAnalysisSessionPaneOpen) || analysisAcpConnected || analysisAcpLoading) {
      return;
    }

    void connectAnalysisAcp();
  }, [
    analysisAcpConnected,
    analysisAcpLoading,
    connectAnalysisAcp,
    isAnalysisSessionPaneOpen,
    isSessionAnalysisDrawerOpen,
  ]);

  const handleOpenSessionAnalysisDrawer = () => {
    setSessionAnalysisError(null);
    setIsSessionAnalysisDrawerOpen(true);
  };

  const handleStartSessionAnalysis = async (sessionsToAnalyze: AggregatedSelectionSession[] = selectedScopeSessions) => {
    if (!effectiveRepoSelection?.path || selectedFilePaths.length === 0 || sessionsToAnalyze.length === 0) {
      return;
    }

    setSessionAnalysisError(null);
    setIsStartingSessionAnalysis(true);

    try {
      const sessionName = buildSessionAnalysisSessionName(
        locale,
        surfaceOnlySelection ? null : resolvedFeatureDetail,
        selectedFilePaths,
      );
      const prompt = buildSessionAnalysisPrompt({
        locale,
        workspaceId,
        repoName: effectiveRepoSelection.name,
        repoPath: effectiveRepoSelection.path,
        branch: effectiveRepoSelection.branch,
        featureDetail: surfaceOnlySelection ? null : resolvedFeatureDetail,
        selectedFilePaths,
        sessions: sessionsToAnalyze,
      });

      const response = await desktopAwareFetch("/api/acp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `feature-explorer-analysis:${Date.now()}`,
          method: "session/new",
          params: {
            workspaceId,
            cwd: effectiveRepoSelection.path,
            branch: effectiveRepoSelection.branch || undefined,
            role: "ROUTA",
            specialistId: "file-session-analyst",
            specialistLocale: locale,
            name: sessionName,
            provider: analysisSelectedProvider,
          },
        }),
      });

      const payload = await response.json().catch(() => null) as {
        result?: { sessionId?: string };
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error?.message || t.featureExplorer.sessionAnalysisFailed);
      }

      if (payload?.error?.message) {
        throw new Error(payload.error.message);
      }

      const sessionId = payload?.result?.sessionId;
      if (!sessionId) {
        throw new Error(t.featureExplorer.sessionAnalysisFailed);
      }

      await connectAnalysisAcp();
      selectAnalysisSession(sessionId);
      setAnalysisSessionId(sessionId);
      setAnalysisSessionName(sessionName);
      setAnalysisSessionProviderId(analysisSelectedProvider);
      setIsAnalysisSessionPaneOpen(true);
      setIsSessionAnalysisDrawerOpen(false);
      void promptAnalysisSession(sessionId, prompt);
    } catch (err) {
      setSessionAnalysisError(
        err instanceof Error && err.message
          ? err.message
          : t.featureExplorer.sessionAnalysisFailed,
      );
    } finally {
      setIsStartingSessionAnalysis(false);
    }
  };
  const middlePanelTitle = selectedSurface && selectedSurface.kind !== "feature"
    ? (middleHeadingDetail || activeFeature?.name || t.featureExplorer.featureStructureHeading)
    : (activeFeature?.name || middleHeadingDetail || t.featureExplorer.featureStructureHeading);
  const middlePanelSummary = selectedSurface && selectedSurface.kind !== "feature"
    ? (activeFeature?.summary || selectedSurface.secondary || "")
    : (activeFeature?.summary || "");
  const repositoryStatusLabel = repositoryStatusTone === "ready"
    ? t.featureExplorer.repositoryReady
    : repositoryStatusTone === "inferred"
      ? t.featureExplorer.repositoryInferred
      : t.featureExplorer.repositoryMissingTaxonomy;
  const repositoryStatusChipClassName = repositoryStatusTone === "ready"
    ? "border-emerald-300/60 bg-emerald-50/70 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
    : repositoryStatusTone === "inferred"
      ? "border-sky-300/60 bg-sky-50/70 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200"
      : "border-amber-300/60 bg-amber-50/70 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200";

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
          <section
            ref={resizeContainerRef}
            className="grid min-h-0 flex-1 grid-cols-1"
            style={isWideLayout
              ? {
                  gridTemplateColumns: `${leftPanelWidth}px 8px minmax(320px,1fr) 8px ${rightPanelWidth}px`,
                }
              : undefined}
          >
            <aside className="flex min-h-0 flex-col border-r border-desktop-border bg-desktop-bg-secondary/20">
              <div className="border-b border-desktop-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 rounded-sm border border-desktop-border bg-desktop-bg-primary px-2.5 py-1.5">
                    <RepoPicker
                      value={effectiveRepoSelection}
                      onChange={handleRepoSelectionChange}
                      additionalRepos={workspaceRepos}
                      pathDisplay="hidden"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsGenerateDrawerOpen(true)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-desktop-accent/50 bg-desktop-accent/10 px-2 py-1.5 text-[10px] font-medium text-desktop-accent hover:bg-desktop-accent/20"
                    data-testid="generate-feature-tree-button"
                    title={t.featureExplorer.generateFeatureTree}
                    aria-label={t.featureExplorer.generateFeatureTree}
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span className="hidden xl:inline">{t.featureExplorer.generateFeatureTree}</span>
                  </button>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <label className="flex min-w-0 flex-1 items-center gap-2 rounded-sm border border-desktop-border bg-desktop-bg-primary px-2.5 py-1.5 text-xs text-desktop-text-secondary">
                    <Search className="h-3.5 w-3.5" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t.featureExplorer.searchPlaceholder}
                      className="w-full bg-transparent text-xs text-desktop-text-primary outline-none placeholder:text-desktop-text-secondary"
                    />
                  </label>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className={`rounded-sm border px-1.5 py-1 text-[9px] font-semibold normal-case tracking-normal ${repositoryStatusChipClassName}`}>
                    {repositoryStatusLabel}
                  </span>
                  {surfaceNavigationOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSurfaceNavigationView(option.id)}
                      title={option.tooltip}
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
                <div className="mt-1 flex flex-wrap gap-1 text-[9px] text-desktop-text-secondary">
                  {isRefreshingFeatureTree ? (
                    <span className="rounded-sm border border-desktop-accent/40 bg-desktop-accent/10 px-1.5 py-0.5 text-desktop-accent">
                      {t.featureExplorer.refreshingFeatureTree}
                    </span>
                  ) : null}
                  <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5">
                    {curatedFeatureCount} {t.featureExplorer.curatedFeaturesLabel}
                  </span>
                  <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5">
                    {inferredFeatureCount} {t.featureExplorer.inferredFeaturesLabel}
                  </span>
                  <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5">
                    {surfaceIndex.pages.length} {t.featureExplorer.pageSection}
                  </span>
                  <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5">
                    {surfaceIndex.contractApis.length} {t.featureExplorer.contractApiSection}
                  </span>
                  {surfaceIndex.generatedAt ? (
                    <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5">
                      {formatShortDate(surfaceIndex.generatedAt)}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <div className="px-3 py-4 text-xs text-desktop-text-secondary">Loading…</div>
                ) : error ? (
                  <div className="px-3 py-4 text-xs text-red-400">{error}</div>
                ) : surfaceNavigationView === "capabilities" ? (
                  featureSidebarGroups.length > 0 ? (
                    <div className="space-y-3 px-2 pb-3 pt-2">
                      {featureSidebarGroups.map((group) => {
                        const collapsed = surfaceSectionCollapsed[group.id] ?? (group.id === inferredGroupId && curatedFeatureCount > 0);
                        const groupNode = capabilityTreeNodes.find((node) => node.id === `capability:${group.id}`);
                        const groupMetrics = capabilityGroupMetrics[group.id] ?? { pages: 0, apis: 0, files: 0 };
                        return (
                          <div key={group.id}>
                            <button
                              type="button"
                              onClick={() => handleToggleSurfaceSection(group.id)}
                              className="mb-1 flex w-full items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary hover:text-desktop-text-primary"
                            >
                              <span className="flex items-center gap-1.5">
                                {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                <span>{group.title}</span>
                              </span>
                              <span className="flex items-center gap-1 text-[9px] font-medium normal-case tracking-normal text-current/80">
                                <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5">
                                  {groupMetrics.pages} {t.featureExplorer.pageSection}
                                </span>
                                <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5">
                                  {groupMetrics.apis} API
                                </span>
                                <span className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5">
                                  {groupMetrics.files} {t.featureExplorer.filesLabel}
                                </span>
                              </span>
                            </button>
                            {group.description ? (
                              <div className="mb-1 px-1 text-[11px] leading-5 text-desktop-text-secondary">
                                {group.description}
                              </div>
                            ) : null}
                            {!collapsed ? (
                              <div className="space-y-0.5">
                                {(groupNode?.children ?? []).map((node) => (
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
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-3 py-4">
                      <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary p-3">
                        <div className="text-[12px] font-semibold text-desktop-text-primary">
                          {t.featureExplorer.featureTaxonomyEmptyTitle}
                        </div>
                        <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">
                          {t.featureExplorer.featureTaxonomyEmptyDescription}
                        </div>
                      </div>
                    </div>
                  )
                ) : !surfaceTreeSection ? (
                  <div className="px-3 py-4 text-xs text-desktop-text-secondary">
                    {t.featureExplorer.noFeatureMatches}
                  </div>
                ) : (
                  <div className="space-y-3 px-2 pb-3 pt-2">
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
                  </div>
                )}
              </div>
            </aside>

            {isWideLayout ? (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize navigation panel"
                onPointerDown={() => startColumnResize("left")}
                className="group relative hidden cursor-col-resize bg-desktop-bg-secondary/10 xl:block"
              >
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-desktop-border transition-colors group-hover:bg-desktop-accent" />
              </div>
            ) : null}

            <section className="flex min-h-0 flex-col border-r border-desktop-border bg-desktop-bg-primary">
              <div className="border-b border-desktop-border px-3 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-desktop-text-primary">
                      {middlePanelTitle}
                    </div>
                    {middlePanelSummary ? (
                      <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">
                        {middlePanelSummary}
                      </div>
                    ) : null}
                  </div>
                  {activeFeature ? (
                    <div className="flex flex-wrap gap-1.5">
                      <InlineStatPill label={t.featureExplorer.statusLabel} value={activeFeature.status || "-"} />
                      <InlineStatPill label={t.featureExplorer.pageSection} value={String(featurePageDetails.length)} />
                      <InlineStatPill label={t.featureExplorer.apiSurfacesLabel} value={String(featureApiDetails.length)} />
                      <InlineStatPill label={t.featureExplorer.sourceFilesLabel} value={String(featureSourceFiles.length)} />
                      <InlineStatPill label={t.featureExplorer.sessionsLabel} value={String(activeFeature.sessionCount)} />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {featureDetailLoading ? (
                  <div className="px-3 py-4 text-xs text-desktop-text-secondary">Loading…</div>
                ) : !effectiveFeatureId ? (
                  <div className="px-3 py-4 text-xs text-desktop-text-secondary">
                    {t.featureExplorer.featureStructureEmpty}
                  </div>
                ) : (
                  <div className="space-y-3 px-3 py-3">
                    {!activeFeature ? (
                      <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary p-3 text-[11px] text-desktop-text-secondary">
                        {t.featureExplorer.featureStructureUnavailable}
                      </div>
                    ) : null}

                    <FeatureStructureSection
                      title={t.featureExplorer.sourceFilesLabel}
                      count={featureSourceFiles.length}
                      collapsed={structureSectionCollapsed.files ?? false}
                      onToggle={() => handleToggleStructureSection("files")}
                      toolbar={featureSourceFiles.length > 0 ? (
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
                      ) : null}
                    >
                      {fileTree.length > 0 ? (
                        <div className="overflow-hidden rounded-sm border border-desktop-border">
                          <div className="grid grid-cols-[minmax(0,1fr)_56px_72px_96px] bg-desktop-bg-secondary/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-desktop-text-secondary">
                            <div>{t.featureExplorer.nameColumn}</div>
                            <div>{t.featureExplorer.changeColumn}</div>
                            <div>{t.featureExplorer.sessionsColumn}</div>
                            <div>{t.featureExplorer.updatedColumn}</div>
                          </div>
                          {middleView === "list" ? (
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
                                        data-testid={`feature-tree-select-${node.id}`}
                                        checked={isSelected}
                                        onChange={() => handleToggleNodeSelection(node.id)}
                                        className="h-3.5 w-3.5 rounded border-black/15 bg-transparent dark:border-white/20"
                                      />
                                      <button
                                        type="button"
                                        data-testid={`feature-tree-activate-${node.id}`}
                                        onClick={() => handleActivateFile(node.id)}
                                        className="flex min-w-0 items-center gap-1.5 text-left"
                                      >
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
                                  selectableFileIdsByNode={selectableFileIdsByNode}
                                  onToggleNode={handleToggleNode}
                                  onToggleNodeSelection={handleToggleNodeSelection}
                                  onSetActiveFile={handleActivateFile}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      ) : featureSourceFiles.length > 0 ? (
                        <div className="space-y-1.5">
                          {featureSourceFiles.map((sourceFile) => (
                            <SimpleSourceFileRow key={sourceFile} path={sourceFile} />
                          ))}
                        </div>
                      ) : (
                        <div className="text-[11px] text-desktop-text-secondary">{t.featureExplorer.sourceFilesEmpty}</div>
                      )}
                    </FeatureStructureSection>

                    <FeatureStructureSection
                      title={t.featureExplorer.frontendRoutesLabel}
                      count={featurePageDetails.length}
                      collapsed={structureSectionCollapsed.pages ?? false}
                      onToggle={() => handleToggleStructureSection("pages")}
                    >
                      {featurePageDetails.length > 0 ? (
                        <div className="space-y-1.5">
                          {featurePageDetails.map((page) => (
                            <FeatureRouteRow key={page.route} page={page} />
                          ))}
                        </div>
                      ) : (
                        <div className="text-[11px] text-desktop-text-secondary">{t.featureExplorer.noPagesDeclared}</div>
                      )}
                    </FeatureStructureSection>

                    <FeatureStructureSection
                      title={t.featureExplorer.apiSourceLabel}
                      count={featureApiDetails.length}
                      collapsed={structureSectionCollapsed.apis ?? false}
                      onToggle={() => handleToggleStructureSection("apis")}
                    >
                      {featureApiDetails.length > 0 ? (
                        <div className="space-y-1.5">
                          {featureApiDetails.map((api) => (
                            <FeatureApiRow
                              key={`${api.method}:${api.endpoint}`}
                              api={api}
                              implementationLabel={t.featureExplorer.implementationLabel}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-[11px] text-desktop-text-secondary">{t.featureExplorer.noApisDeclared}</div>
                      )}
                    </FeatureStructureSection>
                  </div>
                )}
              </div>

            </section>

            {isWideLayout ? (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize inspector panel"
                onPointerDown={() => startColumnResize("right")}
                className="group relative hidden cursor-col-resize bg-desktop-bg-secondary/10 xl:block"
              >
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-desktop-border transition-colors group-hover:bg-desktop-accent" />
              </div>
            ) : null}

            <FeatureExplorerInspectorPane
              featureDetail={surfaceOnlySelection ? null : resolvedFeatureDetail}
              selectedFileCount={selectedFileIds.length}
              selectedScopeSessions={selectedScopeSessions}
              selectedSurface={selectedSurface}
              selectedSurfaceFeatureNames={selectedSurfaceFeatureNames}
              onOpenSessionAnalysis={handleOpenSessionAnalysisDrawer}
              t={t}
            />

          </section>
        </main>

        <FeatureExplorerDrawers
          workspaceId={workspaceId}
          repoPath={effectiveRepoSelection?.path}
          generateOpen={isGenerateDrawerOpen}
          onCloseGenerate={() => setIsGenerateDrawerOpen(false)}
          onGenerated={() => {
            setIsRefreshingFeatureTree(true);
            setGenerateRefreshCounter((c) => c + 1);
          }}
          sessionAnalysisDrawerKey={`session-analysis:${isSessionAnalysisDrawerOpen ? "open" : "closed"}:${selectedFilePaths.join("|")}:${selectedScopeSessions.map((session) => `${session.provider}:${session.sessionId}`).join("|")}`}
          sessionAnalysisOpen={isSessionAnalysisDrawerOpen}
          selectedFilePaths={selectedFilePaths}
          selectedScopeSessions={selectedScopeSessions}
          providers={analysisProviders}
          selectedProvider={analysisSelectedProvider}
          onProviderChange={setAnalysisProvider}
          isStartingSessionAnalysis={isStartingSessionAnalysis}
          sessionAnalysisError={sessionAnalysisError}
          onCloseSessionAnalysis={() => setIsSessionAnalysisDrawerOpen(false)}
          onStartSessionAnalysis={handleStartSessionAnalysis}
          analysisSessionPaneOpen={isAnalysisSessionPaneOpen}
          analysisSessionId={analysisSessionId}
          analysisSessionName={analysisSessionName}
          analysisSessionProviderName={analysisSessionProviderName}
          analysisSessionProviderId={analysisSessionProviderId}
          fallbackSelectedProvider={analysisSelectedProvider}
          onCloseAnalysisSessionPane={() => {
            setIsAnalysisSessionPaneOpen(false);
            setAnalysisSessionId(null);
          }}
          acp={analysisAcp}
          onEnsureAnalysisSession={async () => analysisSessionId}
          onSelectAnalysisSession={async (sessionId) => {
            setAnalysisSessionId(sessionId);
            selectAnalysisSession(sessionId);
          }}
          repoSelection={effectiveRepoSelection}
          codebases={codebases}
          t={t}
        />
      </div>
    </DesktopAppShell>
  );
}
