import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CatalogInstallResult,
  CloneSkillsResult,
  GithubCatalogResult,
  SkillContent,
  SkillSummary,
  SkillsShSearchResult,
} from "@/client/skill-client";

const {
  constructorBaseUrls,
  listMock,
  loadMock,
  reloadMock,
  cloneFromGithubMock,
  listFromRepoMock,
  searchSkillsShMock,
  listGithubCatalogMock,
  installFromSkillsShMock,
  installFromGithubCatalogMock,
  logRuntimeMock,
  toErrorMessageMock,
  getDesktopApiBaseUrlMock,
} = vi.hoisted(() => ({
  constructorBaseUrls: [] as string[],
  listMock: vi.fn<() => Promise<SkillSummary[]>>(),
  loadMock: vi.fn<(name: string, repoPath?: string) => Promise<SkillContent | null>>(),
  reloadMock: vi.fn<() => Promise<{ count: number }>>(),
  cloneFromGithubMock: vi.fn<(url: string) => Promise<CloneSkillsResult>>(),
  listFromRepoMock: vi.fn<(repoPath: string) => Promise<SkillSummary[]>>(),
  searchSkillsShMock: vi.fn<(query: string) => Promise<SkillsShSearchResult>>(),
  listGithubCatalogMock: vi.fn<(repo?: string, path?: string) => Promise<GithubCatalogResult>>(),
  installFromSkillsShMock: vi.fn<(skills: Array<{ name: string; source: string }>) => Promise<CatalogInstallResult>>(),
  installFromGithubCatalogMock: vi.fn<(skills: string[], repo?: string, path?: string) => Promise<CatalogInstallResult>>(),
  logRuntimeMock: vi.fn(),
  toErrorMessageMock: vi.fn((error: unknown) => error instanceof Error ? error.message : String(error)),
  getDesktopApiBaseUrlMock: vi.fn(() => "/desktop"),
}));

vi.mock("../../skill-client", () => ({
  SkillClient: class MockSkillClient {
    constructor(baseUrl: string = "") {
      constructorBaseUrls.push(baseUrl);
    }
    list = listMock;
    load = loadMock;
    reload = reloadMock;
    cloneFromGithub = cloneFromGithubMock;
    listFromRepo = listFromRepoMock;
    searchSkillsSh = searchSkillsShMock;
    listGithubCatalog = listGithubCatalogMock;
    installFromSkillsSh = installFromSkillsShMock;
    installFromGithubCatalog = installFromGithubCatalogMock;
  },
}));

vi.mock("../../utils/diagnostics", () => ({
  getDesktopApiBaseUrl: getDesktopApiBaseUrlMock,
  logRuntime: logRuntimeMock,
  toErrorMessage: toErrorMessageMock,
}));

import { useSkills } from "../use-skills";

