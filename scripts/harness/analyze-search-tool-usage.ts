#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

type SearchToolFamily =
  | "rg_text"
  | "rg_files"
  | "grep"
  | "find"
  | "fd"
  | "custom_grep"
  | "custom_glob";

type SearchPatternCategory = "path_like" | "symbol_like" | "natural_language" | "other";

interface SearchCommandSignal {
  family: SearchToolFamily;
  rawCommand: string;
  pattern?: string;
  globs: string[];
  pathTargets: string[];
}

interface TranscriptSearchStats {
  sessionId: string;
  transcriptPath: string;
  cwd?: string;
  searchCount: number;
  families: Record<SearchToolFamily, number>;
  topPatterns: string[];
  topGlobs: string[];
  topPathRoots: string[];
}

export interface SearchToolUsageReport {
  rootPath: string;
  transcriptFilesScanned: number;
  sessionsWithSearches: number;
  searchEvents: number;
  familyBreakdown: Record<SearchToolFamily, number>;
  patternCategoryBreakdown: Record<SearchPatternCategory, number>;
  topPatterns: Array<{ value: string; count: number; familyBreakdown: Partial<Record<SearchToolFamily, number>> }>;
  topGlobs: Array<{ value: string; count: number }>;
  topActionableGlobs: Array<{ value: string; count: number }>;
  topPathRoots: Array<{ value: string; count: number }>;
  topActionablePathRoots: Array<{ value: string; count: number }>;
  topCommands: Array<{ value: string; count: number }>;
  topEnumerationCommands: Array<{ value: string; count: number }>;
  exampleSessions: TranscriptSearchStats[];
}

type Options = {
  rootPath: string;
  maxItems: number;
  maxFiles?: number;
  cwdContains?: string;
};

const DEFAULT_MAX_ITEMS = 15;

const FAMILY_KEYS: SearchToolFamily[] = [
  "rg_text",
  "rg_files",
  "grep",
  "find",
  "fd",
  "custom_grep",
  "custom_glob",
];

const PATTERN_CATEGORY_KEYS: SearchPatternCategory[] = [
  "path_like",
  "symbol_like",
  "natural_language",
  "other",
];

const GENERIC_GLOBS = new Set([
  "*",
  "*.ts",
  "*.tsx",
  "*.rs",
  "*.js",
  "*.md",
  "*.json",
  "*.yaml",
  "*.yml",
  "*.py",
  "*.d.ts",
]);

const NOISY_ROOTS = new Set([
  "/",
  ".",
  "~",
  "**",
  "node_modules",
  ".next",
  ".git",
  "$f",
  "2>",
  "2",
]);

function stringifyCommand(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const parts = value.filter((part): part is string => typeof part === "string");
    return parts.length > 0 ? parts.join(" ") : undefined;
  }

  return undefined;
}

function commandFromUnknown(event: unknown): string | undefined {
  if (!event || typeof event !== "object") {
    return undefined;
  }

  const map = event as Record<string, unknown>;
  if (map.type === "function_call" && typeof map.arguments === "string") {
    const rawArguments = map.arguments.trim();
    if (typeof map.name === "string" && map.name === "exec_command") {
      try {
        const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
        const command = stringifyCommand(parsed.command) ?? stringifyCommand(parsed.cmd);
        if (command) {
          return command;
        }
      } catch {
        // Fall through to other heuristics when arguments are not JSON.
      }
    }

    return rawArguments;
  }

  const directCommand = stringifyCommand(map.command) ?? stringifyCommand(map.cmd);
  if (directCommand) {
    return directCommand;
  }

  if (typeof map.tool_input === "object" && map.tool_input !== null) {
    const toolInput = map.tool_input as Record<string, unknown>;
    return stringifyCommand(toolInput.command) ?? stringifyCommand(toolInput.cmd);
  }

  if (typeof map.payload === "object" && map.payload !== null) {
    const payload = map.payload as Record<string, unknown>;
    return stringifyCommand(payload.command) ?? stringifyCommand(payload.cmd);
  }

  return undefined;
}

function emptyFamilyBreakdown(): Record<SearchToolFamily, number> {
  return {
    rg_text: 0,
    rg_files: 0,
    grep: 0,
    find: 0,
    fd: 0,
    custom_grep: 0,
    custom_glob: 0,
  };
}

