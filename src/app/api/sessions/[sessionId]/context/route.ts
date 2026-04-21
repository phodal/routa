/**
 * Session Context API Route - /api/sessions/[sessionId]/context
 *
 * Returns comprehensive context information for a session:
 * - Current session details
 * - Parent session (if exists)
 * - Child sessions
 * - Sibling sessions (same parent)
 * - Recent sessions in the same workspace
 */

import { NextRequest, NextResponse } from "next/server";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { getRoutaSystem } from "@/core/routa-system";
import { buildSessionKanbanContext, findTaskForSession } from "@/core/kanban/session-kanban-context";
import { buildTaskFingerprint } from "@/core/trace/run-outcome";
import { syncLearnedPlaybookArtifact } from "@/core/trace/trace-playbook";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const store = getHttpSessionStore();

  // Hydrate from database on first access
  await store.hydrateFromDb();

  const current = store.getSession(sessionId);

  if (!current) {
    return NextResponse.json(
      { error: "Session not found" },
      { status: 404 }
    );
  }

  const allSessions = store.listSessions();

  // Find parent session
  const parent = current.parentSessionId
    ? allSessions.find((s) => s.sessionId === current.parentSessionId)
    : undefined;

  // Find child sessions (exclude empty ones)
  const children = allSessions.filter(
    (s) => s.parentSessionId === sessionId && s.firstPromptSent !== false
  );

  // Find sibling sessions (same parent, excluding current and empty ones)
  const siblings = current.parentSessionId
    ? allSessions.filter(
        (s) =>
          s.parentSessionId === current.parentSessionId &&
          s.sessionId !== sessionId &&
          s.firstPromptSent !== false
      )
    : [];

  // Filter out empty sessions (only have "Connected to ACP session" — never received a real prompt)
  const isNonEmpty = (s: { firstPromptSent?: boolean }) => s.firstPromptSent !== false;

  // Find recent sessions in the same workspace (excluding current, parent, children, siblings)
  const excludeIds = new Set([
    sessionId,
    parent?.sessionId,
    ...children.map((c) => c.sessionId),
    ...siblings.map((s) => s.sessionId),
  ].filter(Boolean));

  const recentInWorkspace = allSessions
    .filter(
      (s) =>
        s.workspaceId === current.workspaceId &&
        !excludeIds.has(s.sessionId) &&
        isNonEmpty(s)
    )
    .sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return bTime - aTime; // Most recent first
    })
    .slice(0, 5);

  const system = getRoutaSystem();
  const tasks = await system.taskStore.listByWorkspace(current.workspaceId);
  const relatedTask = findTaskForSession(tasks, sessionId);
  const relatedBoard = relatedTask?.boardId
    ? await system.kanbanBoardStore.get(relatedTask.boardId)
    : undefined;
  let kanbanContext = relatedTask
    ? buildSessionKanbanContext(relatedTask, sessionId, relatedBoard ?? undefined)
    : null;

  if (kanbanContext && relatedTask) {
    try {
      const fingerprint = buildTaskFingerprint(relatedTask, current.workspaceId);
      const learnedPlaybook = await syncLearnedPlaybookArtifact(
        current.cwd,
        fingerprint,
        relatedTask.title,
        current.workspaceId,
      );
      if (learnedPlaybook) {
        kanbanContext = {
          ...kanbanContext,
          learnedPlaybook,
        };
      }
    } catch {
      // Learned playbook lookup is best-effort for the session context API.
    }
  }

  return NextResponse.json(
    {
      current: {
        sessionId: current.sessionId,
        name: current.name,
        cwd: current.cwd,
        workspaceId: current.workspaceId,
        routaAgentId: current.routaAgentId,
        provider: current.provider,
        role: current.role,
        modeId: current.modeId,
        model: current.model,
        createdAt: current.createdAt,
        parentSessionId: current.parentSessionId,
      },
      parent: parent
        ? {
            sessionId: parent.sessionId,
            name: parent.name,
            cwd: parent.cwd,
            workspaceId: parent.workspaceId,
            provider: parent.provider,
            role: parent.role,
            model: parent.model,
            createdAt: parent.createdAt,
          }
        : undefined,
      children: children.map((c) => ({
        sessionId: c.sessionId,
        name: c.name,
        cwd: c.cwd,
        workspaceId: c.workspaceId,
        provider: c.provider,
        role: c.role,
        model: c.model,
        createdAt: c.createdAt,
        parentSessionId: c.parentSessionId,
      })),
      siblings: siblings.map((s) => ({
        sessionId: s.sessionId,
        name: s.name,
        cwd: s.cwd,
        workspaceId: s.workspaceId,
        provider: s.provider,
        role: s.role,
        model: s.model,
        createdAt: s.createdAt,
        parentSessionId: s.parentSessionId,
      })),
      recentInWorkspace: recentInWorkspace.map((r) => ({
        sessionId: r.sessionId,
        name: r.name,
        cwd: r.cwd,
        workspaceId: r.workspaceId,
        provider: r.provider,
        role: r.role,
        model: r.model,
        createdAt: r.createdAt,
        parentSessionId: r.parentSessionId,
      })),
      kanbanContext,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
