/**
 * Specialist File Loader
 *
 * Loads YAML specialist definitions and locale overlays.
 * Supports a loading priority hierarchy:
 *   1. User-defined specialists (~/.routa/specialists/) — highest priority
 *   2. Bundled specialists (resources/specialists/) — default
 *   3. Hardcoded fallback (specialist-prompts.ts) — lowest priority
 *
 * Directory layout rules:
 *   - Runtime specialist definitions may live in nested taxonomy directories
 *     (for example `team/`, `review/`, `workflows/kanban/`)
 *   - Locale overlays are loaded only from `locales/<locale>/` or the legacy
 *     `<locale>/` directory, are authored in YAML, and do not participate in
 *     the base scan
 *
 * YAML runtime/locale overlay format:
 *   id: "coordinator"
 *   name: "Coordinator"
 *   description: "Plans work, breaks down tasks, coordinates sub-agents"
 *   role: "ROUTA"
 *   model_tier: "smart"
 *   system_prompt: |
 *     ## Coordinator
 *     You plan, delegate, and verify...
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { AgentRole, ModelTier } from "../models/agent";
import type { SpecialistConfig } from "./specialist-types";

export interface SpecialistFileMeta {
  id?: string;
  name: string;
  description: string;
  modelTier?: string;
  model_tier?: string;
  model?: string;
  role?: string;
  roleReminder?: string;
  role_reminder?: string;
  defaultProvider?: string;
  default_provider?: string;
  defaultAdapter?: string;
  default_adapter?: string;
  execution?: {
    role?: string;
    provider?: string;
    adapter?: string;
    modelTier?: string;
    model_tier?: string;
    model?: string;
  };
  system_prompt?: string;
}

export interface ParsedSpecialist {
  id: string;
  filePath: string;
  frontmatter: SpecialistFileMeta;
  behaviorPrompt: string;
  rawContent: string;
  source: "user" | "bundled" | "hardcoded";
  locale?: string;
}

const VALID_MODEL_TIERS = ["fast", "balanced", "smart"];
const SPECIALIST_ROOT_DIRNAME = "specialists";
const SPECIALIST_LOCALES_DIRNAME = "locales";
const DEFAULT_LOCALE = "en";
const CANONICAL_TEAM_SPECIALIST_IDS = new Set([
  "team-agent-lead",
  "team-backend-dev",
  "team-code-reviewer",
  "team-frontend-dev",
  "team-general-engineer",
  "team-operations",
  "team-qa",
  "team-researcher",
  "team-ux-designer",
]);

function isLocaleDirectoryName(name: string): boolean {
  return name === SPECIALIST_LOCALES_DIRNAME || /^[a-z]{2}(?:-[A-Z]{2})?$/.test(name);
}

function collectSpecialistFiles(
  dirPath: string,
  includeLocaleDirectories: boolean,
  allowedExtensions: string[] = [".yaml", ".yml"],
): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (!includeLocaleDirectories && isLocaleDirectoryName(entry.name)) {
        continue;
      }
      files.push(...collectSpecialistFiles(entryPath, includeLocaleDirectories, allowedExtensions));
      continue;
    }

    if (entry.isFile() && allowedExtensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(entryPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function uniqueExistingDirs(dirPaths: string[]): string[] {
  return Array.from(new Set(dirPaths)).filter((dirPath) => fs.existsSync(dirPath));
}

export function mergeSpecialistDefinitions(
  specialists: ParsedSpecialist[],
  context: string,
): ParsedSpecialist[] {
  const merged = new Map<string, ParsedSpecialist>();

  for (const specialist of specialists) {
    const previous = merged.get(specialist.id);
    if (previous) {
      throw new Error(
        `[SpecialistLoader] Duplicate specialist id "${specialist.id}" in ${context}; ` +
        `conflicts: ${previous.filePath} and ${specialist.filePath}`
      );
    }
    merged.set(specialist.id, specialist);
  }

  return Array.from(merged.values());
}

export function getBundledSpecialistsRootDir(): string {
  return path.join(process.cwd(), "resources", SPECIALIST_ROOT_DIRNAME);
}

export function getUserSpecialistsRootDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return path.join(home, ".routa", SPECIALIST_ROOT_DIRNAME);
}

export function getLocaleOverlayDirs(rootDir: string, locale: string): string[] {
  if (!locale || locale === DEFAULT_LOCALE) {
    return [];
  }

  return uniqueExistingDirs([
    path.join(rootDir, SPECIALIST_LOCALES_DIRNAME, locale),
    path.join(rootDir, locale),
  ]);
}

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
 */
