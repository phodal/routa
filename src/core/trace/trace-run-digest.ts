/**
 * Trace Run Digest — Single-run trace state digest for specialist prompt injection.
 *
 * Reads trace records from the current (parent) session and produces a structured
 * digest that gives delegated specialists (GATE, CRAFTER) immediate awareness of
 * what has already happened in this run: files touched, tools used, errors hit, etc.
 *
 * This avoids the "cold start" problem where a specialist has no context about
 * prior work in the same coordination run.
 *
 * @see https://github.com/phodal/routa/issues/344
 */

import type { TraceRecord } from "./types";
import type { AgentRole } from "../models/agent";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FileDigestEntry {
  /** Relative file path */
  path: string;
  /** Operations performed (read, write, create, delete) */
  operations: string[];
  /** Number of times this file was touched (churn indicator) */
  touchCount: number;
}

export interface ToolCallDigestEntry {
  /** Tool name */
  name: string;
  /** Number of times called */
  count: number;
  /** Number of failures */
  failures: number;
}

export interface VerificationSignal {
  /** The command or tool that ran a verification step */
  command: string;
  /** Whether it passed */
  passed: boolean;
  /** Brief output summary on failure */
  outputSummary?: string;
}

export interface ChurnEntry {
  /** File path or tool name with high churn */
  target: string;
  /** Type: "file" or "tool" */
  type: "file" | "tool";
  /** Number of repeated touches/retries */
  count: number;
}

