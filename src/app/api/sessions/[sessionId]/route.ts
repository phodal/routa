/**
 * Session API Route - /api/sessions/[sessionId]
 *
 * Supports:
 * - GET: Get session metadata (provider, role, model, etc.)
 * - PATCH: Rename a session
 * - DELETE: Delete a session
 */

import { NextRequest, NextResponse } from "next/server";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { renameSessionInDb, deleteSessionFromDb } from "@/core/acp/session-db-persister";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const store = getHttpSessionStore();
  await store.hydrateFromDb();
  const session = store.getSession(sessionId);

  if (!session) {
    return NextResponse.json(
      { error: "Session not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    session: {
      sessionId: session.sessionId,
      name: session.name,
      cwd: session.cwd,
      branch: session.branch,
      workspaceId: session.workspaceId,
      routaAgentId: session.routaAgentId,
      provider: session.provider,
      role: session.role,
      acpStatus: session.acpStatus,
      acpError: session.acpError,
      modeId: session.modeId,
      model: session.model,
      createdAt: session.createdAt,
      parentSessionId: session.parentSessionId,
      specialistId: session.specialistId,
      executionMode: session.executionMode,
      ownerInstanceId: session.ownerInstanceId,
      leaseExpiresAt: session.leaseExpiresAt,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const body = await request.json();
  const { name } = body;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { error: "Invalid name" },
      { status: 400 }
    );
  }

  const store = getHttpSessionStore();
  const success = store.renameSession(sessionId, name.trim());

  if (!success) {
    return NextResponse.json(
      { error: "Session not found" },
      { status: 404 }
    );
  }

  await renameSessionInDb(sessionId, name.trim());

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const store = getHttpSessionStore();
  const success = store.deleteSession(sessionId);

  if (!success) {
    return NextResponse.json(
      { error: "Session not found" },
      { status: 404 }
    );
  }

  await deleteSessionFromDb(sessionId);

  return NextResponse.json({ ok: true });
}
