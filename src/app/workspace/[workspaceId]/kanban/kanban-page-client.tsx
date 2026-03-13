"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAcp } from "@/client/hooks/use-acp";
import { useWorkspaces, useCodebases } from "@/client/hooks/use-workspaces";
import { AppHeader } from "@/client/components/app-header";
import { KanbanTab } from "./kanban-tab";
import type { KanbanBoardInfo, TaskInfo, SessionInfo } from "../types";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
}

interface KanbanAgentPromptOptions {
  provider?: string;
  role?: string;
  toolMode?: "essential" | "full";
}

export function KanbanPageClient() {
  const params = useParams();
  const router = useRouter();
  const rawWorkspaceId = params.workspaceId as string;
  const workspaceId =
    rawWorkspaceId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? rawWorkspaceId)
      : rawWorkspaceId;
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
    // We intentionally exclude 'acp' from deps to avoid re-connecting on every acp change
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Handler for agent input - creates session and sends prompt
  const handleAgentPrompt = useCallback(async (
    promptText: string,
    options?: KanbanAgentPromptOptions,
  ): Promise<string | null> => {
    if (!acp.connected) {
      await acp.connect();
    }

    const defaultCodebase = codebases.find((c) => c.isDefault) ?? codebases[0];
    const cwd = defaultCodebase?.repoPath;
    const provider = options?.provider ?? acp.selectedProvider ?? undefined;

    // Create a new session with DEVELOPER role (has access to Kanban tools)
    const result = await acp.createSession(
      cwd,
      provider,
      undefined,
      options?.role ?? "DEVELOPER",
      workspaceId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      options?.toolMode,
    );

    if (!result?.sessionId) {
      return null;
    }

    // Send the prompt - acp.prompt uses the current session from createSession
    await acp.prompt(promptText);

    return result.sessionId;
  }, [acp, codebases, workspaceId]);

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-[#0a0c10]">
      <AppHeader
        workspaceId={workspaceId}
        workspaces={workspacesHook.workspaces}
        workspacesLoading={workspacesHook.loading}
        onWorkspaceSelect={handleWorkspaceSelect}
        onWorkspaceCreate={handleWorkspaceCreate}
        variant="dashboard"
        rightSlot={
          <a
            href={`/workspace/${workspaceId}`}
            className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Dashboard
          </a>
        }
      />
      <main className="flex-1 min-h-0 overflow-hidden px-6 py-6">
        <div className="flex h-full flex-col">
          <KanbanTab
            workspaceId={workspaceId}
            boards={boards}
            tasks={tasks}
            sessions={sessions}
            providers={acp.providers}
            specialists={specialists}
            codebases={codebases}
            onRefresh={() => setRefreshKey((k) => k + 1)}
            acp={acp}
            onAgentPrompt={handleAgentPrompt}
          />
        </div>
      </main>
    </div>
  );
}
