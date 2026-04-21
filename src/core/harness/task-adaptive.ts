import * as fs from "fs";
import * as path from "path";
import type { McpServerProfile } from "@/core/mcp/mcp-server-profiles";
import {
  collectMatchingTranscriptSessions,
  commandFromUnknown,
  commandOutputFromUnknown,
  type TranscriptProvider,
} from "./transcript-sessions";

export type TaskAdaptiveHarnessTaskType = "implementation" | "planning" | "analysis" | "review";

export interface TaskAdaptiveHarnessOptions {
  taskLabel?: string;
  locale?: string;
  featureId?: string;
  filePaths?: string[];
  historySessionIds?: string[];
  taskType?: TaskAdaptiveHarnessTaskType;
  maxFiles?: number;
  maxSessions?: number;
  role?: string;
}

export interface TaskAdaptiveHarnessFailureSignal {
  provider: string;
  sessionId: string;
  message: string;
  toolName: string;
  command?: string;
}

export interface TaskAdaptiveHarnessSessionSummary {
  provider: string;
  sessionId: string;
  updatedAt: string;
  promptSnippet: string;
  matchedFiles: string[];
  matchedChangedFiles: string[];
  matchedReadFiles: string[];
  matchedWrittenFiles: string[];
  repeatedReadFiles: string[];
  toolNames: string[];
  failedReadSignals: TaskAdaptiveHarnessFailureSignal[];
  resumeCommand?: string;
}

export interface TaskAdaptiveHarnessPack {
  summary: string;
  warnings: string[];
  featureId?: string;
  featureName?: string;
  selectedFiles: string[];
  matchedSessionIds: string[];
  failures: TaskAdaptiveHarnessFailureSignal[];
  repeatedReadFiles: string[];
  sessions: TaskAdaptiveHarnessSessionSummary[];
  recommendedToolMode?: "essential" | "full";
  recommendedMcpProfile?: McpServerProfile;
  recommendedAllowedNativeTools?: string[];
}

export interface FeatureTreeFeature {
  id: string;
  name: string;
  group: string;
  summary: string;
  status: string;
  pages: string[];
  apis: string[];
  sourceFiles: string[];
  relatedFeatures: string[];
  domainObjects: string[];
}

export interface FileSessionToolFailure {
  toolName: string;
  command?: string;
  message: string;
}

export interface FileSessionDiagnostics {
  toolCallCount: number;
  failedToolCallCount: number;
  toolCallsByName: Record<string, number>;
  readFiles: string[];
  writtenFiles: string[];
  repeatedReadFiles: string[];
  repeatedCommands: string[];
  failedTools: FileSessionToolFailure[];
}

export interface FileSessionSignal {
  provider: TranscriptProvider;
  sessionId: string;
  updatedAt: string;
  promptSnippet: string;
  promptHistory: string[];
  toolNames: string[];
  changedFiles?: string[];
  resumeCommand?: string;
  diagnostics?: FileSessionDiagnostics;
}

type TaskAdaptiveFileSignal = {
  sessions: FileSessionSignal[];
  toolHistory: string[];
  promptHistory: string[];
};

