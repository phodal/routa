/**
 * Skill Catalog API Route - /api/skills/catalog
 *
 * Supports multiple catalog sources:
 *   1. skills.sh (default) — Search-based catalog from https://skills.sh
 *   2. github — Directory-based catalog from GitHub repos (e.g. openai/skills)
 *
 * GET /api/skills/catalog?type=skillssh&q=react&limit=20
 *   Search skills from skills.sh
 *   Returns: { type, skills: SkillsShSkill[], query }
 *
 * GET /api/skills/catalog?type=github&repo=openai/skills&path=skills/.curated
 *   List skills from a GitHub repo directory
 *   Returns: { type, skills: GithubCatalogSkill[], repo, path }
 *
 * POST /api/skills/catalog
 *   Install skill(s) from a source
 *   Body: { type: "skillssh"|"github", ... }
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── skills.sh constants ─────────────────────────────────────────────────
const SKILLS_SH_API = process.env.SKILLS_API_URL || "https://skills.sh";
const DEFAULT_SEARCH_LIMIT = 30;

// ── GitHub constants ────────────────────────────────────────────────────
const DEFAULT_GITHUB_REPO = "openai/skills";
const DEFAULT_GITHUB_PATH = "skills/.curated";
const DEFAULT_REF = "main";

// ── Types ───────────────────────────────────────────────────────────────

interface SkillsShSkill {
  name: string;
  slug: string;
  source: string;
  installs: number;
  installed: boolean;
}

interface GithubCatalogSkill {
  name: string;
  installed: boolean;
}

interface GitHubContentsEntry {
  name: string;
  type: "file" | "dir" | "symlink";
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getGitHubToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

async function githubFetch(url: string): Promise<Response> {
  const headers: Record<string, string> = {
    "User-Agent": "routa-skill-catalog",
    Accept: "application/vnd.github.v3+json",
  };
  const token = getGitHubToken();
  if (token) {
    headers["Authorization"] = `token ${token}`;
  }
  return fetch(url, { headers });
}

function getInstalledSkillNames(): Set<string> {
  const installed = new Set<string>();
  const skillDirs = [
    path.join(process.cwd(), ".agents/skills"),
    path.join(process.cwd(), ".codex/skills"),
    path.join(os.homedir(), ".codex/skills"),
    path.join(os.homedir(), ".agents/skills"),
  ];

  for (const dir of skillDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          installed.add(entry.name);
        }
      }
    } catch {
      // skip
    }
  }
  return installed;
}

// ── GET ─────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const catalogType = request.nextUrl.searchParams.get("type") || "skillssh";

  if (catalogType === "skillssh") {
    return handleSkillsShSearch(request);
  } else if (catalogType === "github") {
    return handleGithubList(request);
  }

  return NextResponse.json(
    { error: `Unknown catalog type: ${catalogType}. Use "skillssh" or "github".` },
    { status: 400 }
  );
}

/** Search skills.sh API */
async function handleSkillsShSearch(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || "";
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || String(DEFAULT_SEARCH_LIMIT), 10);

  // skills.sh API requires at least 2-char query; return empty for shorter
  if (query.length < 2) {
    return NextResponse.json({
      type: "skillssh",
      skills: [],
      query,
      count: 0,
    });
  }

  try {
    const apiUrl = `${SKILLS_SH_API}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const response = await fetch(apiUrl, {
      headers: { "User-Agent": "routa-skill-catalog" },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `skills.sh API error: HTTP ${response.status}` },
        { status: response.status }
      );
    }

    const data = (await response.json()) as {
      skills: Array<{
        id: string;
        skillId: string;
        name: string;
        installs: number;
        source: string;
      }>;
      count: number;
    };

    const installed = getInstalledSkillNames();

    const skills: SkillsShSkill[] = (data.skills ?? []).map((s) => ({
      name: s.name,
      slug: s.id,
      source: s.source || "",
      installs: s.installs || 0,
      installed: installed.has(s.name),
    }));

    return NextResponse.json({
      type: "skillssh",
      skills,
      query,
      count: data.count || skills.length,
    });
  } catch (err) {
    console.error("[skills/catalog] skills.sh search failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to search skills.sh" },
      { status: 500 }
    );
  }
}

/** List skills from a GitHub repo directory */
async function handleGithubList(request: NextRequest) {
  const repo = request.nextUrl.searchParams.get("repo") || DEFAULT_GITHUB_REPO;
  const catalogPath = request.nextUrl.searchParams.get("path") || DEFAULT_GITHUB_PATH;
  const ref = request.nextUrl.searchParams.get("ref") || DEFAULT_REF;

  const apiUrl = `https://api.github.com/repos/${repo}/contents/${catalogPath}?ref=${ref}`;

  try {
    const response = await githubFetch(apiUrl);

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { error: `Catalog not found: https://github.com/${repo}/tree/${ref}/${catalogPath}` },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `GitHub API error: HTTP ${response.status}` },
        { status: response.status }
      );
    }

    const data = (await response.json()) as GitHubContentsEntry[];

    if (!Array.isArray(data)) {
      return NextResponse.json(
        { error: "Unexpected response from GitHub API" },
        { status: 500 }
      );
    }

    const installed = getInstalledSkillNames();

    const skills: GithubCatalogSkill[] = data
      .filter((entry) => entry.type === "dir")
      .map((entry) => ({
        name: entry.name,
        installed: installed.has(entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      type: "github",
      skills,
      repo,
      path: catalogPath,
      ref,
    });
  } catch (err) {
    console.error("[skills/catalog] GitHub list failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch catalog" },
      { status: 500 }
    );
  }
}

