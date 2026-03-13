import { NextRequest, NextResponse } from "next/server";
import { getSharedSessionService } from "@/core/shared-session";
import { serializeParticipant, serializeSession, toErrorResponse } from "./_helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const service = getSharedSessionService();
    const sessions = service.listSessions({
      workspaceId: searchParams.get("workspaceId") ?? undefined,
      hostSessionId: searchParams.get("hostSessionId") ?? undefined,
      status: (searchParams.get("status") as "active" | "closed" | "expired" | null) ?? undefined,
    });

    return NextResponse.json({
      sessions: sessions.map(serializeSession),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      hostSessionId?: string;
      hostUserId?: string;
      hostDisplayName?: string;
      mode?: "view_only" | "comment_only" | "prompt_with_approval" | "prompt_direct";
      workspaceId?: string;
      expiresInMinutes?: number;
    };

    if (!body.hostSessionId) {
      return NextResponse.json({ error: "hostSessionId is required" }, { status: 400 });
    }
    if (!body.hostUserId?.trim()) {
      return NextResponse.json({ error: "hostUserId is required" }, { status: 400 });
    }

    const expiresAt = typeof body.expiresInMinutes === "number" && body.expiresInMinutes > 0
      ? new Date(Date.now() + body.expiresInMinutes * 60 * 1000)
      : undefined;

    const service = getSharedSessionService();
    const { session, hostParticipant } = service.createSession({
      hostSessionId: body.hostSessionId,
      hostUserId: body.hostUserId,
      hostDisplayName: body.hostDisplayName,
      mode: body.mode,
      workspaceId: body.workspaceId,
      expiresAt,
    });

    return NextResponse.json(
      {
        session: serializeSession(session),
        inviteToken: session.inviteToken,
        hostParticipant: serializeParticipant(hostParticipant, true),
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

