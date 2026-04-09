import { AgentRole } from "../models/agent";
import type { TraceRecord, TraceVcs } from "./types";

const DEFAULT_LIST_LIMIT = 8;
export interface TraceToolSummary {
  toolCallId?: string;
  toolName: string;
  timestamp: string;
  command?: string;
  contextPath?: string;
}

export interface TraceFileSummary {
  path: string;
  count: number;
  operations: string[];
}

export interface TraceRetrySignal {
  key: string;
  count: number;
  kind: "failed_tool" | "missing_result";
}

export interface TraceRunDigest {
  sessionIds: string[];
  traceAvailable: boolean;
  traceRecordCount: number;
  successfulTools: TraceToolSummary[];
  failedTools: TraceToolSummary[];
  toolCallsMissingResult: TraceToolSummary[];
  observedVerificationCommands: string[];
  touchedFiles: TraceFileSummary[];
  hotFiles: TraceFileSummary[];
  recentFailedCommands: string[];
  retrySignals: TraceRetrySignal[];
  toolCallContextPaths: string[];
  vcsContexts: TraceVcs[];
  evidenceGaps: string[];
}

interface ToolCallPair {
  call?: TraceRecord;
  result?: TraceRecord;
}

export function buildTraceRunDigest(records: TraceRecord[]): TraceRunDigest {
  const sortedRecords = sortRecords(records);
  const pairs = pairToolCalls(sortedRecords);
  const toolCalls = sortedToolPairs(pairs);
  const fileSummaries = summarizeFiles(sortedRecords);

  const successfulTools: TraceToolSummary[] = [];
  const failedTools: TraceToolSummary[] = [];
  const toolCallsMissingResult: TraceToolSummary[] = [];
  const verificationCommands = new Set<string>();

  for (const pair of toolCalls) {
    const call = pair.call;
    const result = pair.result;
    const source = call ?? result;
    if (!source?.tool) continue;

    const command = call?.tool ? extractCommand(call.tool.input) : undefined;
    if (command && isVerificationCommand(command)) {
      verificationCommands.add(command);
    }

    if (result?.tool?.status === "completed") {
      successfulTools.push(toolSummary(source, command));
    } else if (result?.tool?.status === "failed") {
      failedTools.push(toolSummary(source, command));
    } else if (call && !result) {
      toolCallsMissingResult.push(toolSummary(call, command));
    }
  }

  const recentFailedCommands = failedTools
    .map((tool) => tool.command)
    .filter((command): command is string => Boolean(command))
    .slice(-DEFAULT_LIST_LIMIT)
    .sort();

  const digest: TraceRunDigest = {
    sessionIds: Array.from(new Set(sortedRecords.map((record) => record.sessionId))).sort(),
    traceAvailable: sortedRecords.length > 0,
    traceRecordCount: sortedRecords.length,
    successfulTools: sortedToolSummaries(successfulTools).slice(0, DEFAULT_LIST_LIMIT),
    failedTools: sortedToolSummaries(failedTools).slice(0, DEFAULT_LIST_LIMIT),
    toolCallsMissingResult: sortedToolSummaries(toolCallsMissingResult).slice(0, DEFAULT_LIST_LIMIT),
    observedVerificationCommands: Array.from(verificationCommands).sort().slice(0, DEFAULT_LIST_LIMIT),
    touchedFiles: fileSummaries.slice(0, DEFAULT_LIST_LIMIT),
    hotFiles: fileSummaries
      .filter((file) => file.count > 1)
      .sort((left, right) => right.count - left.count || left.path.localeCompare(right.path))
      .slice(0, DEFAULT_LIST_LIMIT),
    recentFailedCommands,
    retrySignals: summarizeRetrySignals(failedTools, toolCallsMissingResult),
    toolCallContextPaths: summarizeContextPaths(sortedRecords),
    vcsContexts: summarizeVcs(sortedRecords),
    evidenceGaps: [],
  };

  digest.evidenceGaps = summarizeEvidenceGaps(digest);
  return digest;
}