export function filenameToSpecialistId(filename: string): string {
  return path.basename(filename, path.extname(filename));
}

export function isCanonicalTeamSpecialistId(id: string | undefined): boolean {
  return typeof id === "string" && CANONICAL_TEAM_SPECIALIST_IDS.has(id);
}

function shouldSkipBundledTeamSpecialist(filePath: string, id: string): boolean {
  if (!filePath.includes(`${path.sep}team${path.sep}`)) {
    return false;
  }
  return !isCanonicalTeamSpecialistId(id);
}

function normalizeSpecialistMeta(raw: Record<string, unknown>): SpecialistFileMeta {
  const execution = typeof raw.execution === "object" && raw.execution !== null
    ? raw.execution as Record<string, unknown>
    : undefined;

  return {
    id: typeof raw.id === "string" ? raw.id : undefined,
    name: typeof raw.name === "string" ? raw.name : "",
    description: typeof raw.description === "string" ? raw.description : "",
    modelTier: typeof raw.modelTier === "string"
      ? raw.modelTier
      : typeof raw.model_tier === "string"
        ? raw.model_tier
        : undefined,
    model: typeof raw.model === "string" ? raw.model : undefined,
    role: typeof raw.role === "string" ? raw.role : undefined,
    roleReminder: typeof raw.roleReminder === "string"
      ? raw.roleReminder
      : typeof raw.role_reminder === "string"
        ? raw.role_reminder
        : undefined,
    defaultProvider: typeof raw.defaultProvider === "string"
      ? raw.defaultProvider
      : typeof raw.default_provider === "string"
        ? raw.default_provider
        : undefined,
    defaultAdapter: typeof raw.defaultAdapter === "string"
      ? raw.defaultAdapter
      : typeof raw.default_adapter === "string"
        ? raw.default_adapter
        : undefined,
    execution: execution ? {
      role: typeof execution.role === "string" ? execution.role : undefined,
      provider: typeof execution.provider === "string" ? execution.provider : undefined,
      adapter: typeof execution.adapter === "string" ? execution.adapter : undefined,
      modelTier: typeof execution.modelTier === "string"
        ? execution.modelTier
        : typeof execution.model_tier === "string"
          ? execution.model_tier
          : undefined,
      model: typeof execution.model === "string" ? execution.model : undefined,
    } : undefined,
    system_prompt: typeof raw.system_prompt === "string" ? raw.system_prompt : undefined,
  };
}

