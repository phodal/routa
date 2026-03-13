import { NextRequest, NextResponse } from "next/server";
import { getSharedSessionService } from "@/core/shared-session";
import {
  serializeApproval,
  serializeParticipant,
  serializeSession,
  toErrorResponse,
} from "../_helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sharedSessionId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { sharedSessionId } = await params;
    const service = getSharedSessionService();
    const session = service.getSession(sharedSessionId);
    if (!session) {
      return NextResponse.json({ error: "Shared session not found" }, { status: 404 });
    }

    const participants = service.listParticipants(sharedSessionId).map((participant) =>
      serializeParticipant(participant, false),
    );
    const approvals = service.listApprovals(sharedSessionId).map(serializeApproval);

    return NextResponse.json({
      session: serializeSession(session),
      participants,
      approvals,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { sharedSessionId } = await params;
    const body = await request.json() as {
      participantId?: string;
      participantToken?: string;
    };

    if (!body.participantId || !body.participantToken) {
      return NextResponse.json(
        { error: "participantId and participantToken are required" },
        { status: 400 },
      );
    }

    const service = getSharedSessionService();
    const session = service.closeSession({
      sharedSessionId,
      participantId: body.participantId,
      participantToken: body.participantToken,
    });

    return NextResponse.json({
      closed: true,
      session: serializeSession(session),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