export function formatTraceStateForGate(digest: TraceRunDigest): string {
  return [
    "## Trace State",
    formatTraceHeader(digest),
    formatStringList("Evidence gaps", digest.evidenceGaps),
    formatStringList("Observed verification commands", digest.observedVerificationCommands),
    formatToolList("Failed tools", digest.failedTools),
    formatToolList("Tool calls missing tool_result", digest.toolCallsMissingResult),
    formatToolList("Successful tools", digest.successfulTools),
    formatFileList("Touched files", digest.touchedFiles),
    formatFileList("Hot files", digest.hotFiles),
    formatStringList("Recent failed commands", digest.recentFailedCommands),
    formatRetrySignals(digest.retrySignals),
    formatStringList("Tool-call context paths", digest.toolCallContextPaths),
    formatVcsContexts(digest.vcsContexts),
    "Use this section as inspectable runtime state only; task/spec acceptance criteria remain authoritative.",
  ].filter(Boolean).join("\n");
}

export function formatTracePreflightForCrafter(digest: TraceRunDigest): string {
  const warnings = digest.evidenceGaps.filter((gap) => gap.includes("trace"));
  return [
    "## Trace Preflight",
    formatTraceHeader(digest),
    warnings.length > 0 ? formatStringList("Trace availability", warnings) : "",
    formatFileList("Files already touched", digest.touchedFiles.slice(0, 5)),
    formatStringList("Recent failed commands", digest.recentFailedCommands.slice(0, 3)),
    formatRetrySignals(digest.retrySignals.slice(0, 3)),
    formatFileList("Hot files", digest.hotFiles.slice(0, 3)),
    "This is a short preflight risk note. Do not treat it as a verifier audit checklist.",
  ].filter(Boolean).join("\n");
}

export function formatTraceContextForSpecialist(
  role: AgentRole,
  digest: TraceRunDigest,
): string | undefined {
  if (role === AgentRole.GATE) return formatTraceStateForGate(digest);
  if (role === AgentRole.CRAFTER) return formatTracePreflightForCrafter(digest);
  return undefined;
}

function sortRecords(records: TraceRecord[]): TraceRecord[] {
  return [...records].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp) ||
    (left.tool?.toolCallId ?? "").localeCompare(right.tool?.toolCallId ?? "") ||
    (left.tool?.name ?? "").localeCompare(right.tool?.name ?? "") ||
    left.id.localeCompare(right.id),
  );
}

function pairToolCalls(records: TraceRecord[]): Map<string, ToolCallPair> {
  const pairs = new Map<string, ToolCallPair>();
  for (const record of records) {
    if (!record.tool || (record.eventType !== "tool_call" && record.eventType !== "tool_result")) {
      continue;
    }

    const key = record.tool.toolCallId ?? `record:${record.id}`;
    const pair = pairs.get(key) ?? {};
    if (record.eventType === "tool_call") {
      pair.call = chooseEarlier(pair.call, record);
    } else {
      pair.result = chooseLater(pair.result, record);
    }
    pairs.set(key, pair);
  }
  return pairs;
}

function sortedToolPairs(pairs: Map<string, ToolCallPair>): ToolCallPair[] {
  return Array.from(pairs.values()).sort((left, right) =>
    toolPairSortKey(left).localeCompare(toolPairSortKey(right)),
  );
}

function toolPairSortKey(pair: ToolCallPair): string {
  const record = pair.call ?? pair.result;
  return [
    record?.timestamp ?? "",
    record?.tool?.toolCallId ?? "",
    record?.tool?.name ?? "",
    record?.id ?? "",
  ].join("\0");
}

function chooseEarlier(left: TraceRecord | undefined, right: TraceRecord): TraceRecord {
  if (!left) return right;
  return toolRecordSort(left, right) <= 0 ? left : right;
}

