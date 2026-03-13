import { NextRequest, NextResponse } from "next/server";
import { getSharedSessionService } from "@/core/shared-session";
import { serializeParticipant, toErrorResponse } from "../../_helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sharedSessionId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
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
    const participant = service.leaveSession({
      sharedSessionId,
      participantId: body.participantId,
      participantToken: body.participantToken,
    });

    return NextResponse.json({
      participant: serializeParticipant(participant, false),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

