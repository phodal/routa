import { fireEvent, render, screen } from "@testing-library/react";
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

    expect(screen.getByRole("heading", { name: "Instruction file - CLAUDE.md" })).not.toBeNull();
    expect(screen.getByText("Instruction audit")).not.toBeNull();
    expect(screen.getByText("specialist")).not.toBeNull();
    expect(screen.getByText("codex · 1.3s")).not.toBeNull();
    expect(screen.getByText("16/20")).not.toBeNull();
    expect(screen.getAllByText("4/5").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("渐进式暴露")).not.toBeNull();
    expect(screen.getByText("负面约束优先")).not.toBeNull();
    expect(screen.getByText("反重复机制")).not.toBeNull();
    expect(screen.getByText("确定性验证")).not.toBeNull();
    expect(screen.getByLabelText("渐进式暴露 说明")).not.toBeNull();
    expect(screen.getByText("按任务阶段按需加载最小上下文，先定位，再展开，避免一次性灌入全部背景。")).not.toBeNull();
    expect(screen.getByText((content) => content.includes("# Routa.js"))).not.toBeNull();
  });

  it("supports re-running audit when callback is provided", () => {
    const onAuditRerun = vi.fn();
    render(
      <HarnessAgentInstructionsPanel
        workspaceId="default"
        repoPath="/Users/phodal/ai/routa-js"
        repoLabel="phodal/routa"
        data={instructionsData}
        onAuditRerun={onAuditRerun}
      />,
    );

    const rerunButton = screen.getByRole("button", { name: /Re-run audit/i });
    fireEvent.click(rerunButton);
    expect(onAuditRerun).toHaveBeenCalledTimes(1);
  });

  it("keeps the audit rerun entry visible before the first audit result", () => {
    const onAuditRerun = vi.fn();
    render(
      <HarnessAgentInstructionsPanel
        workspaceId="default"
        repoPath="/Users/phodal/ai/routa-js"
        repoLabel="phodal/routa"
        data={{
          ...instructionsData,
          audit: null,
        }}
        onAuditRerun={onAuditRerun}
      />,
    );

    expect(screen.getByText("Instruction audit")).not.toBeNull();
    expect(screen.getByText("Audit has not been run yet in this view. Click Re-run audit to generate a fresh summary.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Re-run audit/i }));
    expect(onAuditRerun).toHaveBeenCalledTimes(1);
  });

  it("shows explicit running feedback while audit is refreshing", () => {
    render(
      <HarnessAgentInstructionsPanel
        workspaceId="default"
        repoPath="/Users/phodal/ai/routa-js"
        repoLabel="phodal/routa"
        data={instructionsData}
        loading
      />,
    );

    expect(screen.getByText("Running specialist audit...")).not.toBeNull();
  });
});
