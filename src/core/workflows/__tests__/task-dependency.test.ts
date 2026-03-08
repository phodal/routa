/**
 * Unit tests for BackgroundTask dependency checking
 *
 * Tests the listReadyToRun() method which handles task dependencies.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryBackgroundTaskStore } from "@/core/store/background-task-store";
import type { BackgroundTask } from "@/core/models/background-task";

describe("BackgroundTask Dependency Checking", () => {
  let store: InMemoryBackgroundTaskStore;

  const createTask = (overrides: Partial<BackgroundTask> = {}): BackgroundTask => ({
    id: `task-${Math.random().toString(36).slice(2)}`,
    title: "Test task",
    workspaceId: "ws-1",
    agentId: "agent-1",
    triggeredBy: "user",
    status: "PENDING",
    priority: "NORMAL",
    prompt: "Test prompt",
    triggerSource: "workflow",
    attempts: 0,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    dependsOnTaskIds: [],
    ...overrides,
  });

  beforeEach(() => {
    store = new InMemoryBackgroundTaskStore();
  });

  describe("listReadyToRun", () => {
    it("should return tasks with no dependencies", async () => {
      const task = createTask({ id: "task-1", dependsOnTaskIds: [] });
      await store.save(task);

      const ready = await store.listReadyToRun();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe("task-1");
    });

    it("should not return tasks with PENDING dependencies", async () => {
      const dep = createTask({ id: "dep-1", status: "PENDING" });
      const task = createTask({ id: "task-1", dependsOnTaskIds: ["dep-1"] });
      await store.save(dep);
      await store.save(task);

      const ready = await store.listReadyToRun();
      // Only dep-1 is ready (no deps), task-1 is blocked
      expect(ready.map(t => t.id)).toEqual(["dep-1"]);
    });

    it("should not return tasks with RUNNING dependencies", async () => {
      const dep = createTask({ id: "dep-1", status: "RUNNING" });
      const task = createTask({ id: "task-1", dependsOnTaskIds: ["dep-1"] });
      await store.save(dep);
      await store.save(task);

      const ready = await store.listReadyToRun();
      expect(ready).toHaveLength(0); // dep is running, task is blocked
    });

    it("should return tasks when all dependencies are COMPLETED", async () => {
      const dep = createTask({ id: "dep-1", status: "COMPLETED" });
      const task = createTask({ id: "task-1", dependsOnTaskIds: ["dep-1"] });
      await store.save(dep);
      await store.save(task);

      const ready = await store.listReadyToRun();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe("task-1");
    });

    it("should handle multiple dependencies - all must be COMPLETED", async () => {
      const dep1 = createTask({ id: "dep-1", status: "COMPLETED" });
      const dep2 = createTask({ id: "dep-2", status: "PENDING" });
      const task = createTask({ id: "task-1", dependsOnTaskIds: ["dep-1", "dep-2"] });
      await store.save(dep1);
      await store.save(dep2);
      await store.save(task);

      let ready = await store.listReadyToRun();
      expect(ready.map(t => t.id)).toEqual(["dep-2"]); // Only dep-2 is ready

      // Complete dep-2
      await store.updateStatus("dep-2", "COMPLETED");

      ready = await store.listReadyToRun();
      expect(ready.map(t => t.id)).toEqual(["task-1"]); // Now task-1 is ready
    });

    it("should respect priority ordering", async () => {
      const high = createTask({ id: "high", priority: "HIGH" });
      const normal = createTask({ id: "normal", priority: "NORMAL" });
      const low = createTask({ id: "low", priority: "LOW" });
      await store.save(normal);
      await store.save(low);
      await store.save(high);

      const ready = await store.listReadyToRun();
      expect(ready.map(t => t.id)).toEqual(["high", "normal", "low"]);
    });

    it("should not return already RUNNING tasks", async () => {
      const task = createTask({ id: "task-1", status: "RUNNING" });
      await store.save(task);

      const ready = await store.listReadyToRun();
      expect(ready).toHaveLength(0);
    });

    it("should not return COMPLETED tasks", async () => {
      const task = createTask({ id: "task-1", status: "COMPLETED" });
      await store.save(task);

      const ready = await store.listReadyToRun();
      expect(ready).toHaveLength(0);
    });

    it("should not return CANCELLED tasks", async () => {
      const task = createTask({ id: "task-1", status: "CANCELLED" });
      await store.save(task);

      const ready = await store.listReadyToRun();
      expect(ready).toHaveLength(0);
    });

    it("should not return FAILED tasks", async () => {
      const task = createTask({ id: "task-1", status: "FAILED" });
      await store.save(task);

      const ready = await store.listReadyToRun();
      expect(ready).toHaveLength(0);
    });
  });

  describe("updateTaskOutput", () => {
    it("should store task output", async () => {
      const task = createTask({ id: "task-1" });
      await store.save(task);

      await store.updateTaskOutput("task-1", "Output from task");

      const updated = await store.get("task-1");
      expect(updated?.taskOutput).toBe("Output from task");
    });
  });

  describe("listByWorkflowRunId", () => {
    it("should list tasks for a specific workflow run", async () => {
      const task1 = createTask({ id: "task-1", workflowRunId: "run-1" });
      const task2 = createTask({ id: "task-2", workflowRunId: "run-1" });
      const task3 = createTask({ id: "task-3", workflowRunId: "run-2" });
      await store.save(task1);
      await store.save(task2);
      await store.save(task3);

      const tasks = await store.listByWorkflowRunId("run-1");
      expect(tasks).toHaveLength(2);
      expect(tasks.map(t => t.id).sort()).toEqual(["task-1", "task-2"]);
    });
  });
});

