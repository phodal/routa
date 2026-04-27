/**
 * @vitest-environment node
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getFeatureRetrospectiveMemoryPath,
  loadMatchingFeatureRetrospectiveMemories,
  saveFeatureRetrospectiveMemory,
} from "../retrospective-memory";

describe("retrospective-memory", () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "routa-retro-home-"));
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

  it("stores one json per file target", async () => {
    const repoRoot = "/Users/phodal/ai/routa-js";
    const filePath = "src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx";
    const result = saveFeatureRetrospectiveMemory(repoRoot, {
      scope: "file",
      filePath,
      featureId: "feature-explorer",
      featureName: "Feature Explorer",
      summary: "Open with the exact file path and state whether you want read-only retrospective or implementation work.",
    });

    expect(result.storagePath).toBe(
      path.join(
        tempHome,
        ".routa",
        "projects",
        "Users-phodal-ai-routa-js",
        "feature-explorer",
        "retrospectives",
        "files",
        "src",
        "app",
        "workspace",
        "[workspaceId]",
        "feature-explorer",
        "feature-explorer-page-client.tsx.json",
      ),
    );

    const stored = JSON.parse(await fs.readFile(result.storagePath, "utf8")) as {
      targetId: string;
      summary: string;
      featureId?: string;
    };
    expect(stored).toMatchObject({
      targetId: filePath,
      featureId: "feature-explorer",
    });

    const loaded = loadMatchingFeatureRetrospectiveMemories(repoRoot, {
      filePaths: [filePath],
    });
    expect(loaded.matchedMemories).toEqual([
      expect.objectContaining({
        scope: "file",
        targetId: filePath,
        summary: "Open with the exact file path and state whether you want read-only retrospective or implementation work.",
      }),
    ]);
  });

  it("stores feature memories as separate json files", async () => {
    const repoRoot = "/Users/phodal/ai/routa-js";
    const result = saveFeatureRetrospectiveMemory(repoRoot, {
      scope: "feature",
      featureId: "feature-explorer",
      featureName: "Feature Explorer",
      summary: "Mention the target file first, then the feature, and say whether transcript rereads are allowed.",
    });
    saveFeatureRetrospectiveMemory(repoRoot, {
      scope: "feature",
      featureId: "workspace-overview",
      featureName: "Workspace Overview",
      summary: "Call out the main page before expanding to adjacent routes.",
    });

    expect(result.storagePath).toBe(
      path.join(
        tempHome,
        ".routa",
        "projects",
        "Users-phodal-ai-routa-js",
        "feature-explorer",
        "retrospectives",
        "features",
        "feature-explorer.json",
      ),
    );

    const loaded = loadMatchingFeatureRetrospectiveMemories(repoRoot, {
      featureIds: ["feature-explorer", "workspace-overview"],
    });
    expect(loaded.matchedMemories).toEqual([
      expect.objectContaining({
        scope: "feature",
        targetId: "feature-explorer",
        summary: "Mention the target file first, then the feature, and say whether transcript rereads are allowed.",
      }),
      expect.objectContaining({
        scope: "feature",
        targetId: "workspace-overview",
        summary: "Call out the main page before expanding to adjacent routes.",
      }),
    ]);
  });

  it("exposes deterministic target paths for file and feature entries", () => {
    const repoRoot = "/Users/phodal/ai/routa-js";

    expect(getFeatureRetrospectiveMemoryPath(repoRoot, {
      scope: "file",
      filePath: "src/app/page.tsx",
    })).toBe(
      path.join(
        tempHome,
        ".routa",
        "projects",
        "Users-phodal-ai-routa-js",
        "feature-explorer",
        "retrospectives",
        "files",
        "src",
        "app",
        "page.tsx.json",
      ),
    );
    expect(getFeatureRetrospectiveMemoryPath(repoRoot, {
      scope: "feature",
      featureId: "workspace-overview",
    })).toBe(
      path.join(
        tempHome,
        ".routa",
        "projects",
        "Users-phodal-ai-routa-js",
        "feature-explorer",
        "retrospectives",
        "features",
        "workspace-overview.json",
      ),
    );
  });
});
