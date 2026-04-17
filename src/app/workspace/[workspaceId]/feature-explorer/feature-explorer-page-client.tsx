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
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

import type { CapabilityGroup, FeatureDetail, FeatureSummary, FileTreeNode, InspectorTab } from "./types";
import { useFeatureExplorerData } from "./use-feature-explorer-data";

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
  const defaultCodebase = codebases.find((cb) => cb.isDefault) ?? codebases[0] ?? null;
  const repoLabel = defaultCodebase
    ? (defaultCodebase.label ?? defaultCodebase.repoPath.split("/").pop() ?? defaultCodebase.repoPath)
    : null;

  const {
    loading,
    error,
    capabilityGroups,
    features,
    featureDetail,
    featureDetailLoading,
    initialFeatureId,
    fetchFeatureDetail,
  } = useFeatureExplorerData({
    workspaceId,
  });

  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("context");
  const [featureId, setFeatureId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [activeFileId, setActiveFileId] = useState<string>("");

  // Derive effective feature ID: user-selected or auto-initialized from hook
  const effectiveFeatureId = featureId || initialFeatureId;

  const filteredFeatures = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return features;
    return features.filter((f) => f.name.toLowerCase().includes(normalized));
  }, [features, query]);

  const groupedFeatures = useMemo(() => {
    const groupMap = new Map<string, { group: CapabilityGroup; items: FeatureSummary[] }>();

    // Initialize groups from capability_groups (preserving order)
    for (const group of capabilityGroups) {
      groupMap.set(group.id, { group, items: [] });
    }

    for (const feature of filteredFeatures) {
      const entry = groupMap.get(feature.group);
      if (entry) {
        entry.items.push(feature);
      } else {
        // Fallback: create an ad-hoc group
        groupMap.set(feature.group, {
          group: { id: feature.group, name: feature.group, description: "" },
          items: [feature],
        });
      }
    }

    return Array.from(groupMap.values()).filter((g) => g.items.length > 0);
  }, [filteredFeatures, capabilityGroups]);

  const fileTree = useMemo(() => featureDetail?.fileTree ?? [], [featureDetail]);
  const fileStats = useMemo(() => featureDetail?.fileStats ?? {}, [featureDetail]);
  const flatMap = useMemo(() => flattenFiles(fileTree), [fileTree]);
  const activeFile = flatMap[activeFileId] ?? null;
  const activeFeature = features.find((f) => f.id === effectiveFeatureId);
  const activeGroup = activeFeature
    ? capabilityGroups.find((group) => group.id === activeFeature.group) ?? null
    : null;

  const handleWorkspaceSelect = (nextWorkspaceId: string) => {
    router.push(`/workspace/${encodeURIComponent(nextWorkspaceId)}/feature-explorer`);
  };

  const handleWorkspaceCreate = async (title: string) => {
    const created = await workspacesHook.createWorkspace(title);
    if (created?.id) {
      router.push(`/workspace/${encodeURIComponent(created.id)}/feature-explorer`);
    }
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
          <section className="grid min-h-0 flex-1 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
            {/* ── Left panel: Feature list ── */}
            <aside className="flex min-h-0 flex-col border-r border-desktop-border bg-desktop-bg-secondary/20">
              {repoLabel && (
                <div className="border-b border-desktop-border px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                    {t.featureExplorer.repository}
                  </div>
                  <div className="mt-1 truncate text-[12px] font-medium text-desktop-text-primary" title={defaultCodebase?.repoPath}>
                    {repoLabel}
                  </div>
                  {defaultCodebase?.branch && (
                    <div className="mt-0.5 text-[10px] text-desktop-text-secondary">{defaultCodebase.branch}</div>
                  )}
                </div>
              )}
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
                ) : groupedFeatures.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-desktop-text-secondary">
                    {t.featureExplorer.noFeatureMatches}
                  </div>
                ) : (
                  groupedFeatures.map(({ group, items }) => (
                    <div key={group.id} className="border-b border-desktop-border">
                      <div className="px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                          {group.name}
                        </div>
                        {group.description ? (
                          <div className="mt-1 text-[10px] leading-4 text-desktop-text-secondary/80">
                            {group.description}
                          </div>
                        ) : null}
                      </div>
                      <div className="px-2 pb-2">
                        {items.map((feature) => {
                          const isActive = feature.id === effectiveFeatureId;
                          return (
                            <button
                              key={feature.id}
                              onClick={() => handleSelectFeature(feature.id)}
                              className={`mb-1 w-full rounded-sm border px-2 py-1.5 text-left transition-colors ${
                                isActive
                                  ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
                                  : "border-transparent text-desktop-text-secondary hover:border-desktop-border hover:bg-desktop-bg-primary/70 hover:text-desktop-text-primary"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex h-5 w-7 items-center justify-center rounded-sm border text-[10px] font-semibold ${
                                  isActive
                                    ? "border-desktop-accent bg-desktop-bg-primary text-desktop-text-primary"
                                    : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary"
                                }`}>
                                  {featureCodeBadge(feature.id)}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                                  {feature.name}
                                </span>
                                <span className={`rounded-sm border px-1 py-0.5 text-[9px] font-medium ${
                                  feature.status === "shipped"
                                    ? "border-emerald-500/30 text-emerald-400"
                                    : "border-amber-500/30 text-amber-400"
                                }`}>
                                  {feature.status}
                                </span>
                              </div>
                              <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-current/80">
                                {feature.summary}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-current/70">
                                <span>{feature.sourceFileCount}f</span>
                                <span>{feature.pageCount}p</span>
                                <span>{feature.apiCount}a</span>
                                <span>{feature.updatedAt}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>

            {/* ── Middle panel: File tree ── */}
            <section className="flex min-h-0 flex-col border-r border-desktop-border bg-desktop-bg-primary">
              <div className="border-b border-desktop-border px-3 py-2">
                {activeFeature && (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="inline-flex h-5 w-7 items-center justify-center rounded-sm border border-desktop-accent bg-desktop-bg-active text-[10px] font-semibold text-desktop-text-primary">
                          {featureCodeBadge(activeFeature.id)}
                        </span>
                        <span className="truncate text-[13px] font-semibold text-desktop-text-primary">
                          {activeFeature.name}
                        </span>
                        <span className="text-[10px] text-desktop-text-secondary">
                          {activeFeature.sessionCount}s · {activeFeature.changedFiles}f
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-desktop-text-secondary">
                        {activeFeature.summary}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-desktop-text-secondary">
                        <span>{activeGroup?.name ?? activeFeature.group}</span>
                        <span>{activeFeature.pageCount}p</span>
                        <span>{activeFeature.apiCount}a</span>
                        <span>{activeFeature.sourceFileCount}f</span>
                      </div>
                    </div>
                    <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${
                      activeFeature.status === "shipped"
                        ? "border-emerald-500/30 text-emerald-400"
                        : "border-amber-500/30 text-amber-400"
                    }`}>
                      {activeFeature.status}
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_64px_48px_80px] border-b border-desktop-border bg-desktop-bg-secondary/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                <div>{t.featureExplorer.nameColumn}</div>
                <div>{t.featureExplorer.changeColumn}</div>
                <div>{t.featureExplorer.sessionsColumn}</div>
                <div>{t.featureExplorer.updatedColumn}</div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {featureDetailLoading ? (
                  <div className="px-3 py-4 text-xs text-desktop-text-secondary">Loading…</div>
                ) : fileTree.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-desktop-text-secondary">
                    {t.featureExplorer.noFilesSelected}
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
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setInspectorTab(tab.id)}
                        className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          inspectorTab === tab.id
                            ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
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
                    featureDetail={featureDetail}
                    t={t}
                  />
                )}

                {inspectorTab === "screenshot" && (
                  <ScreenshotPanel featureDetail={featureDetail} t={t} />
                )}

                {inspectorTab === "api" && (
                  <ApiPanel
                    featureDetail={featureDetail}
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
  t,
}: {
  activeFile: FileTreeNode | null;
  activeGroup: CapabilityGroup | null;
  featureDetail: FeatureDetail | null;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (!featureDetail) {
    return <div className="text-xs text-desktop-text-secondary">-</div>;
  }

  return (
    <div className="space-y-2">
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

      {activeFile && (
        <ContextSection title={t.featureExplorer.activeFile}>
          <div className="flex items-center gap-2 text-desktop-text-primary">
            <FileIcon path={activeFile.path} />
            <span className="truncate text-xs font-semibold">{activeFile.name}</span>
          </div>
          <div className="mt-1 truncate text-[10px] text-desktop-text-secondary">
            {activeFile.path}
          </div>
        </ContextSection>
      )}

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

      {featureDetail.relatedFeatures.length > 0 && (
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

  const pageDetails = featureDetail.pageDetails ?? featureDetail.pages.map((route) => ({
    name: route,
    route,
    description: "",
  }));

  return (
    <ContextSection title={t.featureExplorer.screenshotTab}>
      {pageDetails.length === 0 ? (
        <div className="text-[11px] text-desktop-text-secondary">{t.featureExplorer.noPagesDeclared}</div>
      ) : (
        <div className="space-y-2">
          {pageDetails.map((page) => (
            <div key={page.route} className="rounded-sm border border-desktop-border bg-desktop-bg-secondary p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium text-desktop-text-primary">{page.name}</div>
                  <div className="mt-1 break-all font-mono text-[10px] text-desktop-text-secondary">{page.route}</div>
                </div>
              </div>
              {page.description ? (
                <div className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{page.description}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
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

  const apiDetails = featureDetail?.apiDetails ?? featureDetail?.apis.map((declaration) => {
    const [method, endpoint] = declaration.split(/\s+/, 2);
    if (endpoint) {
      return { group: "", method, endpoint, description: "" };
    }
    return { group: "", method: "GET", endpoint: declaration, description: "" };
  }) ?? [];

  if (!featureDetail || apiDetails.length === 0) {
    return <div className="text-xs text-desktop-text-secondary">-</div>;
  }

  const selectedApi = apiDetails[selectedApiIdx] ?? apiDetails[0];
  const method = selectedApi.method;
  const apiPath = selectedApi.endpoint;

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
        {selectedApi.group || selectedApi.description ? (
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
        <div className="grid grid-cols-[minmax(0,1fr)_64px_48px_80px] items-center px-3 py-1 text-xs text-desktop-text-primary">
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
      className={`grid grid-cols-[minmax(0,1fr)_64px_48px_80px] items-center px-3 py-1 text-xs transition-colors ${
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
