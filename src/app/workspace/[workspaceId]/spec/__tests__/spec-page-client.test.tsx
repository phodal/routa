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

  it("loads issues, exposes issue links, and follows local relations in the detail panel", async () => {
    desktopAwareFetch.mockResolvedValue(okJson({
      issues: [
        {
          filename: "2026-04-11-spec-board.md",
          title: "Spec board",
          date: "2026-04-11",
          kind: "progress_note",
          status: "closed",
          severity: "high",
          area: "ui",
          tags: ["spec", "board"],
          reportedBy: "codex",
          relatedIssues: ["docs/issues/2026-04-10-linked-issue.md", "https://github.com/phodal/routa/issues/410"],
          githubIssue: 410,
          githubState: "closed",
          githubUrl: "https://github.com/phodal/routa/issues/410",
          body: "Rendered as markdown.\nMarker: lineage-alpha",
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
    }));

    render(<SpecPageClient />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Spec board/i })).toBeTruthy();
    });

    expect(desktopAwareFetch).toHaveBeenCalledWith(
      "/api/spec/issues?workspaceId=default",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );

    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "lineage-alpha" },
    });

    expect(screen.getByRole("button", { name: /Spec board/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Spec board/i }));

    const dialog = await screen.findByRole("dialog", { name: "Spec board" });
    expect(within(dialog).getByText("Issue Links")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: /#410/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Linked issue/i })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: /Linked issue/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Linked issue" })).toBeTruthy();
    });

    const linkedDialog = screen.getByRole("dialog", { name: "Linked issue" });
    expect(within(linkedDialog).getByText("Linked From")).toBeTruthy();
    expect(within(linkedDialog).getByRole("button", { name: /Spec board/i })).toBeTruthy();
    expect(screen.getByTestId("markdown-viewer").textContent).toContain("Second body for the linked issue.");

    fireEvent.click(screen.getByRole("button", { name: "Close (Esc)" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Linked issue" })).toBeNull();
    });
  });

  it("surfaces API errors instead of rendering an empty board", async () => {
    desktopAwareFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Missing spec repo" }),
    } as Response);

    render(<SpecPageClient />);

    await waitFor(() => {
      expect(screen.getByText("Missing spec repo")).toBeTruthy();
    });
  });
});
