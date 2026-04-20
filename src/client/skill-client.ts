/**
 * Browser Skill Client
 *
 * Provides skill discovery and loading for the browser client.
 * Works via both ACP (JSON-RPC) and REST endpoints.
 *
 * Usage:
 *   const skills = new SkillClient();
 *   const list = await skills.list();
 *   const skill = await skills.load("git-release");
 *   await skills.cloneFromGithub("vercel-labs/agent-skills");
 *   const repoSkills = await skills.listFromRepo("/path/to/repo");
 */
import { resolveApiPath } from "@/client/config/backend";

export interface SkillSummary {
  name: string;
  description: string;
  /** Short label for UI display (from metadata.short-description) */
  shortDescription?: string;
  license?: string;
  compatibility?: string;
  /** "local" for installed skills, "repo" for repo-discovered skills */
  source?: "local" | "repo";
}

export interface SkillContent {
  name: string;
  description: string;
  content: string;
  license?: string;
  metadata?: Record<string, string>;
}

export interface CloneSkillsResult {
  success: boolean;
  imported: string[];
  count: number;
  repoPath: string;
  source: string;
  error?: string;
}

/** A skill from the skills.sh search catalog */
export interface SkillsShSkill {
  name: string;
  slug: string;
  source: string;
  installs: number;
  installed: boolean;
}

/** A skill from a GitHub directory catalog */
export interface GithubCatalogSkill {
  name: string;
  installed: boolean;
}

export interface SkillsShSearchResult {
  type: "skillssh";
  skills: SkillsShSkill[];
  query: string;
  count: number;
}

export interface GithubCatalogResult {
  type: "github";
  skills: GithubCatalogSkill[];
  repo: string;
  path: string;
  ref: string;
}

export type CatalogResult = SkillsShSearchResult | GithubCatalogResult;

export interface CatalogInstallResult {
  success: boolean;
  installed: string[];
  errors: string[];
  dest: string;
}

export class SkillClient {
  private baseUrl: string;
  private cache = new Map<string, SkillContent>();

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl;
  }

  /**
   * List all available skills
   */
  async list(): Promise<SkillSummary[]> {
    const response = await fetch(resolveApiPath("api/skills", this.baseUrl));
    const data = await response.json();
    return (data.skills ?? []).map((s: SkillSummary) => ({
      ...s,
      source: "local" as const,
    }));
  }

  /**
   * Load a specific skill by name.
   * If repoPath is provided, also searches in the repo's skill directories.
   */
  async load(name: string, repoPath?: string): Promise<SkillContent | null> {
    // Build cache key that includes repoPath for repo-specific skills
    const cacheKey = repoPath ? `${name}@${repoPath}` : name;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let url = resolveApiPath(`api/skills?name=${encodeURIComponent(name)}`, this.baseUrl);
    if (repoPath) {
      url += `&repoPath=${encodeURIComponent(repoPath)}`;
    }

    const response = await fetch(url);

    if (!response.ok) return null;

    const skill = (await response.json()) as SkillContent;
    this.cache.set(cacheKey, skill);
    return skill;
  }

  /**
   * Reload skills on the server and refresh list
   */
  async reload(): Promise<{ count: number }> {
    this.cache.clear();
    const response = await fetch(resolveApiPath("api/skills", this.baseUrl), {
      method: "POST",
    });
    return response.json();
  }

  /**
   * Clone skills from a GitHub repository
   * (e.g. "vercel-labs/agent-skills" or "https://github.com/vercel-labs/agent-skills")
   * Clones the repo, discovers skills, and imports them to .agents/skills/
   */
  async cloneFromGithub(
    url: string,
    skillsDir?: string
  ): Promise<CloneSkillsResult> {
    const response = await fetch(resolveApiPath("api/skills/clone", this.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, skillsDir }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        imported: [],
        count: 0,
        repoPath: "",
        source: url,
        error: data.error || "Failed to clone skills",
      };
    }

    // Clear cache since new skills were imported
    this.cache.clear();
    return data as CloneSkillsResult;
  }

  /**
   * Discover skills from an already-cloned repo path.
   * Used when user selects a repo in RepoPicker.
   */
  async listFromRepo(repoPath: string): Promise<SkillSummary[]> {
    const response = await fetch(
      resolveApiPath(`api/skills/clone?repoPath=${encodeURIComponent(repoPath)}`, this.baseUrl)
    );

    if (!response.ok) return [];

    const data = await response.json();
    return (data.skills ?? []).map((s: SkillSummary) => ({
      ...s,
      source: "repo" as const,
    }));
  }

  /**
   * Search skills from skills.sh catalog.
   */
  async searchSkillsSh(query: string, limit: number = 30): Promise<SkillsShSearchResult> {
    const params = new URLSearchParams({ type: "skillssh", q: query, limit: String(limit) });
    const response = await fetch(resolveApiPath(`api/skills/catalog?${params}`, this.baseUrl));

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Failed to search skills.sh: HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * Browse a GitHub directory catalog (e.g. openai/skills).
   */
  async listGithubCatalog(
    repo: string = "openai/skills",
    catalogPath: string = "skills/.curated",
    ref: string = "main"
  ): Promise<GithubCatalogResult> {
    const params = new URLSearchParams({ type: "github", repo, path: catalogPath, ref });
    const response = await fetch(resolveApiPath(`api/skills/catalog?${params}`, this.baseUrl));

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Failed to list catalog: HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * Install skills from skills.sh search results.
   * Each skill has its own source repo.
   */
  async installFromSkillsSh(
    skills: Array<{ name: string; source: string }>
  ): Promise<CatalogInstallResult> {
    const response = await fetch(resolveApiPath("api/skills/catalog", this.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "skillssh", skills }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to install from skills.sh");
    }

    this.cache.clear();
    return data as CatalogInstallResult;
  }

  /**
   * Install skills from a GitHub directory catalog.
   */
  async installFromGithubCatalog(
    skills: string[],
    repo: string = "openai/skills",
    catalogPath: string = "skills/.curated",
    ref: string = "main"
  ): Promise<CatalogInstallResult> {
    const response = await fetch(resolveApiPath("api/skills/catalog", this.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "github", repo, path: catalogPath, ref, skills }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to install from catalog");
    }

    this.cache.clear();
    return data as CatalogInstallResult;
  }

  /**
   * Clear the local cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
