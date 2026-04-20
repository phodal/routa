import type { Task, TaskLaneSession, TaskLaneHandoff } from "../models/task";
import type {
  BouncePattern,
  FailureHotspot,
  FlowDiagnosisReport,
  FlowGuidanceItem,
  HandoffFriction,
  LaneMetrics,
} from "./flow-ledger-types";

/**
 * Aggregates lane sessions and handoffs across tasks to produce a
 * structured flow analysis report. Pure computation — no side effects.
 */
export function analyzeFlowForTasks(
  tasks: Task[],
  options: { workspaceId: string; boardId?: string; windowStart?: string; windowEnd?: string },
): FlowDiagnosisReport {
  const windowStart = options.windowStart ? new Date(options.windowStart).getTime() : undefined;
  const windowEnd = options.windowEnd ? new Date(options.windowEnd).getTime() : undefined;

  // Collect all sessions and handoffs from the task set, filtered by time window
  const allSessions: { session: TaskLaneSession; taskId: string }[] = [];
  const allHandoffs: { handoff: TaskLaneHandoff; taskId: string }[] = [];

  for (const task of tasks) {
    for (const session of task.laneSessions ?? []) {
      const startTs = new Date(session.startedAt).getTime();
      if (windowStart && startTs < windowStart) continue;
      if (windowEnd && startTs > windowEnd) continue;
      allSessions.push({ session, taskId: task.id });
    }
    for (const handoff of task.laneHandoffs ?? []) {
      const requestTs = new Date(handoff.requestedAt).getTime();
      if (windowStart && requestTs < windowStart) continue;
      if (windowEnd && requestTs > windowEnd) continue;
      allHandoffs.push({ handoff, taskId: task.id });
    }
  }

  const bouncePatterns = detectBouncePatterns(tasks, windowStart, windowEnd);
  const laneMetrics = computeLaneMetrics(allSessions);
  const failureHotspots = detectFailureHotspots(allSessions);
  const handoffFriction = computeHandoffFriction(allHandoffs);
  const guidance = deriveGuidance(bouncePatterns, laneMetrics, failureHotspots, handoffFriction);

  return {
    boardId: options.boardId,
    workspaceId: options.workspaceId,
    analyzedAt: new Date().toISOString(),
    windowStart: options.windowStart,
    windowEnd: options.windowEnd,
    taskCount: tasks.length,
    sessionCount: allSessions.length,
    bouncePatterns,
    laneMetrics,
    failureHotspots,
    handoffFriction,
    guidance,
  };
}

// ---------------------------------------------------------------------------
// Bounce Pattern Detection
// ---------------------------------------------------------------------------

