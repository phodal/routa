/**
 * SchedulerService — in-process cron scheduler for the local Node.js backend.
 *
 * Uses node-cron to tick every minute and run the schedule dispatcher directly.
 * Only active outside Vercel production.
 *
 * In production on Vercel, the tick is handled by Vercel Cron Jobs instead.
 */

import nodeCron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { getRoutaSystem } from "../routa-system";
import { runScheduleTick } from "./run-schedule-tick";
import { runWithSpan } from "../telemetry/tracing";

let schedulerTask: ScheduledTask | null = null;
let isStarted = false;

export function startSchedulerService(): void {
  if (isStarted) return;

  // Only start in-process scheduler outside Vercel production
  const isVercelProduction =
    process.env.VERCEL === "1" && process.env.NODE_ENV === "production";
  if (isVercelProduction) {
    console.log("[Scheduler] Skipping in-process scheduler (Vercel handles crons)");
    return;
  }

  console.log("[Scheduler] Starting in-process cron scheduler (every minute)");

  schedulerTask = nodeCron.schedule("* * * * *", () => {
    void runWithSpan(
      "routa.scheduler.tick_cycle",
      {},
      async (span) => {
        const result = await runScheduleTick(getRoutaSystem());
        span.setAttribute("routa.schedule.due_count", result.dueCount);
        span.setAttribute("routa.schedules.fired_count", result.fired);

        if (result.fired > 0) {
          console.log(`[Scheduler] Tick fired ${result.fired} schedule(s): ${result.scheduleIds.join(", ")}`);
        }
      },
    ).catch((error) => {
      console.error("[Scheduler] Tick failed:", error);
    });
  });

  isStarted = true;
}

export function stopSchedulerService(): void {
  schedulerTask?.stop();
  schedulerTask = null;
  isStarted = false;
}