function emptyPatternCategoryBreakdown(): Record<SearchPatternCategory, number> {
  return {
    path_like: 0,
    symbol_like: 0,
    natural_language: 0,
    other: 0,
  };
}

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    rootPath: path.join(process.env.HOME ?? "", ".codex", "sessions"),
    maxItems: DEFAULT_MAX_ITEMS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--root requires a value");
      }
      options.rootPath = value;
      index += 1;
      continue;
    }

    if (arg === "--max-items") {
      options.maxItems = parsePositiveInteger(arg, argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--max-files") {
      options.maxFiles = parsePositiveInteger(arg, argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--cwd-contains") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--cwd-contains requires a value");
      }
      options.cwdContains = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parsePositiveInteger(flag: string, value: string | undefined): number {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }

  return parsed;
}

function printHelp(): void {
  console.log(`
Analyze grep/glob-like search usage from Codex transcripts

Usage:
  node --import tsx scripts/harness/analyze-search-tool-usage.ts [options]

Options:
  --root <path>         Transcript root. Defaults to ~/.codex/sessions
  --max-items <n>       Number of top entries to return per section. Default: 15
  --max-files <n>       Optional cap on scanned transcript files.
  --cwd-contains <txt>  Only include sessions whose cwd contains this substring.
  --help, -h            Show this help.
`);
}

export function splitShellCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      current += char;
      quote = char;
      continue;
    }

    const isPipe = char === "|";
    const isSemicolon = char === ";";
    const isDoubleAmpersand = char === "&" && next === "&";

    if (isPipe || isSemicolon || isDoubleAmpersand) {
      const trimmed = current.trim();
      if (trimmed) {
        segments.push(trimmed);
      }
      current = "";
      if (isDoubleAmpersand) {
        index += 1;
      }
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) {
    segments.push(trailing);
  }

  return segments;
}

export function tokenizeShellLike(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }

    if (/\s/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function looksLikeOption(token: string): boolean {
  return token.startsWith("-") && token !== "-";
}

function normalizePattern(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeGlob(value: string): string {
  return value.trim().replace(/^[.][/\\]/u, "");
}

function normalizePathTarget(value: string, cwd?: string): string {
  const trimmed = value.trim().replace(/[),;]+$/u, "");
  if (!trimmed) {
    return trimmed;
  }

  if (cwd && path.isAbsolute(trimmed) && trimmed.startsWith(cwd)) {
    const relative = path.relative(cwd, trimmed);
    return relative || ".";
  }

  return trimmed.replace(/^[.][/\\]/u, "");
}

function classifyPattern(pattern: string): SearchPatternCategory {
  const normalized = normalizePattern(pattern);
  if (!normalized) {
    return "other";
  }

  if (
    normalized.includes("/")
    || normalized.includes("\\")
    || /\.[A-Za-z0-9]{1,8}\b/u.test(normalized)
    || normalized.startsWith("/api/")
  ) {
    return "path_like";
  }

  if (normalized.includes(" ")) {
    return "natural_language";
  }

  if (
    normalized.includes("_")
    || normalized.includes("::")
    || /[a-z][A-Z]/u.test(normalized)
    || /[-.]/u.test(normalized)
  ) {
    return "symbol_like";
  }

  return "other";
}

function rootFromPathTarget(value: string): string {
  const normalized = normalizeGlob(value);
  if (!normalized) {
    return normalized;
  }

  if (normalized.startsWith("/")) {
    return "/";
  }

  if (normalized.startsWith("**/")) {
    return "**";
  }

  const first = normalized.split(/[\\/]/u)[0];
  return first || normalized;
}

function parseRgOrGrep(
  family: "rg" | "grep",
  tokens: string[],
  rawCommand: string,
): SearchCommandSignal | null {
  const globs: string[] = [];
  const values: string[] = [];
  let filesMode = false;
  let explicitPattern: string | undefined;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "--files") {
      filesMode = true;
      continue;
    }

    if (token === "-g" || token === "--glob") {
      const next = tokens[index + 1];
      if (next) {
        globs.push(normalizeGlob(next));
        index += 1;
      }
      continue;
    }

    if (token === "-e" || token === "--regexp") {
      const next = tokens[index + 1];
      if (next) {
        explicitPattern = normalizePattern(next);
        index += 1;
      }
      continue;
    }

    if (!looksLikeOption(token)) {
      values.push(token);
    }
  }

  let pattern = explicitPattern;
  let pathTargets = values;
  if (!filesMode) {
    if (!pattern && values.length > 0) {
      pattern = normalizePattern(values[0]);
      pathTargets = values.slice(1);
    }
  }

  const normalizedPaths = pathTargets.map((value) => normalizePathTarget(value)).filter(Boolean);
  const normalizedGlobs = globs.filter(Boolean);
  const normalizedPattern = pattern ? normalizePattern(pattern) : undefined;
  const resolvedFamily: SearchToolFamily = family === "rg"
    ? (filesMode ? "rg_files" : "rg_text")
    : "grep";

  if (!normalizedPattern && normalizedGlobs.length === 0 && normalizedPaths.length === 0) {
    return null;
  }

  return {
    family: resolvedFamily,
    rawCommand: rawCommand.trim(),
    pattern: normalizedPattern,
    globs: normalizedGlobs,
    pathTargets: normalizedPaths,
  };
}

