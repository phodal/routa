"use client";

import type { AutomationSpecialistResolver } from "@/core/kanban/effective-task-automation";
import type { SessionInfo, TaskInfo, TaskRunInfo } from "../types";
import { findSpecialistById, getSpecialistDisplayName } from "./kanban-specialist-language";

export interface KanbanSpecialistOption {
  id: string;
  name: string;
  role: string;
  displayName?: string;
  defaultProvider?: string;
}

export function getSpecialistName(
  specialistId: string | undefined,
  specialistName: string | undefined,
  specialists: KanbanSpecialistOption[],
): string {
  if (!specialistId && !specialistName) return "None";
  return getSpecialistDisplayName(findSpecialistById(specialists, specialistId)) ?? specialistName ?? specialistId ?? "None";
}

export function createKanbanSpecialistResolver(
  specialists: KanbanSpecialistOption[],
): AutomationSpecialistResolver {
  return (specialistId) => {
    const specialist = findSpecialistById(specialists, specialistId);
    if (!specialist) return undefined;
    return {
      name: getSpecialistDisplayName(specialist) ?? specialist.name,
      role: specialist.role,
      defaultProvider: specialist.defaultProvider,
    };
  };
}

export function formatSessionTimestamp(value: string | undefined): string {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString();
}

export function getOrderedSessionIds(task: TaskInfo): string[] {
  const laneSessions = task.laneSessions ?? [];
  return laneSessions.length > 0
    ? laneSessions.map((entry) => entry.sessionId)
    : Array.from(new Set([
        ...(task.sessionIds ?? []),
        ...(task.triggerSessionId ? [task.triggerSessionId] : []),
      ]));
}

export function getStableOrderedSessionIds(
  task: TaskInfo,
  runs?: TaskRunInfo[] | null,
): string[] {
  const orderedTaskIds = getOrderedSessionIds(task);
  if (!runs || runs.length === 0) {
    return orderedTaskIds;
  }

  const runIds = runs.map((run) => run.sessionId ?? run.id);
  if (orderedTaskIds.length === 0) {
    return Array.from(new Set(runIds));
  }

  const seen = new Set(orderedTaskIds);
  const extraRunIds = runIds.filter((sessionId) => {
    if (seen.has(sessionId)) return false;
    seen.add(sessionId);
    return true;
  });

  return [...orderedTaskIds, ...extraRunIds];
}

export function buildSessionDisplayLabel(
  sessionId: string,
  index: number,
  sessionMap: Map<string, SessionInfo>,
): string {
  const session = sessionMap.get(sessionId);
  const name = session?.name?.trim();
  if (name) return name;
  const provider = session?.provider?.trim();
  if (provider) return provider;
  return `Run ${index + 1}`;
}

export function getLaneSessionStepLabel(
  session: { stepIndex?: number; stepName?: string } | undefined,
): string | null {
  if (!session) return null;
  const stepName = session.stepName?.trim();
  if (stepName) return stepName;
  if (typeof session.stepIndex === "number") return `Step ${session.stepIndex + 1}`;
  return null;
}
