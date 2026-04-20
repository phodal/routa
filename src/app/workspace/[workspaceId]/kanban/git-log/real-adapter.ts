/**
 * Real Git adapter that fetches data from the Next.js API routes.
 * Used in production; the mock adapter is swapped in for UI development.
 */

import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type {
  GitLogAdapter,
  GitLogPage,
  GitLogQuery,
  GitRefsResult,
  GitCommitDetail,
} from "./types";

export class RealGitAdapter implements GitLogAdapter {
  async getRefs(repoPath: string): Promise<GitRefsResult> {
    const url = `/api/git/refs?repoPath=${encodeURIComponent(repoPath)}`;
    const res = await desktopAwareFetch(url, { cache: "no-store" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `Failed to fetch refs: ${res.status}`);
    }
    return res.json();
  }

  async getLog(query: GitLogQuery): Promise<GitLogPage> {
    const params = new URLSearchParams({
      repoPath: query.repoPath,
      limit: String(query.limit ?? 40),
      skip: String(query.skip ?? 0),
    });
    if (query.branches && query.branches.length > 0) {
      params.set("branches", query.branches.join(","));
    }
    if (query.search) {
      params.set("search", query.search);
    }

    const res = await desktopAwareFetch(`/api/git/log?${params.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `Failed to fetch log: ${res.status}`);
    }
    return res.json();
  }

  async getCommitDetail(
    repoPath: string,
    sha: string,
  ): Promise<GitCommitDetail> {
    const params = new URLSearchParams({
      repoPath,
      sha,
    });
    const res = await desktopAwareFetch(`/api/git/commit?${params.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `Failed to fetch commit detail: ${res.status}`);
    }
    return res.json();
  }
}
