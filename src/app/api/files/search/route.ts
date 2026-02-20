/**
 * File Search API Route - /api/files/search
 *
 * GET /api/files/search?q=query&repoPath=/path/to/repo&limit=20
 *   Search files in a repository using fuzzy matching
 *   Returns: { files: FileMatch[], total: number, query: string }
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

// ─── Types ──────────────────────────────────────────────────────────────

interface FileMatch {
  path: string;       // Relative path from repo root
  fullPath: string;   // Absolute path
  name: string;       // File name only
  score: number;      // Match score (higher is better)
}

interface SearchResult {
  files: FileMatch[];
  total: number;
  query: string;
  scanned: number;
}

// ─── Ignore patterns ────────────────────────────────────────────────────

const DEFAULT_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".cache",
  "coverage",
  ".turbo",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  "*.log",
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];

// ─── Simple fuzzy match scoring ─────────────────────────────────────────

function fuzzyMatch(query: string, target: string): number {
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  // Exact match gets highest score
  if (targetLower === queryLower) return 1000;

  // Contains exact query
  if (targetLower.includes(queryLower)) {
    // Prefer matches at start of filename
    const fileName = path.basename(targetLower);
    if (fileName.startsWith(queryLower)) return 900;
    if (fileName.includes(queryLower)) return 800;
    return 700;
  }

  // Fuzzy character matching
  let score = 0;
  let queryIdx = 0;
  let consecutiveBonus = 0;

  for (let i = 0; i < targetLower.length && queryIdx < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIdx]) {
      score += 10 + consecutiveBonus;
      consecutiveBonus += 5; // Bonus for consecutive matches
      queryIdx++;
    } else {
      consecutiveBonus = 0;
    }
  }

  // All query characters must be found
  if (queryIdx < queryLower.length) return 0;

  // Bonus for shorter paths (more specific matches)
  score += Math.max(0, 100 - target.length);

  return score;
}

// ─── Walk directory ─────────────────────────────────────────────────────

function shouldIgnore(name: string, ignorePatterns: string[]): boolean {
  for (const pattern of ignorePatterns) {
    if (pattern.startsWith("*")) {
      // Wildcard pattern like *.log
      if (name.endsWith(pattern.slice(1))) return true;
    } else if (name === pattern) {
      return true;
    }
  }
  return false;
}

function* walkDirectory(
  dir: string,
  rootDir: string,
  ignorePatterns: string[],
  maxFiles: number
): Generator<string> {
  let count = 0;

  function* walk(currentDir: string): Generator<string> {
    if (count >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return; // Skip directories we can't read
    }

    for (const entry of entries) {
      if (count >= maxFiles) return;

      if (shouldIgnore(entry.name, ignorePatterns)) continue;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        yield* walk(fullPath);
      } else if (entry.isFile()) {
        const relativePath = path.relative(rootDir, fullPath);
        yield relativePath;
        count++;
      }
    }
  }

  yield* walk(dir);
}

// ─── GET Handler ────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || "";
  const repoPath = request.nextUrl.searchParams.get("repoPath");
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 20;

  if (!repoPath) {
    return NextResponse.json(
      { error: "Missing repoPath parameter" },
      { status: 400 }
    );
  }

  if (!fs.existsSync(repoPath)) {
    return NextResponse.json(
      { error: "Repository path does not exist" },
      { status: 404 }
    );
  }

  // Collect files
  const maxFilesToScan = 10000;
  const files: string[] = [];

  for (const file of walkDirectory(repoPath, repoPath, DEFAULT_IGNORE_PATTERNS, maxFilesToScan)) {
    files.push(file);
  }

  // If no query, return recent/common files
  if (!query.trim()) {
    const defaultFiles = files.slice(0, limit).map((filePath) => ({
      path: filePath,
      fullPath: path.join(repoPath, filePath),
      name: path.basename(filePath),
      score: 0,
    }));

    return NextResponse.json({
      files: defaultFiles,
      total: files.length,
      query: "",
      scanned: files.length,
    } as SearchResult);
  }

  // Score and sort files
  const scored: FileMatch[] = [];

  for (const filePath of files) {
    const score = fuzzyMatch(query, filePath);
    if (score > 0) {
      scored.push({
        path: filePath,
        fullPath: path.join(repoPath, filePath),
        name: path.basename(filePath),
        score,
      });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    files: scored.slice(0, limit),
    total: scored.length,
    query,
    scanned: files.length,
  } as SearchResult);
}

