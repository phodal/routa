/**
 * Task API contract tests.
 *
 * Tests the /api/tasks endpoints for create, list, get, status update, delete, ready.
 */

import {
  api,
  assert,
  assertStatus,
  assertHasField,
  assertArrayField,
  assertEnum,
  type TestResult,
} from "./helpers";

const TASK_STATUSES = [
  "PENDING", "IN_PROGRESS", "REVIEW_REQUIRED", "COMPLETED",
  "NEEDS_FIX", "BLOCKED", "CANCELLED",
];

export async function testTasks(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  let createdTaskId = "";

  // ── POST /api/tasks — create task ──
  results.push(
    await runTest("POST /api/tasks — create task", async () => {
      const { status, data } = await api("POST", "/api/tasks", {
        title: "Test Task",
        objective: "Verify API contract parity",
        workspaceId: "default",
        scope: "tests/api-contract",
        acceptanceCriteria: ["Tests pass on both backends"],
        dependencies: [],
      });
      assertStatus(status, 201);
      const d = data as Record<string, unknown>;
      assertHasField(d, "task");
      const task = d.task as Record<string, unknown>;
      validateTaskShape(task);
      createdTaskId = task.id as string;
    })
  );

  // ── GET /api/tasks — list tasks ──
  results.push(
    await runTest("GET /api/tasks — list tasks", async () => {
      const { status, data } = await api("GET", "/api/tasks?workspaceId=default");
      assertStatus(status, 200);
      const d = data as Record<string, unknown>;
      assertArrayField(d, "tasks");
    })
  );

  // ── GET /api/tasks/{id} — get single task ──
  results.push(
    await runTest("GET /api/tasks/{id} — get task", async () => {
      if (!createdTaskId) throw new Error("Depends on create test");
      const { status, data } = await api("GET", `/api/tasks/${createdTaskId}`);
      assertStatus(status, 200);
      const d = data as Record<string, unknown>;
      assertHasField(d, "task");
      const task = d.task as Record<string, unknown>;
      assert(task.id === createdTaskId, "ID should match");
      validateTaskShape(task);
    })
  );

  // ── GET /api/tasks/{id} — 404 for missing ──
  results.push(
    await runTest("GET /api/tasks/{id} — 404 for missing", async () => {
      const { status } = await api("GET", "/api/tasks/nonexistent-task-id-99999");
      assertStatus(status, 404);
    })
  );

  // ── POST /api/tasks/{id}/status — update status ──
  results.push(
    await runTest("POST /api/tasks/{id}/status — update status", async () => {
      if (!createdTaskId) throw new Error("Depends on create test");
      const { status, data } = await api(
        "POST",
        `/api/tasks/${createdTaskId}/status`,
        { status: "IN_PROGRESS" }
      );
      assertStatus(status, 200);
      const d = data as Record<string, unknown>;
      assert(d.updated === true, "Should return updated: true");
    })
  );

  // ── GET /api/tasks/ready — find ready tasks ──
  results.push(
    await runTest("GET /api/tasks/ready — find ready tasks", async () => {
      const { status, data } = await api("GET", "/api/tasks/ready?workspaceId=default");
      assertStatus(status, 200);
      const d = data as Record<string, unknown>;
      assertArrayField(d, "tasks");
    })
  );

  // ── DELETE /api/tasks/{id} — delete task ──
  results.push(
    await runTest("DELETE /api/tasks/{id} — delete task", async () => {
      if (!createdTaskId) throw new Error("Depends on create test");
      const { status, data } = await api("DELETE", `/api/tasks/${createdTaskId}`);
      assertStatus(status, 200);
      const d = data as Record<string, unknown>;
      assert(d.deleted === true, "Should return deleted: true");
    })
  );

  return results;
}

function validateTaskShape(task: Record<string, unknown>) {
  assert(typeof task.id === "string", "task.id should be string");
  assert(typeof task.title === "string", "task.title should be string");
  assert(typeof task.objective === "string", "task.objective should be string");
  assertEnum(task.status as string, TASK_STATUSES, "task.status");
  assert(typeof task.workspaceId === "string", "task.workspaceId should be string");
  assert(Array.isArray(task.dependencies), "task.dependencies should be array");
}

async function runTest(
  name: string,
  fn: () => Promise<void>
): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, passed: true, duration: Date.now() - start };
  } catch (err) {
    return {
      name,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
      duration: Date.now() - start,
    };
  }
}
