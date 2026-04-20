import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, type Task } from "@/core/models/task";
import type { RoutaSessionRecord } from "@/core/acp/http-session-store";

const taskStore = {
  get: vi.fn<(_: string) => Promise<Task | null>>(),
};

const hydrateFromDb = vi.fn<() => Promise<void>>();
const getSession = vi.fn<(sessionId: string) => RoutaSessionRecord | undefined>();

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({ taskStore }),
}));

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore: () => ({
    hydrateFromDb,
    getSession,
  }),
}));

import { GET } from "../route";

describe("/api/tasks/[taskId]/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hydrateFromDb.mockResolvedValue();
  });

  it("returns newest-first normalized runs across ACP and A2A sessions", async () => {
    const task = createTask({
      id: "task-1",
      title: "Normalize lane runs",
      objective: "Build a read-only ledger",
      workspaceId: "workspace-1",
    });
    task.laneSessions = [
      {
        sessionId: "session-embedded",
        columnId: "todo",
        stepId: "step-1",
        stepName: "Plan",
        provider: "claude",
        specialistName: "Planner",
        transport: "acp",
        status: "completed",
        startedAt: "2026-03-26T08:00:00.000Z",
        completedAt: "2026-03-26T08:05:00.000Z",
      },
      {
        sessionId: "a2a-session-1",
        columnId: "dev",
        stepId: "step-2",
        stepName: "Implement",
        transport: "a2a",
        externalTaskId: "remote-task-1",
        contextId: "ctx-1",
        specialistName: "Remote Builder",
        status: "running",
        startedAt: "2026-03-27T08:00:00.000Z",
      },
      {
        sessionId: "session-runner",
        columnId: "review",
        transport: "acp",
        status: "failed",
        startedAt: "2026-03-27T07:00:00.000Z",
      },
    ];

    taskStore.get.mockResolvedValue(task);
    getSession.mockImplementation((sessionId) => {
      if (sessionId === "session-embedded") {
        return {
          sessionId,
          cwd: "/tmp/repo",
          workspaceId: "workspace-1",
          provider: "claude",
          createdAt: "2026-03-26T08:00:00.000Z",
          executionMode: "embedded",
          acpStatus: "ready",
        };
      }

      if (sessionId === "session-runner") {
        return {
          sessionId,
          cwd: "/tmp/repo",
          workspaceId: "workspace-1",
          provider: "opencode",
          createdAt: "2026-03-27T07:00:00.000Z",
          executionMode: "runner",
          ownerInstanceId: "runner-1",
          acpStatus: "error",
        };
      }

      return undefined;
    });

    const response = await GET(new NextRequest("http://localhost/api/tasks/task-1/runs"), {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(hydrateFromDb).toHaveBeenCalledTimes(1);
    expect(data.runs).toEqual([
      expect.objectContaining({
        id: "a2a-session-1",
        kind: "a2a_task",
        status: "running",
        resumeTarget: { type: "external_task", id: "remote-task-1" },
      }),
      expect.objectContaining({
        id: "session-runner",
        kind: "runner_acp",
        status: "failed",
        ownerInstanceId: "runner-1",
        resumeTarget: { type: "session", id: "session-runner" },
      }),
      expect.objectContaining({
        id: "session-embedded",
        kind: "embedded_acp",
        status: "completed",
        provider: "claude",
        resumeTarget: { type: "session", id: "session-embedded" },
      }),
    ]);
  });

  it("treats a running lane session as failed when the linked ACP session is already in error", async () => {
    const task = createTask({
      id: "task-2",
      title: "Surface session error state",
      objective: "Reflect ACP failure in the run ledger",
      workspaceId: "workspace-1",
    });
    task.laneSessions = [
      {
        sessionId: "session-stuck-running",
        columnId: "review",
        transport: "acp",
        status: "running",
        startedAt: "2026-03-27T09:00:00.000Z",
      },
    ];

    taskStore.get.mockResolvedValue(task);
    getSession.mockReturnValue({
      sessionId: "session-stuck-running",
      cwd: "/tmp/repo",
      workspaceId: "workspace-1",
      provider: "codex",
      createdAt: "2026-03-27T09:00:00.000Z",
      executionMode: "embedded",
      acpStatus: "error",
      acpError: "Prompt failed",
    });

    const response = await GET(new NextRequest("http://localhost/api/tasks/task-2/runs"), {
      params: Promise.resolve({ taskId: "task-2" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.runs).toEqual([
      expect.objectContaining({
        id: "session-stuck-running",
        kind: "embedded_acp",
        status: "failed",
      }),
    ]);
  });

  it("returns 404 when the task does not exist", async () => {
    taskStore.get.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost/api/tasks/missing/runs"), {
      params: Promise.resolve({ taskId: "missing" }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: "Task not found" });
  });
});
