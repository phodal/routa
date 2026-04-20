import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryArtifactStore } from "@/core/store/artifact-store";
import { InMemoryTaskStore } from "@/core/store/task-store";
import { InMemoryWorkspaceStore } from "@/core/db/pg-workspace-store";
import { createWorkspace } from "@/core/models/workspace";

const artifactStore = new InMemoryArtifactStore();
const taskStore = new InMemoryTaskStore();
const workspaceStore = new InMemoryWorkspaceStore();

const system = {
  artifactStore,
  taskStore,
  workspaceStore,
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

import { GET, POST } from "../route";

const SAMPLE_TSX = `
import { Stack, H1, Text } from "@canvas-sdk";
export default function Hello() {
  return <Stack><H1>Hello</H1><Text>World</Text></Stack>;
}
`;

describe("/api/canvas", () => {
  beforeEach(async () => {
    const all = await artifactStore.listByWorkspace("ws-1");
    for (const a of all) {
      await artifactStore.deleteArtifact(a.id);
    }

    await taskStore.deleteByWorkspace("ws-1");
    await workspaceStore.save(createWorkspace({
      id: "ws-1",
      title: "Workspace One",
    }));
  });

  describe("POST — dynamic mode", () => {
    it("creates a dynamic canvas artifact with TSX source", async () => {
      const body = {
        renderMode: "dynamic",
        title: "Dynamic Canvas",
        source: SAMPLE_TSX,
        workspaceId: "ws-1",
      };
      const req = new NextRequest("http://localhost/api/canvas", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.id).toBeDefined();
      expect(json.renderMode).toBe("dynamic");
      expect(json.title).toBe("Dynamic Canvas");
      expect(json.taskId).toBeDefined();

      const tasks = await taskStore.listByWorkspace("ws-1");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        title: "Canvas artifact: Dynamic Canvas",
        status: "COMPLETED",
        workspaceId: "ws-1",
        labels: ["canvas"],
      });
    });

    it("defaults to dynamic renderMode when not specified", async () => {
      const body = {
        title: "Default Mode",
        source: SAMPLE_TSX,
        workspaceId: "ws-1",
      };
      const req = new NextRequest("http://localhost/api/canvas", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.renderMode).toBe("dynamic");
    });

    it("rejects dynamic mode without source", async () => {
      const body = {
        renderMode: "dynamic",
        title: "No Source",
        workspaceId: "ws-1",
      };
      const req = new NextRequest("http://localhost/api/canvas", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe("POST — prebuilt mode", () => {
    it("creates a prebuilt canvas artifact with data", async () => {
      const body = {
        renderMode: "prebuilt",
        canvasType: "fitness_overview",
        title: "Prebuilt Canvas",
        data: { overallLevel: "L3", dimensions: {} },
        workspaceId: "ws-1",
      };
      const req = new NextRequest("http://localhost/api/canvas", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.renderMode).toBe("prebuilt");
      expect(json.canvasType).toBe("fitness_overview");
    });

    it("rejects prebuilt mode without canvasType", async () => {
      const body = {
        renderMode: "prebuilt",
        title: "No Type",
        data: {},
        workspaceId: "ws-1",
      };
      const req = new NextRequest("http://localhost/api/canvas", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("rejects prebuilt mode without data", async () => {
      const body = {
        renderMode: "prebuilt",
        canvasType: "fitness_overview",
        title: "No Data",
        workspaceId: "ws-1",
      };
      const req = new NextRequest("http://localhost/api/canvas", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe("POST — common validation", () => {
    it("rejects non-object JSON bodies", async () => {
      const req = new NextRequest("http://localhost/api/canvas", {
        method: "POST",
        body: JSON.stringify(["not", "an", "object"]),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: "Invalid JSON body" });
    });

    it("rejects missing title", async () => {
      const body = { source: SAMPLE_TSX, workspaceId: "ws-1" };
      const req = new NextRequest("http://localhost/api/canvas", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("rejects missing workspaceId", async () => {
      const body = { title: "Test", source: SAMPLE_TSX };
      const req = new NextRequest("http://localhost/api/canvas", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("rejects an unknown taskId", async () => {
      const req = new NextRequest("http://localhost/api/canvas", {
        method: "POST",
        body: JSON.stringify({
          title: "Missing task",
          source: SAMPLE_TSX,
          workspaceId: "ws-1",
          taskId: "missing-task",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: "Task not found: missing-task",
      });
    });
  });

  describe("GET", () => {
    it("lists canvas artifacts for a workspace", async () => {
      for (const title of ["Canvas A", "Canvas B"]) {
        const req = new NextRequest("http://localhost/api/canvas", {
          method: "POST",
          body: JSON.stringify({
            title,
            source: SAMPLE_TSX,
            workspaceId: "ws-1",
          }),
          headers: { "Content-Type": "application/json" },
        });
        await POST(req);
      }

      const req = new NextRequest(
        "http://localhost/api/canvas?workspaceId=ws-1",
      );
      const res = await GET(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.canvasArtifacts).toHaveLength(2);
      expect(json.canvasArtifacts[0].renderMode).toBe("dynamic");
    });

    it("returns empty for unknown workspace", async () => {
      const req = new NextRequest(
        "http://localhost/api/canvas?workspaceId=ws-unknown",
      );
      const res = await GET(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.canvasArtifacts).toHaveLength(0);
    });

    it("requires workspaceId", async () => {
      const req = new NextRequest("http://localhost/api/canvas");
      const res = await GET(req);
      expect(res.status).toBe(400);
    });
  });
});
