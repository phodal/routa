"use client";

import { useState, useCallback, useEffect } from "react";
import type {
  GitLogAdapter,
  GitRefsResult,
  GitCommit,
  GitCommitDetail,
  GitLogQuery,
} from "./types";

export interface UseGitLogState {
  refs: GitRefsResult | null;
  commits: GitCommit[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  selectedSha: string | null;
  detail: GitCommitDetail | null;
  detailLoading: boolean;
  searchText: string;
  activeBranches: string[];
  error: string | null;
}

export interface UseGitLogActions {
  loadRefs: () => Promise<void>;
  loadLog: () => Promise<void>;
  loadMore: () => Promise<void>;
  selectCommit: (sha: string) => void;
  setSearch: (text: string) => void;
  toggleBranch: (branch: string) => void;
  setActiveBranches: (branches: string[]) => void;
  refresh: () => Promise<void>;
}

const PAGE_SIZE = 40;

export function useGitLog(
  adapter: GitLogAdapter,
  repoPath: string,
): UseGitLogState & UseGitLogActions {
  const [refs, setRefs] = useState<GitRefsResult | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [activeBranches, setActiveBranches] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const buildQuery = useCallback(
    (skip: number): GitLogQuery => ({
      repoPath,
      branches: activeBranches.length > 0 ? activeBranches : undefined,
      search: searchText || undefined,
      limit: PAGE_SIZE,
      skip,
    }),
    [activeBranches, repoPath, searchText],
  );

  const loadRefs = useCallback(async () => {
    try {
      const result = await adapter.getRefs(repoPath);
      setRefs(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [adapter, repoPath]);

  const loadLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await adapter.getLog(buildQuery(0));
      setCommits(page.commits);
      setTotal(page.total);
      setHasMore(page.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [adapter, buildQuery]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const page = await adapter.getLog(buildQuery(commits.length));
      setCommits((prev) => [...prev, ...page.commits]);
      setTotal(page.total);
      setHasMore(page.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [adapter, buildQuery, commits.length, hasMore, loadingMore]);

  const selectCommit = useCallback(
    (sha: string) => {
      setSelectedSha(sha);
      setDetailLoading(true);
      adapter
        .getCommitDetail(repoPath, sha)
        .then((d) => setDetail(d))
        .catch(() => setDetail(null))
        .finally(() => setDetailLoading(false));
    },
    [adapter, repoPath],
  );

  const setSearch = useCallback((text: string) => {
    setSearchText(text);
  }, []);

  const toggleBranch = useCallback((branch: string) => {
    setActiveBranches((prev) =>
      prev.includes(branch) ? prev.filter((b) => b !== branch) : [...prev, branch],
    );
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadRefs(), loadLog()]);
  }, [loadRefs, loadLog]);

  useEffect(() => {
    setRefs(null);
    setCommits([]);
    setTotal(0);
    setHasMore(false);
    setSelectedSha(null);
    setDetail(null);
    setDetailLoading(false);
    setActiveBranches((prev) => (prev.length > 0 ? [] : prev));
  }, [repoPath]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  return {
    refs,
    commits,
    total,
    hasMore,
    loading,
    loadingMore,
    selectedSha,
    detail,
    detailLoading,
    searchText,
    activeBranches,
    error,
    loadRefs,
    loadLog,
    loadMore,
    selectCommit,
    setSearch,
    toggleBranch,
    setActiveBranches,
    refresh,
  };
}
