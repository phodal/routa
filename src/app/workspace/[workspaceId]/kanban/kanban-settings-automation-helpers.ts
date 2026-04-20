"use client";

import type { KanbanRequiredTaskField } from "@/core/models/kanban";
import type { TranslationDictionary } from "@/i18n";

export const TASK_FIELD_OPTIONS = [
  "scope",
  "acceptance_criteria",
  "verification_plan",
  "verification_commands",
  "test_cases",
  "dependencies_declared",
] as const satisfies KanbanRequiredTaskField[];

export function getTaskFieldLabel(field: KanbanRequiredTaskField, t: TranslationDictionary): string {
  switch (field) {
    case "scope":
      return t.kanbanDetail.scope;
    case "acceptance_criteria":
      return t.kanbanDetail.acceptanceCriteria;
    case "verification_plan":
      return t.kanbanDetail.verificationPlan;
    case "verification_commands":
      return t.kanbanDetail.verificationCommands;
    case "test_cases":
      return t.kanbanDetail.testCases;
    case "dependencies_declared":
      return t.kanbanDetail.dependenciesDeclared;
    default:
      return field;
  }
}

export function getTaskFieldHint(field: KanbanRequiredTaskField, t: TranslationDictionary): string {
  switch (field) {
    case "scope":
      return t.kanban.storyReadinessScopeHint;
    case "acceptance_criteria":
      return t.kanban.storyReadinessAcceptanceCriteriaHint;
    case "verification_plan":
      return t.kanban.storyReadinessVerificationPlanHint;
    case "verification_commands":
      return t.kanban.storyReadinessVerificationCommandsHint;
    case "test_cases":
      return t.kanban.storyReadinessTestCasesHint;
    case "dependencies_declared":
      return t.kanban.storyReadinessDependenciesDeclaredHint;
    default:
      return field;
  }
}
