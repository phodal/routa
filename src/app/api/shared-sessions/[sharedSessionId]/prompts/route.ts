import { NextRequest, NextResponse } from "next/server";
import { getSharedSessionService } from "@/core/shared-session";
import { serializeApproval, toErrorResponse } from "../../_helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sharedSessionId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { sharedSessionId } = await params;
    const body = await request.json() as {
      participantId?: string;
      participantToken?: string;
      prompt?: string;
    };

    if (!body.participantId || !body.participantToken) {
      return NextResponse.json(
        { error: "participantId and participantToken are required" },
        { status: 400 },
      );
    }
    if (typeof body.prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const service = getSharedSessionService();
    const result = service.sendPrompt({
      sharedSessionId,
      participantId: body.participantId,
      participantToken: body.participantToken,
      prompt: body.prompt,
    });

    return NextResponse.json({
      status: result.status,
      approval: result.approval ? serializeApproval(result.approval) : null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

