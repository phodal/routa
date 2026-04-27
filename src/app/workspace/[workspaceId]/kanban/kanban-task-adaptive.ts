import type { AcpTaskAdaptiveHarnessOptions } from "@/client/acp-client";
import {
  buildKanbanTaskAdaptiveHarnessOptions as buildCoreKanbanTaskAdaptiveHarnessOptions,
  hasConfirmedKanbanTaskAdaptiveContext as hasConfirmedCoreKanbanTaskAdaptiveContext,
  shouldEnableKanbanTaskAdaptiveHarness as shouldEnableCoreKanbanTaskAdaptiveHarness,
} from "@/core/kanban/task-adaptive";
import type { TaskInfo } from "../types";

export const buildKanbanTaskAdaptiveHarnessOptions = (
  promptLabel: string,
  options: {
    locale?: string;
    role?: string;
    taskType?: AcpTaskAdaptiveHarnessOptions["taskType"];
    task?: TaskInfo | null;
  },
): AcpTaskAdaptiveHarnessOptions | undefined => {
  return buildCoreKanbanTaskAdaptiveHarnessOptions(promptLabel, options);
};

export const hasConfirmedKanbanTaskAdaptiveContext = (task: TaskInfo | null | undefined): boolean => {
  return hasConfirmedCoreKanbanTaskAdaptiveContext(task);
};

export const shouldEnableKanbanTaskAdaptiveHarness = (task: TaskInfo | null | undefined): boolean => {
  return shouldEnableCoreKanbanTaskAdaptiveHarness(task);
};
