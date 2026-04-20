/**
 * /api/schedules/tick — Cron tick handler.
 *
 * Called every minute by Vercel Cron Jobs (configured in vercel.json).
 * Finds all due schedules and fires BackgroundTasks for each.
 *
 * Also used by the in-process SchedulerService (node-cron) for local dev.
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { runScheduleTick } from "@/core/scheduling/run-schedule-tick";
import { runWithSpan } from "@/core/telemetry/tracing";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest) {
  return runWithSpan(
    "routa.schedule.tick_route",
    {
      attributes: {
        "http.request.method": "POST",
      },
    },
    async (span) => {
      try {
        const system = getRoutaSystem();
        const result = await runScheduleTick(system);
        span.setAttribute("routa.schedule.due_count", result.dueCount);
        span.setAttribute("routa.schedule.fired_count", result.fired);
        return NextResponse.json({ fired: result.fired, scheduleIds: result.scheduleIds });
      } catch (err) {
        console.error("[ScheduleTick] Error:", err);
        return NextResponse.json(
          { error: "Tick failed", details: String(err) },
          { status: 500 }
        );
      }
    },
  );
}

// Allow GET for manual testing in browser
export async function GET(request: NextRequest) {
  return POST(request);
}