function parseYamlSpecialistFile(
  filePath: string,
  source: "user" | "bundled",
  locale?: string,
): ParsedSpecialist | null {
  const rawContent = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.load(rawContent) as Record<string, unknown> | undefined;
  if (!parsed || typeof parsed !== "object") {
    console.warn(`[SpecialistLoader] Skipping ${filePath}: invalid YAML specialist definition`);
    return null;
  }

  const frontmatter = normalizeSpecialistMeta(parsed);
  if (!frontmatter.name) {
    console.warn(`[SpecialistLoader] Skipping ${filePath}: missing 'name' in YAML`);
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

  const id = frontmatter.id ?? filenameToSpecialistId(filePath);
  if (source === "bundled" && shouldSkipBundledTeamSpecialist(filePath, id)) {
    console.warn(
      `[SpecialistLoader] Skipping ${filePath}: non-canonical bundled team specialist id "${id}"`
    );
    return null;
  }

  return {
    id,
    filePath,
    frontmatter,
    behaviorPrompt: frontmatter.system_prompt?.trim() ?? "",
    rawContent,
    source,
    locale,
  };
}

/**
 * Parse a single specialist file.
 */
export function parseSpecialistFile(
  filePath: string,
  source: "user" | "bundled",
  locale?: string,
): ParsedSpecialist | null {
  try {
    const extension = path.extname(filePath).toLowerCase();
    switch (extension) {
      case ".yaml":
      case ".yml":
        return parseYamlSpecialistFile(filePath, source, locale);
      default:
        console.warn(`[SpecialistLoader] Skipping ${filePath}: unsupported specialist file extension`);
        return null;
    }
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
  source: "user" | "bundled",
  locale?: string,
): ParsedSpecialist[] {
  const specialists: ParsedSpecialist[] = [];
  const files = collectSpecialistFiles(
    dirPath,
    locale !== undefined,
    [".yaml", ".yml"],
  );

  for (const file of files) {
    const parsed = parseSpecialistFile(file, source, locale);
    if (parsed) {
      specialists.push(parsed);
    }
  }

  return mergeSpecialistDefinitions(
    specialists,
    `directory ${dirPath}${locale ? ` (locale ${locale})` : ""}`
  );
}

/**
 * Get the path to bundled specialists directory.
 * Resolves relative to the project root.
 */
export function getBundledSpecialistsDir(locale?: string): string {
  const rootDir = getBundledSpecialistsRootDir();
  return locale && locale !== DEFAULT_LOCALE
    ? path.join(rootDir, SPECIALIST_LOCALES_DIRNAME, locale)
    : rootDir;
}

/**
 * Get the path to user-defined specialists directory.
 */
export function getUserSpecialistsDir(locale?: string): string {
  const rootDir = getUserSpecialistsRootDir();
  return locale && locale !== DEFAULT_LOCALE
    ? path.join(rootDir, SPECIALIST_LOCALES_DIRNAME, locale)
    : rootDir;
}

/**
 * Load bundled specialists from resources/specialists/.
 */
export function loadBundledSpecialists(locale?: string): ParsedSpecialist[] {
  if (locale && locale !== DEFAULT_LOCALE) {
    return mergeSpecialistDefinitions(
      getLocaleOverlayDirs(getBundledSpecialistsRootDir(), locale).flatMap((dirPath) =>
        loadSpecialistsFromDirectory(dirPath, "bundled", locale)
      ),
      `bundled locale overlays (${locale})`
    );
  }
  return loadSpecialistsFromDirectory(getBundledSpecialistsRootDir(), "bundled");
}

/**
 * Load user-defined specialists from ~/.routa/specialists/.
 */
export function loadUserSpecialists(locale?: string): ParsedSpecialist[] {
  if (locale && locale !== DEFAULT_LOCALE) {
    return mergeSpecialistDefinitions(
      getLocaleOverlayDirs(getUserSpecialistsRootDir(), locale).flatMap((dirPath) =>
        loadSpecialistsFromDirectory(dirPath, "user", locale)
      ),
      `user locale overlays (${locale})`
    );
  }
  return loadSpecialistsFromDirectory(getUserSpecialistsRootDir(), "user");
}

/**
 * Convert a ParsedSpecialist to a SpecialistConfig.
 * The behaviorPrompt becomes the systemPrompt.
 */
export function toSpecialistConfig(parsed: ParsedSpecialist): SpecialistConfig {
  const execution = parsed.frontmatter.execution;
  const role = resolveRole(execution?.role ?? parsed.frontmatter.role);
  const resolvedModelTier = resolveModelTier(execution?.modelTier ?? parsed.frontmatter.modelTier);

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
    defaultModelTier: resolvedModelTier,
    systemPrompt: parsed.behaviorPrompt,
    roleReminder: parsed.frontmatter.roleReminder ?? "",
    source: parsed.source,
    locale: parsed.locale,
    defaultProvider: execution?.provider ?? parsed.frontmatter.defaultProvider,
    defaultAdapter: execution?.adapter ?? parsed.frontmatter.defaultAdapter,
    model: execution?.model ?? parsed.frontmatter.model,
  };
}

/**
 * Load all specialists with proper priority merging.
 * User specialists override bundled ones with the same ID.
 * Returns a merged array of SpecialistConfig.
 */
export function loadAllSpecialists(locale?: string): SpecialistConfig[] {
  const bundled = loadBundledSpecialists();
  const localizedBundled = locale && locale !== "en" ? loadBundledSpecialists(locale) : [];
  const user = loadUserSpecialists();
  const localizedUser = locale && locale !== "en" ? loadUserSpecialists(locale) : [];

  // Start with bundled, then overlay user specialists by ID
  const configMap = new Map<string, SpecialistConfig>();

  for (const spec of bundled) {
    const config = toSpecialistConfig(spec);
    configMap.set(config.id, config);
  }

  for (const spec of localizedBundled) {
    const config = toSpecialistConfig(spec);
    configMap.set(config.id, config);
  }

  for (const spec of user) {
    const config = toSpecialistConfig(spec);
    configMap.set(config.id, config);
  }

  for (const spec of localizedUser) {
    const config = toSpecialistConfig(spec);
    configMap.set(config.id, config);
  }

  return Array.from(configMap.values());
}
