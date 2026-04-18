/**
 * @vitest-environment node
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildFitnessCanvasFileName,
  getStoredFitnessCanvasPath,
  persistFitnessCanvasSource,
} from "../local-canvas-storage";
import { getProjectStorageDir } from "@/core/storage/folder-slug";

describe("local canvas storage", () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "routa-canvas-home-"));
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

  it("builds a deterministic fitness canvas file name", () => {
    expect(buildFitnessCanvasFileName("/Users/phodal/ai/routa-js", "routa-js")).toBe(
      "routa-js-fitness-overview.canvas.tsx",
    );
  });

  it("resolves the stored path under ~/.routa/projects/{slug}/canvases", () => {
    expect(getStoredFitnessCanvasPath("/Users/phodal/ai/routa-js", "routa-js")).toBe(
      path.join(
        tempHome,
        ".routa",
        "projects",
        "Users-phodal-ai-routa-js",
        "canvases",
        "routa-js-fitness-overview.canvas.tsx",
      ),
    );
  });

  it("stores canvases for managed clone repos under the current project storage root", () => {
    const cloneRepoPath = path.join(process.cwd(), ".routa", "repos", "phodal--routa");

    expect(getStoredFitnessCanvasPath(cloneRepoPath, "phodal/routa")).toBe(
      path.join(
        getProjectStorageDir(process.cwd()),
        "canvases",
        "phodal-routa-fitness-overview.canvas.tsx",
      ),
    );
  });

  it("persists the generated canvas source to the project-local canvases directory", async () => {
    const result = await persistFitnessCanvasSource({
      repoPath: "/Users/phodal/ai/routa-js",
      repoLabel: "routa-js",
      source: "export default function Canvas(){ return <div />; }",
    });

    await expect(fs.readFile(result.filePath, "utf-8")).resolves.toBe(
      "export default function Canvas(){ return <div />; }\n",
    );
  });

  it("persists managed clone canvases under the current project storage root", async () => {
    const cloneRepoPath = path.join(process.cwd(), ".routa", "repos", "phodal--routa");
    const result = await persistFitnessCanvasSource({
      repoPath: cloneRepoPath,
      repoLabel: "phodal/routa",
      source: "export default function Canvas(){ return <div>Clone</div>; }",
    });

    expect(result.filePath).toBe(
      path.join(
        getProjectStorageDir(process.cwd()),
        "canvases",
        "phodal-routa-fitness-overview.canvas.tsx",
      ),
    );
    await expect(fs.readFile(result.filePath, "utf-8")).resolves.toContain("Clone");
  });
});
