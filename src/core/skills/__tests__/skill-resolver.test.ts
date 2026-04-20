import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fsSkill: undefined as { content?: string } | undefined,
  repoSkills: [] as Array<{ name: string; content?: string }>,
}));

const discoverSkillsFromPathMock = vi.hoisted(() => vi.fn());

vi.mock("../skill-registry", () => ({
  SkillRegistry: class SkillRegistry {
    getSkill(name: string) {
      if (state.fsSkill?.content && name === "agent-browser") {
        return state.fsSkill;
      }
      return undefined;
    }
  },
}));

vi.mock("../skill-loader", () => ({
  discoverSkillsFromPath: discoverSkillsFromPathMock.mockImplementation(() => state.repoSkills),
}));

const { resolveSkillContent } = await import("../skill-resolver");

describe("resolveSkillContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.fsSkill = undefined;
    state.repoSkills = [];
  });

  it("returns filesystem skill content first", async () => {
    state.fsSkill = { content: "filesystem content" };

    await expect(resolveSkillContent("agent-browser", "/repo")).resolves.toBe("filesystem content");
    expect(discoverSkillsFromPathMock).not.toHaveBeenCalled();
  });

  it("falls back to repo-local skills when filesystem discovery misses", async () => {
    state.repoSkills = [
      { name: "repo-skill", content: "repo content" },
      { name: "other-skill", content: "other content" },
    ];

    await expect(resolveSkillContent("repo-skill", "/repo")).resolves.toBe("repo content");
    expect(discoverSkillsFromPathMock).toHaveBeenCalledWith("/repo");
  });

  it("returns undefined when no source resolves content", async () => {
    await expect(resolveSkillContent("missing-skill", "/repo")).resolves.toBeUndefined();
  });
});