function chooseLater(left: TraceRecord | undefined, right: TraceRecord): TraceRecord {
  if (!left) return right;
  return toolRecordSort(left, right) >= 0 ? left : right;
}

function toolRecordSort(left: TraceRecord, right: TraceRecord): number {
  return left.timestamp.localeCompare(right.timestamp) ||
    (left.tool?.toolCallId ?? "").localeCompare(right.tool?.toolCallId ?? "") ||
    (left.tool?.name ?? "").localeCompare(right.tool?.name ?? "") ||
    left.id.localeCompare(right.id);
}

function toolSummary(record: TraceRecord, command?: string): TraceToolSummary {
  return {
    toolCallId: record.tool?.toolCallId,
    toolName: record.tool?.name ?? "unknown",
    timestamp: record.timestamp,
    command,
    contextPath: stringMetadata(record, "toolCallContentPath"),
  };
}

function sortedToolSummaries(tools: TraceToolSummary[]): TraceToolSummary[] {
  return [...tools].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp) ||
    (left.toolCallId ?? "").localeCompare(right.toolCallId ?? "") ||
    left.toolName.localeCompare(right.toolName) ||
    (left.command ?? "").localeCompare(right.command ?? ""),
  );
}

function summarizeFiles(records: TraceRecord[]): TraceFileSummary[] {
  const files = new Map<string, { count: number; operations: Set<string> }>();
  for (const record of records) {
    for (const file of record.files ?? []) {
      const entry = files.get(file.path) ?? { count: 0, operations: new Set<string>() };
      entry.count += 1;
      if (file.operation) entry.operations.add(file.operation);
      files.set(file.path, entry);
    }
  }

  return Array.from(files.entries())
    .map(([path, summary]) => ({
      path,
      count: summary.count,
      operations: Array.from(summary.operations).sort(),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function summarizeRetrySignals(
  failedTools: TraceToolSummary[],
  missingResults: TraceToolSummary[],
): TraceRetrySignal[] {
  const signals = new Map<string, TraceRetrySignal>();
  for (const tool of failedTools) {
    const key = tool.command ?? tool.toolName;
    incrementSignal(signals, key, "failed_tool");
  }
  for (const tool of missingResults) {
    const key = tool.command ?? tool.toolName;
    incrementSignal(signals, key, "missing_result");
  }

  return Array.from(signals.values())
    .filter((signal) => signal.count > 1)
    .sort((left, right) =>
      left.kind.localeCompare(right.kind) ||
      right.count - left.count ||
      left.key.localeCompare(right.key),
    )
    .slice(0, DEFAULT_LIST_LIMIT);
}

function incrementSignal(
  signals: Map<string, TraceRetrySignal>,
  key: string,
  kind: TraceRetrySignal["kind"],
): void {
  const mapKey = `${kind}:${key}`;
  const signal = signals.get(mapKey) ?? { key, count: 0, kind };
  signal.count += 1;
  signals.set(mapKey, signal);
}

function summarizeContextPaths(records: TraceRecord[]): string[] {
  const paths = new Set<string>();
  for (const record of records) {
    for (const key of ["toolCallContentPath", "toolCallMetadataPath", "toolCallContextDir"]) {
      const value = stringMetadata(record, key);
      if (value) paths.add(value);
    }
  }
  return Array.from(paths).sort().slice(0, DEFAULT_LIST_LIMIT);
}

function summarizeVcs(records: TraceRecord[]): TraceVcs[] {
  const contexts = new Map<string, TraceVcs>();
  for (const record of records) {
    if (!record.vcs) continue;
    const key = [
      record.vcs.branch ?? "",
      record.vcs.revision ?? record.vcs.gitSha ?? "",
      record.vcs.repoRoot ?? "",
    ].join("\0");
    contexts.set(key, record.vcs);
  }

  return Array.from(contexts.values())
    .sort((left, right) =>
      (left.branch ?? "").localeCompare(right.branch ?? "") ||
      (left.revision ?? left.gitSha ?? "").localeCompare(right.revision ?? right.gitSha ?? "") ||
      (left.repoRoot ?? "").localeCompare(right.repoRoot ?? ""),
    )
    .slice(0, 3);
}

function summarizeEvidenceGaps(digest: TraceRunDigest): string[] {
  const gaps: string[] = [];
  if (!digest.traceAvailable) {
    gaps.push("No readable trace records found for the delegated session context.");
  }
  if (digest.observedVerificationCommands.length === 0) {
    gaps.push("No structured verification command was observed in trace.");
  }
  if (digest.toolCallsMissingResult.length > 0) {
    gaps.push(`${digest.toolCallsMissingResult.length} tool_call record(s) have no paired tool_result.`);
  }
  if (digest.failedTools.length > 0) {
    gaps.push(`${digest.failedTools.length} failed tool result(s) observed.`);
  }
  return gaps.sort();
}

function extractCommand(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const command = input.command ?? input.cmd ?? input.script ?? input.shell_command;
  if (typeof command === "string") return command;
  const args = input.args ?? input.arguments;
  if (Array.isArray(args) && args.every((arg) => typeof arg === "string")) {
    const executable = input.executable ?? input.commandName;
    if (typeof executable === "string") return [executable, ...args].join(" ");
  }
  return undefined;
}

function isVerificationCommand(command: string): boolean {
  return /\b(test|vitest|jest|playwright|check|clippy|lint|typecheck|tsc|entrix|cargo\s+test|npm\s+run\s+test|pnpm\s+test)\b/i.test(command);
}

function stringMetadata(record: TraceRecord, key: string): string | undefined {
  const value = record.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatTraceHeader(digest: TraceRunDigest): string {
  return [
    `- traceAvailable: ${digest.traceAvailable ? "yes" : "no"}`,
    `- traceRecords: ${digest.traceRecordCount}`,
    `- sessions: ${digest.sessionIds.length > 0 ? digest.sessionIds.join(", ") : "none"}`,
  ].join("\n");
}

function formatToolList(title: string, tools: TraceToolSummary[]): string {
  if (tools.length === 0) return `### ${title}\n- none`;
  return `### ${title}\n${tools.map(formatTool).join("\n")}`;
}

function formatTool(tool: TraceToolSummary): string {
  const id = tool.toolCallId ? ` id=${tool.toolCallId}` : "";
  const command = tool.command ? ` command=${JSON.stringify(tool.command)}` : "";
  const context = tool.contextPath ? ` context=${tool.contextPath}` : "";
  return `- ${tool.toolName}${id}${command}${context}`;
}

function formatFileList(title: string, files: TraceFileSummary[]): string {
  if (files.length === 0) return `### ${title}\n- none`;
  return `### ${title}\n${files.map((file) => {
    const operations = file.operations.length > 0 ? ` ops=${file.operations.join(",")}` : "";
    return `- ${file.path} count=${file.count}${operations}`;
  }).join("\n")}`;
}

function formatStringList(title: string, values: string[]): string {
  if (values.length === 0) return `### ${title}\n- none`;
  return `### ${title}\n${values.map((value) => `- ${value}`).join("\n")}`;
}

function formatRetrySignals(signals: TraceRetrySignal[]): string {
  if (signals.length === 0) return "### Retry / repeated-failure signals\n- none";
  return `### Retry / repeated-failure signals\n${signals
    .map((signal) => `- ${signal.kind}: ${signal.key} repeated ${signal.count} times`)
    .join("\n")}`;
}

function formatVcsContexts(contexts: TraceVcs[]): string {
  if (contexts.length === 0) return "### VCS context\n- none";
  return `### VCS context\n${contexts.map((vcs) => {
    const revision = vcs.revision ?? vcs.gitSha ?? "unknown";
    return `- branch=${vcs.branch ?? "unknown"} revision=${revision} repoRoot=${vcs.repoRoot ?? "unknown"}`;
  }).join("\n")}`;
}
