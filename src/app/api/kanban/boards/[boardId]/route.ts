import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import type { KanbanColumn } from "@/core/models/kanban";
import {
  getKanbanAutoProvider,
  setKanbanAutoProvider,
} from "@/core/kanban/board-auto-provider";
import {
  getKanbanBranchRules,
  setKanbanBranchRules,
  type KanbanBranchRules,
} from "@/core/kanban/board-branch-rules";
import {
  getKanbanSessionConcurrencyLimit,
  setKanbanSessionConcurrencyLimit,
} from "@/core/kanban/board-session-limits";
import {
  getKanbanDevSessionSupervision,
  setKanbanDevSessionSupervision,
} from "@/core/kanban/board-session-supervision";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { getKanbanSessionQueue } from "@/core/kanban/workflow-orchestrator-singleton";
import type { KanbanDevSessionSupervision } from "@/core/models/kanban";
import type { KanbanBoard } from "@/core/models/kanban";

export const dynamic = "force-dynamic";

interface PatchBoardBody {
  name?: string;
  columns?: KanbanColumn[];
  isDefault?: boolean;
  githubToken?: string | null;
  clearGitHubToken?: boolean;
  autoProviderId?: string | null;
  sessionConcurrencyLimit?: number;
  devSessionSupervision?: Partial<KanbanDevSessionSupervision>;
  branchRules?: Partial<KanbanBranchRules>;
}

function sanitizeBoard(
  board: KanbanBoard,
  extras?: {
    autoProviderId?: string | null;
    sessionConcurrencyLimit?: number;
    devSessionSupervision?: KanbanDevSessionSupervision;
    branchRules?: KanbanBranchRules;
    queue?: unknown;
  },
) {
  return {
    ...board,
    githubToken: undefined,
    githubTokenConfigured: Boolean(board.githubToken?.trim()),
    autoProviderId: extras?.autoProviderId,
    sessionConcurrencyLimit: extras?.sessionConcurrencyLimit,
    devSessionSupervision: extras?.devSessionSupervision,
    branchRules: extras?.branchRules,
    queue: extras?.queue,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  const { boardId } = await params;
  const system = getRoutaSystem();
  const board = await system.kanbanBoardStore.get(boardId);

  if (!board) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  const workspace = await system.workspaceStore.get(board.workspaceId);
  const queue = getKanbanSessionQueue(system);
  return NextResponse.json({
    board: sanitizeBoard(board, {
      autoProviderId: getKanbanAutoProvider(workspace?.metadata, board.id),
      sessionConcurrencyLimit: getKanbanSessionConcurrencyLimit(workspace?.metadata, board.id),
      devSessionSupervision: getKanbanDevSessionSupervision(workspace?.metadata, board.id),
      branchRules: getKanbanBranchRules(workspace?.metadata, board.id),
      queue: await queue.getBoardSnapshot(board.id),
    }),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  const { boardId } = await params;

  let body: PatchBoardBody;
  try {
    body = await request.json() as PatchBoardBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const system = getRoutaSystem();
  const existing = await system.kanbanBoardStore.get(boardId);

  if (!existing) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  // Update board fields
  const updated = {
    ...existing,
    name: body.name?.trim() ?? existing.name,
    githubToken: body.clearGitHubToken
      ? undefined
      : body.githubToken !== undefined
        ? (body.githubToken?.trim() || undefined)
        : existing.githubToken,
    columns: body.columns ?? existing.columns,
    isDefault: body.isDefault ?? existing.isDefault,
    updatedAt: new Date(),
  };

  await system.kanbanBoardStore.save(updated);

  if (
    body.autoProviderId !== undefined
    || body.sessionConcurrencyLimit !== undefined
    || body.devSessionSupervision !== undefined
    || body.branchRules !== undefined
  ) {
    const workspace = await system.workspaceStore.get(existing.workspaceId);
    let nextMetadata = workspace?.metadata;
    if (body.autoProviderId !== undefined) {
      nextMetadata = setKanbanAutoProvider(
        nextMetadata,
        boardId,
        body.autoProviderId,
      );
    }
    if (body.sessionConcurrencyLimit !== undefined) {
      nextMetadata = setKanbanSessionConcurrencyLimit(
        nextMetadata,
        boardId,
        body.sessionConcurrencyLimit,
      );
    }
    if (body.devSessionSupervision !== undefined) {
      nextMetadata = setKanbanDevSessionSupervision(
        nextMetadata,
        boardId,
        body.devSessionSupervision,
      );
    }
    if (body.branchRules !== undefined) {
      nextMetadata = setKanbanBranchRules(
        nextMetadata,
        boardId,
        body.branchRules,
      );
    }
    await system.workspaceStore.updateMetadata(existing.workspaceId, nextMetadata ?? {});
  }

  // If setting as default, update other boards
  if (body.isDefault && !existing.isDefault) {
    await system.kanbanBoardStore.setDefault(existing.workspaceId, boardId);
  }
  getKanbanEventBroadcaster().notify({
    workspaceId: existing.workspaceId,
    entity: "board",
    action: "updated",
    resourceId: boardId,
    source: "user",
  });

  const workspace = await system.workspaceStore.get(existing.workspaceId);
  const queue = getKanbanSessionQueue(system);
  return NextResponse.json({
    board: sanitizeBoard(updated, {
      autoProviderId: getKanbanAutoProvider(workspace?.metadata, boardId),
      sessionConcurrencyLimit: getKanbanSessionConcurrencyLimit(workspace?.metadata, boardId),
      devSessionSupervision: getKanbanDevSessionSupervision(workspace?.metadata, boardId),
      branchRules: getKanbanBranchRules(workspace?.metadata, boardId),
      queue: await queue.getBoardSnapshot(boardId),
    }),
  });
}