function detectBouncePatterns(
  tasks: Task[],
  windowStart?: number,
  windowEnd?: number,
): BouncePattern[] {
  // A "bounce" is when a task enters column A, then B, then A again.
  // We track consecutive column transitions per task.
  const pairCounts = new Map<string, { occurrences: Set<string>; totalBounces: number }>();

  for (const task of tasks) {
    const sessions = (task.laneSessions ?? [])
      .filter((s) => {
        const ts = new Date(s.startedAt).getTime();
        if (windowStart && ts < windowStart) return false;
        if (windowEnd && ts > windowEnd) return false;
        return true;
      })
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    // Build column sequence (deduplicate consecutive same-column entries)
    const columnSeq: string[] = [];
    for (const s of sessions) {
      const col = s.columnId ?? "unknown";
      if (columnSeq.length === 0 || columnSeq[columnSeq.length - 1] !== col) {
        columnSeq.push(col);
      }
    }

    // Detect A→B→A patterns
    for (let i = 0; i + 2 < columnSeq.length; i++) {
      if (columnSeq[i] === columnSeq[i + 2]) {
        const key = `${columnSeq[i + 1]}→${columnSeq[i]}`;
        let entry = pairCounts.get(key);
        if (!entry) {
          entry = { occurrences: new Set(), totalBounces: 0 };
          pairCounts.set(key, entry);
        }
        entry.occurrences.add(task.id);
        entry.totalBounces++;
      }
    }
  }

  return Array.from(pairCounts.entries())
    .map(([key, value]) => {
      const [fromColumnId, toColumnId] = key.split("→");
      const taskIds = Array.from(value.occurrences);
      return {
        fromColumnId,
        toColumnId,
        occurrences: taskIds.length,
        taskIds,
        avgBounceCount: value.totalBounces / taskIds.length,
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences);
}

// ---------------------------------------------------------------------------
// Lane Metrics
// ---------------------------------------------------------------------------

function computeLaneMetrics(sessions: { session: TaskLaneSession; taskId: string }[]): LaneMetrics[] {
  const byColumn = new Map<string, { sessions: TaskLaneSession[]; name?: string }>();

  for (const { session } of sessions) {
    const col = session.columnId ?? "unknown";
    let entry = byColumn.get(col);
    if (!entry) {
      entry = { sessions: [], name: session.columnName };
      byColumn.set(col, entry);
    }
    entry.sessions.push(session);
    if (!entry.name && session.columnName) {
      entry.name = session.columnName;
    }
  }

  return Array.from(byColumn.entries()).map(([columnId, { sessions: colSessions, name }]) => {
    const completed = colSessions.filter((s) => s.status === "completed" || s.status === "transitioned");
    const failed = colSessions.filter((s) => s.status === "failed" || s.status === "timed_out");
    const recovered = colSessions.filter((s) => s.recoveredFromSessionId);

    const durations = completed
      .filter((s) => s.completedAt)
      .map((s) => new Date(s.completedAt!).getTime() - new Date(s.startedAt).getTime())
      .filter((d) => d >= 0)
      .sort((a, b) => a - b);

    const avgDurationMs = durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

    const medianDurationMs = durations.length > 0
      ? durations[Math.floor(durations.length / 2)]
      : 0;

    return {
      columnId,
      columnName: name,
      totalSessions: colSessions.length,
      completedSessions: completed.length,
      failedSessions: failed.length,
      recoveredSessions: recovered.length,
      avgDurationMs: Math.round(avgDurationMs),
      medianDurationMs: Math.round(medianDurationMs),
      failureRate: colSessions.length > 0 ? failed.length / colSessions.length : 0,
      recoveryRate: colSessions.length > 0 ? recovered.length / colSessions.length : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Failure Hotspots
// ---------------------------------------------------------------------------

function detectFailureHotspots(
  sessions: { session: TaskLaneSession; taskId: string }[],
): FailureHotspot[] {
  const byColumn = new Map<string, {
    name?: string;
    failureCount: number;
    timeoutCount: number;
    recoveryReasons: Map<string, number>;
  }>();

  for (const { session } of sessions) {
    const col = session.columnId ?? "unknown";
    let entry = byColumn.get(col);
    if (!entry) {
      entry = { failureCount: 0, timeoutCount: 0, recoveryReasons: new Map(), name: session.columnName };
      byColumn.set(col, entry);
    }
    if (session.status === "failed") entry.failureCount++;
    if (session.status === "timed_out") entry.timeoutCount++;
    if (session.recoveryReason) {
      entry.recoveryReasons.set(
        session.recoveryReason,
        (entry.recoveryReasons.get(session.recoveryReason) ?? 0) + 1,
      );
    }
  }

  return Array.from(byColumn.entries())
    .filter(([, v]) => v.failureCount + v.timeoutCount > 0)
    .map(([columnId, v]) => ({
      columnId,
      columnName: v.name,
      failureCount: v.failureCount,
      timeoutCount: v.timeoutCount,
      topRecoveryReasons: Array.from(v.recoveryReasons.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => (b.failureCount + b.timeoutCount) - (a.failureCount + a.timeoutCount));
}

// ---------------------------------------------------------------------------
// Handoff Friction
// ---------------------------------------------------------------------------

function computeHandoffFriction(
  handoffs: { handoff: TaskLaneHandoff; taskId: string }[],
): HandoffFriction[] {
  const byPair = new Map<string, {
    fromColumnId: string;
    toColumnId: string;
    total: number;
    blocked: number;
    failed: number;
    responseTimes: number[];
  }>();

  for (const { handoff } of handoffs) {
    const from = handoff.fromColumnId ?? "unknown";
    const to = handoff.toColumnId ?? "unknown";
    const key = `${from}→${to}`;
    let entry = byPair.get(key);
    if (!entry) {
      entry = { fromColumnId: from, toColumnId: to, total: 0, blocked: 0, failed: 0, responseTimes: [] };
      byPair.set(key, entry);
    }
    entry.total++;
    if (handoff.status === "blocked") entry.blocked++;
    if (handoff.status === "failed") entry.failed++;
    if (handoff.respondedAt) {
      const elapsed = new Date(handoff.respondedAt).getTime() - new Date(handoff.requestedAt).getTime();
      if (elapsed >= 0) entry.responseTimes.push(elapsed);
    }
  }

  return Array.from(byPair.values()).map((entry) => {
    const avgResponseTimeMs = entry.responseTimes.length > 0
      ? Math.round(entry.responseTimes.reduce((a, b) => a + b, 0) / entry.responseTimes.length)
      : 0;
    return {
      fromColumnId: entry.fromColumnId,
      toColumnId: entry.toColumnId,
      totalHandoffs: entry.total,
      blockedHandoffs: entry.blocked,
      failedHandoffs: entry.failed,
      avgResponseTimeMs,
      frictionRate: entry.total > 0 ? (entry.blocked + entry.failed) / entry.total : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Guidance Derivation
// ---------------------------------------------------------------------------

function deriveGuidance(
  bouncePatterns: BouncePattern[],
  laneMetrics: LaneMetrics[],
  failureHotspots: FailureHotspot[],
  handoffFriction: HandoffFriction[],
): FlowGuidanceItem[] {
  const items: FlowGuidanceItem[] = [];

  // Bounce pattern guidance
  for (const bp of bouncePatterns) {
    if (bp.occurrences < 2) continue;
    const severity = bp.occurrences >= 5 ? "critical" : bp.occurrences >= 3 ? "warning" : "info";
    items.push({
      category: "bounce_pattern",
      severity,
      summary: `${bp.occurrences} tasks bounced from ${bp.fromColumnId} back to ${bp.toColumnId} (avg ${bp.avgBounceCount.toFixed(1)} bounces/task).`,
      recommendation: `Investigate why work leaving ${bp.fromColumnId} is being rejected by ${bp.toColumnId}. Consider strengthening exit criteria or adding verification before transition.`,
      affectedColumns: [bp.fromColumnId, bp.toColumnId],
    });
  }

  // Lane bottleneck guidance
  for (const lm of laneMetrics) {
    if (lm.failureRate > 0.5 && lm.totalSessions >= 3) {
      items.push({
        category: "failure_hotspot",
        severity: lm.failureRate > 0.7 ? "critical" : "warning",
        summary: `Lane ${lm.columnName ?? lm.columnId} has a ${(lm.failureRate * 100).toFixed(0)}% failure rate across ${lm.totalSessions} sessions.`,
        recommendation: `Review automation configuration for ${lm.columnName ?? lm.columnId}. High failure rate may indicate misconfigured specialists, insufficient context, or unrealistic completion criteria.`,
        affectedColumns: [lm.columnId],
      });
    }
    if (lm.recoveryRate > 0.3 && lm.totalSessions >= 3) {
      items.push({
        category: "lane_bottleneck",
        severity: "warning",
        summary: `Lane ${lm.columnName ?? lm.columnId} has a ${(lm.recoveryRate * 100).toFixed(0)}% recovery rate — sessions frequently need watchdog intervention.`,
        recommendation: `Consider increasing session timeouts or reviewing specialist prompts for ${lm.columnName ?? lm.columnId} to reduce watchdog recoveries.`,
        affectedColumns: [lm.columnId],
      });
    }
  }

  // Failure hotspot guidance
  for (const fh of failureHotspots) {
    if (fh.topRecoveryReasons.length > 0 && fh.failureCount + fh.timeoutCount >= 3) {
      const topReason = fh.topRecoveryReasons[0];
      items.push({
        category: "failure_hotspot",
        severity: "warning",
        summary: `Lane ${fh.columnName ?? fh.columnId} top recovery reason: "${topReason.reason}" (${topReason.count} occurrences).`,
        recommendation: `Address the root cause of "${topReason.reason}" failures in ${fh.columnName ?? fh.columnId}.`,
        affectedColumns: [fh.columnId],
      });
    }
  }

  // Handoff friction guidance
  for (const hf of handoffFriction) {
    if (hf.frictionRate > 0.3 && hf.totalHandoffs >= 2) {
      items.push({
        category: "handoff_friction",
        severity: hf.frictionRate > 0.5 ? "critical" : "warning",
        summary: `Handoffs from ${hf.fromColumnId} to ${hf.toColumnId} have ${(hf.frictionRate * 100).toFixed(0)}% friction rate (${hf.blockedHandoffs} blocked, ${hf.failedHandoffs} failed out of ${hf.totalHandoffs}).`,
        recommendation: `Improve handoff protocol between ${hf.fromColumnId} and ${hf.toColumnId}. Consider clearer request templates or automatic environment preparation.`,
        affectedColumns: [hf.fromColumnId, hf.toColumnId],
      });
    }
  }

  return items.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

/**
 * Formats a compact guidance summary for injection into agent prompts.
 * Returns an empty string if no actionable guidance exists.
 */
export function formatFlowGuidanceForPrompt(report: FlowDiagnosisReport): string {
  const actionable = report.guidance.filter((g) => g.severity !== "info");
  if (actionable.length === 0) return "";

  const lines = [
    "## Flow Guidance (Board-Level Learned Patterns)",
    "",
    `Analysis window: ${report.windowStart ?? "all time"} – ${report.windowEnd ?? "now"} | ${report.taskCount} tasks, ${report.sessionCount} sessions`,
    "",
  ];

  for (const item of actionable.slice(0, 5)) {
    lines.push(`- **[${item.severity.toUpperCase()}]** ${item.summary}`);
    lines.push(`  → ${item.recommendation}`);
  }

  if (actionable.length > 5) {
    lines.push(`- ...and ${actionable.length - 5} more guidance items.`);
  }

  lines.push("");
  return lines.join("\n");
}
