import { NextRequest } from "next/server";

import { normalizeFitnessContextValue } from "@/core/fitness/repo-root";
import {
  buildFitnessRuntimeChangeKey,
  tryReadFitnessRuntimeStatus,
} from "@/core/fitness/runtime-status";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "*";
  const codebaseId = normalizeFitnessContextValue(request.nextUrl.searchParams.get("codebaseId"));
  const broadcaster = getKanbanEventBroadcaster();
  let connectionId: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  let lastFitnessChangeKey: string | null = null;

  const cleanup = () => {
    if (connectionId) {
      broadcaster.detach(connectionId);
      connectionId = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      connectionId = broadcaster.attach(workspaceId, controller);

      if (workspaceId === "*") {
        return;
      }

      const encoder = new TextEncoder();

      const pollFitnessStatus = async () => {
        if (polling) {
          return;
        }

        polling = true;
        try {
          const status = await tryReadFitnessRuntimeStatus({ workspaceId, codebaseId });
          const nextKey = buildFitnessRuntimeChangeKey(status);

          if (lastFitnessChangeKey === null) {
            lastFitnessChangeKey = nextKey;
            return;
          }

          if (nextKey === lastFitnessChangeKey) {
            return;
          }

          lastFitnessChangeKey = nextKey;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "fitness:changed",
            workspaceId,
            codebaseId: codebaseId ?? null,
            repoRoot: status?.repoRoot ?? null,
            timestamp: new Date().toISOString(),
          })}\n\n`));
        } catch {
          // Ignore transient fitness polling failures so the main kanban stream stays alive.
        } finally {
          polling = false;
        }
      };

      void pollFitnessStatus();
      pollTimer = setInterval(() => {
        void pollFitnessStatus();
      }, 3000);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
