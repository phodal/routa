import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentHooksResponse } from "@/client/hooks/use-harness-settings-data";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes }: { nodes: Array<{ id: string; data?: { title?: string } }> }) => (
    <div data-testid="agent-hook-flow">
      {nodes.map((node) => (
        <div key={node.id}>{node.data?.title ?? node.id}</div>
      ))}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Left: "left", Right: "right" },
}));

vi.mock("../codemirror/code-viewer", () => ({
  CodeViewer: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

import { HarnessAgentHookWorkbench } from "../harness-agent-hook-workbench";

function createAgentHooksResponse(): AgentHooksResponse {
  return {
    generatedAt: "2026-03-30T00:00:00.000Z",
    repoRoot: "/Users/phodal/ai/routa-js",
    configFile: {
      relativePath: ".codex/hooks.yaml",
      source: "hooks: []",
      schema: "agent-hooks-v1",
    },
    hooks: [
      {
        event: "PreToolUse",
        matcher: "Bash",
        type: "command",
        command: "scripts/check-command.sh",
        timeout: 30,
        blocking: true,
        description: "Guard dangerous shell commands",
        source: ".codex/hooks.yaml:4",
      },
      {
        event: "PostToolUse",
        type: "http",
        url: "http://localhost:4318/hook",
        timeout: 10,
        blocking: false,
        description: "Audit tool results",
        source: ".codex/hooks.yaml:12",
      },
    ],
    warnings: [],
  };
}

describe("HarnessAgentHookWorkbench", () => {
  it("renders the flow canvas for the selected agent hook event", () => {
    render(<HarnessAgentHookWorkbench data={createAgentHooksResponse()} />);

    const flow = screen.getByTestId("agent-hook-flow");

    expect(screen.getByText("Event → Hook → Outcome")).not.toBeNull();
    expect(flow).not.toBeNull();
    expect(within(flow).getByText("PreToolUse")).not.toBeNull();
    expect(within(flow).getByText("Guard dangerous shell commands")).not.toBeNull();
    expect(within(flow).getByText("Allow")).not.toBeNull();
    expect(within(flow).getByText("Block")).not.toBeNull();
  });

  it("updates the flow when switching to another event", () => {
    render(<HarnessAgentHookWorkbench data={createAgentHooksResponse()} />);

    fireEvent.click(screen.getByRole("button", { name: /PostToolUse/i }));

    const flow = screen.getByTestId("agent-hook-flow");

    expect(within(flow).getByText("Audit tool results")).not.toBeNull();
    expect(within(flow).getByText("Signal")).not.toBeNull();
  });
});
