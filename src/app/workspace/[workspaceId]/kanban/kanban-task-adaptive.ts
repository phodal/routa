import type { AcpTaskAdaptiveHarnessOptions } from "@/client/acp-client";
import type { TaskInfo } from "../types";

function uniqueNonEmptyStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function collectTaskHistorySessionIds(task: TaskInfo | null | undefined): string[] | undefined {
  if (!task) return undefined;
  const historySessionIds = uniqueNonEmptyStrings([
    task.triggerSessionId,
    ...(task.sessionIds ?? []),
    ...((task.laneSessions ?? []).map((session) => session.sessionId)),
  ]);
  return historySessionIds.length > 0 ? historySessionIds : undefined;
}

export function buildKanbanTaskAdaptiveHarnessOptions(
  promptLabel: string,
  options: {
    locale?: string;
    role?: string;
    taskType: AcpTaskAdaptiveHarnessOptions["taskType"];
    task?: TaskInfo | null;
  },
): AcpTaskAdaptiveHarnessOptions {
  return {
    taskLabel: options.task?.title ?? promptLabel.trim(),
    historySessionIds: collectTaskHistorySessionIds(options.task),
    taskType: options.taskType,
    locale: options.locale,
    role: options.role,
  };
}
