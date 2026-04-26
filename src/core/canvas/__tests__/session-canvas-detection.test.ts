import { describe, expect, it } from "vitest";

import {
  extractCanvasToolWriteCandidate,
  getCanvasToolWriteCandidateKey,
} from "../session-canvas-detection";
import { buildLiveCanvasAgentPrompt } from "../session-canvas-prompt";

describe("session canvas detection", () => {
  it("extracts a direct Write tool candidate for a canvas file", () => {
    const candidate = extractCanvasToolWriteCandidate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawInput: {
          path: "canvases/status.canvas.tsx",
          content: "export default function Canvas(){ return <div>Status</div>; }",
        },
      },
    });

    expect(candidate).toMatchObject({
      fileName: "status.canvas.tsx",
      filePath: "canvases/status.canvas.tsx",
      sessionId: "session-1",
      title: "Status",
      toolCallId: "tool-1",
    });
    expect(candidate?.source).toContain("export default function Canvas");
  });

  it("extracts a canvas from an apply_patch add-file hunk", () => {
    const candidate = extractCanvasToolWriteCandidate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-2",
        status: "completed",
        rawInput: {
          patch: [
            "*** Begin Patch",
            "*** Add File: canvases/agent-flow.canvas.tsx",
            "+import { Card } from \"routa/canvas\";",
            "+",
            "+export default function Canvas(){",
            "+  return <Card title=\"Flow\">Ready</Card>;",
            "+}",
            "*** End Patch",
          ].join("\n"),
        },
      },
    });

    expect(candidate).toMatchObject({
      fileName: "agent-flow.canvas.tsx",
      filePath: "canvases/agent-flow.canvas.tsx",
      title: "Agent Flow",
    });
    expect(candidate?.source).toContain("export default function Canvas");
  });

  it("ignores non-canvas paths and non-renderable source", () => {
    expect(extractCanvasToolWriteCandidate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call_update",
        rawInput: {
          path: "src/status.tsx",
          content: "export default function Canvas(){ return <div />; }",
        },
      },
    })).toBeNull();

    expect(extractCanvasToolWriteCandidate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call_update",
        rawInput: {
          path: "canvases/status.canvas.tsx",
          content: "not a component",
        },
      },
    })).toBeNull();
  });

  it("builds a stable candidate key", () => {
    const candidate = extractCanvasToolWriteCandidate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        rawInput: {
          path: "canvases/status.canvas.tsx",
          content: "export default function Canvas(){ return <div>Status</div>; }",
        },
      },
    });

    expect(candidate ? getCanvasToolWriteCandidateKey(candidate) : "").toBe(
      "session-1:tool-1:canvases/status.canvas.tsx:61",
    );
  });
});

describe("live canvas prompt", () => {
  it("adapts the canvas skill into a Routa agent prompt", () => {
    const prompt = buildLiveCanvasAgentPrompt({
      repoPath: "/Users/phodal/ai/routa-js",
      request: "Render the latest tool result.",
    });

    expect(prompt).toContain("Create or overwrite exactly one `*.canvas.tsx` file");
    expect(prompt).toContain("read_canvas_sdk_resource");
    expect(prompt).toContain("Import only from `routa/canvas` or `react`.");
    expect(prompt).toContain("/Users/phodal/ai/routa-js");
    expect(prompt).toContain("Render the latest tool result.");
  });
});
