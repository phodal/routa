/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { buildKanbanSessionRestorePrompt } from "../kanban-tab-panels";
import type { SessionInfo, TaskInfo } from "../../types";

function createSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: "session-restore-1",
    cwd: "/tmp/repo",
    branch: "feature/drag-overlay",
    workspaceId: "workspace-1",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createTask(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: "task-1",
    title: "Fix drag overlay",
    objective: "Keep the card visible during drag",
    status: "IN_PROGRESS",
    boardId: "board-1",
    columnId: "dev",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildKanbanSessionRestorePrompt", () => {
  it("includes clean task and transcript context while filtering noisy entries", () => {
    const prompt = buildKanbanSessionRestorePrompt(
      createTask(),
      createSession(),
      [
        { role: "thought", content: "Hidden internal reasoning" },
        { role: "user", content: "Check why the drag overlay disappears." },
        { role: "assistant", content: "I will inspect the drag state and overlay rendering." },
        { role: "info", content: "2025-01-01T00:00:00.000Z INFO bootstrap complete" },
      ],
    );

    expect(prompt).toContain("Card: Fix drag overlay");
    expect(prompt).toContain("Objective: Keep the card visible during drag");
    expect(prompt).toContain("Column: dev");
    expect(prompt).toContain("Status: IN_PROGRESS");
    expect(prompt).toContain("Previous session: session-restore-1");
    expect(prompt).toContain("Working directory: /tmp/repo");
    expect(prompt).toContain("Branch: feature/drag-overlay");
    expect(prompt).toContain("User: Check why the drag overlay disappears.");
    expect(prompt).toContain("Assistant: I will inspect the drag state and overlay rendering.");
    expect(prompt).not.toContain("Hidden internal reasoning");
    expect(prompt).not.toContain("bootstrap complete");
  });

  it("falls back to an unknown card when no task is available", () => {
    const prompt = buildKanbanSessionRestorePrompt(null, createSession(), []);

    expect(prompt).toContain("Card context:");
    expect(prompt).toContain("- Card: unknown");
    expect(prompt).not.toContain("Recent clean conversation:");
  });
});
