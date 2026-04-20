import type { AcpProviderInfo } from "@/client/acp-client";
import { resolveKanbanAutomationStep } from "@/core/kanban/effective-task-automation";
import { getKanbanAutomationSteps, normalizeKanbanAutomation } from "@/core/models/kanban";
import { createKanbanSpecialistResolver } from "./kanban-card-session-utils";
import {
  findSpecialistById,
  getSpecialistDisplayName,
  type KanbanSpecialistLanguage,
} from "./kanban-specialist-language";
import type { ColumnAutomationConfig } from "./kanban-settings-modal";
import type { KanbanBoardInfo, SessionInfo, TaskInfo } from "../types";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
  displayName?: string;
  defaultProvider?: string;
}

function normalizeProviderId(providerId: string | null | undefined): string | undefined {
  const normalized = providerId?.trim();
  return normalized ? normalized : undefined;
}

export function extractHistoryText(content: unknown): string | null {
  if (typeof content === "string") return content.trim() || null;
  if (!content || typeof content !== "object") return null;

  const record = content as Record<string, unknown>;
  if (typeof record.text === "string" && record.text.trim()) return record.text.trim();

  if (Array.isArray(record.content)) {
    const parts = record.content
      .map((item) => (typeof item === "object" && item !== null && typeof (item as { text?: unknown }).text === "string"
        ? (item as { text: string }).text
        : ""))
      .filter(Boolean);
    if (parts.length > 0) return parts.join("").trim() || null;
  }

  return null;
}

export function extractSessionLiveTail(history: unknown): string | null {
  if (!Array.isArray(history) || history.length === 0) return null;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (!entry || typeof entry !== "object") continue;
    const update = (entry as { update?: unknown }).update;
    if (!update || typeof update !== "object") continue;
    const updateRecord = update as Record<string, unknown>;
    const updateType = updateRecord.sessionUpdate;
    if (updateType !== "agent_message" && updateType !== "agent_message_chunk" && updateType !== "user_message") {
      continue;
    }
    const text = extractHistoryText(updateRecord.content);
    if (text) return text.replace(/\s+/g, " ").trim();
  }

  return null;
}

export function getPreferredTaskSessionId(task: TaskInfo | null | undefined): string | null {
  if (!task) return null;
  const latestLaneSessionId = task.laneSessions && task.laneSessions.length > 0
    ? task.laneSessions[task.laneSessions.length - 1]?.sessionId ?? null
    : null;
  return task.triggerSessionId
    ?? latestLaneSessionId
    ?? (task.sessionIds && task.sessionIds.length > 0 ? task.sessionIds[task.sessionIds.length - 1] : null);
}

export function getTaskLaneSession(
  task: TaskInfo | null | undefined,
  sessionId: string | null | undefined,
): NonNullable<TaskInfo["laneSessions"]>[number] | undefined {
  if (!task || !sessionId) return undefined;
  return task.laneSessions?.find((entry) => entry.sessionId === sessionId);
}

export function isA2ATaskSession(
  task: TaskInfo | null | undefined,
  sessionId: string | null | undefined,
): boolean {
  if (!sessionId) return false;
  if (getTaskLaneSession(task, sessionId)?.transport === "a2a") {
    return true;
  }
  return sessionId.startsWith("a2a-");
}

export function canSelectTaskSessionInAcp(
  task: TaskInfo | null | undefined,
  sessionId: string | null | undefined,
  sessionMap: Map<string, SessionInfo>,
): boolean {
  if (!sessionId) return false;
  if (isA2ATaskSession(task, sessionId)) return false;
  return sessionMap.has(sessionId);
}

export function taskOwnsSession(task: TaskInfo | null | undefined, sessionId: string | null | undefined): boolean {
  if (!task || !sessionId) return false;
  if (task.triggerSessionId === sessionId) return true;
  if (task.sessionIds?.includes(sessionId)) return true;
  return task.laneSessions?.some((entry) => entry.sessionId === sessionId) ?? false;
}

export function resolveKanbanBoardAutoProviderId(
  board: Pick<KanbanBoardInfo, "autoProviderId"> | null | undefined,
  fallbackProviderId?: string | null,
): string | undefined {
  return normalizeProviderId(board?.autoProviderId) ?? normalizeProviderId(fallbackProviderId);
}

function getProviderDisplayName(providerId: string | undefined, providers: AcpProviderInfo[]): string | undefined {
  if (!providerId) return undefined;
  return providers.find((provider) => provider.id === providerId)?.name ?? providerId;
}

function formatAutoProviderLabel(
  providerId: string | undefined,
  providers: AcpProviderInfo[],
  autoLabel: string,
): string {
  const providerName = getProviderDisplayName(providerId, providers);
  return providerName ? `${autoLabel} (${providerName})` : autoLabel;
}

