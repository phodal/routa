import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanCardArtifacts } from "../kanban-card-artifacts";

vi.mock("@/client/components/codemirror/code-viewer", () => ({
  CodeViewer: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

describe("KanbanCardArtifacts", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows agent-first artifact guidance and current requirement coverage", async () => {
    let getCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/tasks/task-1/artifacts" && (!init?.method || init.method === "GET")) {
        getCount += 1;
        return {
          ok: true,
          json: async () => ({
            artifacts: getCount > 1
              ? [{
                id: "artifact-1",
                type: "screenshot",
                taskId: "task-1",
                workspaceId: "workspace-1",
                providedByAgentId: "agent-1",
                content: "aW1hZ2U=",
                context: "Review proof",
                status: "provided",
                createdAt: "2025-01-01T00:00:00.000Z",
                updatedAt: "2025-01-01T00:00:00.000Z",
                metadata: {
                  filename: "review.png",
                  mediaType: "image/png",
                },
              }]
              : [],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <KanbanCardArtifacts
        taskId="task-1"
        requiredArtifacts={["screenshot", "test_results"]}
        refreshSignal={0}
      />,
    );

    expect(await screen.findByText("No artifacts attached yet.")).toBeTruthy();

    rerender(
      <KanbanCardArtifacts
        taskId="task-1"
        requiredArtifacts={["screenshot", "test_results"]}
        refreshSignal={1}
      />,
    );

    expect(await screen.findByText("Review proof")).toBeTruthy();
    expect(screen.getByText(/Missing for next move/i)).toBeTruthy();
    expect(screen.getByText(/Missing: Test Results/i)).toBeTruthy();
    expect(screen.getByText(/by agent-1/i)).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("falls back to text when a screenshot artifact does not contain valid base64", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/tasks/task-bad/artifacts" && (!init?.method || init.method === "GET")) {
        return {
          ok: true,
          json: async () => ({
            artifacts: [{
              id: "artifact-bad-1",
              type: "screenshot",
              taskId: "task-bad",
              workspaceId: "workspace-1",
              providedByAgentId: "agent-1",
              content: "Screenshot captured at: /tmp/bad.png",
              context: "Broken screenshot",
              status: "provided",
              createdAt: "2025-01-01T00:00:00.000Z",
              updatedAt: "2025-01-01T00:00:00.000Z",
              metadata: {
                mediaType: "image/png",
                path: "/tmp/bad.png",
              },
            }],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<KanbanCardArtifacts taskId="task-bad" refreshSignal={0} />);

    expect(await screen.findByText("Broken screenshot")).toBeTruthy();
    expect(screen.getByText("Screenshot captured at: /tmp/bad.png")).toBeTruthy();
    expect(screen.queryByAltText("Broken screenshot")).toBeNull();
  });

  it("renders code diff artifacts as per-file expandable code viewers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/tasks/task-2/artifacts" && (!init?.method || init.method === "GET")) {
        return {
          ok: true,
          json: async () => ({
            artifacts: [{
              id: "artifact-diff-1",
              type: "code_diff",
              taskId: "task-2",
              workspaceId: "workspace-1",
              providedByAgentId: "agent-diff",
              content: [
                "diff --git a/src/a.ts b/src/a.ts",
                "--- a/src/a.ts",
                "+++ b/src/a.ts",
                "@@ -1,2 +1,2 @@",
                "-const oldValue = 1;",
                "+const newValue = 2;",
              ].join("\n"),
              status: "provided",
              createdAt: "2025-01-01T00:00:00.000Z",
              updatedAt: "2025-01-01T00:00:00.000Z",
            }],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<KanbanCardArtifacts taskId="task-2" refreshSignal={0} />);

    expect(await screen.findByText("src/a.ts")).toBeTruthy();
    const diffViewer = screen.getByText("src/a.ts").closest("details");
    expect(diffViewer).toBeTruthy();
    expect(diffViewer?.textContent).toContain("const newValue = 2;");
    expect(diffViewer?.textContent).toContain("const oldValue = 1;");
  });
});
