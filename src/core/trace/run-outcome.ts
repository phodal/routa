import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentRole } from "../models/agent";
import {
  TaskStatus,
  type Task,
  type TaskLaneSession,
  VerificationVerdict,
} from "../models/task";
import { getTracesDir } from "../storage/folder-slug";
import type { TraceRecord } from "./types";
import type { TraceRunDigest, VerificationSignal } from "./trace-run-digest";
import { getVcsContextSync } from "./vcs-context";

export type TaskType =
  | "kanban_card"
  | "harness_evolution"
  | "review_flow"
  | "general_session"
  | "specialist_delegation";

export type OutcomeStatus = "success" | "failure" | "partial" | "cancelled" | "unknown";

export interface CardFingerprint {
  boardId?: string;
  columnId?: string;
  taskId?: string;
  labels?: string[];
  priority?: string;
  creationSource?: string;
}

export interface EvidenceBundle {
  testsRan: boolean;
  testsPassed: boolean;
  lintPassed: boolean;
  buildSucceeded: boolean;
  reviewApproved?: boolean;
  typeCheckPassed?: boolean;
  fitnessChecksPassed?: boolean;
  securityScanPassed?: boolean;
}

export interface LaneTransition {
  from: string;
  to: string;
  reason?: string;
  timestamp: string;
}

export interface RunOutcome {
  id: string;
  fingerprint: string;
  sessionId: string;
  taskId: string;
  taskTitle: string;
  taskType: TaskType;
  workspaceId: string;
  role: AgentRole;
  cardFingerprint?: CardFingerprint;
  repoRoot?: string;
  branch?: string;
  revision?: string;
  changedFiles: string[];
  toolSequence: string[];
  evidenceBundle: EvidenceBundle;
  outcome: OutcomeStatus;
  failureMode?: string;
  recoveryActions?: string[];
  laneTransitions?: LaneTransition[];
  loopDetected?: boolean;
  bouncePattern?: string[];
  timestamp: string;
  duration?: number;
  contributor?: {
    provider: string;
    model?: string;
  };
  verificationVerdict?: string | null;
  digest: TraceRunDigest;
}

export interface BuildRunOutcomeParams {
  cwd: string;
  task?: Task;
  taskId: string;
  sessionId: string;
  workspaceId: string;
  role: AgentRole;
  provider: string;
  model?: string;
  traces: TraceRecord[];
  digest: TraceRunDigest;
  timestamp?: string;
}

const LEDGER_FILE = "trace-ledger.jsonl";

const TEST_KEYWORDS = ["test", "vitest", "jest", "pytest", "cargo test", "npm test", "pnpm test", "bun test"];
const LINT_KEYWORDS = ["lint", "eslint", "stylelint", "ruff check"];
const TYPECHECK_KEYWORDS = ["tsc", "typecheck", "type-check", "cargo check", "mypy"];
const BUILD_KEYWORDS = ["build", "compile", "next build", "cargo build"];
const FITNESS_KEYWORDS = ["entrix", "fitness", "contract", "api:test", "api:check"];
const SECURITY_KEYWORDS = ["semgrep", "trivy", "security", "hadolint", "audit", "snyk"];

type SignalBucket = { total: number; failures: number };

interface LaneSummary {
  transitions: LaneTransition[];
  pattern: string[];
  loopDetected: boolean;
}

