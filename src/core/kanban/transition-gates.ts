import { VerificationVerdict, type Task } from "../models/task";
import type { KanbanColumn, KanbanTransitionGateMode } from "../models/kanban";

export interface KanbanTransitionGateIssue {
  code: "required_checklist" | "required_human_approval" | "validator_command";
  message: string;
  missing?: string[];
}

export interface KanbanTransitionGateResult {
  mode: KanbanTransitionGateMode;
  passed: boolean;
  blocking: boolean;
  issues: KanbanTransitionGateIssue[];
}

function normalizeToken(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function collectTaskText(task: Pick<Task,
  | "objective"
  | "comment"
  | "comments"
  | "scope"
  | "acceptanceCriteria"
  | "verificationCommands"
  | "testCases"
  | "completionSummary"
  | "verificationReport"
>): string {
  return [
    task.objective,
    task.comment,
    task.scope,
    ...(task.acceptanceCriteria ?? []),
    ...(task.verificationCommands ?? []),
    ...(task.testCases ?? []),
    task.completionSummary,
    task.verificationReport,
    ...(task.comments ?? []).map((entry) => entry.body),
  ].filter((value): value is string => Boolean(value?.trim())).join("\n");
}

export function collectCheckedChecklistLabels(text: string): Set<string> {
  const checked = new Set<string>();
  const pattern = /^\s*[-*]\s+\[[xX]\]\s+(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const label = match[1]?.trim();
    if (label) {
      checked.add(normalizeToken(label));
    }
  }
  return checked;
}

function isValidatorEvidencePresent(task: Task, command: string): boolean {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    return true;
  }
  const evidenceText = [
    task.verificationReport,
    task.completionSummary,
    ...(task.verificationCommands ?? []),
  ].filter((value): value is string => Boolean(value?.trim())).join("\n");
  const commandLower = normalizedCommand.toLowerCase();
  return evidenceText
    .split(/\r?\n/)
    .some((line) => {
      const lineLower = line.toLowerCase();
      return lineLower.includes(commandLower)
        && !/\b(fail|failed|error|errors|red)\b/i.test(line)
        && /\b(pass|passed|success|succeeded|ok|green)\b/i.test(line);
    });
}

export function evaluateKanbanTransitionGates(
  task: Task,
  targetColumn: Pick<KanbanColumn, "id" | "name" | "automation"> | undefined,
): KanbanTransitionGateResult {
  const automation = targetColumn?.automation;
  if (!automation?.enabled) {
    return {
      mode: "blocking",
      passed: true,
      blocking: false,
      issues: [],
    };
  }
  const mode = automation.gateMode === "warning" ? "warning" : "blocking";
  const issues: KanbanTransitionGateIssue[] = [];

  const requiredChecklist = (automation?.requiredChecklist ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
  if (requiredChecklist.length > 0) {
    const checked = collectCheckedChecklistLabels(collectTaskText(task));
    const missing = requiredChecklist.filter((item) => !checked.has(normalizeToken(item)));
    if (missing.length > 0) {
      issues.push({
        code: "required_checklist",
        missing,
        message: `missing required checklist items: ${missing.join(", ")}`,
      });
    }
  }

  if (automation?.requiredHumanApproval && task.verificationVerdict !== VerificationVerdict.APPROVED) {
    issues.push({
      code: "required_human_approval",
      message: "missing required human approval verdict",
    });
  }

  const validatorCommand = automation?.validatorCommand?.trim();
  if (validatorCommand && !isValidatorEvidencePresent(task, validatorCommand)) {
    issues.push({
      code: "validator_command",
      missing: [validatorCommand],
      message: `missing passing validator evidence for: ${validatorCommand}`,
    });
  }

  return {
    mode,
    passed: issues.length === 0,
    blocking: mode === "blocking" && issues.length > 0,
    issues,
  };
}

export function formatKanbanTransitionGateMessage(
  result: KanbanTransitionGateResult,
  targetColumnName: string,
): string {
  const summary = result.issues.map((issue) => issue.message).join("; ");
  return `Cannot move task to "${targetColumnName}": ${summary}.`;
}

export function formatKanbanTransitionGateWarning(
  result: KanbanTransitionGateResult,
  targetColumnName: string,
): string {
  const summary = result.issues.map((issue) => issue.message).join("; ");
  return `Transition gate warning for "${targetColumnName}": ${summary}.`;
}
