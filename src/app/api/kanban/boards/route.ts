import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getRoutaSystem } from "@/core/routa-system";
import { createKanbanBoard } from "@/core/models/kanban";
import { ensureDefaultBoard } from "@/core/kanban/boards";
import { getKanbanAutoProvider } from "@/core/kanban/board-auto-provider";
import { getKanbanHistoryMemoryPolicy } from "@/core/kanban/board-history-memory-policy";
import { getKanbanSessionConcurrencyLimit } from "@/core/kanban/board-session-limits";
import { getKanbanDevSessionSupervision } from "@/core/kanban/board-session-supervision";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { reviveMissingEntryAutomations } from "@/core/kanban/restart-recovery";
import { getKanbanSessionQueue } from "@/core/kanban/workflow-orchestrator-singleton";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { getAcpProcessManager } from "@/core/acp/processer";
import type { KanbanBoard, KanbanDevSessionSupervision } from "@/core/models/kanban";

export const dynamic = "force-dynamic";

function sanitizeBoard(
  board: KanbanBoard,
  extras?: {
    autoProviderId?: string | null;
    historyMemoryPolicy?: unknown;
    sessionConcurrencyLimit?: number;
    devSessionSupervision?: KanbanDevSessionSupervision;
    queue?: unknown;
  },
) {
  return {
    ...board,
    githubToken: undefined,
    githubTokenConfigured: Boolean(board.githubToken?.trim()),
    autoProviderId: extras?.autoProviderId,
    historyMemoryPolicy: extras?.historyMemoryPolicy,
    sessionConcurrencyLimit: extras?.sessionConcurrencyLimit,
    devSessionSupervision: extras?.devSessionSupervision,
    queue: extras?.queue,
  };
}

function requireWorkspaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function GET(request: NextRequest) {
  const workspaceId = requireWorkspaceId(request.nextUrl.searchParams.get("workspaceId"));
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const system = getRoutaSystem();
  await ensureDefaultBoard(system, workspaceId);
  const boards = await system.kanbanBoardStore.listByWorkspace(workspaceId);
  const workspace = await system.workspaceStore.get(workspaceId);
  const queue = getKanbanSessionQueue(system);
  const sessionStore = getHttpSessionStore();
  const processManager = getAcpProcessManager();
  await sessionStore.hydrateFromDb();
  await Promise.all(boards.map((board) => reviveMissingEntryAutomations(system, workspaceId, board.id, {
    sessionStore,
    processManager,
  })));
  return NextResponse.json({
    boards: await Promise.all(boards.map(async (board) => sanitizeBoard(board, {
      autoProviderId: getKanbanAutoProvider(workspace?.metadata, board.id),
      historyMemoryPolicy: getKanbanHistoryMemoryPolicy(workspace?.metadata, board.id),
      sessionConcurrencyLimit: getKanbanSessionConcurrencyLimit(workspace?.metadata, board.id),
      devSessionSupervision: getKanbanDevSessionSupervision(workspace?.metadata, board.id),
      queue: await queue.getBoardSnapshot(board.id),
    }))),
  });
}

export async function POST(request: NextRequest) {
  let body: { workspaceId?: string; name?: string; columns?: ReturnType<typeof createKanbanBoard>["columns"]; isDefault?: boolean };
  try {
    body = await request.json() as { workspaceId?: string; name?: string; columns?: ReturnType<typeof createKanbanBoard>["columns"]; isDefault?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const system = getRoutaSystem();
  const board = createKanbanBoard({
    id: uuidv4(),
    workspaceId,
    name: body.name.trim(),
    isDefault: body.isDefault ?? false,
    columns: body.columns,
  });
  await system.kanbanBoardStore.save(board);
  if (board.isDefault) {
    await system.kanbanBoardStore.setDefault(workspaceId, board.id);
  }
  getKanbanEventBroadcaster().notify({
    workspaceId,
    entity: "board",
    action: "created",
    resourceId: board.id,
    source: "user",
  });
  return NextResponse.json({ board: sanitizeBoard(board) }, { status: 201 });
}
