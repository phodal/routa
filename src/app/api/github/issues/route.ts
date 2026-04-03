import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { listGitHubIssues, resolveGitHubRepo } from "@/core/kanban/github-issues";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  const codebaseId = request.nextUrl.searchParams.get("codebaseId")?.trim();
  const requestedState = request.nextUrl.searchParams.get("state")?.trim() ?? "open";
  const state = requestedState === "open" || requestedState === "closed" || requestedState === "all"
    ? requestedState
    : null;

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  if (!state) {
    return NextResponse.json({ error: "state must be one of: open, closed, all" }, { status: 400 });
  }

  const system = getRoutaSystem();
  const workspaceCodebases = await system.codebaseStore.listByWorkspace(workspaceId);

  if (workspaceCodebases.length === 0) {
    return NextResponse.json({ error: "No codebases linked to this workspace" }, { status: 404 });
  }

  const codebase = codebaseId
    ? workspaceCodebases.find((item) => item.id === codebaseId)
    : workspaceCodebases.find((item) => item.isDefault) ?? workspaceCodebases[0];

  if (!codebase) {
    return NextResponse.json({ error: "Codebase not found in this workspace" }, { status: 404 });
  }

  const repo = resolveGitHubRepo(codebase.sourceUrl, codebase.repoPath);
  if (!repo) {
    return NextResponse.json(
      { error: "Selected codebase is not linked to a GitHub repository." },
      { status: 400 },
    );
  }

  try {
    const issues = await listGitHubIssues(repo, { state });
    return NextResponse.json({
      repo,
      codebase: {
        id: codebase.id,
        label: codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath,
      },
      issues,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load GitHub issues" },
      { status: 502 },
    );
  }
}
