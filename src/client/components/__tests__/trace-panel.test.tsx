import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TracePanel } from "../trace-panel";

describe("TracePanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders kanban handoff context for the selected session", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/traces?sessionId=session-review-1") {
        return {
          ok: true,
          json: async () => ({ traces: [] }),
        } as Response;
      }

      if (url === "/api/traces/stats?sessionId=session-review-1") {
        return {
          ok: true,
          json: async () => ({
            stats: {
              totalDays: 1,
              totalFiles: 0,
              totalRecords: 0,
              uniqueSessions: 1,
              eventTypes: {},
            },
          }),
        } as Response;
      }

      if (url === "/api/sessions/session-review-1/context") {
        return {
          ok: true,
          json: async () => ({
            current: {
              sessionId: "session-review-1",
              workspaceId: "default",
              cwd: "/tmp/project",
              createdAt: "2026-03-17T00:10:00.000Z",
            },
            children: [],
            siblings: [],
            recentInWorkspace: [],
            kanbanContext: {
              taskId: "task-1",
              taskTitle: "Desk check login flow",
              columnId: "review",
              currentLaneSession: {
                sessionId: "session-review-1",
                columnId: "review",
                columnName: "Review",
                stepIndex: 1,
                stepName: "Review Step 2",
                provider: "codex",
                role: "GATE",
                status: "running",
                startedAt: "2026-03-17T00:10:00.000Z",
              },
              previousLaneSession: {
                sessionId: "session-dev-1",
                columnId: "dev",
                columnName: "Dev",
                provider: "claude",
                role: "DEVELOPER",
                status: "completed",
                startedAt: "2026-03-17T00:00:00.000Z",
              },
              previousLaneRun: {
                sessionId: "session-review-0",
                columnId: "review",
                columnName: "Review",
                stepIndex: 0,
                stepName: "Review Step 1",
                provider: "codex",
                role: "GATE",
                status: "completed",
                startedAt: "2026-03-17T00:05:00.000Z",
              },
              learnedPlaybook: {
                fingerprint: "fingerprint-123",
                taskType: "kanban_card",
                workspaceId: "default",
                taskTitle: "Desk check login flow",
                sampleSize: 3,
                successRate: 2 / 3,
                preferredTools: ["write_file", "run_command"],
                keyFiles: ["src/index.ts", "src/app/login.tsx"],
                verificationCommands: ["npm test (67% pass over 3 runs)"],
                antiPatterns: ["Failure mode: review not approved"],
                sourceSessions: ["session-review-1", "session-review-0", "session-dev-1"],
              },
              relatedHandoffs: [
                {
                  id: "handoff-1",
                  direction: "outgoing",
                  fromSessionId: "session-review-1",
                  toSessionId: "session-dev-1",
                  fromColumnId: "review",
                  fromColumnName: "Review",
                  toColumnId: "dev",
                  toColumnName: "Dev",
                  requestType: "environment_preparation",
                  request: "Start the app and share the URL.",
                  status: "completed",
                  requestedAt: "2026-03-17T00:12:00.000Z",
                  respondedAt: "2026-03-17T00:13:00.000Z",
                  responseSummary: "Running at http://127.0.0.1:3000/login",
                },
              ],
            },
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TracePanel sessionId="session-review-1" />);

    await waitFor(() => {
      expect(screen.getByText("Kanban Story")).toBeTruthy();
    });

    expect(screen.getByText("Desk check login flow")).toBeTruthy();
    expect(screen.getByText(/Current lane session: Review • Review Step 2/i)).toBeTruthy();
    expect(screen.getByText(/Previous lane session: Dev/i)).toBeTruthy();
    expect(screen.getByText(/Previous run in lane: Review • Review Step 1/i)).toBeTruthy();
    expect(screen.getByText("Learned Playbook")).toBeTruthy();
    expect(screen.getByText(/Confidence: 67%/i)).toBeTruthy();
    expect(screen.getByText(/write_file/i)).toBeTruthy();
    expect(screen.getByText(/npm test \(67% pass over 3 runs\)/i)).toBeTruthy();
    expect(screen.getByText("Start the app and share the URL.")).toBeTruthy();
    expect(screen.getByText("Running at http://127.0.0.1:3000/login")).toBeTruthy();
    expect(screen.getAllByText("session-review-1").length).toBeGreaterThan(0);
  });
});
