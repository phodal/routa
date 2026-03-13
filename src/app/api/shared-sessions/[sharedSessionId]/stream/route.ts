import { NextRequest, NextResponse } from "next/server";
import { getSharedSessionService } from "@/core/shared-session";
import { toErrorResponse } from "../../_helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sharedSessionId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { sharedSessionId } = await params;
    const participantId = request.nextUrl.searchParams.get("participantId");
    const participantToken = request.nextUrl.searchParams.get("participantToken");

    if (!participantId || !participantToken) {
      return NextResponse.json(
        { error: "participantId and participantToken are required" },
        { status: 400 },
      );
    }

    const service = getSharedSessionService();
    service.authenticateParticipant({
      sharedSessionId,
      participantId,
      participantToken,
    });

    const broadcaster = service.getBroadcaster();
    let connectionId: string | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        connectionId = broadcaster.attach(sharedSessionId, controller);

        heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
          } catch {
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
            }
          }
        }, 30_000);

        request.signal.addEventListener("abort", () => {
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
          if (connectionId) {
            broadcaster.detach(connectionId);
          }
          try {
            controller.close();
          } catch {
            // Ignore already-closed stream.
          }
        });
      },
      cancel() {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (connectionId) {
          broadcaster.detach(connectionId);
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