export interface TraceRunDigest {
  /** Parent session ID this digest was built from */
  sessionId: string;
  /** Total number of trace events in the session */
  totalEvents: number;
  /** Files touched during the session, with operations */
  filesTouched: FileDigestEntry[];
  /** Tool usage summary */
  toolCalls: ToolCallDigestEntry[];
  /** Number of errors/failures observed */
  errorCount: number;
  /** Brief error summaries (max 5) */
  errorSummaries: string[];
  /** Key decisions or thoughts from the agent (max 3) */
  keyThoughts: string[];
  /** Timestamp of the first and last event */
  timeRange: { start: string; end: string } | null;
  /** Verification commands detected and their outcomes */
  verificationSignals: VerificationSignal[];
  /** High-churn files or tools (repeated retries / edits) */
  churnMarkers: ChurnEntry[];
  /** Confidence-reducing signals */
  confidenceFlags: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Tool names that indicate verification/test/build commands */
const VERIFICATION_TOOL_PATTERNS = [
  "run_command", "execute_command", "run_terminal", "bash", "shell",
];

/** Keywords in command input that suggest a verification step */
const VERIFICATION_CMD_KEYWORDS = [
  "test", "vitest", "jest", "pytest", "cargo test", "npm test",
  "check", "lint", "eslint", "tsc", "build", "compile",
  "verify", "validate",
];

/** Churn threshold: a file or tool touched this many times is flagged */
const CHURN_THRESHOLD = 3;

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Build a TraceRunDigest from a set of trace records (typically from the parent session).
 */
export function buildTraceRunDigest(
  sessionId: string,
  records: TraceRecord[],
): TraceRunDigest {
  const fileMap = new Map<string, { ops: Set<string>; touchCount: number }>();
  const toolMap = new Map<string, { count: number; failures: number }>();
  const errors: string[] = [];
  const thoughts: string[] = [];
  const verificationSignals: VerificationSignal[] = [];
  const confidenceFlags: string[] = [];
  const pendingToolCalls = new Map<string, string>(); // toolCallId → toolName
  const pendingVerifications = new Map<string, number>(); // toolCallId → index in verificationSignals

  for (const record of records) {
    // Collect file operations
    if (record.files) {
      for (const file of record.files) {
        const entry = fileMap.get(file.path) ?? { ops: new Set<string>(), touchCount: 0 };
        if (file.operation) {
          entry.ops.add(file.operation);
        }
        entry.touchCount++;
        fileMap.set(file.path, entry);
      }
    }

    // Collect tool call stats
    if (record.tool && (record.eventType === "tool_call" || record.eventType === "tool_result")) {
      const existing = toolMap.get(record.tool.name) ?? { count: 0, failures: 0 };
      if (record.eventType === "tool_call") {
        existing.count++;
        // Track pending calls for missing-result detection
        if (record.tool.toolCallId) {
          pendingToolCalls.set(record.tool.toolCallId, record.tool.name);
        }

        // Detect verification commands
        if (isVerificationTool(record.tool.name, record.tool.input)) {
          const cmd = extractCommandString(record.tool.name, record.tool.input);
          const idx = verificationSignals.length;
          verificationSignals.push({ command: cmd, passed: true }); // optimistic, updated on result
          if (record.tool.toolCallId) {
            pendingVerifications.set(record.tool.toolCallId, idx);
          }
        }
      }
      if (record.eventType === "tool_result") {
        // Clear pending
        if (record.tool.toolCallId) {
          pendingToolCalls.delete(record.tool.toolCallId);
        }

        if (record.tool.status === "failed" || record.tool.status === "error") {
          existing.failures++;
          // Capture error summary
          if (errors.length < 5) {
            const output = record.tool.output;
            const summary = typeof output === "string"
              ? output.slice(0, 200)
              : typeof output === "object" && output !== null && "error" in output
                ? String((output as { error: unknown }).error).slice(0, 200)
                : `${record.tool.name} failed`;
            errors.push(summary);
          }

          // Update verification signal if this was a verification tool
          const verifIdx = record.tool.toolCallId
            ? pendingVerifications.get(record.tool.toolCallId)
            : undefined;
          if (verifIdx !== undefined) {
            verificationSignals[verifIdx].passed = false;
            verificationSignals[verifIdx].outputSummary = typeof record.tool.output === "string"
              ? record.tool.output.slice(0, 200)
              : undefined;
            pendingVerifications.delete(record.tool.toolCallId!);
          }
        } else if (record.tool.toolCallId) {
          // Successful result — clear pending verification tracking
          pendingVerifications.delete(record.tool.toolCallId);
        }
      }
      toolMap.set(record.tool.name, existing);
    }

    // Collect agent thoughts (key decisions)
    if (record.eventType === "agent_thought" && record.conversation?.contentPreview) {
      if (thoughts.length < 3) {
        thoughts.push(record.conversation.contentPreview.slice(0, 300));
      }
    }
  }

  // Detect missing tool results (confidence-reducing signal)
  if (pendingToolCalls.size > 0) {
    confidenceFlags.push(
      `${pendingToolCalls.size} tool call(s) have no matching result (may indicate interrupted execution)`,
    );
  }

  // Build file digest entries
  const filesTouched: FileDigestEntry[] = Array.from(fileMap.entries())
    .map(([filePath, entry]) => ({
      path: filePath,
      operations: Array.from(entry.ops),
      touchCount: entry.touchCount,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  // Build tool call digest entries
  const toolCalls: ToolCallDigestEntry[] = Array.from(toolMap.entries())
    .map(([name, stats]) => ({
      name,
      count: stats.count,
      failures: stats.failures,
    }))
    .sort((a, b) => b.count - a.count);

  // Detect churn markers
  const churnMarkers: ChurnEntry[] = [];
  for (const file of filesTouched) {
    if (file.touchCount >= CHURN_THRESHOLD) {
      churnMarkers.push({ target: file.path, type: "file", count: file.touchCount });
    }
  }
  for (const tool of toolCalls) {
    if (tool.failures >= CHURN_THRESHOLD) {
      churnMarkers.push({ target: tool.name, type: "tool", count: tool.failures });
    }
  }
  churnMarkers.sort((a, b) => b.count - a.count);

  // Additional confidence flags
  const errorCount = toolCalls.reduce((sum, t) => sum + t.failures, 0);
  if (errorCount > 0 && verificationSignals.length === 0) {
    confidenceFlags.push("No verification commands detected despite errors occurring");
  }

  const writtenFiles = filesTouched.filter((f) =>
    f.operations.some((op) => op === "write" || op === "create"),
  );
  if (writtenFiles.length > 0 && verificationSignals.length === 0) {
    confidenceFlags.push(
      `${writtenFiles.length} file(s) were modified but no verification/test commands were observed`,
    );
  }

  const failedVerifications = verificationSignals.filter((v) => !v.passed);
  if (failedVerifications.length > 0) {
    confidenceFlags.push(
      `${failedVerifications.length} verification command(s) failed`,
    );
  }

  // Time range
  const timestamps = records.map((r) => r.timestamp).filter(Boolean).sort();
  const timeRange = timestamps.length >= 2
    ? { start: timestamps[0], end: timestamps[timestamps.length - 1] }
    : timestamps.length === 1
      ? { start: timestamps[0], end: timestamps[0] }
      : null;

  return {
    sessionId,
    totalEvents: records.length,
    filesTouched,
    toolCalls,
    errorCount,
    errorSummaries: errors,
    keyThoughts: thoughts,
    timeRange,
    verificationSignals,
    churnMarkers,
    confidenceFlags,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isVerificationTool(toolName: string, input: unknown): boolean {
  const normalized = toolName.toLowerCase();
  const isShellTool = VERIFICATION_TOOL_PATTERNS.some((p) => normalized.includes(p));
  if (!isShellTool) return false;

  // Check command content for verification keywords
  const cmdStr = extractRawCommand(input);
  if (!cmdStr) return false;

  return VERIFICATION_CMD_KEYWORDS.some((kw) => cmdStr.toLowerCase().includes(kw));
}

function extractRawCommand(input: unknown): string | undefined {
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;
    return typeof obj.command === "string"
      ? obj.command
      : typeof obj.cmd === "string"
        ? obj.cmd
        : typeof obj.content === "string"
          ? obj.content
          : undefined;
  }
  return undefined;
}

function extractCommandString(toolName: string, input: unknown): string {
  const raw = extractRawCommand(input);
  return raw ? raw.slice(0, 100) : toolName;
}

// ─── Formatter ───────────────────────────────────────────────────────────────

const MAX_FILES_GATE = 30;
const MAX_FILES_CRAFTER = 15;
const MAX_TOOLS_DISPLAY = 10;

/**
 * Format a TraceRunDigest into a role-specific markdown section
 * suitable for injection into the delegation prompt's additionalContext.
 */
export function formatDigestForRole(
  digest: TraceRunDigest,
  role: AgentRole,
): string {
  if (digest.totalEvents === 0) {
    return "";
  }

  const sections: string[] = [];
  sections.push("## Prior Run Context (Trace Digest)");
  sections.push("");

  // For GATE: full verification evidence — all files, all errors, key thoughts
  // For CRAFTER: lightweight risk hints — modified files, error flags
  const isGate = role === "GATE";
  const maxFiles = isGate ? MAX_FILES_GATE : MAX_FILES_CRAFTER;

  // Files section
  if (digest.filesTouched.length > 0) {
    const fileLabel = isGate ? "Files Modified/Read" : "Files Changed";
    sections.push(`### ${fileLabel}`);

    const displayFiles = isGate
      ? digest.filesTouched
      : digest.filesTouched.filter((f) => f.operations.some((op) => op !== "read"));

    const limited = displayFiles.slice(0, maxFiles);
    for (const file of limited) {
      const opsStr = file.operations.length > 0 ? ` (${file.operations.join(", ")})` : "";
      const churnStr = file.touchCount >= CHURN_THRESHOLD ? ` ⚠ HIGH CHURN (${file.touchCount}x)` : "";
      sections.push(`- \`${file.path}\`${opsStr}${churnStr}`);
    }
    if (displayFiles.length > maxFiles) {
      sections.push(`- ... and ${displayFiles.length - maxFiles} more files`);
    }
    sections.push("");
  }

  // Tool usage section (GATE gets full detail, CRAFTER gets summary)
  if (digest.toolCalls.length > 0 && isGate) {
    sections.push("### Tool Usage");
    const limited = digest.toolCalls.slice(0, MAX_TOOLS_DISPLAY);
    for (const tool of limited) {
      const failStr = tool.failures > 0 ? ` (${tool.failures} failed)` : "";
      sections.push(`- ${tool.name}: ${tool.count} calls${failStr}`);
    }
    if (digest.toolCalls.length > MAX_TOOLS_DISPLAY) {
      sections.push(`- ... and ${digest.toolCalls.length - MAX_TOOLS_DISPLAY} more tools`);
    }
    sections.push("");
  }

  // Verification signals section
  if (digest.verificationSignals.length > 0) {
    const label = isGate ? "Verification Evidence" : "Verification Status";
    sections.push(`### ${label}`);
    for (const signal of digest.verificationSignals) {
      const status = signal.passed ? "✅ PASSED" : "❌ FAILED";
      sections.push(`- ${status}: \`${signal.command}\``);
      if (!signal.passed && signal.outputSummary && isGate) {
        sections.push(`  > ${signal.outputSummary}`);
      }
    }
    sections.push("");
  } else if (isGate && digest.filesTouched.some((f) => f.operations.some((op) => op === "write" || op === "create"))) {
    sections.push("### Verification Evidence");
    sections.push("⚠ **No verification commands detected.** Files were modified but no test/build/lint commands were observed in traces.");
    sections.push("");
  }

  // Churn markers (CRAFTER gets this prominently, GATE as supporting info)
  if (digest.churnMarkers.length > 0) {
    const label = isGate ? "Churn Indicators" : "High-Risk Areas (Repeated Churn)";
    sections.push(`### ${label}`);
    for (const churn of digest.churnMarkers) {
      const typeLabel = churn.type === "file" ? "file" : "tool (repeated failures)";
      sections.push(`- \`${churn.target}\` — ${typeLabel}, ${churn.count}x`);
    }
    sections.push("");
  }

  // Errors section
  if (digest.errorCount > 0) {
    sections.push(`### ${isGate ? "Errors Encountered" : "Error Flags"}`);
    sections.push(`Total failures: ${digest.errorCount}`);
    if (isGate && digest.errorSummaries.length > 0) {
      sections.push("");
      for (const err of digest.errorSummaries) {
        sections.push(`- ${err}`);
      }
    }
    sections.push("");
  }

  // Confidence flags (GATE gets full list, CRAFTER gets count)
  if (digest.confidenceFlags.length > 0) {
    if (isGate) {
      sections.push("### Suspicious Gaps");
      for (const flag of digest.confidenceFlags) {
        sections.push(`- ⚠ ${flag}`);
      }
      sections.push("");
    } else {
      sections.push(`### Risk Signals`);
      sections.push(`${digest.confidenceFlags.length} confidence-reducing signal(s) detected. See GATE verification for details.`);
      sections.push("");
    }
  }

  // Key thoughts (GATE only — helps verifier understand agent reasoning)
  if (isGate && digest.keyThoughts.length > 0) {
    sections.push("### Key Agent Reasoning");
    for (const thought of digest.keyThoughts) {
      sections.push(`> ${thought}`);
    }
    sections.push("");
  }

  return sections.join("\n");
}
