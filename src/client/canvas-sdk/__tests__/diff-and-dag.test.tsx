/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CanvasHost } from "@/client/canvas-runtime";
import {
  computeDAGLayout,
  DiffStats,
  DiffView,
} from "@/client/canvas-sdk";

describe("canvas-sdk diff and DAG helpers", () => {
  it("renders diff stats only when there are changes", () => {
    const { container, rerender } = render(
      <CanvasHost applyBodyTheme={false}>
        <DiffStats additions={3} deletions={1} />
      </CanvasHost>,
    );

    expect(screen.getByText("+3")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();

    rerender(
      <CanvasHost applyBodyTheme={false}>
        <DiffStats additions={0} deletions={0} />
      </CanvasHost>,
    );

    expect(container.textContent).not.toContain("+0");
    expect(container.textContent).not.toContain("-0");
  });

  it("renders structured diff lines with inferred language metadata", () => {
    const { container } = render(
      <CanvasHost applyBodyTheme={false}>
        <DiffView
          path="src/core/example.ts"
          lines={[
            { type: "unchanged", content: "export const value = 1;", lineNumber: 1 },
            { type: "removed", content: "return oldValue;", lineNumber: 2 },
            { type: "added", content: "return nextValue;", lineNumber: 2 },
          ]}
        />
      </CanvasHost>,
    );

    const diff = screen.getByLabelText("Diff for src/core/example.ts");
    expect(diff.getAttribute("data-language")).toBe("typescript");
    expect(diff.textContent).toContain("return nextValue;");
    expect(container.innerHTML).toContain("hljs-keyword");
  });

  it("escapes highlighted diff content instead of injecting raw HTML", () => {
    const { container } = render(
      <CanvasHost applyBodyTheme={false}>
        <DiffView
          language="ts"
          lines={[
            { type: "added", content: "const value = \"<script>alert(1)</script>\";", lineNumber: 1 },
          ]}
        />
      </CanvasHost>,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).toContain("&lt;script&gt;");
  });

  it("computes rank-based DAG layout and marks back edges", () => {
    const layout = computeDAGLayout({
      nodes: [{ id: "entry" }, { id: "core" }, { id: "leaf" }],
      edges: [
        { from: "entry", to: "core" },
        { from: "core", to: "leaf" },
        { from: "leaf", to: "entry" },
      ],
      direction: "horizontal",
      nodeWidth: 100,
      nodeHeight: 40,
      rankGap: 50,
      nodeGap: 20,
      padding: 10,
    });

    expect(layout.direction).toBe("horizontal");
    expect(layout.nodes.find((node) => node.id === "entry")?.rank).toBe(0);
    expect(layout.nodes.find((node) => node.id === "core")?.rank).toBe(1);
    expect(layout.edges.find((edge) => edge.from === "leaf" && edge.to === "entry")?.isBackEdge).toBe(true);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});
