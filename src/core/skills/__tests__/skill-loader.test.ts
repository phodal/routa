import { beforeEach, describe, expect, it, vi } from "vitest";

type DirEntry = { name: string; isDirectory: boolean };

const fsState = vi.hoisted(() => ({
  existingPaths: new Set<string>(),
  dirEntries: new Map<string, DirEntry[]>(),
  fileContents: new Map<string, string>(),
  env: {
    HOME: "/home/tester" as string | undefined,
    USERPROFILE: undefined as string | undefined,
  },
}));

vi.mock("@/core/platform", () => ({
  getServerBridge: () => ({
    env: {
      getEnv: (name: string) => fsState.env[name as keyof typeof fsState.env],
      homeDir: () => "/home/fallback",
    },
    fs: {
      existsSync: (target: string) => fsState.existingPaths.has(target),
      readDirSync: (target: string) => {
        const entries = fsState.dirEntries.get(target);
        if (!entries) {
          throw new Error(`Directory not readable: ${target}`);
        }
        return entries;
      },
      readTextFileSync: (target: string) => {
        const content = fsState.fileContents.get(target);
        if (content === undefined) {
          throw new Error(`File not found: ${target}`);
        }
        return content;
      },
    },
  }),
}));

const {
  discoverSkills,
  discoverSkillsFromPath,
  loadSkillFile,
} = await import("../skill-loader");

function defineDirectory(path: string, entries: DirEntry[]): void {
  fsState.existingPaths.add(path);
  fsState.dirEntries.set(path, entries);
}

function defineSkillFile(path: string, content: string): void {
  fsState.existingPaths.add(path);
  fsState.fileContents.set(path, content);
}

function skillMarkdown(name: string, description = "Test skill", extra = ""): string {
  return `---
name: ${name}
description: ${description}
metadata:
  short-description: Short ${name}
${extra}---

Content for ${name}
`;
}

describe("skill-loader", () => {
  beforeEach(() => {
    fsState.existingPaths.clear();
    fsState.dirEntries.clear();
    fsState.fileContents.clear();
    fsState.env.HOME = "/home/tester";
    fsState.env.USERPROFILE = undefined;
  });

  it("loads a valid skill file and trims markdown content", () => {
    const filePath = "/workspace/.agents/skills/agent-browser/SKILL.md";
    defineSkillFile(
      filePath,
      skillMarkdown("agent-browser", "Browser automation", "license: MIT\n"),
    );

    expect(loadSkillFile(filePath, "agent-browser")).toEqual({
      name: "agent-browser",
      description: "Browser automation",
      shortDescription: "Short agent-browser",
      content: "Content for agent-browser",
      license: "MIT",
      compatibility: undefined,
      metadata: {
        "short-description": "Short agent-browser",
      },
      source: filePath,
    });
  });

  it("rejects invalid skill definitions", () => {
    const missingFields = "/workspace/.agents/skills/missing/SKILL.md";
    const invalidName = "/workspace/.agents/skills/InvalidName/SKILL.md";
    const wrongDir = "/workspace/.agents/skills/agent-browser/SKILL.md";
    const longDescription = "/workspace/.agents/skills/long/SKILL.md";

    defineSkillFile(missingFields, "---\nname: missing\n---\n\nbody\n");
    defineSkillFile(invalidName, skillMarkdown("InvalidName"));
    defineSkillFile(wrongDir, skillMarkdown("agent-browser"));
    defineSkillFile(longDescription, skillMarkdown("long-skill", "x".repeat(1025)));

    expect(loadSkillFile(missingFields, "missing")).toBeNull();
    expect(loadSkillFile(invalidName, "InvalidName")).toBeNull();
    expect(loadSkillFile(wrongDir, "other-name")).toBeNull();
    expect(loadSkillFile(longDescription, "long-skill")).toBeNull();
  });

  it("discovers project and global skills without duplicates", () => {
    defineDirectory("/workspace/.agents/skills", [{ name: "agent-browser", isDirectory: true }]);
    defineSkillFile(
      "/workspace/.agents/skills/agent-browser/SKILL.md",
      skillMarkdown("agent-browser", "Project browser skill"),
    );

    defineDirectory("/home/tester/.codex/skills", [
      { name: "agent-browser", isDirectory: true },
      { name: "skill-creator", isDirectory: true },
    ]);
    defineSkillFile(
      "/home/tester/.codex/skills/agent-browser/SKILL.md",
      skillMarkdown("agent-browser", "Global duplicate browser skill"),
    );
    defineSkillFile(
      "/home/tester/.codex/skills/skill-creator/SKILL.md",
      skillMarkdown("skill-creator", "Global creator skill"),
    );

    const discovered = discoverSkills("/workspace");

    expect(discovered.map((skill) => [skill.name, skill.description])).toEqual([
      ["agent-browser", "Project browser skill"],
      ["skill-creator", "Global creator skill"],
    ]);
  });

  it("discovers nested repo-local skill directories", () => {
    defineDirectory("/repo/skills", [{ name: "claude.ai", isDirectory: true }]);
    defineDirectory("/repo/skills/claude.ai", [{ name: "reviewer", isDirectory: true }]);
    defineSkillFile(
      "/repo/skills/claude.ai/reviewer/SKILL.md",
      skillMarkdown("reviewer", "Nested reviewer skill"),
    );

    const discovered = discoverSkillsFromPath("/repo");

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.name).toBe("reviewer");
    expect(discovered[0]?.description).toBe("Nested reviewer skill");
  });

  it("falls back to USERPROFILE when HOME is unavailable", () => {
    fsState.env.HOME = undefined;
    fsState.env.USERPROFILE = "/Users/tester";

    defineDirectory("/Users/tester/.claude/skills", [{ name: "writer", isDirectory: true }]);
    defineSkillFile(
      "/Users/tester/.claude/skills/writer/SKILL.md",
      skillMarkdown("writer", "Windows profile skill"),
    );

    const discovered = discoverSkills("/workspace");

    expect(discovered.map((skill) => skill.name)).toEqual(["writer"]);
  });
});
