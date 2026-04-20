/**
 * Structured types for global Kanban flow analysis.
 *
 * These types represent aggregated cross-task/cross-board flow patterns
 * detected by the flow ledger service. They are consumed by:
 * - The kanban-flow-analyst specialist for AI diagnosis
 * - The flow diagnostics API for workspace-level reporting
 * - The agent-trigger prompt builder for preflight guidance injection
 */

/** A detected bounce pattern: tasks repeatedly moving between two columns. */
export interface BouncePattern {
  fromColumnId: string;
  toColumnId: string;
  /** Number of tasks exhibiting this bounce */
  occurrences: number;
  /** Task IDs that bounced on this path */
  taskIds: string[];
  /** Average number of bounces per affected task */
  avgBounceCount: number;
}

/** Aggregated metrics for a single lane/column. */
export interface LaneMetrics {
  columnId: string;
  columnName?: string;
  /** Total sessions that entered this lane */
  totalSessions: number;
  /** Sessions that completed successfully */
  completedSessions: number;
  /** Sessions that failed or timed out */
  failedSessions: number;
  /** Sessions recovered via watchdog or loop */
  recoveredSessions: number;
  /** Average session duration in milliseconds (completed only) */
  avgDurationMs: number;
  /** Median session duration in milliseconds (completed only) */
  medianDurationMs: number;
  /** Failure rate as a fraction 0–1 */
  failureRate: number;
  /** Recovery rate as a fraction 0–1 */
  recoveryRate: number;
}

/** A failure hotspot: a lane with disproportionate failures. */
export interface FailureHotspot {
  columnId: string;
  columnName?: string;
  failureCount: number;
  timeoutCount: number;
  /** Most common recovery reasons in this lane */
  topRecoveryReasons: { reason: string; count: number }[];
}

/** Handoff friction report between two adjacent lanes. */
export interface HandoffFriction {
  fromColumnId: string;
  toColumnId: string;
  totalHandoffs: number;
  blockedHandoffs: number;
  failedHandoffs: number;
  /** Average time from request to response in milliseconds */
  avgResponseTimeMs: number;
  /** Fraction of handoffs that were blocked or failed */
  frictionRate: number;
}

/** A single actionable guidance item derived from flow analysis. */
export interface FlowGuidanceItem {
  /** e.g., "bounce_pattern", "failure_hotspot", "handoff_friction", "lane_bottleneck" */
  category: string;
  severity: "info" | "warning" | "critical";
  /** Human-readable summary */
  summary: string;
  /** Suggested action or mitigation */
  recommendation: string;
  /** Related column IDs */
  affectedColumns: string[];
}

/** Complete flow diagnosis report for a board or workspace. */
export interface FlowDiagnosisReport {
  boardId?: string;
  workspaceId: string;
  analyzedAt: string;
  /** Time window used for analysis */
  windowStart?: string;
  windowEnd?: string;
  taskCount: number;
  sessionCount: number;
  bouncePatterns: BouncePattern[];
  laneMetrics: LaneMetrics[];
  failureHotspots: FailureHotspot[];
  handoffFriction: HandoffFriction[];
  guidance: FlowGuidanceItem[];
}
