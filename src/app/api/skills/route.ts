/**
 * Skills REST API Route - /api/skills
 *
 * Provides a simple REST interface for skill discovery and loading.
 * Used by the browser client alongside the ACP JSON-RPC endpoint.
 *
 * GET  /api/skills         - List all skills
 * GET  /api/skills?name=x  - Load a specific skill
 * POST /api/skills/reload  - Reload skills from disk
 */

import { NextRequest, NextResponse } from "next/server";
import { SkillRegistry } from "@/core/skills/skill-registry";
import { discoverSkillsFromPath } from "@/core/skills";

let registry: SkillRegistry | undefined;

function getRegistry(): SkillRegistry {
  if (!registry) {
    registry = new SkillRegistry({ projectDir: process.cwd() });
  }
  return registry;
}

export async function GET(request: NextRequest) {
  const reg = getRegistry();
  const name = request.nextUrl.searchParams.get("name");
  const repoPath = request.nextUrl.searchParams.get("repoPath");

  if (name) {
    // First try the local registry (project + global skills)
    let skill = reg.getSkill(name);

    // If not found in registry and a repoPath is provided,
    // search in the repo's skill directories
    if (!skill && repoPath) {
      try {
        const repoSkills = discoverSkillsFromPath(repoPath);
        skill = repoSkills.find((s) => s.name === name);
      } catch (err) {
        console.warn(`[Skills API] Failed to discover skills from repo path: ${repoPath}`, err);
      }
    }

    if (!skill) {
      return NextResponse.json(
        { error: `Skill not found: ${name}${repoPath ? ` (also searched in ${repoPath})` : ""}` },
        { status: 404 }
      );
    }
    return NextResponse.json({
      name: skill.name,
      description: skill.description,
      content: skill.content,
      license: skill.license,
      compatibility: skill.compatibility,
      metadata: skill.metadata,
    });
  }

  const skills = reg.listSkills();
  return NextResponse.json({
    skills: skills.map((s) => ({
      name: s.name,
      description: s.description,
      license: s.license,
      compatibility: s.compatibility,
    })),
  });
}

export async function POST() {
  const reg = getRegistry();
  reg.reload(process.cwd());
  return NextResponse.json({
    reloaded: true,
    count: reg.listSkills().length,
  });
}