export function buildTaskFingerprint(
  task: Pick<Task, "workspaceId" | "title" | "scope" | "acceptanceCriteria"> & Partial<Pick<Task, "boardId" | "columnId" | "labels">>,
  fallbackWorkspaceId?: string,
): string {
  const workspace = task.workspaceId ?? fallbackWorkspaceId ?? "workspace-unknown";
  const scope = task.scope ?? "";
  const acceptance = Array.isArray(task.acceptanceCriteria)
    ? task.acceptanceCriteria.join("|")
    : "";
  const labels = Array.isArray(task.labels) ? [...task.labels].sort().join("|") : "";
  const boardId = task.boardId ?? "";
  const columnId = task.columnId ?? "";
  const key = `${workspace}::${task.title}::${scope}::${acceptance}::${boardId}::${columnId}::${labels}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

export function determineOutcome(task?: Task): OutcomeStatus {
  if (!task) {
    return "unknown";
  }

  if (task.status === TaskStatus.CANCELLED) {
    return "cancelled";
  }

  const approved =
    task.verificationVerdict === undefined
    || task.verificationVerdict === null
    || task.verificationVerdict === VerificationVerdict.APPROVED;

  if (task.status === TaskStatus.COMPLETED && approved) {
    return "success";
  }

  if (
    task.status === TaskStatus.NEEDS_FIX
    || task.status === TaskStatus.BLOCKED
    || task.verificationVerdict === VerificationVerdict.NOT_APPROVED
  ) {
    return "failure";
  }

  if (
    task.status === TaskStatus.IN_PROGRESS
    || task.status === TaskStatus.PENDING
    || task.status === TaskStatus.REVIEW_REQUIRED
  ) {
    return "partial";
  }

  return "unknown";
}

export function buildRunOutcome(params: BuildRunOutcomeParams): RunOutcome {
  const fingerprintSource = params.task ?? {
    workspaceId: params.workspaceId,
    title: params.taskId,
    scope: "",
    acceptanceCriteria: [],
    boardId: undefined,
    columnId: undefined,
    labels: [],
  };
  const laneSummary = buildLaneSummary(params.task?.laneSessions);
  const evidenceBundle = buildEvidenceBundle(params.task, params.digest.verificationSignals);
  const vcs = getVcsContextSync(params.cwd);

  return {
    id: createOutcomeId(),
    fingerprint: buildTaskFingerprint(fingerprintSource, params.workspaceId),
    sessionId: params.sessionId,
    taskId: params.taskId,
    taskTitle: params.task?.title ?? params.taskId,
    taskType: inferTaskType(params.task, params.role),
    workspaceId: params.task?.workspaceId ?? params.workspaceId,
    role: params.role,
    cardFingerprint: buildCardFingerprint(params.task),
    repoRoot: vcs?.repoRoot,
    branch: vcs?.branch,
    revision: vcs?.revision,
    changedFiles: collectChangedFiles(params.traces, params.digest),
    toolSequence: collectToolSequence(params.traces, params.digest),
    evidenceBundle,
    outcome: determineOutcome(params.task),
    failureMode: deriveFailureMode(params.task, evidenceBundle, params.digest, laneSummary.loopDetected),
    recoveryActions: collectRecoveryActions(params.task?.laneSessions),
    laneTransitions: laneSummary.transitions.length > 0 ? laneSummary.transitions : undefined,
    loopDetected: laneSummary.loopDetected || undefined,
    bouncePattern: laneSummary.pattern.length > 1 ? laneSummary.pattern : undefined,
    timestamp: params.timestamp ?? new Date().toISOString(),
    duration: deriveDurationMs(params.digest),
    contributor: {
      provider: params.provider,
      model: params.model,
    },
    verificationVerdict: params.task?.verificationVerdict ?? null,
    digest: params.digest,
  };
}

export async function saveRunOutcome(cwd: string, outcome: RunOutcome): Promise<void> {
  const ledgerDir = path.join(getTracesDir(cwd), "ledger");
  await fs.mkdir(ledgerDir, { recursive: true });
  const ledgerPath = path.join(ledgerDir, LEDGER_FILE);
  await fs.appendFile(ledgerPath, `${JSON.stringify(outcome)}\n`, "utf-8");
}

export async function readRunOutcomes(cwd: string): Promise<RunOutcome[]> {
  const ledgerPath = path.join(getTracesDir(cwd), "ledger", LEDGER_FILE);
  try {
    const content = await fs.readFile(ledgerPath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as RunOutcome);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function readRunOutcomesByFingerprint(
  cwd: string,
  fingerprint: string,
): Promise<RunOutcome[]> {
  const outcomes = await readRunOutcomes(cwd);
  return outcomes.filter((outcome) => outcome.fingerprint === fingerprint);
}

function createOutcomeId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `trace-outcome-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function inferTaskType(task: Task | undefined, role: AgentRole): TaskType {
  if (task?.boardId || task?.columnId) {
    return "kanban_card";
  }

  if (task?.verificationVerdict && task.status === TaskStatus.REVIEW_REQUIRED) {
    return "review_flow";
  }

  if (role) {
    return "specialist_delegation";
  }

  return "general_session";
}

function buildCardFingerprint(task?: Task): CardFingerprint | undefined {
  if (!task) {
    return undefined;
  }

  return {
    boardId: task.boardId,
    columnId: task.columnId,
    taskId: task.id,
    labels: task.labels,
    priority: task.priority,
    creationSource: task.creationSource,
  };
}

function collectChangedFiles(traces: TraceRecord[], digest: TraceRunDigest): string[] {
  const changed = new Set<string>();

  for (const trace of traces) {
    for (const file of trace.files ?? []) {
      if (file.operation && file.operation !== "read") {
        changed.add(file.path);
      }
    }
  }

  if (changed.size === 0) {
    for (const file of digest.filesTouched) {
      if (file.operations.some((operation) => operation !== "read")) {
        changed.add(file.path);
      }
    }
  }

  return Array.from(changed).sort();
}

function collectToolSequence(traces: TraceRecord[], digest: TraceRunDigest): string[] {
  const tools: string[] = [];
  const seen = new Set<string>();

  for (const trace of traces) {
    if (trace.eventType !== "tool_call" || !trace.tool?.name) {
      continue;
    }
    if (seen.has(trace.tool.name)) {
      continue;
    }
    seen.add(trace.tool.name);
    tools.push(trace.tool.name);
  }

  if (tools.length > 0) {
    return tools;
  }

  return digest.toolCalls.map((tool) => tool.name);
}

function buildEvidenceBundle(
  task: Task | undefined,
  verificationSignals: VerificationSignal[],
): EvidenceBundle {
  const tests = summarizeSignals(verificationSignals, TEST_KEYWORDS);
  const lint = summarizeSignals(verificationSignals, LINT_KEYWORDS);
  const typeCheck = summarizeSignals(verificationSignals, TYPECHECK_KEYWORDS);
  const build = summarizeSignals(verificationSignals, BUILD_KEYWORDS);
  const fitness = summarizeSignals(verificationSignals, FITNESS_KEYWORDS);
  const security = summarizeSignals(verificationSignals, SECURITY_KEYWORDS);

  return {
    testsRan: tests.total > 0,
    testsPassed: tests.total > 0 && tests.failures === 0,
    lintPassed: lint.total > 0 && lint.failures === 0,
    buildSucceeded: build.total > 0 && build.failures === 0,
    reviewApproved: task?.verificationVerdict === VerificationVerdict.APPROVED,
    typeCheckPassed: typeCheck.total > 0 ? typeCheck.failures === 0 : undefined,
    fitnessChecksPassed: fitness.total > 0 ? fitness.failures === 0 : undefined,
    securityScanPassed: security.total > 0 ? security.failures === 0 : undefined,
  };
}

function summarizeSignals(signals: VerificationSignal[], keywords: string[]): SignalBucket {
  return signals.reduce<SignalBucket>((bucket, signal) => {
    const normalized = signal.command.toLowerCase();
    if (!keywords.some((keyword) => normalized.includes(keyword))) {
      return bucket;
    }
    bucket.total += 1;
    if (!signal.passed) {
      bucket.failures += 1;
    }
    return bucket;
  }, { total: 0, failures: 0 });
}

function deriveFailureMode(
  task: Task | undefined,
  evidenceBundle: EvidenceBundle,
  digest: TraceRunDigest,
  loopDetected: boolean,
): string | undefined {
  const lint = summarizeSignals(digest.verificationSignals, LINT_KEYWORDS);
  const typeCheck = summarizeSignals(digest.verificationSignals, TYPECHECK_KEYWORDS);
  const build = summarizeSignals(digest.verificationSignals, BUILD_KEYWORDS);
  const fitness = summarizeSignals(digest.verificationSignals, FITNESS_KEYWORDS);
  const security = summarizeSignals(digest.verificationSignals, SECURITY_KEYWORDS);

  if (task?.verificationVerdict === VerificationVerdict.NOT_APPROVED) {
    return "review_not_approved";
  }

  if (evidenceBundle.testsRan && !evidenceBundle.testsPassed) {
    return "test_failure";
  }

  if (lint.total > 0 && lint.failures > 0) {
    return "lint_failure";
  }

  if (typeCheck.total > 0 && typeCheck.failures > 0) {
    return "typecheck_failure";
  }

  if (build.total > 0 && build.failures > 0) {
    return "build_failure";
  }

  if (fitness.total > 0 && fitness.failures > 0) {
    return "fitness_failure";
  }

  if (security.total > 0 && security.failures > 0) {
    return "security_failure";
  }

  if (loopDetected) {
    return "lane_loop";
  }

  if (task?.status === TaskStatus.BLOCKED) {
    return "task_blocked";
  }

  if (digest.errorCount > 0) {
    return "tool_failure";
  }

  return undefined;
}

function collectRecoveryActions(laneSessions: TaskLaneSession[] | undefined): string[] | undefined {
  if (!laneSessions || laneSessions.length === 0) {
    return undefined;
  }

  const actions = laneSessions
    .flatMap((session) => session.recoveryReason ? [session.recoveryReason] : []);
  return actions.length > 0 ? Array.from(new Set(actions)) : undefined;
}

function buildLaneSummary(laneSessions: TaskLaneSession[] | undefined): LaneSummary {
  if (!laneSessions || laneSessions.length === 0) {
    return { transitions: [], pattern: [], loopDetected: false };
  }

  const ordered = [...laneSessions].sort((left, right) =>
    Date.parse(left.startedAt) - Date.parse(right.startedAt),
  );
  const transitions: LaneTransition[] = [];
  const pattern: string[] = [];

  for (const session of ordered) {
    const columnId = session.columnId?.trim();
    if (!columnId) {
      continue;
    }

    if (pattern[pattern.length - 1] !== columnId) {
      pattern.push(columnId);
    }

    const previousColumn = pattern.length >= 2 ? pattern[pattern.length - 2] : undefined;
    if (previousColumn && previousColumn !== columnId) {
      transitions.push({
        from: previousColumn,
        to: columnId,
        reason: session.recoveryReason ?? session.status,
        timestamp: session.startedAt,
      });
    }
  }

  const seen = new Set<string>();
  let loopDetected = false;
  for (const columnId of pattern) {
    if (seen.has(columnId)) {
      loopDetected = true;
      break;
    }
    seen.add(columnId);
  }

  return { transitions, pattern, loopDetected };
}

function deriveDurationMs(digest: TraceRunDigest): number | undefined {
  if (!digest.timeRange) {
    return undefined;
  }

  const start = Date.parse(digest.timeRange.start);
  const end = Date.parse(digest.timeRange.end);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return undefined;
  }

  return end - start;
}