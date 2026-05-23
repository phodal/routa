import { describe, expect, it } from "vitest";

import { createTask } from "../../models/task";
import { InMemoryArtifactStore } from "../../store/artifact-store";
import { createArtifact } from "../../models/artifact";
import { ensureCompletionFallbackArtifact } from "../completion-fallback-artifact";

describe("ensureCompletionFallbackArtifact", () => {
  it("creates a logs artifact from a session final response when the task has no artifacts", async () => {
    const artifactStore = new InMemoryArtifactStore();
    const task = createTask({
      id: "task-fallback-1",
      title: "Review solution",
      objective: "Capture the review output",
      workspaceId: "default",
      columnId: "review",
    });

    const result = await ensureCompletionFallbackArtifact({
      task,
      sessionId: "session-1",
      workspaceId: "default",
      stage: "review",
      artifactStore,
      finalResponseText: "The solution is ready for owner review.",
    });

    expect(result.status).toBe("created");
    const artifacts = await artifactStore.listByTask(task.id);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      type: "logs",
      status: "provided",
      content: "The solution is ready for owner review.",
      metadata: expect.objectContaining({
        kind: "session_final_response_fallback",
        fallback: "true",
        sessionId: "session-1",
        sensitiveBlocked: "false",
      }),
    });
  });

  it("does not create a fallback artifact when the task already has evidence", async () => {
    const artifactStore = new InMemoryArtifactStore();
    const task = createTask({
      id: "task-fallback-existing",
      title: "Review solution",
      objective: "Existing evidence should win",
      workspaceId: "default",
      columnId: "review",
    });
    await artifactStore.saveArtifact(createArtifact({
      id: "artifact-existing",
      type: "test_results",
      taskId: task.id,
      workspaceId: "default",
      status: "provided",
      content: "ok",
    }));

    const result = await ensureCompletionFallbackArtifact({
      task,
      sessionId: "session-2",
      workspaceId: "default",
      stage: "review",
      artifactStore,
      finalResponseText: "This should not be copied.",
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "task_already_has_artifacts",
    });
    expect(await artifactStore.listByTask(task.id)).toHaveLength(1);
  });

  it("is idempotent for the same task and session", async () => {
    const artifactStore = new InMemoryArtifactStore();
    const task = createTask({
      id: "task-fallback-idempotent",
      title: "Review solution",
      objective: "Repeated completion events should not duplicate artifacts",
      workspaceId: "default",
      columnId: "review",
    });

    await ensureCompletionFallbackArtifact({
      task,
      sessionId: "session-3",
      workspaceId: "default",
      stage: "review",
      artifactStore,
      finalResponseText: "Final answer.",
    });
    const result = await ensureCompletionFallbackArtifact({
      task,
      sessionId: "session-3",
      workspaceId: "default",
      stage: "review",
      artifactStore,
      finalResponseText: "Final answer.",
    });

    expect(result.status).toBe("skipped");
    expect(await artifactStore.listByTask(task.id)).toHaveLength(1);
  });

  it("does not store a fallback artifact when the final response appears sensitive", async () => {
    const artifactStore = new InMemoryArtifactStore();
    const task = createTask({
      id: "task-fallback-sensitive",
      title: "Security gate",
      objective: "Avoid saving credentials",
      workspaceId: "default",
      columnId: "review",
    });

    const result = await ensureCompletionFallbackArtifact({
      task,
      sessionId: "session-4",
      workspaceId: "default",
      stage: "review",
      artifactStore,
      finalResponseText: "{\"password\":\"super-secret\"}",
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "sensitive_content_blocked",
    });
    expect(await artifactStore.listByTask(task.id)).toHaveLength(0);
  });
});