const DEFAULT_MAX_FILES = 8;
const DEFAULT_MAX_SESSIONS = 6;
const MAX_FAILURE_SIGNALS = 8;
const MAX_REPEATED_READS = 8;
const MAX_TOOLS_PER_SESSION = 6;
const FEATURE_TREE_INDEX_PATH = "docs/product-specs/feature-tree.index.json";
const MAX_FILE_SIGNAL_SESSIONS = 6;
const MAX_FILE_SIGNAL_TOOLS = 8;
const MAX_FILE_SIGNAL_PROMPTS = 6;
const MAX_FILE_SIGNAL_CHANGED_FILES = 12;
const MAX_FILE_SIGNAL_FAILED_TOOLS = 6;
const MAX_FILE_SIGNAL_REPEATED_COMMANDS = 6;
const HIGH_SIGNAL_FAILURE_PATTERNS = [
  /operation not permitted/i,
  /permission denied/i,
  /no such file/i,
  /\bnot found\b/i,
  /\benoent\b/i,
  /is a directory/i,
  /cannot read/i,
  /failed to read/i,
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((item) => normalizeString(item))
    .filter((item): item is string => Boolean(item));

  return normalized.length > 0 ? normalized : undefined;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function appendLimitedUnique(target: string[], value: string, limit: number): void {
  if (!value || target.includes(value) || target.length >= limit) {
    return;
  }
  target.push(value);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readFeatureTreeFeatures(repoRoot: string): FeatureTreeFeature[] {
  const featureTreeIndexPath = path.join(repoRoot, FEATURE_TREE_INDEX_PATH);
  if (!fs.existsSync(featureTreeIndexPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(featureTreeIndexPath, "utf8");
    const parsed = JSON.parse(raw) as {
      metadata?: {
        features?: Array<Record<string, unknown>>;
      };
    } | null;
    return ((parsed?.metadata?.features ?? []) as Array<Record<string, unknown>>).map((feature) => ({
      id: normalizeString(feature.id) ?? "",
      name: normalizeString(feature.name) ?? "",
      group: normalizeString(feature.group) ?? "",
      summary: normalizeString(feature.summary) ?? "",
      status: normalizeString(feature.status) ?? "",
      pages: normalizeStringArray(feature.pages) ?? [],
      apis: normalizeStringArray(feature.apis) ?? [],
      sourceFiles: normalizeStringArray(feature.sourceFiles) ?? normalizeStringArray(feature.source_files) ?? [],
      relatedFeatures: normalizeStringArray(feature.relatedFeatures) ?? normalizeStringArray(feature.related_features) ?? [],
      domainObjects: normalizeStringArray(feature.domainObjects) ?? normalizeStringArray(feature.domain_objects) ?? [],
    })).filter((feature) => feature.id.length > 0 || feature.name.length > 0);
  } catch {
    return [];
  }
}

function shellLikeSplit(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function parsePatchBlock(text: string): string[] {
  const out: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const [, , value] = trimmed.match(/^(\*{3} (Update|Add|Delete|Move to):)\s*(.*)$/) ?? [];
    if (value) {
      out.push(value);
    }
  }

  return out;
}

function parseCommandPaths(command: string): string[] {
  const tokens = shellLikeSplit(command);
  if (tokens.length === 0) {
    return [];
  }

  const separatorIndex = tokens.indexOf("--");
  if (separatorIndex >= 0) {
    return tokens
      .slice(separatorIndex + 1)
      .filter((token) => token.length > 0 && !token.startsWith("-"));
  }

  if (tokens[0] === "git" && (tokens[1] === "add" || tokens[1] === "rm")) {
    return tokens
      .slice(2)
      .filter((token) => token.length > 0 && !token.startsWith("-"));
  }

  return [];
}

function collectFileValues(value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectFileValues(item, out);
    }
    return;
  }

  if (typeof value === "string") {
    for (const candidate of parsePatchBlock(value)) {
      out.add(candidate);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const map = value as Record<string, unknown>;
  const pathKeys = new Set([
    "path",
    "paths",
    "file",
    "filepath",
    "file_path",
    "filename",
    "target",
    "source",
    "target_file",
    "source_file",
    "absolute_path",
    "relative_path",
  ]);

  for (const [key, child] of Object.entries(map)) {
    const lower = key.toLowerCase();
    if (pathKeys.has(lower)) {
      if (typeof child === "string") {
        out.add(child);
      } else if (Array.isArray(child)) {
        for (const item of child) {
          if (typeof item === "string") {
            out.add(item);
          }
        }
      }
    }
    collectFileValues(child, out);
  }
}

function normalizeCommandSignature(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

function truncateDiagnosticText(text: string, maxLength: number = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function unwrapShellCommand(command: string): string {
  const tokens = shellLikeSplit(command);
  if (tokens.length < 3) {
    return command;
  }

  const executable = path.posix.basename(tokens[0] ?? "");
  const shellLike = executable === "sh" || executable === "bash" || executable === "zsh";
  if (!shellLike) {
    return command;
  }

  const cFlagIndex = tokens.findIndex((token) => token === "-c" || token === "-lc");
  if (cFlagIndex >= 0 && tokens[cFlagIndex + 1]) {
    return tokens.slice(cFlagIndex + 1).join(" ");
  }

  return command;
}

function toolNameFromFeatureEvent(event: unknown): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  if (event.type === "function_call" && typeof event.name === "string") {
    return event.name;
  }

  if (typeof event.tool_name === "string") {
    return event.tool_name;
  }

  if (event.type === "exec_command_end" || event.type === "exec_command_begin") {
    return "exec_command";
  }

  return commandFromUnknown(event) ? "exec_command" : undefined;
}

function extractReadCandidatesFromCommand(command: string): string[] {
  const innerCommand = unwrapShellCommand(command);
  const tokens = shellLikeSplit(innerCommand);
  if (tokens.length === 0) {
    return [];
  }

  const executable = path.posix.basename(tokens[0] ?? "");
  const readCommands = new Set(["bat", "cat", "head", "less", "more", "nl", "sed", "tail"]);
  if (!readCommands.has(executable)) {
    return [];
  }

  return tokens.slice(1).filter((token) => token !== "--" && !token.startsWith("-"));
}

function sanitizePathCandidate(candidate: string): string | null {
  const cleaned = toPosix(candidate)
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "")
    .replace(/^`+|`+$/g, "")
    .replace(/[",;:]+$/g, "");

  if (!cleaned) {
    return null;
  }

  const lineQualifiedPath = cleaned.match(/^(.*\.[^:/\s]+):\d+(?::\d+)?$/);
  if (lineQualifiedPath?.[1]) {
    return lineQualifiedPath[1];
  }

  if (!/\s/.test(cleaned)) {
    return cleaned;
  }

  const embeddedPath = cleaned.match(
    /([A-Za-z0-9_@()[\]{}.\-/]+?\.(?:[cm]?[jt]sx?|jsx?|tsx?|rs|md|json|ya?ml|toml|css|scss|html))/,
  );
  if (embeddedPath?.[1]) {
    return embeddedPath[1];
  }

  return cleaned;
}

function pathLooksFileLike(candidate: string): boolean {
  const base = path.posix.basename(candidate);
  return base.includes(".") || ["Dockerfile", "Makefile", "Cargo.toml"].includes(base);
}

function isExistingDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function normalizeRepoRelative(repoRoot: string, candidate: string, sessionCwd: string): string | null {
  const cleaned = sanitizePathCandidate(candidate);

  if (!cleaned || cleaned === "/dev/null") {
    return null;
  }

  if (!path.isAbsolute(cleaned)) {
    const relativeCandidate = toPosix(cleaned).replace(/^\.\//, "");
    if (!relativeCandidate || relativeCandidate === "." || relativeCandidate.startsWith("../")) {
      return null;
    }
    const repoResolved = path.join(repoRoot, relativeCandidate);
    const sessionResolved = path.join(sessionCwd, relativeCandidate);
    if (isExistingDirectory(repoResolved) || isExistingDirectory(sessionResolved)) {
      return null;
    }
    if (!isExistingFile(repoResolved) && !isExistingFile(sessionResolved) && !pathLooksFileLike(relativeCandidate)) {
      return null;
    }
    return relativeCandidate;
  }

  const candidatePaths = [sessionCwd, repoRoot];
  for (const basePath of candidatePaths) {
    if (isExistingDirectory(cleaned)) {
      return null;
    }
    const relative = path.relative(basePath, cleaned);
    const relativePosix = toPosix(relative);
    if (
      relativePosix
      && !relativePosix.startsWith("../")
      && !path.isAbsolute(relativePosix)
      && (isExistingFile(cleaned) || pathLooksFileLike(relativePosix))
    ) {
      return relativePosix;
    }
  }

  return null;
}

function collectReadFilesFromToolLike(event: unknown, repoRoot: string, sessionCwd: string): string[] {
  const candidates = new Set<string>();
  const toolName = toolNameFromFeatureEvent(event)?.toLowerCase() ?? "";
  const command = commandFromUnknown(event);
  const directReadTool = toolName.includes("read")
    || toolName === "open"
    || toolName === "view"
    || toolName === "fs/read_text_file";

  if (directReadTool) {
    collectFileValues(event, candidates);
  }

  if (command) {
    for (const token of extractReadCandidatesFromCommand(command)) {
      candidates.add(token);
    }
  }

  const readFiles: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeRepoRelative(repoRoot, candidate, sessionCwd);
    if (normalized && !readFiles.includes(normalized)) {
      readFiles.push(normalized);
    }
  }

  return readFiles;
}

function detectFailedToolCall(event: unknown): FileSessionToolFailure | null {
  if (!isRecord(event)) {
    return null;
  }

  const exitCode = typeof event.exit_code === "number"
    ? event.exit_code
    : typeof event.exitCode === "number"
      ? event.exitCode
      : undefined;
  const status = typeof event.status === "string" ? event.status.trim().toLowerCase() : "";
  const failed = (typeof exitCode === "number" && exitCode !== 0)
    || status === "failed"
    || status === "error";

  if (!failed) {
    return null;
  }

  const toolName = toolNameFromFeatureEvent(event) ?? "tool";
  const message = firstNonEmptyString(
    event.stderr,
    event.error,
    event.message,
    commandOutputFromUnknown(event),
  ) ?? (typeof exitCode === "number" ? `Exit code ${exitCode}` : "Tool call failed");

  return {
    toolName,
    ...(commandFromUnknown(event) ? { command: truncateDiagnosticText(commandFromUnknown(event) ?? "") } : {}),
    message: truncateDiagnosticText(message),
  };
}

function deriveTranscriptSessionDiagnostics(
  transcript: ReturnType<typeof collectMatchingTranscriptSessions>[number],
  repoRoot: string,
  writtenFiles: string[],
): FileSessionDiagnostics {
  const toolCallsByName: Record<string, number> = {};
  const readCounts = new Map<string, number>();
  const repeatedCommandCounts = new Map<string, number>();
  const failedTools: FileSessionToolFailure[] = [];
  const pendingExecRequests = new Map<string, number>();
  let failedToolCallCount = 0;

  const incrementToolCall = (toolName: string) => {
    toolCallsByName[toolName] = (toolCallsByName[toolName] ?? 0) + 1;
  };

  const incrementCommand = (signature: string) => {
    if (signature) {
      repeatedCommandCounts.set(signature, (repeatedCommandCounts.get(signature) ?? 0) + 1);
    }
  };

  const appendFailure = (failure: FileSessionToolFailure | null) => {
    if (!failure) {
      return;
    }
    failedToolCallCount += 1;
    if (failedTools.length < MAX_FILE_SIGNAL_FAILED_TOOLS) {
      failedTools.push(failure);
    }
  };

  for (const event of transcript.events) {
    const toolName = toolNameFromFeatureEvent(event);
    const command = commandFromUnknown(event);
    const commandSignature = command ? normalizeCommandSignature(unwrapShellCommand(command)) : "";

    for (const readFile of collectReadFilesFromToolLike(event, repoRoot, transcript.cwd)) {
      readCounts.set(readFile, (readCounts.get(readFile) ?? 0) + 1);
    }

    if (!isRecord(event)) {
      continue;
    }

    if (event.type === "function_call") {
      if (toolName) {
        incrementToolCall(toolName);
      }
      if (toolName === "exec_command" && commandSignature) {
        pendingExecRequests.set(commandSignature, (pendingExecRequests.get(commandSignature) ?? 0) + 1);
      }
      incrementCommand(commandSignature);
      appendFailure(detectFailedToolCall(event));
      continue;
    }

    if (event.type === "exec_command_begin" || event.type === "exec_command_end") {
      const pending = commandSignature ? (pendingExecRequests.get(commandSignature) ?? 0) : 0;
      if (pending > 0 && commandSignature) {
        pendingExecRequests.set(commandSignature, pending - 1);
      } else {
        incrementToolCall("exec_command");
        incrementCommand(commandSignature);
      }
      appendFailure(detectFailedToolCall(event));
      continue;
    }

    if (toolName) {
      incrementToolCall(toolName);
      incrementCommand(commandSignature);
      appendFailure(detectFailedToolCall(event));
    }
  }

  const repeatedReadFiles = [...readCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([filePath, count]) => `${filePath} x${count}`);
  const repeatedCommands = [...repeatedCommandCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_FILE_SIGNAL_REPEATED_COMMANDS)
    .map(([commandText, count]) => `${truncateDiagnosticText(commandText, 120)} x${count}`);

  return {
    toolCallCount: Object.values(toolCallsByName).reduce((sum, count) => sum + count, 0),
    failedToolCallCount,
    toolCallsByName,
    readFiles: [...readCounts.keys()].sort((left, right) => left.localeCompare(right)),
    writtenFiles: [...new Set(writtenFiles)].sort((left, right) => left.localeCompare(right)),
    repeatedReadFiles,
    repeatedCommands,
    failedTools,
  };
}

function extractChangedFilesFromCommandOutput(command: string, output: string): string[] {
  const changed = new Set<string>();
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  if (command.includes("git status --short")) {
    for (const line of lines) {
      const match = line.match(/^[ MADRCU?!]{1,2}\s+(.+)$/);
      const pathCandidate = (match?.[1] ?? line).split(" -> ").pop()?.trim();
      if (pathCandidate) {
        changed.add(pathCandidate);
      }
    }
  }

  if (command.includes("git diff --name-only")) {
    for (const line of lines) {
      changed.add(line);
    }
  }

  if (command.includes("git diff") || command.includes("git show")) {
    for (const line of lines) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match?.[2]) {
        changed.add(match[2]);
      }
    }
  }

  return [...changed];
}

function collectChangedFilesFromToolLike(event: unknown, repoRoot: string, sessionCwd: string): string[] {
  const candidates = new Set<string>();
  collectFileValues(event, candidates);

  const command = commandFromUnknown(event);
  if (typeof command === "string") {
    for (const line of parsePatchBlock(command)) {
      candidates.add(line);
    }
    for (const token of parseCommandPaths(command)) {
      candidates.add(token);
    }
  }
  const commandOutput = commandOutputFromUnknown(event);
  if (command && commandOutput) {
    for (const candidate of extractChangedFilesFromCommandOutput(command, commandOutput)) {
      candidates.add(candidate);
    }
  }

  const changed: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeRepoRelative(repoRoot, candidate, sessionCwd);
    if (normalized) {
      changed.push(normalized);
    }
  }

  return changed;
}

function collectTaskAdaptiveFileSignals(repoRoot: string): Record<string, TaskAdaptiveFileSignal> {
  const fileSignals: Record<string, TaskAdaptiveFileSignal> = {};
  const transcripts = collectMatchingTranscriptSessions(repoRoot);

  for (const transcript of transcripts) {
    const changedFromTranscript = new Set<string>();

    for (const event of transcript.events) {
      for (const changed of collectChangedFilesFromToolLike(event, repoRoot, transcript.cwd)) {
        changedFromTranscript.add(changed);
      }
    }

    if (changedFromTranscript.size === 0) {
      continue;
    }

    const transcriptKey = `${transcript.provider}:${transcript.sessionId}`;
    const changedFiles = [...changedFromTranscript]
      .slice(0, MAX_FILE_SIGNAL_CHANGED_FILES)
      .sort((left, right) => left.localeCompare(right));
    const diagnostics = deriveTranscriptSessionDiagnostics(transcript, repoRoot, changedFiles);

    for (const changedFile of changedFromTranscript) {
      const signalEntry = fileSignals[changedFile] ?? {
        sessions: [],
        toolHistory: [],
        promptHistory: [],
      };
      if (
        signalEntry.sessions.length < MAX_FILE_SIGNAL_SESSIONS
        && !signalEntry.sessions.some(
          (session) => `${session.provider}:${session.sessionId}` === transcriptKey,
        )
      ) {
        signalEntry.sessions.push({
          provider: transcript.provider,
          sessionId: transcript.sessionId,
          updatedAt: transcript.updatedAt,
          promptSnippet: transcript.promptHistory[0] ?? "",
          promptHistory: transcript.promptHistory.slice(0, MAX_FILE_SIGNAL_PROMPTS),
          toolNames: transcript.toolHistory.slice(0, MAX_FILE_SIGNAL_TOOLS),
          changedFiles,
          diagnostics,
          ...(transcript.resumeCommand ? { resumeCommand: transcript.resumeCommand } : {}),
        });
      }
      for (const toolName of transcript.toolHistory) {
        appendLimitedUnique(signalEntry.toolHistory, toolName, MAX_FILE_SIGNAL_TOOLS);
      }
      for (const prompt of transcript.promptHistory) {
        appendLimitedUnique(signalEntry.promptHistory, prompt, MAX_FILE_SIGNAL_PROMPTS);
      }
      fileSignals[changedFile] = signalEntry;
    }
  }

  return fileSignals;
}

export function parseTaskAdaptiveHarnessOptions(value: unknown): TaskAdaptiveHarnessOptions | undefined {
  if (value === true) {
    return {};
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const taskType = normalizeString(value.taskType);
  return {
    taskLabel: normalizeString(value.taskLabel),
    locale: normalizeString(value.locale),
    featureId: normalizeString(value.featureId),
    filePaths: normalizeStringArray(value.filePaths),
    historySessionIds: normalizeStringArray(value.historySessionIds),
    taskType: taskType === "planning" || taskType === "analysis" || taskType === "review" || taskType === "implementation"
      ? taskType
      : undefined,
    maxFiles: typeof value.maxFiles === "number" && Number.isFinite(value.maxFiles)
      ? Math.max(1, Math.floor(value.maxFiles))
      : undefined,
    maxSessions: typeof value.maxSessions === "number" && Number.isFinite(value.maxSessions)
      ? Math.max(1, Math.floor(value.maxSessions))
      : undefined,
    role: normalizeString(value.role),
  };
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function trimTo<T>(values: T[], max: number): T[] {
  return values.slice(0, Math.max(0, max));
}

function truncateSnippet(value: string | undefined, max = 200): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "";
  }
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`;
}

function isHighSignalReadFailure(failure: FileSessionToolFailure): boolean {
  const message = failure.message ?? "";
  const command = failure.command ?? "";
  return HIGH_SIGNAL_FAILURE_PATTERNS.some((pattern) => pattern.test(message) || pattern.test(command));
}

function normalizeRepeatedReadFile(value: string): string {
  return value.replace(/\s+x\d+$/u, "").trim();
}

type CompiledSessionAccumulator = {
  provider: string;
  sessionId: string;
  updatedAt: string;
  promptSnippet: string;
  promptHistory: Set<string>;
  matchedFiles: Set<string>;
  matchedChangedFiles: Set<string>;
  matchedReadFiles: Set<string>;
  matchedWrittenFiles: Set<string>;
  repeatedReadFiles: Set<string>;
  toolNames: Set<string>;
  failedReadSignals: TaskAdaptiveHarnessFailureSignal[];
  resumeCommand?: string;
  frictionScore: number;
};

function ensureAccumulator(
  map: Map<string, CompiledSessionAccumulator>,
  signal: FileSessionSignal,
): CompiledSessionAccumulator {
  const key = `${signal.provider}:${signal.sessionId}`;
  const existing = map.get(key);
  if (existing) {
    if (signal.updatedAt > existing.updatedAt) {
      existing.updatedAt = signal.updatedAt;
    }
    if (!existing.promptSnippet && signal.promptSnippet) {
      existing.promptSnippet = truncateSnippet(signal.promptSnippet);
    }
    if (!existing.resumeCommand && signal.resumeCommand) {
      existing.resumeCommand = signal.resumeCommand;
    }
    return existing;
  }

  const created: CompiledSessionAccumulator = {
    provider: signal.provider,
    sessionId: signal.sessionId,
    updatedAt: signal.updatedAt,
    promptSnippet: truncateSnippet(signal.promptSnippet),
    promptHistory: new Set(signal.promptHistory),
    matchedFiles: new Set<string>(),
    matchedChangedFiles: new Set<string>(),
    matchedReadFiles: new Set<string>(),
    matchedWrittenFiles: new Set<string>(),
    repeatedReadFiles: new Set<string>(),
    toolNames: new Set(signal.toolNames),
    failedReadSignals: [],
    resumeCommand: signal.resumeCommand,
    frictionScore: 0,
  };
  map.set(key, created);
  return created;
}

function collectFeatureFiles(
  feature: FeatureTreeFeature | undefined,
  maxFiles: number,
): string[] {
  if (!feature) {
    return [];
  }
  return trimTo(uniqueSorted(feature.sourceFiles), maxFiles);
}

function inferFilesFromSessionIds(
  historySessionIds: string[] | undefined,
  fileSignals: Record<string, { sessions: FileSessionSignal[] }>,
  maxFiles: number,
): string[] {
  if (!historySessionIds || historySessionIds.length === 0) {
    return [];
  }

  const wanted = new Set(historySessionIds);
  const inferred = Object.entries(fileSignals)
    .filter(([, signal]) => signal.sessions.some((session) => wanted.has(session.sessionId)))
    .map(([filePath]) => filePath);

  return trimTo(uniqueSorted(inferred), maxFiles);
}

function recommendTooling(
  taskType: TaskAdaptiveHarnessTaskType | undefined,
  role: string | undefined,
): Pick<TaskAdaptiveHarnessPack, "recommendedToolMode" | "recommendedMcpProfile" | "recommendedAllowedNativeTools"> {
  if (taskType === "planning") {
    return {
      recommendedToolMode: "essential",
      recommendedMcpProfile: "kanban-planning",
      recommendedAllowedNativeTools: ["Read", "Grep", "Glob"],
    };
  }

  if (taskType === "analysis" || taskType === "review") {
    return {
      recommendedToolMode: "essential",
      recommendedAllowedNativeTools: ["Read", "Grep", "Glob"],
    };
  }

  if (role?.toUpperCase() === "ROUTA") {
    return {
      recommendedToolMode: "essential",
      recommendedMcpProfile: "team-coordination",
    };
  }

  return {};
}

function formatBulletList(values: string[], emptyLabel: string): string {
  if (values.length === 0) {
    return `- ${emptyLabel}`;
  }
  return values.map((value) => `- ${value}`).join("\n");
}

function buildHarnessSummary(input: {
  locale: string;
  taskLabel?: string;
  featureName?: string;
  featureId?: string;
  selectedFiles: string[];
  matchedSessionIds: string[];
  failures: TaskAdaptiveHarnessFailureSignal[];
  repeatedReadFiles: string[];
  sessions: TaskAdaptiveHarnessSessionSummary[];
  warnings: string[];
}): string {
  const isZh = input.locale.startsWith("zh");
  const none = isZh ? "无" : "None";
  const taskLabel = input.taskLabel ?? (isZh ? "未命名任务" : "Unnamed task");
  const featureLabel = input.featureName
    ? `${input.featureName}${input.featureId ? ` (${input.featureId})` : ""}`
    : (input.featureId ?? none);

  const failureLines = trimTo(input.failures, MAX_FAILURE_SIGNALS).map((failure) =>
    `${failure.provider}:${failure.sessionId} | ${failure.toolName} | ${failure.message}${failure.command ? ` | ${failure.command}` : ""}`);
  const sessionLines = input.sessions.map((session) => {
    const relevantFiles = session.matchedFiles.length > 0 ? session.matchedFiles.join(", ") : none;
    const failedReads = session.failedReadSignals.length;
    const repeatedReads = session.repeatedReadFiles.length;
    const tools = session.toolNames.slice(0, MAX_TOOLS_PER_SESSION).join(", ") || none;
    const promptSnippet = session.promptSnippet || none;
    return [
      `- ${session.provider}:${session.sessionId} | ${session.updatedAt || "-"} | ${isZh ? "失败读取" : "failed reads"} ${failedReads} | ${isZh ? "重复读取" : "repeated reads"} ${repeatedReads}`,
      `  ${isZh ? "相关文件" : "Relevant files"}: ${relevantFiles}`,
      `  ${isZh ? "工具" : "Tools"}: ${tools}`,
      `  ${isZh ? "Prompt" : "Prompt"}: ${promptSnippet}`,
    ].join("\n");
  });

  const guidance = isZh
    ? [
        "- 先从上面的高优先级失败和重复读取文件入手，不要一开始就做大范围仓库搜索。",
        "- 如果再次出现读取失败，先确认 repo root / branch / worktree，而不是继续盲读其它文件。",
      ]
    : [
        "- Start from the high-priority failures and repeated-read files above before broad repo search.",
        "- If reads fail again, verify repo root / branch / worktree before continuing exploration.",
      ];

  return [
    isZh ? "## Task-Adaptive Harness" : "## Task-Adaptive Harness",
    "",
    isZh ? "把下面这些 history-session 信号当作当前任务的预加载上下文。优先关注失败读取、路径错误、权限错误和重复读取。" : "Treat the following history-session evidence as preloaded context for the current task. Prioritize failed reads, path errors, permission errors, and repeated reads.",
    "",
    isZh ? "### 任务范围" : "### Task Scope",
    `- ${isZh ? "任务" : "Task"}: ${taskLabel}`,
    `- ${isZh ? "Feature" : "Feature"}: ${featureLabel}`,
    `- ${isZh ? "选中文件" : "Selected files"}: ${input.selectedFiles.length}`,
    `- ${isZh ? "匹配会话" : "Matched sessions"}: ${input.matchedSessionIds.length}`,
    "",
    isZh ? "### 高优先级摩擦信号" : "### High-Priority Friction Signals",
    formatBulletList(failureLines, isZh ? "没有高信号读取失败" : "No high-signal read failures"),
    "",
    isZh ? "### 重复读取文件" : "### Repeated-Read Files",
    formatBulletList(input.repeatedReadFiles, isZh ? "没有高信号重复读取" : "No high-signal repeated reads"),
    "",
    isZh ? "### 已恢复的相关文件" : "### Recovered Relevant Files",
    formatBulletList(input.selectedFiles, none),
    "",
    isZh ? "### 相关历史会话" : "### Relevant History Sessions",
    sessionLines.length > 0 ? sessionLines.join("\n") : `- ${none}`,
    "",
    isZh ? "### 使用建议" : "### Working Guidance",
    guidance.join("\n"),
    ...(input.warnings.length > 0
      ? [
          "",
          isZh ? "### 警告" : "### Warnings",
          formatBulletList(input.warnings, none),
        ]
      : []),
  ].join("\n");
}

export async function assembleTaskAdaptiveHarness(
  repoRoot: string,
  options: TaskAdaptiveHarnessOptions = {},
): Promise<TaskAdaptiveHarnessPack> {
  const locale = options.locale ?? "en";
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const warnings: string[] = [];

  const featureTree = { features: readFeatureTreeFeatures(repoRoot) };
  const feature = options.featureId
    ? featureTree.features.find((item) => item.id === options.featureId)
    : undefined;

  if (options.featureId && !feature) {
    warnings.push(`Feature not found: ${options.featureId}`);
  }

  const fileSignals = collectTaskAdaptiveFileSignals(repoRoot);
  const selectedFiles = trimTo(
    uniqueSorted([
      ...(options.filePaths ?? []),
      ...collectFeatureFiles(feature, maxFiles),
      ...inferFilesFromSessionIds(options.historySessionIds, fileSignals, maxFiles),
    ]),
    maxFiles,
  );

  if (selectedFiles.length === 0) {
    warnings.push("No task-adaptive files could be resolved from the current request.");
  }

  const filteredSessionIds = options.historySessionIds ? new Set(options.historySessionIds) : undefined;
  const sessionsByKey = new Map<string, CompiledSessionAccumulator>();

  for (const filePath of selectedFiles) {
    const signal = fileSignals[filePath];
    if (!signal) {
      continue;
    }

    for (const session of signal.sessions) {
      if (filteredSessionIds && !filteredSessionIds.has(session.sessionId)) {
        continue;
      }

      const compiled = ensureAccumulator(sessionsByKey, session);
      compiled.matchedFiles.add(filePath);

      for (const prompt of session.promptHistory) {
        compiled.promptHistory.add(prompt);
      }
      for (const toolName of session.toolNames) {
        compiled.toolNames.add(toolName);
      }

      for (const changedFile of session.changedFiles ?? []) {
        if (selectedFiles.includes(changedFile)) {
          compiled.matchedChangedFiles.add(changedFile);
        }
      }

      const diagnostics = session.diagnostics;
      if (!diagnostics) {
        continue;
      }

      for (const readFile of diagnostics.readFiles) {
        if (selectedFiles.includes(readFile)) {
          compiled.matchedReadFiles.add(readFile);
        }
      }

      for (const writtenFile of diagnostics.writtenFiles) {
        if (selectedFiles.includes(writtenFile)) {
          compiled.matchedWrittenFiles.add(writtenFile);
        }
      }

      for (const repeatedRead of diagnostics.repeatedReadFiles) {
        const normalizedRepeatedRead = normalizeRepeatedReadFile(repeatedRead);
        if (selectedFiles.includes(normalizedRepeatedRead)) {
          compiled.repeatedReadFiles.add(normalizedRepeatedRead);
        }
      }

      for (const failure of diagnostics.failedTools) {
        if (!isHighSignalReadFailure(failure)) {
          continue;
        }
        compiled.failedReadSignals.push({
          provider: session.provider,
          sessionId: session.sessionId,
          message: failure.message,
          toolName: failure.toolName,
          command: failure.command,
        });
      }
    }
  }

  const compiledSessions = [...sessionsByKey.values()]
    .map((session) => {
      session.frictionScore = (session.failedReadSignals.length * 10)
        + (session.repeatedReadFiles.size * 4)
        + (session.matchedReadFiles.size * 2)
        + session.matchedChangedFiles.size;
      return session;
    })
    .sort((left, right) =>
      right.frictionScore - left.frictionScore
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.sessionId.localeCompare(right.sessionId),
    );

  const sessions = trimTo(compiledSessions, maxSessions).map<TaskAdaptiveHarnessSessionSummary>((session) => ({
    provider: session.provider,
    sessionId: session.sessionId,
    updatedAt: session.updatedAt,
    promptSnippet: session.promptSnippet || truncateSnippet([...session.promptHistory][0]),
    matchedFiles: uniqueSorted(session.matchedFiles),
    matchedChangedFiles: uniqueSorted(session.matchedChangedFiles),
    matchedReadFiles: uniqueSorted(session.matchedReadFiles),
    matchedWrittenFiles: uniqueSorted(session.matchedWrittenFiles),
    repeatedReadFiles: uniqueSorted(session.repeatedReadFiles),
    toolNames: trimTo(uniqueSorted(session.toolNames), MAX_TOOLS_PER_SESSION),
    failedReadSignals: trimTo(session.failedReadSignals, MAX_FAILURE_SIGNALS),
    ...(session.resumeCommand ? { resumeCommand: session.resumeCommand } : {}),
  }));

  const failures = trimTo(
    sessions.flatMap((session) => session.failedReadSignals),
    MAX_FAILURE_SIGNALS,
  );
  const repeatedReadFiles = trimTo(
    uniqueSorted(sessions.flatMap((session) => session.repeatedReadFiles)),
    MAX_REPEATED_READS,
  );
  const matchedSessionIds = sessions.map((session) => session.sessionId);
  const recommendations = recommendTooling(options.taskType, options.role);

  return {
    summary: buildHarnessSummary({
      locale,
      taskLabel: options.taskLabel,
      featureName: feature?.name,
      featureId: feature?.id ?? options.featureId,
      selectedFiles,
      matchedSessionIds,
      failures,
      repeatedReadFiles,
      sessions,
      warnings,
    }),
    warnings,
    featureId: feature?.id ?? options.featureId,
    featureName: feature?.name,
    selectedFiles,
    matchedSessionIds,
    failures,
    repeatedReadFiles,
    sessions,
    ...recommendations,
  };
}
