import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  discoverSkillsMock,
  loadSkillFileMock,
} = vi.hoisted(() => ({
  discoverSkillsMock: vi.fn(),
  loadSkillFileMock: vi.fn(),
}));

vi.mock("../skill-loader", () => ({
  discoverSkills: discoverSkillsMock,
  loadSkillFile: loadSkillFileMock,
}));

const { SkillRegistry } = await import("../skill-registry");

describe("SkillRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    discoverSkillsMock.mockReturnValue([]);
    loadSkillFileMock.mockReturnValue(null);
  });

  it("auto-discovers skills on construction and filters denied permissions", () => {
    discoverSkillsMock.mockReturnValue([
      {
        name: "agent-browser",
        description: "Browser automation",
        shortDescription: "Browser",
        content: "browser skill",
        source: "/skills/agent-browser/SKILL.md",
      },
      {
        name: "internal-admin",
        description: "Admin only",
        content: "secret skill",
        source: "/skills/internal-admin/SKILL.md",
      },
    ]);

    const registry = new SkillRegistry({
      projectDir: "/workspace/repo",
      permissions: {
        "internal-*": "deny",
        "*": "allow",
      },
    });

    expect(discoverSkillsMock).toHaveBeenCalledWith("/workspace/repo");
    expect(registry.getSkill("agent-browser")?.description).toBe("Browser automation");
    expect(registry.getSkill("internal-admin")).toBeUndefined();
    expect(registry.listSkills().map((skill) => skill.name)).toEqual(["agent-browser"]);
    expect(registry.listSkillSummaries()).toEqual([
      {
        name: "agent-browser",
        description: "Browser automation",
        shortDescription: "Browser",
      },
    ]);
  });

  it("supports ask permissions, exact matches, and ACP command serialization", () => {
    const registry = new SkillRegistry({
      permissions: {
        "agent-browser": "ask",
        "*": "allow",
      },
    });

    registry.register({
      name: "agent-browser",
      description: "Browser automation",
      content: "browser skill",
      source: "/skills/agent-browser/SKILL.md",
    });
    registry.register({
      name: "skill-creator",
      description: "Create skills",
      content: "creator skill",
      source: "/skills/skill-creator/SKILL.md",
    });

    expect(registry.needsPermission("agent-browser")).toBe(true);
    expect(registry.needsPermission("skill-creator")).toBe(false);
    expect(registry.toAcpCommands()).toEqual([
      { name: "agent-browser", description: "Browser automation" },
      { name: "skill-creator", description: "Create skills" },
    ]);
  });

  it("registers skills from files and skips null loader results", () => {
    const registry = new SkillRegistry();
    loadSkillFileMock
      .mockReturnValueOnce({
        name: "agent-browser",
        description: "Browser automation",
        content: "browser skill",
        source: "/skills/agent-browser/SKILL.md",
      })
      .mockReturnValueOnce(null);

    const registered = registry.registerFromFile("/skills/agent-browser/SKILL.md");
    const missing = registry.registerFromFile("/skills/missing/SKILL.md");

    expect(registered?.name).toBe("agent-browser");
    expect(missing).toBeNull();
    expect(registry.listSkills().map((skill) => skill.name)).toEqual(["agent-browser"]);
  });

  it("reloads skills from disk and replaces previous registry contents", () => {
    discoverSkillsMock
      .mockReturnValueOnce([
        {
          name: "old-skill",
          description: "Old",
          content: "old",
          source: "/skills/old-skill/SKILL.md",
        },
      ])
      .mockReturnValueOnce([
        {
          name: "new-skill",
          description: "New",
          content: "new",
          source: "/skills/new-skill/SKILL.md",
        },
      ]);

    const registry = new SkillRegistry({ projectDir: "/workspace/repo" });
    expect(registry.listSkills().map((skill) => skill.name)).toEqual(["old-skill"]);

    registry.reload("/workspace/other-repo");

    expect(discoverSkillsMock).toHaveBeenNthCalledWith(2, "/workspace/other-repo");
    expect(registry.listSkills().map((skill) => skill.name)).toEqual(["new-skill"]);
  });
});
