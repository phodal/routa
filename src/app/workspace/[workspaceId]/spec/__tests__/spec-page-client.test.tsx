import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navState = vi.hoisted(() => ({
  params: { workspaceId: "default" },
  push: vi.fn(),
}));

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

const { useWorkspaces } = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => navState.params,
  usePathname: () => "/workspace/default/spec",
  useRouter: () => ({ push: navState.push }),
}));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return {
    ...actual,
    desktopAwareFetch,
  };
});

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces,
}));

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="desktop-shell">{children}</div>,
}));

vi.mock("@/client/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

vi.mock("@/client/components/markdown/markdown-viewer", () => ({
  MarkdownViewer: ({ content }: { content: string }) => <div data-testid="markdown-viewer">{content}</div>,
}));

import { SpecPageClient } from "../spec-page-client";

function okJson(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function errorJson(data: unknown) {
  return {
    ok: false,
    json: async () => data,
  } as Response;
}

function mockSpecResponses(options?: { surfaceOk?: boolean }) {
  const surfaceOk = options?.surfaceOk ?? true;

  desktopAwareFetch.mockImplementation(async (path: string) => {
    if (path.includes("/api/spec/issues?workspaceId=default")) {
      return okJson({
        issues: [
          {
            filename: "2026-04-11-spec-board.md",
            title: "Spec board",
            date: "2026-04-11",
            kind: "progress_note",
            status: "closed",
            severity: "high",
            area: "kanban",
            tags: ["kanban", "board"],
            reportedBy: "codex",
            relatedIssues: [
              "docs/issues/2026-04-10-linked-issue.md",
              "https://github.com/phodal/routa/issues/410",
            ],
            githubIssue: 410,
            githubState: "closed",
            githubUrl: "https://github.com/phodal/routa/issues/410",
            body: [
              "Rendered as markdown.",
              "Marker: lineage-alpha",
              "",
              "## Relevant Files",
              "- `src/app/workspace/[workspaceId]/kanban/page.tsx`",
              "- `src/app/api/kanban/boards/route.ts`",
              "",
              "Touches `/workspace/default/kanban` and `/api/kanban/boards`.",
            ].join("\n"),
          },
          {
            filename: "2026-04-10-linked-issue.md",
            title: "Linked issue",
            date: "2026-04-10",
            kind: "issue",
            status: "open",
            severity: "medium",
            area: "kanban",
            tags: ["link-target"],
            reportedBy: "codex",
            relatedIssues: [],
            githubIssue: null,
            githubState: null,
            githubUrl: null,
            body: "Second body for the linked issue.",
          },
        ],
      });
    }

    if (path.includes("/api/spec/surface-index?workspaceId=default")) {
      if (!surfaceOk) {
        return errorJson({ error: "Feature surface index missing" });
      }

      return okJson({
        generatedAt: "2026-04-16T00:00:00.000Z",
        repoRoot: "/repo",
        warnings: [],
        pages: [
          {
            route: "/workspace/:workspaceId/kanban",
            title: "Workspace / Kanban",
            description: "Kanban workspace view",
            sourceFile: "src/app/workspace/[workspaceId]/kanban/page.tsx",
          },
        ],
        apis: [
          {
            domain: "kanban",
            method: "GET",
            path: "/api/kanban/boards",
            operationId: "listKanbanBoards",
            summary: "List kanban boards",
          },
        ],
      });
    }

    throw new Error(`Unexpected fetch: ${path}`);
  });
}

describe("SpecPageClient", () => {
  beforeEach(() => {
    navState.params = { workspaceId: "default" };
    navState.push.mockReset();
    desktopAwareFetch.mockReset();
    useWorkspaces.mockReturnValue({
      loading: false,
      workspaces: [{ id: "default", title: "Default Workspace" }],
      createWorkspace: vi.fn(),
    });
  });

  it("loads issue families, shows feature footprint matches, and follows local relations", async () => {
    mockSpecResponses();

    render(<SpecPageClient />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Spec board/i })).toBeTruthy();
    });

    const requestedPaths = desktopAwareFetch.mock.calls.map(([path]) => path);
    expect(requestedPaths).toContain("/api/spec/issues?workspaceId=default");
    expect(requestedPaths).toContain("/api/spec/surface-index?workspaceId=default");

    expect(screen.getAllByText("Families").length).toBeGreaterThan(0);

    const detailPane = await screen.findByRole("region", { name: "Spec board" });
    expect(within(detailPane).getByText("Feature Footprint")).toBeTruthy();
    expect(within(detailPane).getAllByText("/workspace/:workspaceId/kanban").length).toBeGreaterThan(0);
    expect(within(detailPane).getByText("GET /api/kanban/boards")).toBeTruthy();

    const linkedButtons = within(detailPane).getAllByRole("button", { name: /Linked issue/i });
    fireEvent.click(linkedButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Linked issue" })).toBeTruthy();
    });

    const linkedPane = screen.getByRole("region", { name: "Linked issue" });
    expect(within(linkedPane).getByText("Same Family")).toBeTruthy();
    expect(screen.getByTestId("markdown-viewer").textContent).toContain("Second body for the linked issue.");
  });

  it("allows collapsing the currently selected family cluster from the explorer", async () => {
    mockSpecResponses();

    render(<SpecPageClient />);

    await waitFor(() => {
      expect(screen.getAllByText("Families").length).toBeGreaterThan(1);
    });

    const explorer = screen.getAllByText("Families")[1]?.closest("section");
    expect(explorer).toBeTruthy();

    await waitFor(() => {
      expect(within(explorer as HTMLElement).getAllByRole("button", { name: /Linked issue/i }).length).toBeGreaterThan(1);
    });

    fireEvent.click(within(explorer as HTMLElement).getAllByRole("button", { name: /Linked issue/i })[0] as HTMLElement);

    await waitFor(() => {
      expect(within(explorer as HTMLElement).getAllByRole("button", { name: /Linked issue/i })).toHaveLength(1);
    });

    fireEvent.click(within(explorer as HTMLElement).getByRole("button", { name: /Linked issue/i }));

    await waitFor(() => {
      expect(within(explorer as HTMLElement).getAllByRole("button", { name: /Linked issue/i }).length).toBeGreaterThan(1);
    });
  });

  it("keeps rendering issues when the feature map endpoint is unavailable", async () => {
    mockSpecResponses({ surfaceOk: false });

    render(<SpecPageClient />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Spec board/i })).toBeTruthy();
    });

    expect(screen.getAllByText("Feature map unavailable").length).toBeGreaterThan(0);
  });

  it("surfaces issue API errors instead of rendering an empty board", async () => {
    desktopAwareFetch.mockImplementation(async (path: string) => {
      if (path.includes("/api/spec/issues?workspaceId=default")) {
        return errorJson({ error: "Missing spec repo" });
      }
      if (path.includes("/api/spec/surface-index?workspaceId=default")) {
        return okJson({
          generatedAt: "",
          repoRoot: "",
          warnings: [],
          pages: [],
          apis: [],
        });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });

    render(<SpecPageClient />);

    await waitFor(() => {
      expect(screen.getByText("Missing spec repo")).toBeTruthy();
    });
  });
});
