import { NextRequest, NextResponse } from "next/server";
import { getSharedSessionService } from "@/core/shared-session";
import { serializeParticipant, toErrorResponse } from "../../_helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sharedSessionId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { sharedSessionId } = await params;
    const service = getSharedSessionService();
    const participants = service.listParticipants(sharedSessionId).map((participant) =>
      serializeParticipant(participant, false),
    );

    return NextResponse.json({ participants });
  } catch (error) {
    return toErrorResponse(error);
  }
}

