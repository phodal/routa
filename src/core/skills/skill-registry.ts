/**
 * SkillRegistry - runtime registry for discovered skills
 *
 * Maintains a collection of loaded skills and provides
 * lookup/filtering capabilities for the ACP agent and UI.
 */

import { SkillDefinition, discoverSkills, loadSkillFile } from "./skill-loader";

export type SkillPermission = "allow" | "deny" | "ask";

export interface SkillRegistryConfig {
  permissions?: Record<string, SkillPermission>;
  projectDir?: string;
}

export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();
  private permissions: Record<string, SkillPermission>;

  constructor(config?: SkillRegistryConfig) {
    this.permissions = config?.permissions ?? { "*": "allow" };

    // Auto-discover skills on creation
    const discovered = discoverSkills(config?.projectDir);
    for (const skill of discovered) {
      this.register(skill);
    }
  }

  /**
   * Register a skill definition
   */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);
  }

  /**
   * Get a skill by name (respects permissions)
   */
  getSkill(name: string): SkillDefinition | undefined {
    const permission = this.getPermission(name);
    if (permission === "deny") return undefined;
    return this.skills.get(name);
  }

  /**
   * List all allowed skills
   */
  listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values()).filter(
      (s) => this.getPermission(s.name) !== "deny"
    );
  }

  /**
   * List skill summaries (name + description only, for client discovery)
   */
  listSkillSummaries(): Array<{ name: string; description: string }> {
    return this.listSkills().map((s) => ({
      name: s.name,
      description: s.description,
    }));
  }

  /**
   * Check if a skill requires permission prompt
   */
  needsPermission(name: string): boolean {
    return this.getPermission(name) === "ask";
  }

  /**
   * Register a skill from a file path
   */
  registerFromFile(filePath: string): SkillDefinition | null {
    const skill = loadSkillFile(filePath);
    if (skill) {
      this.register(skill);
    }
    return skill;
  }

  /**
   * Reload all skills from disk
   */
  reload(projectDir?: string): void {
    this.skills.clear();
    const discovered = discoverSkills(projectDir);
    for (const skill of discovered) {
      this.register(skill);
    }
  }

  /**
   * Get permission level for a skill
   */
  private getPermission(name: string): SkillPermission {
    // Check exact match first
    if (this.permissions[name]) {
      return this.permissions[name];
    }

    // Check wildcard patterns
    for (const [pattern, permission] of Object.entries(this.permissions)) {
      if (pattern === "*") continue;
      if (pattern.endsWith("*")) {
        const prefix = pattern.slice(0, -1);
        if (name.startsWith(prefix)) {
          return permission;
        }
      }
    }

    // Fallback to wildcard
    return this.permissions["*"] ?? "allow";
  }

  /**
   * Serialize skill list for ACP available_commands_update
   */
  toAcpCommands(): Array<{ name: string; description: string }> {
    return this.listSkills().map((s) => ({
      name: s.name,
      description: s.description,
    }));
  }
}
