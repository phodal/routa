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

export interface SkillSummary {
  name: string;
  description: string;
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
    const response = await fetch(`${this.baseUrl}/api/skills`);
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

    let url = `${this.baseUrl}/api/skills?name=${encodeURIComponent(name)}`;
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
    const response = await fetch(`${this.baseUrl}/api/skills`, {
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
    const response = await fetch(`${this.baseUrl}/api/skills/clone`, {
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
      `${this.baseUrl}/api/skills/clone?repoPath=${encodeURIComponent(repoPath)}`
    );

    if (!response.ok) return [];

    const data = await response.json();
    return (data.skills ?? []).map((s: SkillSummary) => ({
      ...s,
      source: "repo" as const,
    }));
  }

  /**
   * Clear the local cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