export function QueueStatusBadge({
  label,
  count,
  cards,
  className,
}: {
  label: string;
  count: number;
  cards: Array<{ cardId: string; cardTitle: string }>;
  className: string;
}) {
  const tooltip = cards.length > 0
    ? `${label}\n${cards.map((card, index) => `${index + 1}. ${card.cardTitle}`).join("\n")}`
    : `${label}\nNo cards`;

  return (
    <span
      className={`group inline-flex h-7 items-center rounded-full px-2 text-[11px] ${className}`}
      title={tooltip}
    >
      {label} {count}
      <span className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-72 rounded-xl border border-gray-200 bg-white p-3 text-left text-xs text-gray-700 shadow-xl group-hover:block dark:border-gray-700 dark:bg-[#12141c] dark:text-gray-200">
        <div className="mb-2 font-semibold text-gray-900 dark:text-gray-100">{label}</div>
        {cards.length > 0 ? (
          <div className="space-y-1">
            {cards.map((card, index) => (
              <div key={card.cardId} className="truncate">
                {index + 1}. {card.cardTitle}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-500 dark:text-gray-400">No cards</div>
        )}
      </span>
    </span>
  );
}

export function formatLaneAutomationSummary(
  automation: ColumnAutomationConfig | undefined,
  providers: AcpProviderInfo[],
  specialists: SpecialistOption[],
  options: {
    autoProviderId?: string;
    autoLabel: string;
  },
): string {
  const resolveSpecialist = createKanbanSpecialistResolver(specialists);
  const steps = getKanbanAutomationSteps(automation);
  const core = steps.map((step) => {
    const resolvedStep = resolveKanbanAutomationStep(step, resolveSpecialist, {
      autoProviderId: options.autoProviderId,
    });
    if (!resolvedStep) {
      return "";
    }
    if (step.transport === "a2a") {
      const specialist = resolvedStep.specialistId || resolvedStep.specialistName
        ? (getSpecialistDisplayName(findSpecialistById(specialists, resolvedStep.specialistId)) ?? resolvedStep.specialistName)
        : null;
      const target = formatAgentCardTarget(resolvedStep.agentCardUrl);
      return [
        "A2A",
        specialist ?? resolvedStep.role ?? "DEVELOPER",
        target,
        resolvedStep.skillId ? `skill:${resolvedStep.skillId}` : null,
      ].filter(Boolean).join(" · ");
    }

    const provider = normalizeProviderId(step.providerId)
      ? getProviderDisplayName(resolvedStep.providerId, providers)
      : resolvedStep.providerSource === "auto"
        ? formatAutoProviderLabel(resolvedStep.providerId, providers, options.autoLabel)
        : resolvedStep.providerSource === "specialist"
          ? (getProviderDisplayName(resolvedStep.providerId, providers) ?? options.autoLabel)
          : options.autoLabel;
    const specialist = resolvedStep.specialistId || resolvedStep.specialistName
      ? (getSpecialistDisplayName(findSpecialistById(specialists, resolvedStep.specialistId)) ?? resolvedStep.specialistName)
      : null;
    return [provider, resolvedStep.role ?? "DEVELOPER", specialist].filter(Boolean).join(" · ");
  }).filter(Boolean).join(" -> ");
  if (automation?.transitionType === "exit") return `${core} ->`;
  if (automation?.transitionType === "both") return `-> ${core} ->`;
  return `-> ${core}`;
}

export function formatLaneAutomationCompactLabel(
  automation: ColumnAutomationConfig | undefined,
  providers: AcpProviderInfo[],
  specialists: SpecialistOption[],
  options: {
    autoProviderId?: string;
    autoLabel: string;
  },
): string {
  const steps = getKanbanAutomationSteps(automation);
  if (steps.length === 0) {
    return options.autoLabel;
  }

  const resolveSpecialist = createKanbanSpecialistResolver(specialists);
  const firstStep = resolveKanbanAutomationStep(steps[0], resolveSpecialist, {
    autoProviderId: options.autoProviderId,
  });

  if (!firstStep) {
    return options.autoLabel;
  }

  if (steps[0]?.transport === "a2a") {
    return [options.autoLabel, "A2A", firstStep.role ?? "DEVELOPER"].filter(Boolean).join(" · ");
  }

  const provider = normalizeProviderId(steps[0]?.providerId)
    ? getProviderDisplayName(firstStep.providerId, providers)
    : firstStep.providerSource === "auto"
      ? formatAutoProviderLabel(firstStep.providerId, providers, options.autoLabel)
      : firstStep.providerSource === "specialist"
        ? (getProviderDisplayName(firstStep.providerId, providers) ?? options.autoLabel)
        : options.autoLabel;

  return [options.autoLabel, provider, firstStep.role ?? "DEVELOPER"].filter(Boolean).join(" · ");
}

function formatAgentCardTarget(agentCardUrl?: string): string | null {
  const trimmed = agentCardUrl?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return `${parsed.hostname}${parsed.pathname !== "/" ? parsed.pathname : ""}`;
  } catch {
    return trimmed.replace(/^https?:\/\//, "");
  }
}

function applySpecialistLanguageToAutomation(
  automation: ColumnAutomationConfig | undefined,
  specialistLanguage: KanbanSpecialistLanguage,
): { automation: ColumnAutomationConfig | undefined; changed: boolean } {
  if (!automation?.enabled) {
    return { automation, changed: false };
  }

  const steps = getKanbanAutomationSteps(automation);
  let changed = false;
  const localizedSteps = steps.map((step) => {
    const nextLocale = step.specialistId ? specialistLanguage : undefined;
    if (step.specialistLocale === nextLocale) {
      return step;
    }
    changed = true;
    return {
      ...step,
      specialistLocale: nextLocale,
    };
  });

  if (!changed) {
    return { automation, changed: false };
  }

  return {
    automation: normalizeKanbanAutomation({
      ...automation,
      steps: localizedSteps,
      specialistLocale: localizedSteps[0]?.specialistLocale,
    }),
    changed: true,
  };
}

export function applySpecialistLanguageToBoardColumns(
  columns: KanbanBoardInfo["columns"],
  specialistLanguage: KanbanSpecialistLanguage,
): { columns: KanbanBoardInfo["columns"]; changed: boolean } {
  let changed = false;
  const localizedColumns = columns.map((column) => {
    const localized = applySpecialistLanguageToAutomation(column.automation, specialistLanguage);
    if (!localized.changed) {
      return column;
    }
    changed = true;
    return {
      ...column,
      automation: localized.automation,
    };
  });

  return { columns: localizedColumns, changed };
}
