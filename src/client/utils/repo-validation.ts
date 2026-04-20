"use client";

import { desktopAwareFetch } from "@/client/utils/diagnostics";

export async function isAccessibleRepoPath(repoPath: string): Promise<boolean> {
  const trimmed = repoPath.trim();
  if (!trimmed) return false;

  try {
    const response = await desktopAwareFetch(
      `/api/clone/branches?repoPath=${encodeURIComponent(trimmed)}`,
      { cache: "no-store" },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function collectAccessibleRepoPaths(repoPaths: string[]): Promise<Set<string>> {
  const uniquePaths = Array.from(new Set(repoPaths.map((repoPath) => repoPath.trim()).filter(Boolean)));
  const checks = await Promise.all(
    uniquePaths.map(async (repoPath) => ({
      repoPath,
      accessible: await isAccessibleRepoPath(repoPath),
    })),
  );

  return new Set(checks.filter((entry) => entry.accessible).map((entry) => entry.repoPath));
}
