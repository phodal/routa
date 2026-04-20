import { v4 as uuidv4 } from "uuid";
import type { RoutaSystem } from "../routa-system";
import { createBackgroundTask } from "../models/background-task";
import { resolveSchedulePrompt } from "../models/schedule";
import { getNextRunTime } from "./cron-utils";

export type ScheduleTickResult = {
  dueCount: number;
  fired: number;
  scheduleIds: string[];
};

type ScheduleTickSystem = Pick<RoutaSystem, "backgroundTaskStore" | "scheduleStore">;

export async function runScheduleTick(system: ScheduleTickSystem): Promise<ScheduleTickResult> {
  const dueSchedules = await system.scheduleStore.listDue();
  if (dueSchedules.length === 0) {
    return {
      dueCount: 0,
      fired: 0,
      scheduleIds: [],
    };
  }

  const fired: string[] = [];

  for (const schedule of dueSchedules) {
    try {
      const prompt = resolveSchedulePrompt(schedule);
      const task = createBackgroundTask({
        id: uuidv4(),
        prompt,
        agentId: schedule.agentId,
        workspaceId: schedule.workspaceId,
        title: `[Scheduled] ${schedule.name}`,
        triggerSource: "schedule",
        triggeredBy: `schedule:${schedule.id}`,
        maxAttempts: 1,
      });

      await system.backgroundTaskStore.save(task);

      const nextRunAt = getNextRunTime(schedule.cronExpr);
      await system.scheduleStore.update(schedule.id, {
        lastRunAt: new Date(),
        lastTaskId: task.id,
        nextRunAt: nextRunAt ?? undefined,
      });

      fired.push(schedule.id);
      console.log(`[ScheduleTick] Fired schedule "${schedule.name}" (${schedule.id}) → task ${task.id}`);
    } catch (err) {
      console.error(`[ScheduleTick] Failed to fire schedule ${schedule.id}:`, err);
    }
  }

  return {
    dueCount: dueSchedules.length,
    fired: fired.length,
    scheduleIds: fired,
  };
}
