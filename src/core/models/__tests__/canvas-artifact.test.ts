import { describe, expect, it } from "vitest";
import { createCanvasMetadata } from "@/core/models/canvas-artifact";

describe("canvas-artifact model", () => {
  it("creates metadata with defaults (dynamic mode, schema v1)", () => {
    const meta = createCanvasMetadata({
      title: "Test",
      generatedAt: "2026-04-16T00:00:00Z",
    });
    expect(meta.schemaVersion).toBe(1);
    expect(meta.renderMode).toBe("dynamic");
    expect(meta.title).toBe("Test");
    expect(meta.canvasType).toBeUndefined();
  });

  it("creates prebuilt metadata with canvasType", () => {
    const meta = createCanvasMetadata({
      renderMode: "prebuilt",
      canvasType: "fitness_overview",
      title: "Prebuilt Canvas",
      generatedAt: "2026-04-16T00:00:00Z",
    });
    expect(meta.renderMode).toBe("prebuilt");
    expect(meta.canvasType).toBe("fitness_overview");
  });

  it("allows custom schema version", () => {
    const meta = createCanvasMetadata({
      title: "V2 Canvas",
      generatedAt: "2026-04-16T00:00:00Z",
      schemaVersion: 2,
    });
    expect(meta.schemaVersion).toBe(2);
  });

  it("preserves optional scope identifiers", () => {
    const meta = createCanvasMetadata({
      title: "Scoped",
      generatedAt: "2026-04-16T00:00:00Z",
      workspaceId: "ws-1",
      codebaseId: "cb-1",
      repoPath: "/path/to/repo",
    });
    expect(meta.workspaceId).toBe("ws-1");
    expect(meta.codebaseId).toBe("cb-1");
    expect(meta.repoPath).toBe("/path/to/repo");
  });
});
