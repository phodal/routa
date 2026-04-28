import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { HarnessSpecSourcesPanel } from "../harness-spec-sources-panel";

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch: vi.fn(),
}));

import { desktopAwareFetch } from "@/client/utils/diagnostics";
const mockFetch = desktopAwareFetch as ReturnType<typeof vi.fn>;

const sampleData = {
  generatedAt: "2026-03-30T00:00:00.000Z",
  repoRoot: "/tmp/repo",
  warnings: [],
  sources: [
    {
      kind: "native-tool" as const,
      system: "kiro" as const,
      rootPath: ".kiro/specs",
      confidence: "high" as const,
      status: "artifacts-present" as const,
      evidence: ["feature-tree"],
      children: [],
      features: [
        {
          name: "Feature Tree",
          documents: [{ type: "requirements" as const, path: ".kiro/specs/feature/requirements.md" }],
        },
      ],
    },
    {
      kind: "framework" as const,
      system: "bmad" as const,
      rootPath: "docs",
      confidence: "low" as const,
      status: "legacy" as const,
      evidence: ["docs/prd.md"],
      children: [{ type: "prd" as const, path: "docs/prd.md" }],
    },
  ],
};

describe("HarnessSpecSourcesPanel", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });
  it("hides stale compact source cards while loading", () => {
    render(
      <HarnessSpecSourcesPanel
        repoLabel="repo"
        data={sampleData}
        loading
        variant="compact"
      />,
    );

    expect(screen.getByTestId("spec-sources-compact")).not.toBeNull();
    expect(screen.getByText("Scanning for spec sources...")).not.toBeNull();
    expect(screen.queryByText("bmad")).toBeNull();
  });

  it("shows the unsupported message in compact mode instead of stale cards", () => {
    render(
      <HarnessSpecSourcesPanel
        repoLabel="repo"
        data={sampleData}
        unsupportedMessage="Harness is unavailable for this repository."
        variant="compact"
      />,
    );

    expect(screen.getByText("Harness is unavailable for this repository.")).not.toBeNull();
    expect(screen.queryByText("bmad")).toBeNull();
  });

  it("keeps Kiro docs collapsed by default while leaving source cards expanded", () => {
    render(
      <HarnessSpecSourcesPanel
        repoLabel="repo"
        data={sampleData}
      />,
    );

    expect(screen.getByText("Feature Tree")).not.toBeNull();
    expect(screen.queryByText(".kiro/specs/feature/requirements.md")).toBeNull();
    expect(screen.getByText("docs/prd.md")).not.toBeNull();
  });

  it("renders a preview button for each flat spec file when context props are provided", () => {
    render(
      <HarnessSpecSourcesPanel
        repoLabel="repo"
        data={sampleData}
        repoPath="/tmp/repo"
      />,
    );

    // bmad source has children (prd.md) — should have a preview button
    const previewButtons = screen.getAllByRole("button", { name: /preview|预览/i });
    expect(previewButtons.length).toBeGreaterThan(0);
  });

  it("shows file content after clicking preview button", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: "# PRD Content\nThis is the spec.", filePath: "docs/prd.md" }),
    });

    const user = userEvent.setup();
    render(
      <HarnessSpecSourcesPanel
        repoLabel="repo"
        data={sampleData}
        repoPath="/tmp/repo"
      />,
    );

    const previewButtons = screen.getAllByRole("button", { name: /preview|预览/i });
    await user.click(previewButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/# PRD Content/)).not.toBeNull();
    });
  });

  it("shows error message when file fetch fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "文件未找到", details: "docs/prd.md" }),
    });

    const user = userEvent.setup();
    render(
      <HarnessSpecSourcesPanel
        repoLabel="repo"
        data={sampleData}
        repoPath="/tmp/repo"
      />,
    );

    const previewButtons = screen.getAllByRole("button", { name: /preview|预览/i });
    await user.click(previewButtons[0]);

    await waitFor(() => {
      // Should show a friendly error, not throw
      const errorMsg = screen.queryByText(/failed|error|失败|找不到|未找到|not found/i);
      expect(errorMsg).not.toBeNull();
    });
  });
});
