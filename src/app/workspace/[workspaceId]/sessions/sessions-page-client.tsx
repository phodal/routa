"use client";

import { useCallback, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { SessionPanel } from "@/client/components/session-panel";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useWorkspaces } from "@/client/hooks/use-workspaces";

export function SessionsPageClient() {
  const params = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const workspacesHook = useWorkspaces();
  const [refreshKey, setRefreshKey] = useState(0);

  const workspaceId = typeof params.workspaceId === "string" ? params.workspaceId : "default";
  const activeWorkspace = useMemo(
    () => workspacesHook.workspaces.find((workspace) => workspace.id === workspaceId) ?? null,
    [workspaceId, workspacesHook.workspaces],
  );

  const handleWorkspaceSelect = useCallback((nextWorkspaceId: string) => {
    router.push(`/workspace/${nextWorkspaceId}/sessions`);
  }, [router]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const workspace = await workspacesHook.createWorkspace(title);
    if (workspace) {
      router.push(`/workspace/${workspace.id}/sessions`);
    }
  }, [router, workspacesHook]);

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={activeWorkspace?.title}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId}
          onSelect={handleWorkspaceSelect}
          onCreate={handleWorkspaceCreate}
          loading={workspacesHook.loading}
          desktop
        />
      )}
    >
      <div className="desktop-theme h-full overflow-y-auto bg-[var(--dt-bg-secondary)]">
        <div className="mx-auto flex h-full max-w-5xl flex-col px-4 py-4">
          <div className="mb-4 border-b border-[var(--dt-border)] pb-3">
            <h1 className="text-lg font-semibold text-[var(--dt-text-primary)]">Sessions</h1>
            <p className="mt-1 text-sm text-[var(--dt-text-secondary)]">
              Browse recent runs in this workspace and jump back into a session.
            </p>
          </div>

          <div className="min-h-0 flex-1 rounded-lg border border-[var(--dt-border)] bg-[var(--dt-bg-primary)]">
            <SessionPanel
              selectedSessionId={null}
              onSelect={(sessionId) => router.push(`/workspace/${workspaceId}/sessions/${sessionId}`)}
              refreshKey={refreshKey}
              onSessionDeleted={() => setRefreshKey((value) => value + 1)}
              workspaceId={workspaceId}
            />
          </div>
        </div>
      </div>
    </DesktopAppShell>
  );
}
