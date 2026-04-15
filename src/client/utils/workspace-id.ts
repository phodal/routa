import type { WorkspaceData } from "@/client/hooks/use-workspaces";

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function normalizeWorkspaceQueryId(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || !WORKSPACE_ID_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

export function resolveWorkspaceSelection(
  selectedWorkspaceId: string,
  urlWorkspaceId: string | null,
  workspaces: WorkspaceData[],
): string {
  const normalizedSelectedWorkspaceId = normalizeWorkspaceQueryId(selectedWorkspaceId);
  if (normalizedSelectedWorkspaceId) {
    return normalizedSelectedWorkspaceId;
  }

  const normalizedUrlWorkspaceId = normalizeWorkspaceQueryId(urlWorkspaceId);
  if (normalizedUrlWorkspaceId && workspaces.some((workspace) => workspace.id === normalizedUrlWorkspaceId)) {
    return normalizedUrlWorkspaceId;
  }

  return workspaces[0]?.id ?? "";
}
