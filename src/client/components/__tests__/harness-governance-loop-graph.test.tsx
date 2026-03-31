import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Handle: () => null,
  ReactFlow: ({
    nodes,
    nodeTypes,
    onNodeClick,
  }: {
    nodes: Array<{ id: string; type: string; data: { title: string } }>;
    nodeTypes?: Record<string, (props: { data: unknown }) => ReactNode>;
    onNodeClick?: (_event: unknown, node: { id: string }) => void;
  }) => (
    <div data-testid="react-flow">
      {nodes.map((node) => {
        const NodeComponent = nodeTypes?.[node.type];
        return (
          <div key={node.id}>
            {NodeComponent ? <NodeComponent data={node.data} /> : null}
            <button
              type="button"
              onClick={() => onNodeClick?.(null, { id: node.id })}
            >
              flow-node-{node.id}
            </button>
          </div>
        );
      })}
    </div>
  ),
  MarkerType: { ArrowClosed: "ArrowClosed" },
  Position: {
    Top: "top",
    Right: "right",
    Bottom: "bottom",
    Left: "left",
  },
}));

import { HarnessGovernanceLoopGraph } from "../harness-governance-loop-graph";

describe("HarnessGovernanceLoopGraph", () => {
  it("shows unavailable reasons for non-interactive stages instead of plain disabled placeholders", () => {
    render(
      <HarnessGovernanceLoopGraph
        repoPath="/Users/phodal/ai/routa-js"
        selectedTier="normal"
        specsError={null}
        dimensionCount={8}
        planError={null}
        metricCount={31}
        hardGateCount={13}
        instructionsData={null}
        hooksData={null}
        workflowData={null}
      />,
    );

    expect(screen.getByText("暂未接入 ADR / 设计决策来源（docs/ARCHITECTURE.md 或 docs/adr）")).not.toBeNull();
    expect(screen.getByText("仓库未检测到 release / publish workflow，暂时无法进入发布上下文。")).not.toBeNull();

    const designDecisionNode = screen.getByRole("button", {
      name: /内部反馈环 设计决策, ADR \/ 设计取舍/i,
    });
    expect(designDecisionNode.getAttribute("aria-disabled")).toBe("true");
    expect(designDecisionNode.getAttribute("aria-describedby")).toBe("governance-unavailable-reason-coding");
    expect(screen.getAllByText("未接入").length).toBeGreaterThan(0);
  });

  it("keeps available stages selectable through the governance flow", () => {
    const onSelectedNodeChange = vi.fn();

    render(
      <HarnessGovernanceLoopGraph
        repoPath="/Users/phodal/ai/routa-js"
        selectedTier="normal"
        specsError={null}
        dimensionCount={8}
        planError={null}
        metricCount={31}
        hardGateCount={13}
        instructionsData={null}
        hooksData={null}
        workflowData={{
          generatedAt: "2026-03-31T00:00:00.000Z",
          repoRoot: "/repo",
          workflowsDir: "/repo/.github/workflows",
          flows: [
            {
              id: "release",
              name: "Release",
              event: "workflow_dispatch",
              yaml: "name: Release",
              jobs: [],
            },
          ],
          warnings: [],
        }}
        selectedNodeId="build"
        onSelectedNodeChange={onSelectedNodeChange}
      />,
    );

    fireEvent.click(screen.getByText("flow-node-release"));

    expect(onSelectedNodeChange).toHaveBeenCalledWith("release");
  });
});