describe("useSkills", () => {
  beforeEach(() => {
    constructorBaseUrls.length = 0;
    vi.clearAllMocks();

    listMock.mockResolvedValue([
      { name: "local-skill", description: "Local skill", source: "local" },
      { name: "shared-skill", description: "Shared local skill", source: "local" },
    ]);
    loadMock.mockResolvedValue({
      name: "local-skill",
      description: "Local skill",
      content: "# local skill",
    });
    reloadMock.mockResolvedValue({ count: 2 });
    cloneFromGithubMock.mockResolvedValue({
      success: true,
      imported: ["new-skill"],
      count: 1,
      repoPath: "/tmp/skills",
      source: "https://github.com/acme/skills",
    });
    listFromRepoMock.mockResolvedValue([
      { name: "shared-skill", description: "Shared repo skill", source: "repo" },
      { name: "repo-only-skill", description: "Repo skill", source: "repo" },
    ]);
    searchSkillsShMock.mockResolvedValue({
      type: "skillssh",
      query: "git",
      count: 1,
      skills: [{ name: "git-release", slug: "git-release", source: "skills.sh", installs: 12, installed: false }],
    });
    listGithubCatalogMock.mockResolvedValue({
      type: "github",
      repo: "openai/skills",
      path: "skills/.curated",
      ref: "main",
      skills: [{ name: "reviewer", installed: false }],
    });
    installFromSkillsShMock.mockResolvedValue({
      success: true,
      installed: ["git-release"],
      errors: [],
      dest: "/Users/test/.codex/skills",
    });
    installFromGithubCatalogMock.mockResolvedValue({
      success: true,
      installed: ["reviewer"],
      errors: [],
      dest: "/Users/test/.codex/skills",
    });
  });

  it("loads local skills on mount and merges repo skills without duplicates", async () => {
    const { result } = renderHook(() => useSkills());

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(2);
    });

    expect(constructorBaseUrls.length).toBeGreaterThan(0);
    expect(constructorBaseUrls.every((baseUrl) => baseUrl === "/desktop")).toBe(true);

    await act(async () => {
      await result.current.loadRepoSkills("/repo/app");
    });

    expect(result.current.repoSkills).toHaveLength(2);
    expect(result.current.allSkills.map((skill) => skill.name)).toEqual([
      "local-skill",
      "shared-skill",
      "repo-only-skill",
    ]);

    act(() => {
      result.current.clearRepoSkills();
    });

    expect(result.current.repoSkills).toEqual([]);
  });

  it("loads skill content and handles load failures", async () => {
    const { result } = renderHook(() => useSkills("http://custom"));

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(2);
    });

    await act(async () => {
      const skill = await result.current.loadSkill("local-skill", "/repo/app");
      expect(skill?.name).toBe("local-skill");
    });

    expect(result.current.loadedSkill).toMatchObject({
      name: "local-skill",
      content: "# local skill",
    });

    loadMock.mockRejectedValueOnce(new Error("load failed"));

    await act(async () => {
      const skill = await result.current.loadSkill("broken-skill");
      expect(skill).toBeNull();
    });

    expect(result.current.error).toBe("load failed");
  });

  it("reloads and clones skills while surfacing clone errors", async () => {
    const { result } = renderHook(() => useSkills());

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(2);
    });

    listMock.mockResolvedValueOnce([
      { name: "reloaded-skill", description: "Reloaded", source: "local" },
    ]);

    await act(async () => {
      await result.current.reloadFromDisk();
    });

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(result.current.skills).toEqual([
      { name: "reloaded-skill", description: "Reloaded", source: "local" },
    ]);

    listMock.mockResolvedValueOnce([
      { name: "reloaded-skill", description: "Reloaded", source: "local" },
      { name: "new-skill", description: "Imported", source: "local" },
    ]);

    await act(async () => {
      const cloneResult = await result.current.cloneFromGithub("https://github.com/acme/skills");
      expect(cloneResult.success).toBe(true);
    });

    expect(result.current.skills.map((skill) => skill.name)).toEqual([
      "reloaded-skill",
      "new-skill",
    ]);

    cloneFromGithubMock.mockRejectedValueOnce(new Error("clone exploded"));

    await act(async () => {
      const cloneResult = await result.current.cloneFromGithub("https://github.com/acme/bad");
      expect(cloneResult).toMatchObject({
        success: false,
        source: "https://github.com/acme/bad",
        error: "clone exploded",
      });
    });

    expect(result.current.error).toBe("clone exploded");
  });

  it("searches and installs catalog skills, updating installed flags", async () => {
    const { result } = renderHook(() => useSkills());

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(2);
    });

    await act(async () => {
      const searchResults = await result.current.searchCatalog("git");
      expect(searchResults).toHaveLength(1);
    });

    listMock.mockResolvedValueOnce([
      { name: "local-skill", description: "Local skill", source: "local" },
      { name: "git-release", description: "Git release", source: "local" },
    ]);

    await act(async () => {
      const installResult = await result.current.installFromCatalog([
        { name: "git-release", source: "skills.sh" },
      ]);
      expect(installResult?.installed).toEqual(["git-release"]);
    });

    expect(result.current.catalogSkills).toEqual([
      { name: "git-release", slug: "git-release", source: "skills.sh", installs: 12, installed: true },
    ]);
    expect(result.current.skills.map((skill) => skill.name)).toEqual(["local-skill", "git-release"]);
  });

  it("lists and installs GitHub catalog skills, and clears catalog state", async () => {
    const { result } = renderHook(() => useSkills());

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(2);
    });

    await act(async () => {
      const githubSkills = await result.current.listGithubCatalog("openai/skills", "skills/.curated");
      expect(githubSkills).toEqual([{ name: "reviewer", installed: false }]);
    });

    listMock.mockResolvedValueOnce([
      { name: "local-skill", description: "Local skill", source: "local" },
      { name: "reviewer", description: "Reviewer", source: "local" },
    ]);

    await act(async () => {
      const installResult = await result.current.installFromGithubCatalog(["reviewer"], "openai/skills", "skills/.curated");
      expect(installResult?.installed).toEqual(["reviewer"]);
    });

    expect(result.current.githubCatalogSkills).toEqual([{ name: "reviewer", installed: true }]);

    act(() => {
      result.current.clearCatalog();
    });

    expect(result.current.catalogSkills).toEqual([]);
    expect(result.current.githubCatalogSkills).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
