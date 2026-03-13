import { NextRequest, NextResponse } from "next/server";
import { getSharedSessionService } from "@/core/shared-session";
import { serializeApproval, toErrorResponse } from "../../../_helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sharedSessionId: string; approvalId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { sharedSessionId, approvalId } = await params;
    const body = await request.json() as {
      participantId?: string;
      participantToken?: string;
      action?: "approve" | "reject";
    };

    if (!body.participantId || !body.participantToken) {
      return NextResponse.json(
        { error: "participantId and participantToken are required" },
        { status: 400 },
      );
    }
    if (body.action !== "approve" && body.action !== "reject") {
      return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
    }

    const service = getSharedSessionService();
    const approval = service.respondToApproval({
      sharedSessionId,
      approvalId,
      participantId: body.participantId,
      participantToken: body.participantToken,
      action: body.action,
    });

    return NextResponse.json({
      approval: serializeApproval(approval),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
