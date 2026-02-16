/**
 * Specialist File Loader
 *
 * Loads specialist configurations from Markdown files with YAML frontmatter.
 * Supports a loading priority hierarchy:
 *   1. User-defined specialists (~/.routa/specialists/) — highest priority
 *   2. Bundled specialists (resources/specialists/) — default
 *   3. Hardcoded fallback (specialist-prompts.ts) — lowest priority
 *
 * File format:
 *   ---
 *   name: "Coordinator"
 *   description: "Plans work, breaks down tasks, coordinates sub-agents"
 *   modelTier: "smart"
 *   role: "ROUTA"
 *   roleReminder: "You NEVER edit files directly..."
 *   ---
 *
 *   ## Coordinator
 *   You plan, delegate, and verify...
 */

import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";
import { AgentRole, ModelTier } from "../models/agent";
import type { SpecialistConfig } from "../orchestration/specialist-prompts";

export interface SpecialistFileMeta {
  name: string;
  description: string;
  modelTier?: string;
  model?: string;
  role?: string;
  roleReminder?: string;
}

export interface ParsedSpecialist {
  id: string;
  filePath: string;
  frontmatter: SpecialistFileMeta;
  behaviorPrompt: string;
  rawContent: string;
  source: "user" | "bundled" | "hardcoded";
}

const VALID_MODEL_TIERS = ["fast", "balanced", "smart"];

/**
 * Map a modelTier string to a ModelTier enum value.
 */
function resolveModelTier(tier?: string): ModelTier {
  switch (tier?.toLowerCase()) {
    case "fast":
      return ModelTier.FAST;
    case "balanced":
      return ModelTier.BALANCED;
    case "smart":
      return ModelTier.SMART;
    default:
      return ModelTier.SMART;
  }
}

/**
 * Map a role string to an AgentRole enum value.
 */
function resolveRole(role?: string): AgentRole | undefined {
  if (!role) return undefined;
  const upper = role.toUpperCase();
  if (Object.values(AgentRole).includes(upper as AgentRole)) {
    return upper as AgentRole;
  }
  return undefined;
}

/**
 * Derive a specialist ID from its filename.
 * e.g., "spec-writer.md" → "spec-writer", "routa.md" → "routa"
 */
export function filenameToSpecialistId(filename: string): string {
  return path.basename(filename, path.extname(filename));
}

/**
 * Parse a single specialist Markdown file.
 */
export function parseSpecialistFile(
  filePath: string,
  source: "user" | "bundled"
): ParsedSpecialist | null {
  try {
    const rawContent = fs.readFileSync(filePath, "utf-8");
    const { data, content } = matter(rawContent);

    const frontmatter = data as SpecialistFileMeta;
    if (!frontmatter.name) {
      console.warn(
        `[SpecialistLoader] Skipping ${filePath}: missing 'name' in frontmatter`
      );
      return null;
    }

    if (
      frontmatter.modelTier &&
      !VALID_MODEL_TIERS.includes(frontmatter.modelTier.toLowerCase())
    ) {
      console.warn(
        `[SpecialistLoader] Invalid modelTier "${frontmatter.modelTier}" in ${filePath}, defaulting to "smart"`
      );
      frontmatter.modelTier = "smart";
    }

    const id = filenameToSpecialistId(filePath);
    const behaviorPrompt = content.trim();

    return {
      id,
      filePath,
      frontmatter,
      behaviorPrompt,
      rawContent,
      source,
    };
  } catch (err) {
    console.error(`[SpecialistLoader] Failed to parse ${filePath}:`, err);
    return null;
  }
}

/**
 * Load all specialist files from a directory.
 */
export function loadSpecialistsFromDirectory(
  dirPath: string,
  source: "user" | "bundled"
): ParsedSpecialist[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".md"));
  const specialists: ParsedSpecialist[] = [];

  for (const file of files) {
    const parsed = parseSpecialistFile(path.join(dirPath, file), source);
    if (parsed) {
      specialists.push(parsed);
    }
  }

  return specialists;
}

/**
 * Get the path to bundled specialists directory.
 * Resolves relative to the project root.
 */
export function getBundledSpecialistsDir(): string {
  // In Next.js, process.cwd() is the project root
  return path.join(process.cwd(), "resources", "specialists");
}

/**
 * Get the path to user-defined specialists directory.
 */
export function getUserSpecialistsDir(): string {
  const home =
    process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return path.join(home, ".routa", "specialists");
}

/**
 * Load bundled specialists from resources/specialists/.
 */
export function loadBundledSpecialists(): ParsedSpecialist[] {
  return loadSpecialistsFromDirectory(getBundledSpecialistsDir(), "bundled");
}

/**
 * Load user-defined specialists from ~/.routa/specialists/.
 */
export function loadUserSpecialists(): ParsedSpecialist[] {
  return loadSpecialistsFromDirectory(getUserSpecialistsDir(), "user");
}

/**
 * Convert a ParsedSpecialist to a SpecialistConfig.
 * The behaviorPrompt becomes the systemPrompt.
 */
export function toSpecialistConfig(parsed: ParsedSpecialist): SpecialistConfig {
  const role = resolveRole(parsed.frontmatter.role);

  // Map specialist ID to a default role if not specified in frontmatter
  const idToRoleMap: Record<string, AgentRole> = {
    routa: AgentRole.ROUTA,
    "spec-writer": AgentRole.ROUTA,
    coordinator: AgentRole.ROUTA,
    crafter: AgentRole.CRAFTER,
    implementor: AgentRole.CRAFTER,
    gate: AgentRole.GATE,
    verifier: AgentRole.GATE,
    developer: AgentRole.DEVELOPER,
  };

  const resolvedRole = role ?? idToRoleMap[parsed.id.toLowerCase()] ?? AgentRole.CRAFTER;

  return {
    id: parsed.id,
    name: parsed.frontmatter.name,
    description: parsed.frontmatter.description ?? "",
    role: resolvedRole,
    defaultModelTier: resolveModelTier(parsed.frontmatter.modelTier),
    systemPrompt: parsed.behaviorPrompt,
    roleReminder: parsed.frontmatter.roleReminder ?? "",
    source: parsed.source,
  };
}

/**
 * Load all specialists with proper priority merging.
 * User specialists override bundled ones with the same ID.
 * Returns a merged array of SpecialistConfig.
 */
export function loadAllSpecialists(): SpecialistConfig[] {
  const bundled = loadBundledSpecialists();
  const user = loadUserSpecialists();

  // Start with bundled, then overlay user specialists by ID
  const configMap = new Map<string, SpecialistConfig>();

  for (const spec of bundled) {
    const config = toSpecialistConfig(spec);
    configMap.set(config.id, config);
  }

  for (const spec of user) {
    const config = toSpecialistConfig(spec);
    configMap.set(config.id, config);
  }

  return Array.from(configMap.values());
}
