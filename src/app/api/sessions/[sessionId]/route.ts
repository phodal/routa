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
import { getPresetById } from "@/core/acp/acp-presets";
import { loadSessionFromDb, loadSessionFromLocalStorage, renameSessionInDb, deleteSessionFromDb } from "@/core/acp/session-db-persister";
import {
  getRequiredRunnerUrl,
  isForwardedAcpRequest,
  proxyRequestToRunner,
  runnerUnavailableResponse,
} from "@/core/acp/runner-routing";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const store = getHttpSessionStore();
  await store.hydrateFromDb();
  const session = store.getSession(sessionId);
  const persistedSession = session ? null : await loadSessionFromDb(sessionId);
  const localSession = session || persistedSession ? null : await loadSessionFromLocalStorage(sessionId);
  const resolvedSession = session ?? (persistedSession ? {
    sessionId: persistedSession.id,
    name: persistedSession.name,
    cwd: persistedSession.cwd,
    branch: persistedSession.branch,
    workspaceId: persistedSession.workspaceId,
    routaAgentId: persistedSession.routaAgentId,
    provider: persistedSession.provider,
    role: persistedSession.role,
    modeId: persistedSession.modeId,
    model: persistedSession.model,
    parentSessionId: persistedSession.parentSessionId,
    specialistId: persistedSession.specialistId,
    executionMode: persistedSession.executionMode,
    ownerInstanceId: persistedSession.ownerInstanceId,
    leaseExpiresAt: persistedSession.leaseExpiresAt,
    createdAt: persistedSession.createdAt?.toISOString() ?? new Date().toISOString(),
  } : localSession ? {
    sessionId: localSession.id,
    name: localSession.name,
    cwd: localSession.cwd,
    branch: localSession.branch,
    workspaceId: localSession.workspaceId,
    routaAgentId: localSession.routaAgentId,
    provider: localSession.provider,
    role: localSession.role,
    modeId: localSession.modeId,
    model: localSession.model,
    parentSessionId: localSession.parentSessionId,
    specialistId: localSession.specialistId,
    executionMode: localSession.executionMode,
    ownerInstanceId: localSession.ownerInstanceId,
    leaseExpiresAt: localSession.leaseExpiresAt,
    createdAt: localSession.createdAt,
  } : null);

  if (!resolvedSession) {
    return NextResponse.json(
      { error: "Session not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    session: {
      sessionId: resolvedSession.sessionId,
      name: resolvedSession.name,
      cwd: resolvedSession.cwd,
      branch: resolvedSession.branch,
      workspaceId: resolvedSession.workspaceId,
      routaAgentId: resolvedSession.routaAgentId,
      provider: resolvedSession.provider,
      role: resolvedSession.role,
      acpStatus: resolvedSession.acpStatus,
      acpError: resolvedSession.acpError,
      modeId: resolvedSession.modeId,
      mcpProfile: "mcpProfile" in resolvedSession
        ? (resolvedSession as { mcpProfile?: string }).mcpProfile
        : undefined,
      model: resolvedSession.model,
      createdAt: resolvedSession.createdAt,
      parentSessionId: resolvedSession.parentSessionId,
      specialistId: resolvedSession.specialistId,
      executionMode: resolvedSession.executionMode,
      ownerInstanceId: resolvedSession.ownerInstanceId,
      leaseExpiresAt: resolvedSession.leaseExpiresAt,
      resumeCapabilities: resolvedSession.provider
        ? getPresetById(resolvedSession.provider)?.resume ?? null
        : null,
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
  await store.hydrateFromDb();
  const session = store.getSession(sessionId);

  if (!session) {
    return NextResponse.json(
      { error: "Session not found" },
      { status: 404 }
    );
  }

  if (!isForwardedAcpRequest(request) && session.executionMode === "runner") {
    const runnerUrl = getRequiredRunnerUrl();
    if (!runnerUrl) return runnerUnavailableResponse();
    return proxyRequestToRunner(request, {
      runnerUrl,
      path: `/api/sessions/${encodeURIComponent(sessionId)}`,
      method: "PATCH",
      body: { name: name.trim() },
    });
  }

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
  request: NextRequest,
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

  if (!isForwardedAcpRequest(request) && session.executionMode === "runner") {
    const runnerUrl = getRequiredRunnerUrl();
    if (!runnerUrl) return runnerUnavailableResponse();
    return proxyRequestToRunner(request, {
      runnerUrl,
      path: `/api/sessions/${encodeURIComponent(sessionId)}`,
      method: "DELETE",
    });
  }

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
