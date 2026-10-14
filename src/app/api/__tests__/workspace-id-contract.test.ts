import { readFileSync } from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

/**
 * #576: api-contract.yaml must document workspaceId as required (no implicit
 * "default") for the endpoints whose Next.js handlers reject a missing
 * workspaceId with 400. This test locks both sides together.
 */

// Handlers must reject before touching the system; any access fails the test.
vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () =>
    new Proxy({}, {
      get(_target, prop) {
        throw new Error(`system.${String(prop)} accessed before workspaceId validation`);
      },
    }),
}));

type Param = { name: string; in: string; required?: boolean; schema?: { default?: unknown } };
type Operation = {
  parameters?: Param[];
  requestBody?: {
    content?: {
      "application/json"?: {
        schema?: { required?: string[]; properties?: Record<string, { default?: unknown }> };
      };
    };
  };
  responses?: Record<string, unknown>;
};

const contract = parse(readFileSync(path.resolve(process.cwd(), "api-contract.yaml"), "utf8")) as {
  paths: Record<string, Record<string, Operation>>;
};

const QUERY_OPS: Array<[string, string]> = [
  ["/api/agents", "get"],
  ["/api/tasks", "get"],
  ["/api/tasks/ready", "get"],
  ["/api/kanban/boards", "get"],
  ["/api/notes", "get"],
  ["/api/notes", "delete"],
  ["/api/a2ui/dashboard", "get"],
];
const BODY_OPS: Array<[string, string]> = [
  ["/api/agents", "post"],
  ["/api/tasks", "post"],
  ["/api/notes", "post"],
  ["/api/a2ui/dashboard", "post"],
];

describe("workspaceId contract (#576)", () => {
  it.each(QUERY_OPS)("%s %s documents query workspaceId without a default and a 400", (p, m) => {
    const op = contract.paths[p][m];
    const param = op.parameters?.find((x) => x.name === "workspaceId" && x.in === "query");
    expect(param).toBeDefined();
    expect(param?.schema?.default).toBeUndefined();
    // GET /api/agents also accepts `id` instead of workspaceId.
    if (p !== "/api/agents") expect(param?.required).toBe(true);
    expect(op.responses?.["400"]).toBeDefined();
  });

  it.each(BODY_OPS)("%s %s documents body workspaceId as required without a default and a 400", (p, m) => {
    const op = contract.paths[p][m];
    const schema = op.requestBody?.content?.["application/json"]?.schema;
    expect(schema?.required).toContain("workspaceId");
    expect(schema?.properties?.workspaceId?.default).toBeUndefined();
    expect(op.responses?.["400"]).toBeDefined();
  });

  const url = (p: string, q = "") => `http://localhost${p}${q}`;
  const jsonReq = (p: string, method: string, body: unknown) =>
    new NextRequest(url(p), { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  it("Next.js handlers return 400 when workspaceId is omitted", async () => {
    const agents = await import("../agents/route");
    const tasks = await import("../tasks/route");
    const ready = await import("../tasks/ready/route");
    const boards = await import("../kanban/boards/route");
    const notes = await import("../notes/route");
    const a2ui = await import("../a2ui/dashboard/route");

    const responses = await Promise.all([
      agents.GET(new NextRequest(url("/api/agents"))),
      agents.POST(jsonReq("/api/agents", "POST", { name: "A", role: "DEVELOPER" })),
      tasks.GET(new NextRequest(url("/api/tasks"))),
      tasks.POST(jsonReq("/api/tasks", "POST", { title: "t", objective: "o" })),
      ready.GET(new NextRequest(url("/api/tasks/ready"))),
      boards.GET(new NextRequest(url("/api/kanban/boards"))),
      notes.GET(new NextRequest(url("/api/notes"))),
      notes.POST(jsonReq("/api/notes", "POST", { title: "n" })),
      notes.DELETE(new NextRequest(url("/api/notes", "?noteId=n1"), { method: "DELETE" })),
      a2ui.GET(new NextRequest(url("/api/a2ui/dashboard"))),
      a2ui.POST(jsonReq("/api/a2ui/dashboard", "POST", { messages: [] })),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "workspaceId is required" });
    }
  });
});
