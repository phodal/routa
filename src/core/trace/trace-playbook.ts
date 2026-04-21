import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { AgentRole } from "../models/agent";
import { TaskStatus, type Task, VerificationVerdict } from "../models/task";
import { getTracesDir } from "../storage/folder-slug";
import type { TraceRunDigest } from "./trace-run-digest";

export type TraceOutcome = "success" | "failure" | "unknown";

export interface TraceLedgerEntry {
  fingerprint: string;
  workspaceId: string;
  taskId: string;
  taskTitle: string;
  sessionId: string;
  role: AgentRole;
  outcome: TraceOutcome;
  verificationVerdict?: string | null;
  timestamp: string;
  digest: TraceRunDigest;
}

export interface LearnedPlaybook {
  fingerprint: string;
  workspaceId: string;
  taskTitle: string;
  sampleSize: number;
  successRate: number;
  preferredTools: string[];
  keyFiles: string[];
  verificationCommands: string[];
  antiPatterns: string[];
  sourceSessions: string[];
}

const LEDGER_FILE = "trace-ledger.jsonl";
const MAX_ITEMS = 8;

export function buildTaskFingerprint(
  task: Pick<Task, "workspaceId" | "title" | "scope" | "acceptanceCriteria">,
  fallbackWorkspaceId?: string,
): string {
  const scope = task.scope ?? "";
  const acceptance = Array.isArray(task.acceptanceCriteria)
    ? task.acceptanceCriteria.join("|")
    : "";
  const workspace = task.workspaceId ?? fallbackWorkspaceId ?? "workspace-unknown";
  const key = `${workspace}::${task.title}::${scope}::${acceptance}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

export function determineOutcome(task?: Task): TraceOutcome {
  if (!task) return "unknown";

  const approved =
    task.verificationVerdict === undefined ||
    task.verificationVerdict === null ||
    task.verificationVerdict === VerificationVerdict.APPROVED;

  if (task.status === TaskStatus.COMPLETED && approved) {
    return "success";
  }

  if (
    task.status === TaskStatus.NEEDS_FIX ||
    task.status === TaskStatus.BLOCKED ||
    task.verificationVerdict === VerificationVerdict.NOT_APPROVED
  ) {
    return "failure";
  }

  return "unknown";
}

export async function saveTraceLedgerEntry(cwd: string, entry: TraceLedgerEntry): Promise<void> {
  const dir = path.join(getTracesDir(cwd), "ledger");
  await fs.mkdir(dir, { recursive: true });
  const ledgerPath = path.join(dir, LEDGER_FILE);
  await fs.appendFile(ledgerPath, `${JSON.stringify(entry)}\n`, "utf-8");
}

async function readLedgerEntries(cwd: string): Promise<TraceLedgerEntry[]> {
  const ledgerPath = path.join(getTracesDir(cwd), "ledger", LEDGER_FILE);
  try {
    const content = await fs.readFile(ledgerPath, "utf-8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TraceLedgerEntry);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function loadLearnedPlaybook(
  cwd: string,
  fingerprint: string,
  taskTitle?: string,
  workspaceId?: string,
): Promise<LearnedPlaybook | null> {
  const entries = await readLedgerEntries(cwd);
  const matching = entries.filter((entry) => entry.fingerprint === fingerprint);
  if (matching.length === 0) return null;
  return buildPlaybookFromEntries(matching, taskTitle, workspaceId);
}

export function buildPlaybookFromEntries(
  entries: TraceLedgerEntry[],
  taskTitleFallback?: string,
  workspaceIdFallback?: string,
): LearnedPlaybook | null {
  if (entries.length === 0) return null;

  const sampleSize = entries.length;
  const successCount = entries.filter((e) => e.outcome === "success").length;
  const successRate = sampleSize === 0 ? 0 : successCount / sampleSize;

  const toolFrequency = new Map<string, number>();
  const fileFrequency = new Map<string, number>();
  const verificationFrequency = new Map<string, { passes: number; total: number }>();
  const antiPatterns = new Set<string>();
  const sourceSessions: string[] = [];

  for (const entry of entries) {
    if (sourceSessions.length < MAX_ITEMS) {
      sourceSessions.push(entry.sessionId);
    }

    for (const tool of entry.digest.toolCalls) {
      const weight = entry.outcome === "success" ? 2 : 1;
      toolFrequency.set(tool.name, (toolFrequency.get(tool.name) ?? 0) + weight);
    }

    for (const file of entry.digest.filesTouched) {
      const weight = file.operations.some((op) => op === "write" || op === "create") ? 2 : 1;
      fileFrequency.set(file.path, (fileFrequency.get(file.path) ?? 0) + weight);
    }

    for (const signal of entry.digest.verificationSignals) {
      const existing = verificationFrequency.get(signal.command) ?? { passes: 0, total: 0 };
      verificationFrequency.set(signal.command, {
        passes: existing.passes + (signal.passed ? 1 : 0),
        total: existing.total + 1,
      });
    }

    if (entry.outcome !== "success") {
      entry.digest.confidenceFlags.forEach((flag) => antiPatterns.add(flag));
      entry.digest.verificationSignals
        .filter((signal) => !signal.passed)
        .forEach((signal) => antiPatterns.add(`Verification failed: ${signal.command}`));
      entry.digest.churnMarkers.forEach((churn) => {
        antiPatterns.add(
          churn.type === "file"
            ? `High churn on ${churn.target}`
            : `Repeated tool failures: ${churn.target}`,
        );
      });
    }
  }

  const preferredTools = Array.from(toolFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ITEMS)
    .map(([name]) => name);

  const keyFiles = Array.from(fileFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ITEMS)
    .map(([path]) => path);

  const verificationCommands = Array.from(verificationFrequency.entries())
    .sort((a, b) => b[1].passes - a[1].passes)
    .slice(0, MAX_ITEMS)
    .map(([command, stats]) => {
      const pct = stats.total === 0 ? 0 : Math.round((stats.passes / stats.total) * 100);
      return `${command} (${pct}% pass over ${stats.total} run${stats.total > 1 ? "s" : ""})`;
    });

  return {
    fingerprint: entries[0].fingerprint,
    workspaceId: entries[0].workspaceId ?? workspaceIdFallback ?? "workspace-unknown",
    taskTitle: entries[0].taskTitle ?? taskTitleFallback ?? "unknown task",
    sampleSize,
    successRate,
    preferredTools,
    keyFiles,
    verificationCommands,
    antiPatterns: Array.from(antiPatterns).slice(0, MAX_ITEMS),
    sourceSessions,
  };
}

export function formatPlaybookForRole(playbook: LearnedPlaybook, role: AgentRole): string {
  if (!playbook) return "";

  const lines: string[] = [];
  lines.push("## Learned Playbook (prior runs)");
  lines.push(
    `Confidence: ${(playbook.successRate * 100).toFixed(0)}% from ${playbook.sampleSize} run(s)`,
  );
  lines.push(`Provenance sessions: ${playbook.sourceSessions.join(", ")}`);
  lines.push("");

  if (playbook.preferredTools.length > 0) {
    lines.push("### Preferred Tool Order");
    playbook.preferredTools.forEach((tool, idx) => {
      lines.push(`${idx + 1}. ${tool}`);
    });
    lines.push("");
  }

  if (playbook.keyFiles.length > 0) {
    lines.push(role === AgentRole.GATE ? "### Areas to Inspect" : "### Target Files");
    playbook.keyFiles.forEach((file) => lines.push(`- \`${file}\``));
    lines.push("");
  }

  if (playbook.verificationCommands.length > 0) {
    const label = role === AgentRole.GATE ? "### Verification to Repeat" : "### Quick Checks";
    lines.push(label);
    playbook.verificationCommands.forEach((cmd) => lines.push(`- ${cmd}`));
    lines.push("");
  }

  if (playbook.antiPatterns.length > 0) {
    lines.push(role === AgentRole.GATE ? "### Anti-Patterns / Risks" : "### Avoid / Risks");
    playbook.antiPatterns.forEach((anti) => lines.push(`- ${anti}`));
    lines.push("");
  }

  return lines.join("\n");
}
