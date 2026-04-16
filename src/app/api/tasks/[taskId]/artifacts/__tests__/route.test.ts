import { v4 as uuidv4 } from "uuid";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifact } from "@/core/models/artifact";
import { createTask, TaskStatus, type Task } from "@/core/models/task";
import { InMemoryArtifactStore } from "@/core/store/artifact-store";
import type { ArtifactType } from "@/core/models/artifact";

const taskStore = {
  get: vi.fn<(_: string) => Promise<Task | null>>(),
};

const artifactStore = new InMemoryArtifactStore();
const provideArtifact = vi.fn(async (params: {
  agentId: string;
  type: ArtifactType;
  taskId: string;
  workspaceId: string;
  content: string;
  context?: string;
  requestId?: string;
  metadata?: Record<string, string>;
}) => {
  const artifact = createArtifact({
    id: uuidv4(),
    type: params.type,
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    providedByAgentId: params.agentId,
    content: params.content,
    context: params.context,
    requestId: params.requestId,
    status: "provided",
    metadata: params.metadata,
  });
  await artifactStore.saveArtifact(artifact);
  return {
    success: true as const,
    data: {
      artifactId: artifact.id,
      type: artifact.type,
      taskId: artifact.taskId,
      status: artifact.status,
    },
  };
});

const system = {
  taskStore,
  artifactStore,
  tools: {
    provideArtifact,
  },
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

import { GET, POST } from "../route";

describe("/api/tasks/[taskId]/artifacts", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    taskStore.get.mockResolvedValue(createTask({
      id: "task-1",
      title: "Attach screenshot",
      objective: "Attach screenshot",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.IN_PROGRESS,
    }));
    await artifactStore.deleteByTask("task-1");
  });

  it("lists artifacts for a task", async () => {
    await artifactStore.saveArtifact(createArtifact({
      id: uuidv4(),
      type: "screenshot",
      taskId: "task-1",
      workspaceId: "workspace-1",
      content: "abc123",
      context: "Before review",
      status: "provided",
      metadata: { mediaType: "image/png" },
    }));

    const response = await GET(
      new NextRequest("http://localhost/api/tasks/task-1/artifacts"),
      { params: Promise.resolve({ taskId: "task-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.artifacts).toHaveLength(1);
    expect(data.artifacts[0]).toMatchObject({
      type: "screenshot",
      taskId: "task-1",
      context: "Before review",
      metadata: { mediaType: "image/png" },
    });
  });

  it("creates a provided artifact using the task workspace", async () => {
    const request = new NextRequest("http://localhost/api/tasks/task-1/artifacts", {
      method: "POST",
      body: JSON.stringify({
        agentId: "agent-1",
        type: "screenshot",
        content: "encoded-image",
        context: "Review proof",
        metadata: {
          filename: "review.png",
          mediaType: "image/png",
        },
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.artifact).toMatchObject({
      type: "screenshot",
      taskId: "task-1",
      workspaceId: "workspace-1",
      context: "Review proof",
      status: "provided",
      metadata: {
        filename: "review.png",
        mediaType: "image/png",
      },
    });

    const saved = await artifactStore.listByTask("task-1");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.workspaceId).toBe("workspace-1");
    expect(saved[0]?.providedByAgentId).toBe("agent-1");
  });

  it("rejects canvas artifacts on the generic task artifact route", async () => {
    const request = new NextRequest("http://localhost/api/tasks/task-1/artifacts", {
      method: "POST",
      body: JSON.stringify({
        agentId: "agent-1",
        type: "canvas",
        content: "{\"source\":\"export default function(){return null;}\"}",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "A valid artifact type is required",
    });
  });
});
