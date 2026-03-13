import { NextRequest, NextResponse } from "next/server";
import { getSharedSessionService } from "@/core/shared-session";
import { serializeParticipant, serializeSession, toErrorResponse } from "../../_helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sharedSessionId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { sharedSessionId } = await params;
    const body = await request.json() as {
      inviteToken?: string;
      userId?: string;
      displayName?: string;
      role?: "collaborator" | "viewer";
    };

    if (!body.inviteToken) {
      return NextResponse.json({ error: "inviteToken is required" }, { status: 400 });
    }
    if (!body.userId?.trim()) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const service = getSharedSessionService();
    const { session, participant } = service.joinSession({
      sharedSessionId,
      inviteToken: body.inviteToken,
      userId: body.userId,
      displayName: body.displayName,
      role: body.role,
    });

    return NextResponse.json({
      session: serializeSession(session),
      participant: serializeParticipant(participant, true),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

