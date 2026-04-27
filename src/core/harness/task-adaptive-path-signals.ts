import * as fs from "fs";
import * as path from "path";

const MAX_SEARCH_OUTPUT_FILE_CANDIDATES = 40;
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function shellLikeSplit(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

export function parsePatchBlock(text: string): string[] {
  const out: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const [, value] = trimmed.match(/^\*{3} (?:(?:Update|Add|Delete) File|Move to):\s*(.*)$/) ?? [];
    if (value) {
      out.push(value);
    }
  }

  return out;
}

export function parseCommandPaths(command: string): string[] {
  const tokens = shellLikeSplit(command);
  if (tokens.length === 0) {
    return [];
  }

  const separatorIndex = tokens.indexOf("--");
  if (separatorIndex >= 0) {
    return tokens
      .slice(separatorIndex + 1)
      .filter((token) => token.length > 0 && !token.startsWith("-"));
  }

  if (tokens[0] === "git" && (tokens[1] === "add" || tokens[1] === "rm")) {
    return tokens
      .slice(2)
      .filter((token) => token.length > 0 && !token.startsWith("-"));
  }

  return [];
}

export function collectFileValues(value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectFileValues(item, out);
    }
    return;
  }

  if (typeof value === "string") {
    for (const candidate of parsePatchBlock(value)) {
      out.add(candidate);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const map = value as Record<string, unknown>;
  const pathKeys = new Set([
    "path",
    "paths",
    "file",
    "filepath",
    "file_path",
    "filename",
    "target",
    "source",
    "target_file",
    "source_file",
    "absolute_path",
    "relative_path",
  ]);

  for (const [key, child] of Object.entries(map)) {
    const lower = key.toLowerCase();
    if (pathKeys.has(lower)) {
      if (typeof child === "string") {
        out.add(child);
      } else if (Array.isArray(child)) {
        for (const item of child) {
          if (typeof item === "string") {
            out.add(item);
          }
        }
      }
    }
    collectFileValues(child, out);
  }
}

export function unwrapShellCommand(command: string): string {
  const tokens = shellLikeSplit(command);
  if (tokens.length < 3) {
    return command;
  }

  const executable = path.posix.basename(tokens[0] ?? "");
  const shellLike = executable === "sh" || executable === "bash" || executable === "zsh";
  if (!shellLike) {
    return command;
  }

  const cFlagIndex = tokens.findIndex((token) => token === "-c" || token === "-lc");
  if (cFlagIndex >= 0 && tokens[cFlagIndex + 1]) {
    return tokens.slice(cFlagIndex + 1).join(" ");
  }

  return command;
}

export function extractReadCandidatesFromCommand(command: string): string[] {
  const innerCommand = unwrapShellCommand(command);
  const tokens = shellLikeSplit(innerCommand);
  if (tokens.length === 0) {
    return [];
  }

  const executable = path.posix.basename(tokens[0] ?? "");
  const readCommands = new Set(["bat", "cat", "head", "less", "more", "nl", "sed", "tail"]);
  if (!readCommands.has(executable)) {
    return [];
  }

  return tokens.slice(1).filter((token) => token !== "--" && !token.startsWith("-"));
}

function sanitizePathCandidate(candidate: string): string | null {
  const cleaned = toPosix(candidate)
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "")
    .replace(/^`+|`+$/g, "")
    .replace(/[",;:]+$/g, "");

  if (!cleaned) {
    return null;
  }

  const lineQualifiedPath = cleaned.match(/^(.*\.[^:/\s]+):\d+(?::\d+)?$/);
  if (lineQualifiedPath?.[1]) {
    return lineQualifiedPath[1];
  }

  if (!/\s/.test(cleaned)) {
    return cleaned;
  }

  const embeddedPath = cleaned.match(
    /([A-Za-z0-9_@()[\]{}.\-/]+?\.(?:[cm]?[jt]sx?|jsx?|tsx?|rs|md|json|ya?ml|toml|css|scss|html))/,
  );
  if (embeddedPath?.[1]) {
    return embeddedPath[1];
  }

  return cleaned;
}

function pathLooksFileLike(candidate: string): boolean {
  const base = path.posix.basename(candidate);
  return base.includes(".") || ["Dockerfile", "Makefile", "Cargo.toml"].includes(base);
}

function isExistingDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function repoRelativeFromResolvedPath(repoRoot: string, resolvedPath: string): string | null {
  const relative = toPosix(path.relative(repoRoot, resolvedPath));
  if (!relative || relative === "." || relative.startsWith("../") || path.isAbsolute(relative)) {
    return null;
  }
  return relative;
}

function isUsableResolvedFileCandidate(resolvedPath: string, relativePath: string): boolean {
  if (isExistingDirectory(resolvedPath)) {
    return false;
  }
  return isExistingFile(resolvedPath) || pathLooksFileLike(relativePath);
}

export function normalizeRepoRelative(repoRoot: string, candidate: string, sessionCwd: string): string | null {
  const cleaned = sanitizePathCandidate(candidate);

  if (!cleaned || cleaned === "/dev/null") {
    return null;
  }

  const normalizedRepoRoot = path.resolve(repoRoot);
  const normalizedSessionCwd = path.resolve(sessionCwd);

  if (!path.isAbsolute(cleaned)) {
    const relativeCandidate = toPosix(cleaned).replace(/^\.\//, "");
    if (!relativeCandidate || relativeCandidate === "." || relativeCandidate.startsWith("../")) {
      return null;
    }
    const repoResolved = path.join(repoRoot, relativeCandidate);
    const sessionResolved = path.join(sessionCwd, relativeCandidate);
    const sessionRelative = repoRelativeFromResolvedPath(repoRoot, sessionResolved);

    if (
      sessionRelative
      && normalizedSessionCwd !== normalizedRepoRoot
      && isUsableResolvedFileCandidate(sessionResolved, sessionRelative)
    ) {
      return sessionRelative;
    }

    if (isExistingDirectory(repoResolved)) {
      return null;
    }
    if (isExistingFile(repoResolved) || pathLooksFileLike(relativeCandidate)) {
      return relativeCandidate;
    }

    if (sessionRelative && isExistingFile(sessionResolved)) {
      return sessionRelative;
    }

    if (!pathLooksFileLike(relativeCandidate)) {
      return null;
    }
    return sessionRelative ?? relativeCandidate;
  }

  if (isExistingDirectory(cleaned)) {
    return null;
  }

  const repoRelative = repoRelativeFromResolvedPath(repoRoot, cleaned);
  if (repoRelative && (isExistingFile(cleaned) || pathLooksFileLike(repoRelative))) {
    return repoRelative;
  }

  const sessionRelative = toPosix(path.relative(sessionCwd, cleaned));
  if (
    sessionRelative
    && !sessionRelative.startsWith("../")
    && !path.isAbsolute(sessionRelative)
    && (isExistingFile(cleaned) || pathLooksFileLike(sessionRelative))
  ) {
    return sessionRelative;
  }

  return null;
}

function isSearchLikeCommand(command: string): boolean {
  const tokens = shellLikeSplit(unwrapShellCommand(command));
  if (tokens.length === 0) {
    return false;
  }

  const executable = path.posix.basename(tokens[0] ?? "");
  if (executable === "rg" || executable === "grep" || executable === "fd" || executable === "find") {
    return true;
  }

  return tokens[0] === "git" && tokens[1] === "grep";
}

function extractSearchOutputPathCandidate(line: string): string | null {
  const cleaned = line.replace(ANSI_ESCAPE_PATTERN, "").trim();
  if (!cleaned) {
    return null;
  }

  const binaryMatch = cleaned.match(/^Binary file (.+?) matches$/u);
  if (binaryMatch?.[1]) {
    return binaryMatch[1];
  }

  const locationMatch = cleaned.match(/^(.+?)(?::\d+)?(?::\d+)?:/u);
  if (locationMatch?.[1] && pathLooksFileLike(locationMatch[1])) {
    return locationMatch[1];
  }

  return pathLooksFileLike(cleaned) ? cleaned : null;
}

export function extractSearchOutputPathCandidates(command: string, output: string): string[] {
  if (!isSearchLikeCommand(command)) {
    return [];
  }

  const candidates: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const candidate = extractSearchOutputPathCandidate(line);
    if (!candidate || candidates.includes(candidate)) {
      continue;
    }
    candidates.push(candidate);
    if (candidates.length >= MAX_SEARCH_OUTPUT_FILE_CANDIDATES) {
      break;
    }
  }

  return candidates;
}
