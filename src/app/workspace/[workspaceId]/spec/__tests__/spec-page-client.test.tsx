import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navState = vi.hoisted(() => ({
  params: { workspaceId: "default" },
}));

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => navState.params,
}));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return {
    ...actual,
    desktopAwareFetch,
  };
});

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
    desktopAwareFetch.mockReset();
  });

  it("loads issues, filters by body text, and opens the detail panel", async () => {
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
          relatedIssues: ["https://github.com/phodal/routa/issues/410"],
          githubIssue: 410,
          githubState: "closed",
          githubUrl: "https://github.com/phodal/routa/issues/410",
          body: "Rendered as markdown.\nMarker: lineage-alpha",
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

    expect(await screen.findByRole("dialog", { name: "Spec board" })).toBeTruthy();
    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.getByTestId("markdown-viewer").textContent).toContain("Rendered as markdown.");

    fireEvent.click(screen.getByRole("button", { name: "Close (Esc)" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Spec board" })).toBeNull();
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
