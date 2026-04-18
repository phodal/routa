import { describe, expect, it } from "vitest";

import { InMemoryBackgroundTaskStore } from "@/core/store/background-task-store";
import { InMemoryScheduleStore } from "@/core/store/schedule-store";
import { runScheduleTick } from "../run-schedule-tick";

describe("runScheduleTick", () => {
  it("returns an empty result when no schedules are due", async () => {
    const scheduleStore = new InMemoryScheduleStore();
    const backgroundTaskStore = new InMemoryBackgroundTaskStore();

    const result = await runScheduleTick({
      scheduleStore,
      backgroundTaskStore,
    });

    expect(result).toEqual({
      dueCount: 0,
      fired: 0,
      scheduleIds: [],
    });
  });

  it("creates a scheduled background task and advances schedule state", async () => {
    const scheduleStore = new InMemoryScheduleStore();
    const backgroundTaskStore = new InMemoryBackgroundTaskStore();
    const schedule = await scheduleStore.create({
      id: "schedule-1",
      name: "Nightly Docs",
      cronExpr: "* * * * *",
      taskPrompt: "Fallback prompt",
      promptTemplate: "Run {scheduleName} at {cronExpr}",
      agentId: "claude-code",
      workspaceId: "default",
    });

    await scheduleStore.update(schedule.id, {
      nextRunAt: new Date(Date.now() - 60_000),
    });

    const result = await runScheduleTick({
      scheduleStore,
      backgroundTaskStore,
    });

    expect(result).toEqual({
      dueCount: 1,
      fired: 1,
      scheduleIds: ["schedule-1"],
    });

    const tasks = await backgroundTaskStore.listByWorkspace("default");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: "[Scheduled] Nightly Docs",
      prompt: "Run Nightly Docs at * * * * *",
      agentId: "claude-code",
      workspaceId: "default",
      triggerSource: "schedule",
      triggeredBy: "schedule:schedule-1",
    });

    const updatedSchedule = await scheduleStore.get("schedule-1");
    expect(updatedSchedule?.lastTaskId).toBe(tasks[0]?.id);
    expect(updatedSchedule?.lastRunAt).toBeInstanceOf(Date);
    expect(updatedSchedule?.nextRunAt).toBeInstanceOf(Date);
  });
});
