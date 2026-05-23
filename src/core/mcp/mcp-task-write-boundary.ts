import type { McpServerProfile } from "./mcp-server-profiles";

export const KANBAN_PLANNING_UPDATE_TASK_FIELDS = new Set([
  "taskId",
  "expectedVersion",
  "agentId",
  "sessionId",
  "title",
  "objective",
  "scope",
  "acceptanceCriteria",
  "verificationCommands",
  "testCases",
  "contextSearchSpec",
  "jitContextAnalysis",
]);

export const HIGH_RISK_UPDATE_TASK_FIELDS = new Set([
  "status",
  "columnId",
  "column_id",
  "dependencies",
  "completionSummary",
  "verificationVerdict",
  "verificationReport",
  "assignedTo",
  "assignedProvider",
  "assignedRole",
  "assignedSpecialistId",
  "releaseLabel",
  "approval",
  "ownerVerdict",
]);

export function blockedUpdateTaskFieldsForProfile(
  params: Record<string, unknown>,
  profile?: McpServerProfile,
): string[] {
  if (profile !== "kanban-planning") {
    return [];
  }

  return Object.keys(params).filter((field) => {
    if (KANBAN_PLANNING_UPDATE_TASK_FIELDS.has(field)) {
      return false;
    }
    return HIGH_RISK_UPDATE_TASK_FIELDS.has(field);
  });
}

export function updateTaskBoundaryError(
  fields: string[],
  profile: McpServerProfile,
): string {
  const fieldList = fields.map((field) => `\`${field}\``).join(", ");
  return `${profile} cannot write protected task workflow fields via update_task: ${fieldList}. Use move_card for lane/status changes, provide artifacts for evidence, and leave owner/review metadata to the appropriate gate.`;
}
