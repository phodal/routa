/**
 * Session Fork API Route - /api/sessions/[sessionId]/fork
 *
 * Creates a child session from an existing session, linked by parentSessionId.
 * The original session is preserved intact.
 *
 * Supports:
 * - POST: Fork a session → creates a new child session with the parent's metadata
 */

import { NextRequest, NextResponse } from "next/server";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import {
  loadSessionFromDb,
  loadSessionFromLocalStorage,
  persistSessionToDb,
} from "@/core/acp/session-db-persister";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId: parentSessionId } = await params;
  const store = getHttpSessionStore();
  await store.hydrateFromDb();

  // Resolve the parent session from in-memory store, DB, or local JSONL
  const inMemory = store.getSession(parentSessionId);
  const persisted = inMemory ? null : await loadSessionFromDb(parentSessionId);
  const local = inMemory || persisted ? null : await loadSessionFromLocalStorage(parentSessionId);
  const parentSession = inMemory ?? (persisted ? {
    sessionId: persisted.id,
    name: persisted.name,
    cwd: persisted.cwd,
    branch: persisted.branch,
    workspaceId: persisted.workspaceId,
    routaAgentId: persisted.routaAgentId,
    provider: persisted.provider,
    role: persisted.role,
    modeId: persisted.modeId,
    model: persisted.model,
    specialistId: persisted.specialistId,
    createdAt: persisted.createdAt?.toISOString() ?? new Date().toISOString(),
  } : local ? {
    sessionId: local.id,
    name: local.name,
    cwd: local.cwd,
    branch: local.branch,
    workspaceId: local.workspaceId,
    routaAgentId: local.routaAgentId,
    provider: local.provider,
    role: local.role,
    modeId: local.modeId,
    model: local.model,
    specialistId: local.specialistId,
    createdAt: local.createdAt,
  } : null);

  if (!parentSession) {
    return NextResponse.json(
      { error: "Parent session not found" },
      { status: 404 },
    );
  }

  // Optional body params for overrides
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Empty body is acceptable
  }

  const forkedSessionId = randomUUID();
  const now = new Date().toISOString();
  const forkedName = typeof body.name === "string"
    ? body.name
    : parentSession.name
      ? `Fork of ${parentSession.name}`
      : `Fork of ${parentSessionId.slice(0, 8)}`;

  const forkedRecord = {
    sessionId: forkedSessionId,
    name: forkedName,
    cwd: parentSession.cwd,
    branch: parentSession.branch,
    workspaceId: parentSession.workspaceId,
    routaAgentId: forkedSessionId,
    provider: parentSession.provider,
    role: parentSession.role,
    modeId: parentSession.modeId,
    model: parentSession.model,
    specialistId: parentSession.specialistId,
    parentSessionId,
    createdAt: now,
    acpStatus: undefined,
  };

  // Persist to in-memory store
  store.upsertSession(forkedRecord);

  // Persist to database
  void persistSessionToDb({
    id: forkedSessionId,
    name: forkedName,
    cwd: forkedRecord.cwd,
    branch: forkedRecord.branch,
    workspaceId: forkedRecord.workspaceId,
    routaAgentId: forkedRecord.routaAgentId,
    provider: forkedRecord.provider ?? "codex",
    role: forkedRecord.role ?? "DEVELOPER",
    modeId: forkedRecord.modeId,
    model: forkedRecord.model,
    specialistId: forkedRecord.specialistId,
    parentSessionId,
  });

  return NextResponse.json({
    sessionId: forkedSessionId,
    parentSessionId,
    name: forkedName,
    provider: forkedRecord.provider,
    role: forkedRecord.role,
    cwd: forkedRecord.cwd,
    branch: forkedRecord.branch,
    workspaceId: forkedRecord.workspaceId,
    createdAt: now,
  });
}
