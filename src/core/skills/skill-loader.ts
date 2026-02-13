/**
 * SkillLoader - discovers and loads SKILL.md files
 *
 * Compatible with OpenCode's skill discovery format:
 *   - Project: .opencode/skills/<name>/SKILL.md
 *   - Global:  ~/.config/opencode/skills/<name>/SKILL.md
 *   - Claude:  .claude/skills/<name>/SKILL.md
 *   - Agents:  .agents/skills/<name>/SKILL.md
 *
 * Each SKILL.md has YAML frontmatter with:
 *   - name (required): lowercase alphanumeric with single hyphens
 *   - description (required): 1-1024 characters
 *   - license (optional)
 *   - compatibility (optional)
 *   - metadata (optional): string-to-string map
 */

import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";

export interface SkillDefinition {
  name: string;
  description: string;
  content: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  source: string; // file path
}

const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const SKILL_SEARCH_DIRS = [
  ".opencode/skills",
  ".claude/skills",
  ".agents/skills",
];

const GLOBAL_SKILL_DIRS = [
  ".config/opencode/skills",
  ".claude/skills",
  ".agents/skills",
];

/**
 * Discover all skills from project and global directories
 */
export function discoverSkills(projectDir?: string): SkillDefinition[] {
  const skills: SkillDefinition[] = [];
  const seen = new Set<string>();

  // Project-local skills
  if (projectDir) {
    for (const searchDir of SKILL_SEARCH_DIRS) {
      const dir = path.join(projectDir, searchDir);
      const found = loadSkillsFromDir(dir);
      for (const skill of found) {
        if (!seen.has(skill.name)) {
          seen.add(skill.name);
          skills.push(skill);
        }
      }
    }
  }

  // Global skills
  const homeDir = process.env.HOME ?? process.env.USERPROFILE;
  if (homeDir) {
    for (const globalDir of GLOBAL_SKILL_DIRS) {
      const dir = path.join(homeDir, globalDir);
      const found = loadSkillsFromDir(dir);
      for (const skill of found) {
        if (!seen.has(skill.name)) {
          seen.add(skill.name);
          skills.push(skill);
        }
      }
    }
  }

  return skills;
}

/**
 * Load all SKILL.md files from a skills directory
 */
function loadSkillsFromDir(dir: string): SkillDefinition[] {
  const skills: SkillDefinition[] = [];

  if (!fs.existsSync(dir)) {
    return skills;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(dir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;

      try {
        const skill = loadSkillFile(skillPath, entry.name);
        if (skill) {
          skills.push(skill);
        }
      } catch (err) {
        console.warn(`[SkillLoader] Failed to load ${skillPath}:`, err);
      }
    }
  } catch {
    // Directory not readable
  }

  return skills;
}

/**
 * Load and parse a single SKILL.md file
 */
export function loadSkillFile(
  filePath: string,
  expectedName?: string
): SkillDefinition | null {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data: frontmatter, content } = matter(raw);

  const name = frontmatter.name as string | undefined;
  const description = frontmatter.description as string | undefined;

  if (!name || !description) {
    console.warn(`[SkillLoader] Missing name or description in ${filePath}`);
    return null;
  }

  // Validate name format
  if (!SKILL_NAME_REGEX.test(name)) {
    console.warn(`[SkillLoader] Invalid skill name: ${name} in ${filePath}`);
    return null;
  }

  // Validate name matches directory
  if (expectedName && name !== expectedName) {
    console.warn(
      `[SkillLoader] Skill name "${name}" doesn't match directory "${expectedName}" in ${filePath}`
    );
    return null;
  }

  // Validate description length
  if (description.length < 1 || description.length > 1024) {
    console.warn(
      `[SkillLoader] Description must be 1-1024 chars in ${filePath}`
    );
    return null;
  }

  return {
    name,
    description,
    content: content.trim(),
    license: frontmatter.license as string | undefined,
    compatibility: frontmatter.compatibility as string | undefined,
    metadata: frontmatter.metadata as Record<string, string> | undefined,
    source: filePath,
  };
}
