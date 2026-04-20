/**
 * @vitest-environment node
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "../route";
import { getProjectStorageDir } from "@/core/storage/folder-slug";

describe("/api/canvas/specialist/materialize", () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "routa-materialize-home-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it("persists canvas source under ~/.routa/projects/{slug}/canvases", async () => {
    const request = new NextRequest("http://localhost/api/canvas/specialist/materialize", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: "default",
        repoPath: "/Users/phodal/ai/routa-js",
        repoLabel: "routa-js",
        source: "export default function Canvas(){ return <div>Saved</div>; }",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.filePath).toContain(
      "/.routa/projects/Users-phodal-ai-routa-js/canvases/routa-js-fitness-overview.canvas.tsx",
    );
    await expect(fs.readFile(json.filePath, "utf-8")).resolves.toContain("Saved");
  });

  it("validates required fields", async () => {
    const request = new NextRequest("http://localhost/api/canvas/specialist/materialize", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: "default",
        repoPath: "/Users/phodal/ai/routa-js",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "source is required" });
  });

  it("stores canvases for managed clone repos under the current project storage root", async () => {
    const cloneRepoPath = path.join(process.cwd(), ".routa", "repos", "phodal--routa");
    const request = new NextRequest("http://localhost/api/canvas/specialist/materialize", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: "default",
        repoPath: cloneRepoPath,
        repoLabel: "phodal/routa",
        source: "export default function Canvas(){ return <div>Clone saved</div>; }",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.filePath).toBe(
      path.join(
        getProjectStorageDir(process.cwd()),
        "canvases",
        "phodal-routa-fitness-overview.canvas.tsx",
      ),
    );
    await expect(fs.readFile(json.filePath, "utf-8")).resolves.toContain("Clone saved");
  });
});
