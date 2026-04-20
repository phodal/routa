import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { getGitHubAccessStatus } from "@/core/kanban/github-issues";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const boardId = searchParams.get("boardId")?.trim();
  const board = boardId
    ? await getRoutaSystem().kanbanBoardStore.get(boardId)
    : undefined;
  const status = getGitHubAccessStatus({ boardToken: board?.githubToken });
  return NextResponse.json(status);
}