function parseFind(tokens: string[], rawCommand: string): SearchCommandSignal | null {
  const globs: string[] = [];
  const pathTargets: string[] = [];
  let parsingRoots = true;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "-name" || token === "-iname" || token === "-path" || token === "-wholename") {
      const next = tokens[index + 1];
      if (next) {
        globs.push(normalizeGlob(next));
        index += 1;
      }
      parsingRoots = false;
      continue;
    }

    if (parsingRoots && !looksLikeOption(token) && token !== "(" && token !== ")" && token !== "!") {
      pathTargets.push(normalizePathTarget(token));
      continue;
    }

    if (looksLikeOption(token) || token === "(" || token === ")" || token === "!") {
      parsingRoots = false;
    }
  }

  if (globs.length === 0 && pathTargets.length === 0) {
    return null;
  }

  return {
    family: "find",
    rawCommand: rawCommand.trim(),
    globs,
    pathTargets,
  };
}

function parseFd(tokens: string[], rawCommand: string): SearchCommandSignal | null {
  const globs: string[] = [];
  const values: string[] = [];

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "-g" || token === "--glob") {
      const next = tokens[index + 1];
      if (next) {
        globs.push(normalizeGlob(next));
        index += 1;
      }
      continue;
    }

    if (!looksLikeOption(token)) {
      values.push(token);
    }
  }

  const pattern = values[0] ? normalizePattern(values[0]) : undefined;
  const pathTargets = values.slice(1).map((value) => normalizePathTarget(value));
  if (!pattern && globs.length === 0 && pathTargets.length === 0) {
    return null;
  }

  return {
    family: "fd",
    rawCommand: rawCommand.trim(),
    pattern,
    globs,
    pathTargets,
  };
}

export function parseSearchCommandSegment(
  segment: string,
  explicitToolName?: string,
): SearchCommandSignal | null {
  const tokens = tokenizeShellLike(segment);
  if (tokens.length === 0) {
    return null;
  }

  const command = path.basename(tokens[0]);
  if (explicitToolName === "grep") {
    return {
      family: "custom_grep",
      rawCommand: segment.trim(),
      pattern: normalizePattern(segment),
      globs: [],
      pathTargets: [],
    };
  }

  if (explicitToolName === "glob") {
    return {
      family: "custom_glob",
      rawCommand: segment.trim(),
      globs: [normalizeGlob(segment)],
      pathTargets: [],
    };
  }

  if (command === "rg" || command === "ripgrep") {
    return parseRgOrGrep("rg", tokens, segment);
  }

  if (command === "grep") {
    return parseRgOrGrep("grep", tokens, segment);
  }

  if (command === "find") {
    return parseFind(tokens, segment);
  }

  if (command === "fd") {
    return parseFd(tokens, segment);
  }

  return null;
}

function collectJsonlFiles(rootPath: string, maxFiles?: number): string[] {
  const collected: string[] = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(nextPath);
        continue;
      }

      if (!entry.isFile() || !nextPath.endsWith(".jsonl")) {
        continue;
      }

      collected.push(nextPath);
      if (maxFiles && collected.length >= maxFiles) {
        return collected;
      }
    }
  }

  return collected;
}

