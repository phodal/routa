"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { AcpProviderDropdown } from "@/client/components/acp-provider-dropdown";
import { useAcp } from "@/client/hooks/use-acp";
import { storePendingPrompt } from "@/client/utils/pending-prompt";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

interface RepoSlideLaunchPoint {
  name: string;
  path: string;
  reason?: string;
}

interface RepoSlideFocusDirectory {
  name: string;
  path: string;
  fileCount: number;
  children: Array<{
    name: string;
    type: "file" | "directory";
    fileCount?: number;
  }>;
}

interface RepoSlideResponse {
  codebase: {
    id: string;
    label?: string;
    repoPath: string;
    sourceType: string;
    sourceUrl?: string;
    branch?: string;
  };
  summary: {
    totalFiles: number;
    totalDirectories: number;
    topLevelFolders: string[];
    sourceType: string;
    branch?: string;
  };
  context: {
    rootFiles: string[];
    entryPoints: RepoSlideLaunchPoint[];
    keyFiles: RepoSlideLaunchPoint[];
    focusDirectories: RepoSlideFocusDirectory[];
  };
  launch: {
    skillName: string;
    skillRepoPath?: string;
    skillAvailable: boolean;
    unavailableReason?: string;
    prompt: string;
  };
}

export function RepoSlidePageClient() {
  const params = useParams<{ workspaceId: string; codebaseId: string }>();
  const router = useRouter();
  const workspaceId = params.workspaceId;
  const codebaseId = params.codebaseId;
  const acp = useAcp();

  const [data, setData] = useState<RepoSlideResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (acp.connected || acp.loading) return;
    void acp.connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acp.connected, acp.loading]);

  useEffect(() => {
    if (!workspaceId || !codebaseId) return;

    let cancelled = false;

    const fetchLaunchContext = async () => {
      try {
        const response = await desktopAwareFetch(
          `/api/workspaces/${workspaceId}/codebases/${codebaseId}/reposlide`,
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const nextData = await response.json() as RepoSlideResponse;
        if (!cancelled) {
          setData(nextData);
          setLoading(false);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
          setLoading(false);
        }
      }
    };

    void fetchLaunchContext();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, codebaseId]);

  const repoName = useMemo(() => {
    if (!data) return "RepoSlide";
    return data.codebase.label ?? data.codebase.repoPath.split("/").pop() ?? "RepoSlide";
  }, [data]);

  const selectableProvider = useMemo(() => {
    const preferredProvider = acp.providers.find(
      (provider) => provider.id === acp.selectedProvider && provider.status !== "unavailable",
    );
    if (preferredProvider) return preferredProvider.id;
    return acp.providers.find((provider) => provider.status !== "unavailable")?.id;
  }, [acp.providers, acp.selectedProvider]);

  const handleLaunch = useCallback(async () => {
    if (!data || !workspaceId) return;

    setLaunching(true);
    setError(null);

    try {
      if (!acp.connected) {
        await acp.connect();
      }

      const provider = selectableProvider;
      if (!provider) {
        throw new Error("No available ACP provider for RepoSlide launch.");
      }
      if (!data.launch.skillAvailable) {
        throw new Error(data.launch.unavailableReason ?? "slide-skill is not available for RepoSlide.");
      }
      if (provider !== acp.selectedProvider) {
        acp.setProvider(provider);
      }

      const result = await acp.createSession(
        data.codebase.repoPath,
        provider,
        undefined,
        "DEVELOPER",
        workspaceId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        data.codebase.branch,
        "full",
      );

      if (!result?.sessionId) {
        throw new Error("RepoSlide session creation returned no session id.");
      }

      storePendingPrompt(result.sessionId, {
        text: data.launch.prompt,
        skillName: data.launch.skillName,
        skillRepoPath: data.launch.skillRepoPath,
      });

      router.push(
        `/workspace/${workspaceId}/sessions/${result.sessionId}?source=reposlide&codebaseId=${codebaseId}`,
      );
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : String(launchError));
      setLaunching(false);
    }
  }, [acp, codebaseId, data, router, selectableProvider, workspaceId]);

  const content = (
    <div className="flex h-full flex-col bg-desktop-bg-primary" data-testid="reposlide-root">
      <div className="flex shrink-0 items-center justify-between border-b border-desktop-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="text-xs text-desktop-text-secondary hover:text-desktop-text-primary"
          >
            ← Back
          </button>
          <div>
            <div className="text-sm font-semibold text-desktop-text-primary">RepoSlide</div>
            <div className="text-xs text-desktop-text-secondary">
              Agent-driven deck generation via `slide-skill`
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <AcpProviderDropdown
            providers={acp.providers}
            selectedProvider={selectableProvider ?? acp.selectedProvider}
            onProviderChange={acp.setProvider}
            disabled={launching || acp.loading}
            ariaLabel="Select RepoSlide provider"
          />
          <button
            type="button"
            onClick={handleLaunch}
            disabled={loading || launching || !data || !selectableProvider || !data.launch.skillAvailable}
            className="rounded-lg bg-[var(--dt-accent)] px-3 py-2 text-sm font-medium text-[var(--dt-accent-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {launching ? "Launching…" : "Launch RepoSlide"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-5 py-5">
        {loading && (
          <div className="text-sm text-desktop-text-secondary">Loading RepoSlide context…</div>
        )}
        {error && (
          <div className="rounded-xl border border-rose-300/50 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-950/20 dark:text-rose-300">
            {error}
          </div>
        )}
        {!loading && !error && data && (
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
            <section className="grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
              <div className="rounded-2xl border border-desktop-border bg-white p-5 shadow-sm dark:bg-[#12141c]">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--dt-accent)]">
                  Target Repository
                </div>
                <h1 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                  {repoName}
                </h1>
                <div className="mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                  {data.codebase.repoPath}
                </div>
                {data.codebase.sourceUrl && (
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Source URL: {data.codebase.sourceUrl}
                  </div>
                )}
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard label="Branch" value={data.codebase.branch ?? "unknown"} />
                  <StatCard label="Source" value={data.codebase.sourceType} />
                  <StatCard label="Files" value={String(data.summary.totalFiles)} />
                  <StatCard label="Directories" value={String(data.summary.totalDirectories)} />
                </div>
                <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  This page no longer renders a hardcoded slide deck. It starts an ACP session in the selected repo,
                  injects `slide-skill`, and asks the agent to build a real deck artifact.
                </div>
                {!data.launch.skillAvailable && (
                  <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/20 dark:text-amber-200">
                    RepoSlide launch is blocked because `slide-skill` is unavailable.
                    {data.launch.unavailableReason ? ` ${data.launch.unavailableReason}` : ""}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-desktop-border bg-white p-5 shadow-sm dark:bg-[#12141c]">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--dt-accent)]">
                  Launch Plan
                </div>
                <ul className="mt-3 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                  <li>1. Create a new `DEVELOPER` ACP session with the repo as `cwd`.</li>
                  <li>2. Load `slide-skill` from Routa&apos;s slide tooling when available.</li>
                  <li>3. Auto-send a structured prompt with repo context and orientation targets.</li>
                  <li>4. Continue in the session page and let the agent generate the PPTX deck.</li>
                </ul>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  Skill source: {data.launch.skillRepoPath ?? "global / installed skill resolution"}
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-3">
              <InfoCard title="Top-level folders" items={data.summary.topLevelFolders} emptyLabel="No folders detected" />
              <InfoCard title="Root files" items={data.context.rootFiles} emptyLabel="No root files detected" />
              <InfoCard
                title="Key files"
                items={data.context.keyFiles.map((file) => file.path)}
                emptyLabel="No key files detected"
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-2xl border border-desktop-border bg-white p-5 shadow-sm dark:bg-[#12141c]">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Entry Points & Anchors
                </h2>
                <div className="mt-4 space-y-3">
                  {data.context.entryPoints.length === 0 && (
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      No entry points detected in the scanned tree.
                    </div>
                  )}
                  {data.context.entryPoints.map((item) => (
                    <div
                      key={`${item.path}-${item.reason ?? item.name}`}
                      className="rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800"
                    >
                      <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                        {item.path}
                      </div>
                      <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                        {item.reason ?? item.name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-desktop-border bg-white p-5 shadow-sm dark:bg-[#12141c]">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Largest Top-level Areas
                </h2>
                <div className="mt-4 space-y-3">
                  {data.context.focusDirectories.length === 0 && (
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      No focus directories detected in the scanned tree.
                    </div>
                  )}
                  {data.context.focusDirectories.map((directory) => (
                    <div
                      key={directory.path}
                      className="rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-800"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            {directory.path}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {directory.fileCount} files scanned
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {directory.children.slice(0, 10).map((child) => (
                          <span
                            key={`${directory.path}-${child.name}`}
                            className="rounded-full border border-slate-200 px-2 py-1 text-[11px] text-slate-600 dark:border-slate-800 dark:text-slate-300"
                          >
                            {child.type === "directory" ? `${child.name}/` : child.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-desktop-border bg-white p-5 shadow-sm dark:bg-[#12141c]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Prompt Preview
                  </h2>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    This is the first task the agent will receive.
                  </div>
                </div>
              </div>
              <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100">
                {data.launch.prompt}
              </pre>
            </section>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <DesktopAppShell workspaceId={workspaceId}>
      {content}
    </DesktopAppShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
        {value}
      </div>
    </div>
  );
}

function InfoCard({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-desktop-border bg-white p-5 shadow-sm dark:bg-[#12141c]">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {items.length === 0 && (
          <div className="text-sm text-slate-500 dark:text-slate-400">{emptyLabel}</div>
        )}
        {items.map((item) => (
          <span
            key={item}
            className="rounded-full border border-slate-200 px-2 py-1 text-[11px] text-slate-600 dark:border-slate-800 dark:text-slate-300"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
