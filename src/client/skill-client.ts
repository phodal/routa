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
 */

export interface SkillSummary {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
}

export interface SkillContent {
  name: string;
  description: string;
  content: string;
  license?: string;
  metadata?: Record<string, string>;
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
    return data.skills ?? [];
  }

  /**
   * Load a specific skill by name
   */
  async load(name: string): Promise<SkillContent | null> {
    // Check cache first
    const cached = this.cache.get(name);
    if (cached) return cached;

    const response = await fetch(
      `${this.baseUrl}/api/skills?name=${encodeURIComponent(name)}`
    );

    if (!response.ok) return null;

    const skill = (await response.json()) as SkillContent;
    this.cache.set(name, skill);
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
   * Clear the local cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
