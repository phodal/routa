import type {
  KanbanHistoryMemoryPolicy,
  KanbanHistoryMemoryPolicyConfidence,
  KanbanHistoryMemoryPolicyMode,
} from "../models/kanban";
import { DEFAULT_KANBAN_HISTORY_MEMORY_POLICY } from "../models/kanban";

const VALID_MODES = new Set<KanbanHistoryMemoryPolicyMode>(["off", "auto", "force"]);
const VALID_CONFIDENCE = new Set<KanbanHistoryMemoryPolicyConfidence>(["low", "medium", "high"]);
const CONFIDENCE_RANK: Record<KanbanHistoryMemoryPolicyConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function metadataKey(boardId: string): string {
  return `kanbanHistoryMemoryPolicy:${boardId}`;
}

function normalizeMode(value: unknown): KanbanHistoryMemoryPolicyMode {
  return VALID_MODES.has(value as KanbanHistoryMemoryPolicyMode)
    ? value as KanbanHistoryMemoryPolicyMode
    : DEFAULT_KANBAN_HISTORY_MEMORY_POLICY.mode;
}

function normalizeThreshold(
  value: unknown,
  fallback: number,
  max: number,
): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(max, Math.floor(parsed)));
}

function normalizeConfidence(value: unknown): KanbanHistoryMemoryPolicyConfidence {
  return VALID_CONFIDENCE.has(value as KanbanHistoryMemoryPolicyConfidence)
    ? value as KanbanHistoryMemoryPolicyConfidence
    : DEFAULT_KANBAN_HISTORY_MEMORY_POLICY.minConfidence;
}

export function normalizeKanbanHistoryMemoryPolicy(
  policy: Partial<KanbanHistoryMemoryPolicy> | undefined,
): KanbanHistoryMemoryPolicy {
  return {
    mode: normalizeMode(policy?.mode),
    minMatchedSessions: normalizeThreshold(
      policy?.minMatchedSessions,
      DEFAULT_KANBAN_HISTORY_MEMORY_POLICY.minMatchedSessions,
      20,
    ),
    minMatchedFiles: normalizeThreshold(
      policy?.minMatchedFiles,
      DEFAULT_KANBAN_HISTORY_MEMORY_POLICY.minMatchedFiles,
      50,
    ),
    minFeatureCandidates: normalizeThreshold(
      policy?.minFeatureCandidates,
      DEFAULT_KANBAN_HISTORY_MEMORY_POLICY.minFeatureCandidates,
      20,
    ),
    minConfidence: normalizeConfidence(policy?.minConfidence),
  };
}

export function getKanbanHistoryMemoryPolicy(
  metadata: Record<string, string> | undefined,
  boardId: string,
): KanbanHistoryMemoryPolicy {
  const raw = metadata?.[metadataKey(boardId)];
  if (!raw) {
    return { ...DEFAULT_KANBAN_HISTORY_MEMORY_POLICY };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<KanbanHistoryMemoryPolicy>;
    return normalizeKanbanHistoryMemoryPolicy(parsed);
  } catch {
    return { ...DEFAULT_KANBAN_HISTORY_MEMORY_POLICY };
  }
}

export function setKanbanHistoryMemoryPolicy(
  metadata: Record<string, string> | undefined,
  boardId: string,
  policy: Partial<KanbanHistoryMemoryPolicy> | undefined,
): Record<string, string> {
  const normalized = normalizeKanbanHistoryMemoryPolicy(policy);
  return {
    ...(metadata ?? {}),
    [metadataKey(boardId)]: JSON.stringify(normalized),
  };
}

export function getDefaultKanbanHistoryMemoryPolicy(): KanbanHistoryMemoryPolicy {
  return { ...DEFAULT_KANBAN_HISTORY_MEMORY_POLICY };
}

export interface KanbanHistoryMemoryInjectionSignals {
  featureCount: number;
  matchedSessions: number;
  matchedFiles: number;
  confidence?: KanbanHistoryMemoryPolicyConfidence | null;
}

export function shouldInjectKanbanHistoryMemory(
  policy: KanbanHistoryMemoryPolicy | undefined,
  signals: KanbanHistoryMemoryInjectionSignals,
): boolean {
  const normalizedPolicy = normalizeKanbanHistoryMemoryPolicy(policy);
  if (normalizedPolicy.mode === "off") {
    return false;
  }
  if (normalizedPolicy.mode === "force") {
    return true;
  }

  const confidence = signals.confidence ?? "low";
  return signals.featureCount >= normalizedPolicy.minFeatureCandidates
    && (
      signals.matchedSessions >= normalizedPolicy.minMatchedSessions
      || signals.matchedFiles >= normalizedPolicy.minMatchedFiles
    )
    && CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK[normalizedPolicy.minConfidence];
}
