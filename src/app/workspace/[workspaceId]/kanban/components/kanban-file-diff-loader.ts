"use client";

import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { KanbanFileChangeItem } from "../kanban-file-changes-types";

interface LoadKanbanFileDiffParams {
  file: KanbanFileChangeItem;
  taskId?: string;
  workspaceId: string;
  codebaseId?: string;
  staged?: boolean;
}

export async function loadKanbanFileDiff({
  file,
  taskId,
  workspaceId,
  codebaseId,
  staged = false,
}: LoadKanbanFileDiffParams): Promise<string | null> {
  const inlineDiff = file.patch ?? file.diff;
  if (typeof inlineDiff === "string") {
    return inlineDiff;
  }

  if (taskId) {
    const controller = new AbortController();
    const params = new URLSearchParams({
      path: file.path,
      status: file.status,
    });
    if (file.previousPath) {
      params.set("previousPath", file.previousPath);
    }
    const response = await desktopAwareFetch(
      `/api/tasks/${encodeURIComponent(taskId)}/changes/file?${params.toString()}`,
      { cache: "no-store", signal: controller.signal }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Failed to load diff");
    }
    return data.diff?.patch || null;
  }

  if (!codebaseId) {
    return null;
  }

  const params = new URLSearchParams({ path: file.path });
  if (staged) {
    params.set("staged", "true");
  }

  const response = await desktopAwareFetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/codebases/${encodeURIComponent(codebaseId)}/git/diff?${params.toString()}`,
    { cache: "no-store" }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Failed to load diff");
  }
  return data.diff || null;
}