function incrementCounter(map: Map<string, number>, key: string | undefined): void {
  if (!key) {
    return;
  }
  map.set(key, (map.get(key) ?? 0) + 1);
}

function summarizeTopCounters(
  map: Map<string, number>,
  maxItems: number,
): Array<{ value: string; count: number }> {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, maxItems)
    .map(([value, count]) => ({ value, count }));
}

export function isActionableGlob(value: string): boolean {
  const normalized = normalizeGlob(value);
  if (!normalized || normalized.startsWith("!")) {
    return false;
  }

  if (GENERIC_GLOBS.has(normalized)) {
    return false;
  }

  return normalized.includes("test")
    || normalized.includes("spec")
    || normalized.includes("__tests__")
    || normalized.includes("route.")
    || normalized.includes("jsonl")
    || normalized === "Cargo.toml"
    || normalized === "package.json";
}

export function isActionablePathRoot(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || NOISY_ROOTS.has(normalized)) {
    return false;
  }

  return normalized === "src"
    || normalized === "crates"
    || normalized === "resources"
    || normalized === "scripts"
    || normalized === "tools"
    || normalized === "apps"
    || normalized === "docs";
}

export function isActionableEnumerationCommand(value: string): boolean {
  const normalized = value.trim();
  if (normalized.startsWith("rg --files ")) {
    return normalized !== "rg --files ." && normalized !== "rg --files /";
  }

  return normalized.startsWith("find ")
    && normalized.includes("-type f")
    && !normalized.includes("node_modules")
    && !normalized.includes(".next");
}

function analyzeTranscriptFile(
  transcriptPath: string,
  options: Options,
  globalFamilyBreakdown: Record<SearchToolFamily, number>,
  globalPatternCategoryBreakdown: Record<SearchPatternCategory, number>,
  globalPatternCounts: Map<string, number>,
  globalPatternFamilies: Map<string, Partial<Record<SearchToolFamily, number>>>,
  globalGlobCounts: Map<string, number>,
  globalPathRootCounts: Map<string, number>,
  globalCommandCounts: Map<string, number>,
): TranscriptSearchStats | null {
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  let sessionId = path.basename(transcriptPath, ".jsonl");
  let cwd: string | undefined;
  const localFamilyBreakdown = emptyFamilyBreakdown();
  const localPatternCounts = new Map<string, number>();
  const localGlobCounts = new Map<string, number>();
  const localPathRootCounts = new Map<string, number>();
  let searchCount = 0;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }

    if (!row || typeof row !== "object") {
      continue;
    }

    const rowMap = row as Record<string, unknown>;
    if (rowMap.type === "session_meta" && rowMap.payload && typeof rowMap.payload === "object") {
      const meta = rowMap.payload as Record<string, unknown>;
      if (typeof meta.id === "string") {
        sessionId = meta.id;
      }
      if (typeof meta.cwd === "string") {
        cwd = meta.cwd;
      }
      continue;
    }

    const payload = rowMap.payload;
    if (!payload || typeof payload !== "object") {
      continue;
    }

    const payloadMap = payload as Record<string, unknown>;

    if (options.cwdContains && cwd && !cwd.includes(options.cwdContains)) {
      return null;
    }

    const explicitToolName = payloadMap.type === "custom_tool_call" && typeof payloadMap.name === "string"
      ? payloadMap.name
      : undefined;
    const command = payloadMap.type === "custom_tool_call"
      ? (typeof payloadMap.input === "string" ? payloadMap.input : undefined)
      : commandFromUnknown(payloadMap);

    if (!command) {
      continue;
    }

    const segments = splitShellCommandSegments(command);
    for (const segment of segments) {
      const parsed = parseSearchCommandSegment(segment, explicitToolName);
      if (!parsed) {
        continue;
      }

      searchCount += 1;
      localFamilyBreakdown[parsed.family] += 1;
      globalFamilyBreakdown[parsed.family] += 1;
      incrementCounter(globalCommandCounts, parsed.rawCommand);

      if (parsed.pattern) {
        incrementCounter(localPatternCounts, parsed.pattern);
        incrementCounter(globalPatternCounts, parsed.pattern);
        const category = classifyPattern(parsed.pattern);
        globalPatternCategoryBreakdown[category] += 1;
        const familyBreakdown = globalPatternFamilies.get(parsed.pattern) ?? {};
        familyBreakdown[parsed.family] = (familyBreakdown[parsed.family] ?? 0) + 1;
        globalPatternFamilies.set(parsed.pattern, familyBreakdown);
      }

      for (const glob of parsed.globs) {
        incrementCounter(localGlobCounts, glob);
        incrementCounter(globalGlobCounts, glob);
      }

      for (const pathTarget of parsed.pathTargets.map((value) => normalizePathTarget(value, cwd)).filter(Boolean)) {
        const root = rootFromPathTarget(pathTarget);
        incrementCounter(localPathRootCounts, root);
        incrementCounter(globalPathRootCounts, root);
      }
    }
  }

  if (options.cwdContains) {
    if (!cwd || !cwd.includes(options.cwdContains)) {
      return null;
    }
  }

  if (searchCount === 0) {
    return null;
  }

  return {
    sessionId,
    transcriptPath,
    cwd,
    searchCount,
    families: localFamilyBreakdown,
    topPatterns: summarizeTopCounters(localPatternCounts, 3).map((entry) => entry.value),
    topGlobs: summarizeTopCounters(localGlobCounts, 3).map((entry) => entry.value),
    topPathRoots: summarizeTopCounters(localPathRootCounts, 4).map((entry) => entry.value),
  };
}

