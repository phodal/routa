import { NextRequest, NextResponse } from "next/server";
import { getSharedSessionService } from "@/core/shared-session";
import { serializeMessage, toErrorResponse } from "../../_helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sharedSessionId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { sharedSessionId } = await params;
    const service = getSharedSessionService();
    const messages = service.listMessages(sharedSessionId).map(serializeMessage);
    return NextResponse.json({ messages });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { sharedSessionId } = await params;
    const body = await request.json() as {
      participantId?: string;
      participantToken?: string;
      text?: string;
    };

    if (!body.participantId || !body.participantToken) {
      return NextResponse.json(
        { error: "participantId and participantToken are required" },
        { status: 400 },
      );
    }
    if (typeof body.text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const service = getSharedSessionService();
    const message = service.sendMessage({
      sharedSessionId,
      participantId: body.participantId,
      participantToken: body.participantToken,
      text: body.text,
    });

    return NextResponse.json({
      message: serializeMessage(message),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

