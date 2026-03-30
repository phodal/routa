import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../markdown/markdown-viewer", () => ({
  MarkdownViewer: ({ content }: { content: string }) => <div>{content}</div>,
}));

import { HarnessAgentInstructionsPanel } from "../harness-agent-instructions-panel";
import type { InstructionsResponse } from "@/client/hooks/use-harness-settings-data";

const instructionsData: InstructionsResponse = {
  generatedAt: "2026-03-29T00:00:00.000Z",
  repoRoot: "/Users/phodal/ai/routa-js",
  fileName: "CLAUDE.md",
  relativePath: "CLAUDE.md",
  source: [
    "# Routa.js",
    "",
    "Intro text.",
    "",
    "## Repository Map",
    "",
    "Repository details.",
    "",
    "## Coding Standards",
    "",
    "Coding details.",
  ].join("\n"),
  fallbackUsed: false,
  audit: {
    status: "ok",
    provider: "codex",
    generatedAt: "2026-03-29T00:00:01.000Z",
    durationMs: 1260,
    totalScore: 16,
    overall: "通过",
    oneSentence: "路由、防护、反思、验证均达到工程化可执行标准。",
    principles: {
      routing: 4,
      protection: 4,
      reflection: 4,
      verification: 4,
    },
  },
};

describe("HarnessAgentInstructionsPanel", () => {
  it("does not render the compact selected-section summary card", () => {
    const { container } = render(
      <HarnessAgentInstructionsPanel
        workspaceId="default"
        repoPath="/Users/phodal/ai/routa-js"
        repoLabel="phodal/routa"
        data={instructionsData}
        variant="compact"
      />,
    );

    expect(screen.queryByText("Selected section")).toBeNull();
    expect(container.querySelectorAll('div[class*="h-[320px]"]')).toHaveLength(2);
    expect(container.querySelectorAll('div[class*="h-[184px]"]')).toHaveLength(0);
  });

  it("renders the instruction file content and metadata", () => {
    render(
      <HarnessAgentInstructionsPanel
        workspaceId="default"
        repoPath="/Users/phodal/ai/routa-js"
        repoLabel="phodal/routa"
        data={instructionsData}
      />,
    );

    expect(screen.getByText("Instruction file")).not.toBeNull();
    expect(screen.getByText("Instruction audit")).not.toBeNull();
    expect(screen.getAllByText("CLAUDE.md").length).toBeGreaterThan(0);
    expect(screen.getByText("preferred CLAUDE.md")).not.toBeNull();
    expect(screen.getByText("16/20")).not.toBeNull();
    expect(screen.getAllByText("4/5").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText((content) => content.includes("# Routa.js"))).not.toBeNull();
  });
});
