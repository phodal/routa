/**
 * Trace Learning - Normalized run outcome types for learning from execution patterns.
 *
 * Extends the existing trace infrastructure to capture high-level run outcomes
 * that can be analyzed for pattern detection and playbook generation.
 *
 * Related: Issue #294 - Trace learning for self-improving agents
 */

/**
 * Task type classification for learning.
 */
export type TaskType =
  | "kanban_card"
  | "harness_evolution"
  | "review_flow"
  | "general_session"
  | "specialist_delegation";

/**
 * Final outcome of a run/session.
 */
export type OutcomeStatus = "success" | "failure" | "partial" | "cancelled";

/**
 * Card fingerprint for Kanban task patterns.
 */
export interface CardFingerprint {
  /** Board ID */
  boardId?: string;
  /** Column/lane ID */
  columnId?: string;
  /** Task ID */
  taskId?: string;
  /** Labels attached to the card */
  labels?: string[];
  /** Task priority */
  priority?: string;
  /** Creation source */
  creationSource?: string;
}

/**
 * Evidence bundle capturing key verification signals.
 */
export interface EvidenceBundle {
  /** Tests were executed */
  testsRan: boolean;
  /** All tests passed */
  testsPassed: boolean;
  /** Linter passed */
  lintPassed: boolean;
  /** Build succeeded */
  buildSucceeded: boolean;
  /** Review approved (for review flows) */
  reviewApproved?: boolean;
  /** Type checking passed */
  typeCheckPassed?: boolean;
  /** Fitness checks passed */
  fitnessChecksPassed?: boolean;
  /** Security scan passed */
  securityScanPassed?: boolean;
}

/**
 * Lane transition for Kanban flow learning.
 */
export interface LaneTransition {
  /** Source lane/column */
  from: string;
  /** Target lane/column */
  to: string;
  /** Reason for transition */
  reason?: string;
  /** Timestamp of transition */
  timestamp: string;
}

/**
 * Normalized run outcome record for trace learning.
 *
 * This is the primary unit of learning - each completed session/task
 * should emit one RunOutcome that captures what happened and why.
 */
export interface RunOutcome {
  /** Unique ID for this outcome */
  id: string;
  /** Session ID this outcome is for */
  sessionId: string;
  /** Task type classification */
  taskType: TaskType;
  /** Workspace ID */
  workspaceId: string;
  /** Card fingerprint (for Kanban tasks) */
  cardFingerprint?: CardFingerprint;
  /** Repository root path */
  repoRoot?: string;
  /** Git branch */
  branch?: string;
  /** Git revision (commit SHA) */
  revision?: string;
  /** Files changed during the session */
  changedFiles: string[];
  /** Tool call sequence (ordered list of tool names) */
  toolSequence: string[];
  /** Evidence bundle from verification steps */
  evidenceBundle: EvidenceBundle;
  /** Final outcome status */
  outcome: OutcomeStatus;
  /** Failure mode (if outcome is failure) */
  failureMode?: string;
  /** Recovery actions taken */
  recoveryActions?: string[];
  /** Lane transitions (for Kanban flow learning) */
  laneTransitions?: LaneTransition[];
  /** Loop detected (for bounce pattern detection) */
  loopDetected?: boolean;
  /** Bounce pattern sequence (e.g., ['dev', 'review', 'dev', 'review']) */
  bouncePattern?: string[];
  /** ISO 8601 timestamp when outcome was recorded */
  timestamp: string;
  /** Session duration in milliseconds */
  duration?: number;
  /** Contributor (model/provider) */
  contributor?: {
    provider: string;
    model?: string;
  };
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Create a new RunOutcome with defaults.
 */
export function createRunOutcome(
  sessionId: string,
  taskType: TaskType,
  workspaceId: string,
  outcome: OutcomeStatus
): RunOutcome {
  return {
    id: crypto.randomUUID(),
    sessionId,
    taskType,
    workspaceId,
    outcome,
    changedFiles: [],
    toolSequence: [],
    evidenceBundle: {
      testsRan: false,
      testsPassed: false,
      lintPassed: false,
      buildSucceeded: false,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Builder-style functions for RunOutcome.
 */

export function withCardFingerprint(
  outcome: RunOutcome,
  fingerprint: CardFingerprint
): RunOutcome {
  return { ...outcome, cardFingerprint: fingerprint };
}

export function withRepoContext(
  outcome: RunOutcome,
  repoRoot: string,
  branch?: string,
  revision?: string
): RunOutcome {
  return { ...outcome, repoRoot, branch, revision };
}

export function withChangedFiles(outcome: RunOutcome, files: string[]): RunOutcome {
  return { ...outcome, changedFiles: files };
}

export function withToolSequence(outcome: RunOutcome, tools: string[]): RunOutcome {
  return { ...outcome, toolSequence: tools };
}

export function withEvidence(outcome: RunOutcome, evidence: Partial<EvidenceBundle>): RunOutcome {
  return {
    ...outcome,
    evidenceBundle: { ...outcome.evidenceBundle, ...evidence },
  };
}

export function withFailureMode(outcome: RunOutcome, mode: string): RunOutcome {
  return { ...outcome, failureMode: mode };
}

export function withRecoveryActions(outcome: RunOutcome, actions: string[]): RunOutcome {
  return { ...outcome, recoveryActions: actions };
}

export function withLaneTransitions(
  outcome: RunOutcome,
  transitions: LaneTransition[]
): RunOutcome {
  return { ...outcome, laneTransitions: transitions };
}

export function withBouncePattern(
  outcome: RunOutcome,
  pattern: string[],
  loopDetected: boolean
): RunOutcome {
  return { ...outcome, bouncePattern: pattern, loopDetected };
}

export function withDuration(outcome: RunOutcome, duration: number): RunOutcome {
  return { ...outcome, duration };
}

export function withContributor(
  outcome: RunOutcome,
  provider: string,
  model?: string
): RunOutcome {
  return { ...outcome, contributor: { provider, model } };
}

export function withMetadata(outcome: RunOutcome, key: string, value: unknown): RunOutcome {
  const metadata = outcome.metadata ?? {};
  return { ...outcome, metadata: { ...metadata, [key]: value } };
}
