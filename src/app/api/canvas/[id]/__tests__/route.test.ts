import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryArtifactStore } from "@/core/store/artifact-store";
import { createArtifact } from "@/core/models/artifact";
import type { CanvasArtifactPayload } from "@/core/models/canvas-artifact";

const artifactStore = new InMemoryArtifactStore();

const system = {
  artifactStore,
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

import { GET, DELETE } from "../route";

const SAMPLE_TSX = `import { H1 } from "@canvas-sdk";\nexport default function() { return <H1>Hi</H1>; }`;

function makeDynamicCanvasArtifact(id: string, title: string) {
  const payload: CanvasArtifactPayload = {
    metadata: {
      renderMode: "dynamic",
      title,
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      workspaceId: "ws-1",
    },
    source: SAMPLE_TSX,
  };

  return createArtifact({
    id,
    type: "canvas",
    taskId: `canvas-${id}`,
    workspaceId: "ws-1",
    content: JSON.stringify(payload),
    context: `Canvas: ${title}`,
    status: "provided",
    metadata: { renderMode: "dynamic", title, schemaVersion: "1" },
  });
}

function makePrebuiltCanvasArtifact(id: string, title: string) {
  const payload: CanvasArtifactPayload = {
    metadata: {
      renderMode: "prebuilt",
      canvasType: "fitness_overview",
      title,
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      workspaceId: "ws-1",
    },
    data: { overallLevel: "L3" },
  };

  return createArtifact({
    id,
    type: "canvas",
    taskId: `canvas-${id}`,
    workspaceId: "ws-1",
    content: JSON.stringify(payload),
    context: `Canvas: ${title}`,
    status: "provided",
    metadata: {
      renderMode: "prebuilt",
      canvasType: "fitness_overview",
      title,
      schemaVersion: "1",
    },
  });
}

describe("/api/canvas/[id]", () => {
  beforeEach(async () => {
    await artifactStore.deleteByTask("canvas-c1");
    await artifactStore.deleteByTask("canvas-c2");
  });

  describe("GET", () => {
    it("returns a dynamic canvas artifact with source", async () => {
      const artifact = makeDynamicCanvasArtifact("c1", "Dynamic One");
      await artifactStore.saveArtifact(artifact);

      const req = new NextRequest("http://localhost/api/canvas/c1");
      const res = await GET(req, { params: Promise.resolve({ id: "c1" }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.id).toBe("c1");
      expect(json.renderMode).toBe("dynamic");
      expect(json.source).toBe(SAMPLE_TSX);
      expect(json.data).toBeUndefined();
    });

    it("returns a prebuilt canvas artifact with data", async () => {
      const artifact = makePrebuiltCanvasArtifact("c1", "Prebuilt One");
      await artifactStore.saveArtifact(artifact);

      const req = new NextRequest("http://localhost/api/canvas/c1");
      const res = await GET(req, { params: Promise.resolve({ id: "c1" }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.renderMode).toBe("prebuilt");
      expect(json.canvasType).toBe("fitness_overview");
      expect(json.data).toEqual({ overallLevel: "L3" });
    });

    it("returns 404 for missing canvas", async () => {
      const req = new NextRequest("http://localhost/api/canvas/missing");
      const res = await GET(req, {
        params: Promise.resolve({ id: "missing" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-canvas artifact", async () => {
      const artifact = createArtifact({
        id: "not-canvas",
        type: "screenshot",
        taskId: "task-1",
        workspaceId: "ws-1",
        status: "provided",
      });
      await artifactStore.saveArtifact(artifact);

      const req = new NextRequest("http://localhost/api/canvas/not-canvas");
      const res = await GET(req, {
        params: Promise.resolve({ id: "not-canvas" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE", () => {
    it("deletes a canvas artifact", async () => {
      const artifact = makeDynamicCanvasArtifact("c2", "To Delete");
      await artifactStore.saveArtifact(artifact);

      const req = new NextRequest("http://localhost/api/canvas/c2", {
        method: "DELETE",
      });
      const res = await DELETE(req, {
        params: Promise.resolve({ id: "c2" }),
      });
      expect(res.status).toBe(200);

      const after = await artifactStore.getArtifact("c2");
      expect(after).toBeUndefined();
    });

    it("returns 404 for missing canvas", async () => {
      const req = new NextRequest("http://localhost/api/canvas/missing", {
        method: "DELETE",
      });
      const res = await DELETE(req, {
        params: Promise.resolve({ id: "missing" }),
      });
      expect(res.status).toBe(404);
    });
  });
});