export function analyzeSearchToolUsage(options: Options): SearchToolUsageReport {
  const transcriptFiles = collectJsonlFiles(options.rootPath, options.maxFiles);
  const familyBreakdown = emptyFamilyBreakdown();
  const patternCategoryBreakdown = emptyPatternCategoryBreakdown();
  const patternCounts = new Map<string, number>();
  const patternFamilies = new Map<string, Partial<Record<SearchToolFamily, number>>>();
  const globCounts = new Map<string, number>();
  const pathRootCounts = new Map<string, number>();
  const commandCounts = new Map<string, number>();
  const sessionStats: TranscriptSearchStats[] = [];

  for (const transcriptPath of transcriptFiles) {
    const stats = analyzeTranscriptFile(
      transcriptPath,
      options,
      familyBreakdown,
      patternCategoryBreakdown,
      patternCounts,
      patternFamilies,
      globCounts,
      pathRootCounts,
      commandCounts,
    );
    if (stats) {
      sessionStats.push(stats);
    }
  }

  const searchEvents = FAMILY_KEYS.reduce((total, family) => total + familyBreakdown[family], 0);
  const topPatterns = summarizeTopCounters(patternCounts, options.maxItems).map((entry) => ({
    value: entry.value,
    count: entry.count,
    familyBreakdown: patternFamilies.get(entry.value) ?? {},
  }));

  return {
    rootPath: options.rootPath,
    transcriptFilesScanned: transcriptFiles.length,
    sessionsWithSearches: sessionStats.length,
    searchEvents,
    familyBreakdown,
    patternCategoryBreakdown,
    topPatterns,
    topGlobs: summarizeTopCounters(globCounts, options.maxItems),
    topActionableGlobs: summarizeTopCounters(globCounts, options.maxItems * 4)
      .filter((entry) => isActionableGlob(entry.value))
      .slice(0, options.maxItems),
    topPathRoots: summarizeTopCounters(pathRootCounts, options.maxItems),
    topActionablePathRoots: summarizeTopCounters(pathRootCounts, options.maxItems * 4)
      .filter((entry) => isActionablePathRoot(entry.value))
      .slice(0, options.maxItems),
    topCommands: summarizeTopCounters(commandCounts, options.maxItems),
    topEnumerationCommands: summarizeTopCounters(commandCounts, options.maxItems * 4)
      .filter((entry) => isActionableEnumerationCommand(entry.value))
      .slice(0, options.maxItems),
    exampleSessions: [...sessionStats]
      .sort((left, right) => right.searchCount - left.searchCount || left.sessionId.localeCompare(right.sessionId))
      .slice(0, Math.min(options.maxItems, 10)),
  };
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const options = parseArgs(argv);
  const report = analyzeSearchToolUsage(options);
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
