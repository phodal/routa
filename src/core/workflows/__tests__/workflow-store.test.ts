/**
 * Unit tests for WorkflowRunStore
 *
 * Tests CRUD operations for workflow runs using the correct interface:
 * - create(input): creates a new run
 * - updateStatus(runId, status, opts): updates status
 * - updateStepOutput(runId, stepName, output): updates step output
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryWorkflowRunStore } from "../workflow-store";
import type { CreateWorkflowRunInput } from "../workflow-types";

describe("InMemoryWorkflowRunStore", () => {
  let store: InMemoryWorkflowRunStore;

  const createInput = (overrides: Partial<CreateWorkflowRunInput> = {}): CreateWorkflowRunInput => ({
    workflowId: "wf-1",
    workflowName: "Test Workflow",
    workspaceId: "ws-1",
    totalSteps: 3,
    triggerSource: "manual",
    ...overrides,
  });

  beforeEach(() => {
    store = new InMemoryWorkflowRunStore();
  });

  describe("create and get", () => {
    it("should create and retrieve a workflow run", async () => {
      const input = createInput();
      const run = await store.create(input);

      expect(run.id).toBeDefined();
      expect(run.workflowId).toBe("wf-1");
      expect(run.workflowName).toBe("Test Workflow");
      expect(run.status).toBe("PENDING");

      const retrieved = await store.get(run.id);
      expect(retrieved).toEqual(run);
    });

    it("should return undefined for non-existent run", async () => {
      const retrieved = await store.get("non-existent");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("updateStatus", () => {
    it("should update an existing run status", async () => {
      const run = await store.create(createInput());

      await store.updateStatus(run.id, "RUNNING");

      const updated = await store.get(run.id);
      expect(updated?.status).toBe("RUNNING");
    });

    it("should update updatedAt timestamp", async () => {
      const run = await store.create(createInput());
      const originalUpdatedAt = run.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      await store.updateStatus(run.id, "COMPLETED");

      const updated = await store.get(run.id);
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });

    it("should not throw when updating non-existent run", async () => {
      await expect(store.updateStatus("non-existent", "RUNNING")).resolves.not.toThrow();
    });

    it("should update optional fields", async () => {
      const run = await store.create(createInput());

      await store.updateStatus(run.id, "RUNNING", {
        currentStepName: "Analyze",
        startedAt: new Date("2024-01-01"),
      });

      const updated = await store.get(run.id);
      expect(updated?.currentStepName).toBe("Analyze");
      expect(updated?.startedAt).toEqual(new Date("2024-01-01"));
    });
  });

  describe("listByWorkspace", () => {
    it("should list runs for a specific workspace", async () => {
      await store.create(createInput({ workspaceId: "ws-1" }));
      await store.create(createInput({ workspaceId: "ws-1" }));
      await store.create(createInput({ workspaceId: "ws-2" }));

      const runs = await store.listByWorkspace("ws-1");
      expect(runs).toHaveLength(2);
    });

    it("should return empty array for workspace with no runs", async () => {
      const runs = await store.listByWorkspace("empty-workspace");
      expect(runs).toEqual([]);
    });
  });

  describe("listByStatus", () => {
    it("should list runs by status", async () => {
      const run1 = await store.create(createInput());
      const run2 = await store.create(createInput());
      const run3 = await store.create(createInput());

      await store.updateStatus(run2.id, "RUNNING");

      const pending = await store.listByStatus("PENDING");
      expect(pending).toHaveLength(2);

      const running = await store.listByStatus("RUNNING");
      expect(running).toHaveLength(1);
      expect(running[0].id).toBe(run2.id);
    });
  });

  describe("updateStepOutput", () => {
    it("should store step output", async () => {
      const run = await store.create(createInput());

      await store.updateStepOutput(run.id, "Analyze", "Analysis complete");

      const retrieved = await store.get(run.id);
      expect(retrieved?.stepOutputs?.Analyze).toBe("Analysis complete");
    });

    it("should increment completedSteps", async () => {
      const run = await store.create(createInput({ totalSteps: 3 }));
      expect(run.completedSteps).toBe(0);

      await store.updateStepOutput(run.id, "Step1", "Output 1");
      let updated = await store.get(run.id);
      expect(updated?.completedSteps).toBe(1);

      await store.updateStepOutput(run.id, "Step2", "Output 2");
      updated = await store.get(run.id);
      expect(updated?.completedSteps).toBe(2);
    });

    it("should update multiple step outputs", async () => {
      const run = await store.create(createInput());

      await store.updateStepOutput(run.id, "Step1", "Output 1");
      await store.updateStepOutput(run.id, "Step2", "Output 2");

      const updated = await store.get(run.id);
      expect(updated?.stepOutputs).toEqual({
        Step1: "Output 1",
        Step2: "Output 2",
      });
    });
  });

  describe("delete", () => {
    it("should delete a workflow run", async () => {
      const run = await store.create(createInput());
      expect(await store.get(run.id)).toBeDefined();

      await store.delete(run.id);
      expect(await store.get(run.id)).toBeUndefined();
    });
  });
});

