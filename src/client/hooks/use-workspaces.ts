"use client";

import { useState, useEffect, useCallback } from "react";
import { desktopAwareFetch } from "../utils/diagnostics";

export interface WorkspaceData {
  id: string;
  title: string;
  status: "active" | "archived";
  metadata: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CodebaseData {
  id: string;
  workspaceId: string;
  repoPath: string;
  branch?: string;
  label?: string;
  isDefault: boolean;
  sourceType?: "local" | "github";
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UseWorkspacesReturn {
  workspaces: WorkspaceData[];
  loading: boolean;
  fetchWorkspaces: () => Promise<void>;
  createWorkspace: (title: string) => Promise<WorkspaceData | null>;
  archiveWorkspace: (id: string) => Promise<void>;
}

export function useWorkspaces(): UseWorkspacesReturn {
  const [workspaces, setWorkspaces] = useState<WorkspaceData[]>([]);
  // Start with loading=true since we fetch on mount
  const [loading, setLoading] = useState(true);

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await desktopAwareFetch("/api/workspaces?status=active");
      if (!res.ok) return;
      const data = await res.json();
      setWorkspaces(data.workspaces ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const createWorkspace = useCallback(async (title: string): Promise<WorkspaceData | null> => {
    const res = await desktopAwareFetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    await fetchWorkspaces();
    return data.workspace ?? null;
  }, [fetchWorkspaces]);

  const archiveWorkspace = useCallback(async (id: string): Promise<void> => {
    await desktopAwareFetch(`/api/workspaces/${id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    await fetchWorkspaces();
  }, [fetchWorkspaces]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  return { workspaces, loading, fetchWorkspaces, createWorkspace, archiveWorkspace };
}

export function useCodebases(workspaceId: string): {
  codebases: CodebaseData[];
  fetchCodebases: () => Promise<void>;
} {
  const [codebases, setCodebases] = useState<CodebaseData[]>([]);

  const fetchCodebases = useCallback(async () => {
    // Skip if workspaceId is missing or is a placeholder (static export mode)
    if (!workspaceId || workspaceId === "__placeholder__") return;
    const res = await desktopAwareFetch(`/api/workspaces/${workspaceId}/codebases`);
    if (!res.ok) return;
    const data = await res.json();
    setCodebases(data.codebases ?? []);
  }, [workspaceId]);

  useEffect(() => {
    fetchCodebases();
  }, [fetchCodebases]);

  return { codebases, fetchCodebases };
}
