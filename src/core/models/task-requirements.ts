export const KANBAN_REQUIRED_TASK_FIELDS = [
  "scope",
  "acceptance_criteria",
  "verification_commands",
  "test_cases",
  "verification_plan",
  "dependencies_declared",
] as const;

export type KanbanRequiredTaskField = typeof KANBAN_REQUIRED_TASK_FIELDS[number];

export const DEFAULT_DEV_REQUIRED_TASK_FIELDS = [
  "scope",
  "acceptance_criteria",
  "verification_plan",
] as const satisfies KanbanRequiredTaskField[];
