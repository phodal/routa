import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const system = {
  codebaseStore: {
    get: vi.fn(),
    listByWorkspace: vi.fn(),
  },
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

import { isFitnessContextError, resolveFitnessRepoRoot } from "../repo-root";

describe("fitness repo root resolution", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    system.codebaseStore.get.mockResolvedValue(undefined);
    system.codebaseStore.listByWorkspace.mockResolvedValue([]);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-fitness-repo-root-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("accepts local repoPath directories that are not Routa workspaces", async () => {
    await expect(resolveFitnessRepoRoot({ repoPath: tempDir })).resolves.toBe(tempDir);
  });

  it("treats missing directories as context errors", () => {
    expect(isFitnessContextError(`repoPath 不存在或不是目录: ${path.join(tempDir, "missing")}`)).toBe(true);
  });

  it("accepts codebase-backed local directories that are not Routa workspaces", async () => {
    system.codebaseStore.get.mockResolvedValue({
      id: "cb-local",
      repoPath: tempDir,
    });

    await expect(resolveFitnessRepoRoot({ codebaseId: "cb-local" })).resolves.toBe(tempDir);
  });
});