// ── POST ────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const catalogType = body.type || "skillssh";

    if (catalogType === "skillssh") {
      return handleSkillsShInstall(body);
    } else if (catalogType === "github") {
      return handleGithubInstall(body);
    }

    return NextResponse.json(
      { error: `Unknown catalog type: ${catalogType}` },
      { status: 400 }
    );
  } catch (err) {
    console.error("[skills/catalog] POST failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Install failed" },
      { status: 500 }
    );
  }
}

/**
 * Install skills from skills.sh results.
 * Each skill has a source (owner/repo) — download the repo zip and extract the skill.
 */
async function handleSkillsShInstall(body: {
  skills: Array<{ name: string; source: string }>;
}) {
  const { skills: skillsToInstall } = body;

  if (!Array.isArray(skillsToInstall) || skillsToInstall.length === 0) {
    return NextResponse.json(
      { error: "Missing 'skills' array with {name, source} items" },
      { status: 400 }
    );
  }

  const destBase = path.join(os.homedir(), ".codex/skills");
  fs.mkdirSync(destBase, { recursive: true });

  const installed: string[] = [];
  const errors: string[] = [];

  // Group skills by source repo for efficient batch download
  const byRepo = new Map<string, string[]>();
  for (const skill of skillsToInstall) {
    if (!skill.source || !skill.name) {
      errors.push(`Invalid skill entry: ${JSON.stringify(skill)}`);
      continue;
    }
    const existing = byRepo.get(skill.source) || [];
    existing.push(skill.name);
    byRepo.set(skill.source, existing);
  }

  for (const [repoSource, skillNames] of byRepo) {
    const parts = repoSource.split("/");
    if (parts.length !== 2) {
      errors.push(`Invalid source: ${repoSource}`);
      continue;
    }
    const [owner, repoName] = parts;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-catalog-"));

    try {
      const zipUrl = `https://codeload.github.com/${owner}/${repoName}/zip/main`;
      const token = getGitHubToken();
      const headers: Record<string, string> = { "User-Agent": "routa-skill-install" };
      if (token) headers["Authorization"] = `token ${token}`;

      const zipResponse = await fetch(zipUrl, { headers });

      if (!zipResponse.ok) {
        errors.push(`Failed to download ${repoSource}: HTTP ${zipResponse.status}`);
        continue;
      }

      const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());

      const AdmZip = (await import("adm-zip")).default;
      const zip = new AdmZip(zipBuffer);
      zip.extractAllTo(tmpDir, true);

      // Find the top-level directory
      const topDirs = fs
        .readdirSync(tmpDir, { withFileTypes: true })
        .filter((e) => e.isDirectory());

      if (topDirs.length !== 1) {
        errors.push(`Unexpected archive layout for ${repoSource}`);
        continue;
      }

      const repoRoot = path.join(tmpDir, topDirs[0].name);

      // Search for each skill in common skill directories
      const searchDirs = [
        "skills",
        ".agents/skills",
        ".opencode/skills",
        ".claude/skills",
        ".codex/skills",
      ];

      for (const skillName of skillNames) {
        const destDir = path.join(destBase, skillName);
        if (fs.existsSync(destDir)) {
          errors.push(`Already installed: ${skillName}`);
          continue;
        }

        let foundSrc: string | null = null;

        // Search in all common locations
        for (const searchDir of searchDirs) {
          const candidate = path.join(repoRoot, searchDir, skillName);
          if (
            fs.existsSync(candidate) &&
            fs.statSync(candidate).isDirectory() &&
            fs.existsSync(path.join(candidate, "SKILL.md"))
          ) {
            foundSrc = candidate;
            break;
          }
        }

        if (!foundSrc) {
          errors.push(`Skill "${skillName}" not found in ${repoSource}`);
          continue;
        }

        copyDirRecursive(foundSrc, destDir);
        installed.push(skillName);
      }
    } catch (err) {
      errors.push(
        `Failed to install from ${repoSource}: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  return NextResponse.json({
    success: installed.length > 0,
    installed,
    errors,
    dest: destBase,
  });
}

/**
 * Install skills from a GitHub repo directory catalog (e.g. openai/skills).
 */
async function handleGithubInstall(body: {
  repo?: string;
  path?: string;
  ref?: string;
  skills: string[];
}) {
  const {
    repo = DEFAULT_GITHUB_REPO,
    path: catalogPath = DEFAULT_GITHUB_PATH,
    ref = DEFAULT_REF,
    skills: skillNames,
  } = body;

  if (!Array.isArray(skillNames) || skillNames.length === 0) {
    return NextResponse.json(
      { error: "Missing 'skills' array" },
      { status: 400 }
    );
  }

  const parts = repo.split("/");
  if (parts.length !== 2) {
    return NextResponse.json(
      { error: "Invalid repo format. Expected: owner/repo" },
      { status: 400 }
    );
  }
  const [owner, repoName] = parts;

  const zipUrl = `https://codeload.github.com/${owner}/${repoName}/zip/${ref}`;
  const token = getGitHubToken();
  const headers: Record<string, string> = { "User-Agent": "routa-skill-install" };
  if (token) headers["Authorization"] = `token ${token}`;

  const zipResponse = await fetch(zipUrl, { headers });

  if (!zipResponse.ok) {
    return NextResponse.json(
      { error: `Failed to download repo: HTTP ${zipResponse.status}` },
      { status: zipResponse.status }
    );
  }

  const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-catalog-"));

  try {
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(tmpDir, true);

    const topDirs = fs
      .readdirSync(tmpDir, { withFileTypes: true })
      .filter((e) => e.isDirectory());

    if (topDirs.length !== 1) {
      return NextResponse.json(
        { error: "Unexpected archive layout" },
        { status: 500 }
      );
    }

    const repoRoot = path.join(tmpDir, topDirs[0].name);
    const destBase = path.join(os.homedir(), ".codex/skills");
    fs.mkdirSync(destBase, { recursive: true });

    const installed: string[] = [];
    const errors: string[] = [];

    for (const skillName of skillNames) {
      try {
        const skillSrc = path.join(repoRoot, catalogPath, skillName);

        if (!fs.existsSync(skillSrc) || !fs.statSync(skillSrc).isDirectory()) {
          errors.push(`Skill not found in catalog: ${skillName}`);
          continue;
        }

        if (!fs.existsSync(path.join(skillSrc, "SKILL.md"))) {
          errors.push(`No SKILL.md in ${skillName}`);
          continue;
        }

        const destDir = path.join(destBase, skillName);
        if (fs.existsSync(destDir)) {
          errors.push(`Already installed: ${skillName}`);
          continue;
        }

        copyDirRecursive(skillSrc, destDir);
        installed.push(skillName);
      } catch (err) {
        errors.push(
          `Failed to install ${skillName}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return NextResponse.json({
      success: installed.length > 0,
      installed,
      errors,
      dest: destBase,
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Utility ─────────────────────────────────────────────────────────────

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
