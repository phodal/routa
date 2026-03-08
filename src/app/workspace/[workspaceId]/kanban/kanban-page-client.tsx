"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAcp } from "@/client/hooks/use-acp";
import { useWorkspaces, useCodebases } from "@/client/hooks/use-workspaces";
import { AppHeader } from "@/client/components/app-header";
import { KanbanTab } from "../kanban-tab";
import type { KanbanBoardInfo, TaskInfo, SessionInfo } from "../types";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
}

export function KanbanPageClient() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.workspaceId as string;
  const acp = useAcp();
  const workspacesHook = useWorkspaces();
  const { codebases } = useCodebases(workspaceId);

  const [boards, setBoards] = useState<KanbanBoardInfo[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Auto-connect ACP
  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
  }, [acp.connected, acp.loading]);

  // Fetch boards
  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        setBoards([]);
        const res = await fetch(`/api/kanban/boards?workspaceId=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setBoards(Array.isArray(data?.boards) ? data.boards : []);
      } catch {
        if (controller.signal.aborted) return;
        setBoards([]);
      }
    })();

    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  // Fetch tasks
  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        setTasks([]);
        const res = await fetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      } catch {
        if (controller.signal.aborted) return;
        setTasks([]);
      }
    })();

    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  // Fetch sessions
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`, { cache: "no-store" });
        const data = await res.json();
        setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
      } catch { /* ignore */ }
    })();
  }, [workspaceId, refreshKey]);

  // Fetch specialists
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/specialists?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
        const data = await res.json();
        setSpecialists(Array.isArray(data?.specialists) ? data.specialists : []);
      } catch { /* ignore */ }
    })();
  }, [workspaceId]);

  const handleWorkspaceSelect = (wsId: string) => {
    router.push(`/workspace/${wsId}/kanban`);
  };

  const handleWorkspaceCreate = async (title: string) => {
    const newWs = await workspacesHook.createWorkspace(title);
    if (newWs) {
      router.push(`/workspace/${newWs.id}/kanban`);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-[#0a0c10]">
      <AppHeader
        workspaceId={workspaceId}
        workspaces={workspacesHook.workspaces}
        workspacesLoading={workspacesHook.loading}
        onWorkspaceSelect={handleWorkspaceSelect}
        onWorkspaceCreate={handleWorkspaceCreate}
        variant="dashboard"
      />
      <main className="flex-1 px-6 py-6">
        <KanbanTab
          workspaceId={workspaceId}
          boards={boards}
          tasks={tasks}
          sessions={sessions}
          providers={acp.providers}
          specialists={specialists}
          codebases={codebases}
          onRefresh={() => setRefreshKey((k) => k + 1)}
        />
      </main>
    </div>
  );
}

