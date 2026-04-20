import { useState, useCallback } from "react";

interface UseGitOperationsProps {
  workspaceId: string;
  codebaseId: string;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

interface GitOperationResult {
  success: boolean;
  error?: string;
}

export function useGitOperations({ workspaceId, codebaseId, onSuccess, onError }: UseGitOperationsProps) {
  const [loading, setLoading] = useState(false);

  const stageFiles = useCallback(async (files: string[]): Promise<GitOperationResult> => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/codebases/${codebaseId}/git/stage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files, confirm: true }),
        }
      );

      const data = await response.json();
      
      if (data.success) {
        onSuccess?.();
        return { success: true };
      } else {
        onError?.(data.error || "Failed to stage files");
        return { success: false, error: data.error };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to stage files";
      onError?.(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [workspaceId, codebaseId, onSuccess, onError]);

  const unstageFiles = useCallback(async (files: string[]): Promise<GitOperationResult> => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/codebases/${codebaseId}/git/unstage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files }),
        }
      );

      const data = await response.json();
      
      if (data.success) {
        onSuccess?.();
        return { success: true };
      } else {
        onError?.(data.error || "Failed to unstage files");
        return { success: false, error: data.error };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to unstage files";
      onError?.(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [workspaceId, codebaseId, onSuccess, onError]);

  const createCommit = useCallback(async (message: string, files?: string[]): Promise<GitOperationResult & { sha?: string }> => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/codebases/${codebaseId}/git/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, files }),
        }
      );

      const data = await response.json();
      
      if (data.success) {
        onSuccess?.();
        return { success: true, sha: data.sha };
      } else {
        onError?.(data.error || "Failed to create commit");
        return { success: false, error: data.error };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create commit";
      onError?.(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [workspaceId, codebaseId, onSuccess, onError]);

  const discardChanges = useCallback(async (files: string[]): Promise<GitOperationResult> => {
    // This is a destructive operation, might need confirmation
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/codebases/${codebaseId}/git/discard`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files, confirm: true }),
        }
      );

      const data = await response.json();
      
      if (data.success) {
        onSuccess?.();
        return { success: true };
      } else {
        onError?.(data.error || "Failed to discard changes");
        return { success: false, error: data.error };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to discard changes";
      onError?.(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [workspaceId, codebaseId, onSuccess, onError]);

  const getCommits = useCallback(async (limit = 20): Promise<any[]> => {
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/codebases/${codebaseId}/git/commits?limit=${limit}`,
        { method: "GET" }
      );

      const data = await response.json();
      return data.commits || [];
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to get commits";
      onError?.(message);
      return [];
    }
  }, [workspaceId, codebaseId, onError]);

  const getFileDiff = useCallback(async (filePath: string, staged = false): Promise<string | null> => {
    try {
      const params = new URLSearchParams({ path: filePath });
      if (staged) params.set("staged", "true");

      const response = await fetch(
        `/api/workspaces/${workspaceId}/codebases/${codebaseId}/git/diff?${params}`,
        { method: "GET" }
      );

      const data = await response.json();
      return data.diff || null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to get file diff";
      onError?.(message);
      return null;
    }
  }, [workspaceId, codebaseId, onError]);

  const getCommitDiff = useCallback(async (commitSha: string, filePath?: string): Promise<string | null> => {
    try {
      const params = new URLSearchParams();
      if (filePath) params.set("path", filePath);

      const response = await fetch(
        `/api/workspaces/${workspaceId}/codebases/${codebaseId}/git/commits/${commitSha}/diff?${params}`,
        { method: "GET" }
      );

      const data = await response.json();
      return data.diff || null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to get commit diff";
      onError?.(message);
      return null;
    }
  }, [workspaceId, codebaseId, onError]);

  const pullCommits = useCallback(async (remote = "origin", branch?: string): Promise<GitOperationResult> => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/codebases/${codebaseId}/git/pull`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ remote, branch }),
        }
      );

      const data = await response.json();

      if (data.success) {
        onSuccess?.();
        return { success: true };
      } else {
        onError?.(data.error || "Failed to pull commits");
        return { success: false, error: data.error };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to pull commits";
      onError?.(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [workspaceId, codebaseId, onSuccess, onError]);

  const rebaseBranch = useCallback(async (onto: string): Promise<GitOperationResult> => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/codebases/${codebaseId}/git/rebase`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ onto }),
        }
      );

      const data = await response.json();

      if (data.success) {
        onSuccess?.();
        return { success: true };
      } else {
        onError?.(data.error || "Failed to rebase branch");
        return { success: false, error: data.error };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to rebase branch";
      onError?.(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [workspaceId, codebaseId, onSuccess, onError]);

  const resetBranch = useCallback(async (to: string, mode: "soft" | "hard", confirm = false): Promise<GitOperationResult> => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/codebases/${codebaseId}/git/reset`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to, mode, confirm }),
        }
      );

      const data = await response.json();

      if (data.success) {
        onSuccess?.();
        return { success: true };
      } else {
        onError?.(data.error || "Failed to reset branch");
        return { success: false, error: data.error };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reset branch";
      onError?.(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [workspaceId, codebaseId, onSuccess, onError]);

  const exportChanges = useCallback(async (files?: string[], format: "patch" | "diff" = "patch"): Promise<GitOperationResult & { patch?: string; filename?: string }> => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/codebases/${codebaseId}/git/export`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files, format }),
        }
      );

      const data = await response.json();

      if (data.success) {
        return { success: true, patch: data.patch, filename: data.filename };
      } else {
        onError?.(data.error || "Failed to export changes");
        return { success: false, error: data.error };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to export changes";
      onError?.(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [workspaceId, codebaseId, onError]);

  return {
    stageFiles,
    unstageFiles,
    createCommit,
    discardChanges,
    getCommits,
    getFileDiff,
    getCommitDiff,
    pullCommits,
    rebaseBranch,
    resetBranch,
    exportChanges,
    loading,
  };
}
