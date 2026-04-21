import * as fs from "fs";
import * as path from "path";
import type { McpServerProfile } from "@/core/mcp/mcp-server-profiles";
import {
  readFeatureSurfaceIndex,
  type FeatureSurfaceIndexResponse,
  type FeatureSurfaceMetadataItem,
} from "@/core/spec/feature-surface-index";
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
  query?: string;
  featureId?: string;
  featureIds?: string[];
  filePaths?: string[];
  routeCandidates?: string[];
  apiCandidates?: string[];
  historySessionIds?: string[];
  moduleHints?: string[];
  symptomHints?: string[];
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

export type TaskAdaptiveMatchConfidence = "high" | "medium" | "low";

export interface TaskAdaptiveMatchedFileDetail {
  filePath: string;
  changes: number;
  sessions: number;
  updatedAt: string;
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

export interface TaskAdaptiveHistorySeedSessionSummary {
  provider: string;
  sessionId: string;
  updatedAt: string;
  promptSnippet: string;
  touchedFiles: string[];
  repeatedReadFiles: string[];
  toolNames: string[];
  failedReadSignals: TaskAdaptiveHarnessFailureSignal[];
}

export interface TaskAdaptiveHistorySummary {
  overview: string;
  seedSessionCount: number;
  recoveredSessionCount: number;
  matchedFileCount: number;
  seedSessions: TaskAdaptiveHistorySeedSessionSummary[];
}

export interface TaskAdaptiveHarnessPack {
  summary: string;
  historySummary?: TaskAdaptiveHistorySummary;
  warnings: string[];
  featureId?: string;
  featureName?: string;
  matchConfidence: TaskAdaptiveMatchConfidence;
  matchReasons: string[];
  selectedFiles: string[];
  matchedFileDetails: TaskAdaptiveMatchedFileDetail[];
  matchedSessionIds: string[];
  failures: TaskAdaptiveHarnessFailureSignal[];
  repeatedReadFiles: string[];
  sessions: TaskAdaptiveHarnessSessionSummary[];
  frictionProfiles: TaskAdaptiveFrictionProfile[];
  recommendedToolMode?: "essential" | "full";
  recommendedMcpProfile?: McpServerProfile;
  recommendedAllowedNativeTools?: string[];
}

export type TaskAdaptiveFrictionProfileScope = "file" | "feature";

export interface TaskAdaptiveFrictionProfile {
  scope: TaskAdaptiveFrictionProfileScope;
  targetId: string;
  targetLabel: string;
  generatedAt: string;
  updatedAt: string;
  featureId?: string;
  featureName?: string;
  selectedFiles: string[];
  matchedFileDetails: TaskAdaptiveMatchedFileDetail[];
  matchedSessionIds: string[];
  failures: TaskAdaptiveHarnessFailureSignal[];
  repeatedReadFiles: string[];
  sessions: TaskAdaptiveHarnessSessionSummary[];
}

export interface TaskAdaptiveFrictionProfileSnapshot {
  generatedAt: string;
  thresholds: {
    minFileSessions: number;
    minFeatureSessions: number;
  };
  fileProfiles: Record<string, TaskAdaptiveFrictionProfile>;
  featureProfiles: Record<string, TaskAdaptiveFrictionProfile>;
}

export interface FileSessionContextSessionSummary {
  provider: string;
  sessionId: string;
  updatedAt: string;
  promptSnippet: string;
  openingPrompt?: string;
  promptHistory: string[];
  matchedFiles: string[];
  matchedChangedFiles: string[];
  matchedReadFiles: string[];
  matchedWrittenFiles: string[];
  relatedFiles: string[];
  repeatedReadFiles: string[];
  repeatedCommands: string[];
  toolNames: string[];
  failedReadSignals: TaskAdaptiveHarnessFailureSignal[];
  failedTools: FileSessionToolFailure[];
  resumeCommand?: string;
}

export interface FileSessionContextPromptSignal {
  provider: string;
  sessionId: string;
  updatedAt: string;
  openingPrompt: string;
  followUpPrompts: string[];
}

export interface FileSessionContextScopeDriftSignal {
  provider: string;
  sessionId: string;
  updatedAt: string;
  reason: string;
  openingPrompt: string;
  laterPrompts: string[];
}

export interface FileSessionContextFrictionSignal {
  provider: string;
  sessionId: string;
  updatedAt: string;
  category: string;
  detail: string;
  evidence: string;
  toolName?: string;
  command?: string;
}

export interface FileSessionContextHotspot {
  value: string;
  count: number;
  sessions: string[];
}

export interface FileSessionContextSummary {
  featureId?: string;
  featureName?: string;
  matchConfidence: TaskAdaptiveMatchConfidence;
  matchReasons: string[];
  selectedFiles: string[];
  focusFiles: string[];
  matchedFileDetails: TaskAdaptiveMatchedFileDetail[];
  matchedSessionIds: string[];
  directSessions: FileSessionContextSessionSummary[];
  adjacentSessions: FileSessionContextSessionSummary[];
  weakSessions: FileSessionContextSessionSummary[];
  openingPrompts: FileSessionContextPromptSignal[];
  scopeDriftSignals: FileSessionContextScopeDriftSignal[];
  inputFrictions: FileSessionContextFrictionSignal[];
  environmentFrictions: FileSessionContextFrictionSignal[];
  repeatedFileHotspots: FileSessionContextHotspot[];
  repeatedCommandHotspots: FileSessionContextHotspot[];
  transcriptHints: string[];
  warnings: string[];
}

export interface RefreshTaskAdaptiveFrictionProfilesOptions {
  minFileSessions?: number;
  minFeatureSessions?: number;
  maxFiles?: number;
  maxSessions?: number;
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

type TaskAdaptiveInferenceSeed = {
  featureIds: string[];
  filePaths: string[];
  pageFiles: string[];
  apiFiles: string[];
  signalFiles: string[];
  matchedRoutes: string[];
  matchedApis: string[];
};

const DEFAULT_MAX_FILES = 8;
const DEFAULT_MAX_SESSIONS = 6;
const MAX_INFERRED_FEATURES = 3;
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
const TASK_ADAPTIVE_FRICTION_PROFILES_PATH = ".routa/feature-explorer/friction-profiles.json";
const DEFAULT_MIN_FILE_PROFILE_SESSIONS = 2;
const DEFAULT_MIN_FEATURE_PROFILE_SESSIONS = 2;
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
const TASK_ADAPTIVE_HINT_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "card",
  "task",
  "story",
  "read",
  "path",
  "file",
  "files",
  "context",
  "jit",
  "feature",
]);

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

function normalizeUniqueStringArray(values: readonly string[] | undefined): string[] {
  return [...new Set(
    (values ?? [])
      .map((value) => normalizeString(value))
      .filter((value): value is string => Boolean(value)),
  )];
}

function mergePreferredStringGroups(
  ...groups: Array<readonly string[] | undefined>
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const value of group ?? []) {
      const normalized = normalizeString(value);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      merged.push(normalized);
    }
  }

  return merged;
}

function mergeRequestedFeatureIds(
  options: TaskAdaptiveHarnessOptions,
  inferredFeatureIds: readonly string[],
): string[] {
  return mergePreferredStringGroups(
    options.featureId ? [options.featureId] : undefined,
    options.featureIds,
    inferredFeatureIds,
  );
}

function collectExplicitFeatureIds(options: TaskAdaptiveHarnessOptions): string[] {
  return mergePreferredStringGroups(
    options.featureId ? [options.featureId] : undefined,
    options.featureIds,
  );
}

function collectPreferredFeatureFiles(
  options: TaskAdaptiveHarnessOptions,
  features: readonly FeatureTreeFeature[],
  maxFiles: number,
): string[] {
  const explicitFeatureIds = new Set(collectExplicitFeatureIds(options));
  const explicitFeatureFiles = features
    .filter((feature) => explicitFeatureIds.has(feature.id))
    .flatMap((feature) => collectFeatureFiles(feature, maxFiles));
  const inferredFeatureFiles = features
    .filter((feature) => !explicitFeatureIds.has(feature.id))
    .flatMap((feature) => collectFeatureFiles(feature, maxFiles));

  return mergePreferredStringGroups(explicitFeatureFiles, inferredFeatureFiles);
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

function featureTreeFeatureFromMetadata(
  feature: FeatureSurfaceMetadataItem,
): FeatureTreeFeature | null {
  const id = normalizeString(feature.id) ?? "";
  const name = normalizeString(feature.name) ?? "";
  if (!id && !name) {
    return null;
  }

  return {
    id,
    name,
    group: normalizeString(feature.group) ?? "",
    summary: normalizeString(feature.summary) ?? "",
    status: normalizeString(feature.status) ?? "",
    pages: feature.pages ?? [],
    apis: feature.apis ?? [],
    sourceFiles: feature.sourceFiles ?? [],
    relatedFeatures: feature.relatedFeatures ?? [],
    domainObjects: feature.domainObjects ?? [],
  };
}

function mergeFeatureTreeFeatures(
  fileFeatures: FeatureTreeFeature[],
  surfaceIndex: FeatureSurfaceIndexResponse,
): FeatureTreeFeature[] {
  const merged = new Map<string, FeatureTreeFeature>();

  for (const feature of fileFeatures) {
    const key = feature.id || feature.name;
    if (!key) {
      continue;
    }
    merged.set(key, feature);
  }

  for (const metadataFeature of surfaceIndex.metadata?.features ?? []) {
    const normalized = featureTreeFeatureFromMetadata(metadataFeature);
    if (!normalized) {
      continue;
    }
    const key = normalized.id || normalized.name;
    if (!key || merged.has(key)) {
      continue;
    }
    merged.set(key, normalized);
  }

  return [...merged.values()];
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

function taskAdaptiveFrictionProfilesPath(repoRoot: string): string {
  return path.join(repoRoot, TASK_ADAPTIVE_FRICTION_PROFILES_PATH);
}

function dedupeFailureSignals(
  failures: TaskAdaptiveHarnessFailureSignal[],
  limit = MAX_FAILURE_SIGNALS,
): TaskAdaptiveHarnessFailureSignal[] {
  const seen = new Set<string>();
  const deduped: TaskAdaptiveHarnessFailureSignal[] = [];

  for (const failure of failures) {
    const key = [
      failure.provider,
      failure.sessionId,
      failure.toolName,
      failure.message,
      failure.command ?? "",
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(failure);
    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

function mergeSessionSummaries(
  sessions: TaskAdaptiveHarnessSessionSummary[],
  maxSessions: number,
): TaskAdaptiveHarnessSessionSummary[] {
  const merged = new Map<string, TaskAdaptiveHarnessSessionSummary>();

  for (const session of sessions) {
    const key = `${session.provider}:${session.sessionId}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...session,
        matchedFiles: [...session.matchedFiles],
        matchedChangedFiles: [...session.matchedChangedFiles],
        matchedReadFiles: [...session.matchedReadFiles],
        matchedWrittenFiles: [...session.matchedWrittenFiles],
        repeatedReadFiles: [...session.repeatedReadFiles],
        toolNames: [...session.toolNames],
        failedReadSignals: [...session.failedReadSignals],
      });
      continue;
    }

    existing.updatedAt = existing.updatedAt > session.updatedAt ? existing.updatedAt : session.updatedAt;
    if (!existing.promptSnippet && session.promptSnippet) {
      existing.promptSnippet = session.promptSnippet;
    }
    if (!existing.resumeCommand && session.resumeCommand) {
      existing.resumeCommand = session.resumeCommand;
    }
    existing.matchedFiles = uniqueSorted([...existing.matchedFiles, ...session.matchedFiles]);
    existing.matchedChangedFiles = uniqueSorted([...existing.matchedChangedFiles, ...session.matchedChangedFiles]);
    existing.matchedReadFiles = uniqueSorted([...existing.matchedReadFiles, ...session.matchedReadFiles]);
    existing.matchedWrittenFiles = uniqueSorted([...existing.matchedWrittenFiles, ...session.matchedWrittenFiles]);
    existing.repeatedReadFiles = uniqueSorted([...existing.repeatedReadFiles, ...session.repeatedReadFiles]);
    existing.toolNames = trimTo(uniqueSorted([...existing.toolNames, ...session.toolNames]), MAX_TOOLS_PER_SESSION);
    existing.failedReadSignals = dedupeFailureSignals(
      [...existing.failedReadSignals, ...session.failedReadSignals],
      MAX_FAILURE_SIGNALS,
    );
  }

  return trimTo(
    [...merged.values()].sort((left, right) =>
      (
        (right.failedReadSignals.length * 10)
        + (right.repeatedReadFiles.length * 4)
        + (right.matchedReadFiles.length * 2)
        + right.matchedChangedFiles.length
      ) - (
        (left.failedReadSignals.length * 10)
        + (left.repeatedReadFiles.length * 4)
        + (left.matchedReadFiles.length * 2)
        + left.matchedChangedFiles.length
      )
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.sessionId.localeCompare(right.sessionId),
    ),
    maxSessions,
  );
}

function loadTaskAdaptiveFrictionProfilesSnapshot(repoRoot: string): TaskAdaptiveFrictionProfileSnapshot | null {
  const snapshotPath = taskAdaptiveFrictionProfilesPath(repoRoot);
  if (!fs.existsSync(snapshotPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(snapshotPath, "utf8");
    const parsed = JSON.parse(raw) as TaskAdaptiveFrictionProfileSnapshot | null;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      generatedAt: normalizeString(parsed.generatedAt) ?? "",
      thresholds: {
        minFileSessions: parsed.thresholds?.minFileSessions ?? DEFAULT_MIN_FILE_PROFILE_SESSIONS,
        minFeatureSessions: parsed.thresholds?.minFeatureSessions ?? DEFAULT_MIN_FEATURE_PROFILE_SESSIONS,
      },
      fileProfiles: parsed.fileProfiles ?? {},
      featureProfiles: parsed.featureProfiles ?? {},
    };
  } catch {
    return null;
  }
}

function persistTaskAdaptiveFrictionProfilesSnapshot(
  repoRoot: string,
  snapshot: TaskAdaptiveFrictionProfileSnapshot,
): void {
  const snapshotPath = taskAdaptiveFrictionProfilesPath(repoRoot);
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
}

function buildTaskAdaptiveMatchDiagnostics(params: {
  locale: string;
  explicitFileCount: number;
  explicitFeatureCount: number;
  historySessionCount: number;
  selectedFiles: string[];
  matchedSessionIds: string[];
  inferenceSeed: TaskAdaptiveInferenceSeed;
  frictionProfiles: TaskAdaptiveFrictionProfile[];
}): { confidence: TaskAdaptiveMatchConfidence; reasons: string[] } {
  const isZh = params.locale.startsWith("zh");
  const reasons: string[] = [];

  if (params.explicitFileCount > 0) {
    reasons.push(isZh
      ? `从卡片已知的 relatedFiles 直接启动，包含 ${params.explicitFileCount} 个显式文件。`
      : `Started from ${params.explicitFileCount} explicit related files on the card.`);
  }

  if (params.explicitFeatureCount > 0) {
    reasons.push(isZh
      ? `使用了 ${params.explicitFeatureCount} 个显式 feature 候选来扩展源码范围。`
      : `Expanded source files from ${params.explicitFeatureCount} explicit feature candidates.`);
  }

  if (params.historySessionCount > 0) {
    reasons.push(isZh
      ? `复用了 ${params.historySessionCount} 个已关联 history session 作为上下文种子。`
      : `Reused ${params.historySessionCount} linked history sessions as retrieval seeds.`);
  }

  if (params.inferenceSeed.matchedRoutes.length > 0) {
    reasons.push(isZh
      ? `根据路由线索命中 ${params.inferenceSeed.matchedRoutes.length} 个页面入口。`
      : `Matched ${params.inferenceSeed.matchedRoutes.length} route hints to page entry points.`);
  }

  if (params.inferenceSeed.matchedApis.length > 0) {
    reasons.push(isZh
      ? `根据 API 线索命中 ${params.inferenceSeed.matchedApis.length} 个实现入口。`
      : `Matched ${params.inferenceSeed.matchedApis.length} API hints to implementation entry points.`);
  }

  if (params.inferenceSeed.featureIds.length > 0) {
    reasons.push(isZh
      ? `根据任务标题和搜索线索收敛出 ${params.inferenceSeed.featureIds.length} 个 feature 候选。`
      : `Narrowed the search to ${params.inferenceSeed.featureIds.length} feature candidates from task/search hints.`);
  }

  if (params.inferenceSeed.signalFiles.length > 0) {
    reasons.push(isZh
      ? `在 feature/file 线索不足时，根据 history-session prompt 和文件信号补回了 ${params.inferenceSeed.signalFiles.length} 个文件。`
      : `Recovered ${params.inferenceSeed.signalFiles.length} files from history-session prompt and file signals when feature hints were weak.`);
  }

  if (params.frictionProfiles.length > 0) {
    reasons.push(isZh
      ? `命中了 ${params.frictionProfiles.length} 个可复用 friction profile。`
      : `Matched ${params.frictionProfiles.length} reusable friction profiles.`);
  }

  if (params.matchedSessionIds.length > 0) {
    reasons.push(isZh
      ? `最终从选中文件中恢复出 ${params.matchedSessionIds.length} 个相关历史会话。`
      : `Recovered ${params.matchedSessionIds.length} relevant history sessions from the selected files.`);
  }

  const explicitSeedStrength = params.explicitFileCount + params.explicitFeatureCount + params.historySessionCount;
  const structuredSeedStrength = params.inferenceSeed.matchedRoutes.length
    + params.inferenceSeed.matchedApis.length
    + params.inferenceSeed.featureIds.length;

  let confidence: TaskAdaptiveMatchConfidence = "low";
  if (explicitSeedStrength > 0 || params.frictionProfiles.length > 0) {
    confidence = params.matchedSessionIds.length > 0 || params.selectedFiles.length > 0 ? "high" : "medium";
  } else if (structuredSeedStrength > 0) {
    confidence = params.selectedFiles.length >= 2 ? "medium" : "low";
  } else if (params.inferenceSeed.signalFiles.length > 0) {
    confidence = params.matchedSessionIds.length >= 2 ? "medium" : "low";
  }

  return {
    confidence,
    reasons,
  };
}

function buildTaskAdaptiveHarnessPack(params: {
  locale: string;
  taskLabel?: string;
  primaryFeature?: FeatureTreeFeature;
  requestedFeatureIds: string[];
  explicitFileCount?: number;
  explicitFeatureCount?: number;
  historySessionCount?: number;
  inferenceSeed?: TaskAdaptiveInferenceSeed;
  selectedFiles: string[];
  matchedFileDetails: TaskAdaptiveMatchedFileDetail[];
  sessions: TaskAdaptiveHarnessSessionSummary[];
  warnings: string[];
  taskType?: TaskAdaptiveHarnessTaskType;
  role?: string;
  frictionProfiles?: TaskAdaptiveFrictionProfile[];
}): TaskAdaptiveHarnessPack {
  const failures = trimTo(
    dedupeFailureSignals(params.sessions.flatMap((session) => session.failedReadSignals), MAX_FAILURE_SIGNALS),
    MAX_FAILURE_SIGNALS,
  );
  const repeatedReadFiles = trimTo(
    uniqueSorted(params.sessions.flatMap((session) => session.repeatedReadFiles)),
    MAX_REPEATED_READS,
  );
  const matchedSessionIds = params.sessions.map((session) => session.sessionId);
  const recommendations = recommendTooling(params.taskType, params.role);
  const frictionProfiles = params.frictionProfiles ?? [];
  const matchDiagnostics = buildTaskAdaptiveMatchDiagnostics({
    locale: params.locale,
    explicitFileCount: params.explicitFileCount ?? 0,
    explicitFeatureCount: params.explicitFeatureCount ?? 0,
    historySessionCount: params.historySessionCount ?? 0,
    selectedFiles: params.selectedFiles,
    matchedSessionIds,
    inferenceSeed: params.inferenceSeed ?? {
      featureIds: [],
      filePaths: [],
      pageFiles: [],
      apiFiles: [],
      signalFiles: [],
      matchedRoutes: [],
      matchedApis: [],
    },
    frictionProfiles,
  });

  return {
    summary: buildHarnessSummary({
      locale: params.locale,
      taskLabel: params.taskLabel,
      featureName: params.primaryFeature?.name,
      featureId: params.primaryFeature?.id ?? params.requestedFeatureIds[0],
      matchConfidence: matchDiagnostics.confidence,
      matchReasons: matchDiagnostics.reasons,
      selectedFiles: params.selectedFiles,
      matchedFileDetails: params.matchedFileDetails,
      matchedSessionIds,
      failures,
      repeatedReadFiles,
      sessions: params.sessions,
      warnings: params.warnings,
      frictionProfiles,
    }),
    warnings: params.warnings,
    featureId: params.primaryFeature?.id ?? params.requestedFeatureIds[0],
    featureName: params.primaryFeature?.name,
    matchConfidence: matchDiagnostics.confidence,
    matchReasons: matchDiagnostics.reasons,
    selectedFiles: params.selectedFiles,
    matchedFileDetails: params.matchedFileDetails,
    matchedSessionIds,
    failures,
    repeatedReadFiles,
    sessions: params.sessions,
    frictionProfiles,
    ...recommendations,
  };
}

function selectStoredFrictionProfiles(
  snapshot: TaskAdaptiveFrictionProfileSnapshot | null,
  selectedFiles: string[],
  requestedFeatureIds: string[],
): TaskAdaptiveFrictionProfile[] {
  if (!snapshot) {
    return [];
  }

  const profiles: TaskAdaptiveFrictionProfile[] = [];
  const seen = new Set<string>();

  for (const filePath of selectedFiles) {
    const profile = snapshot.fileProfiles[filePath];
    if (!profile) {
      continue;
    }
    const key = `${profile.scope}:${profile.targetId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    profiles.push(profile);
  }

  for (const featureId of requestedFeatureIds) {
    const profile = snapshot.featureProfiles[featureId];
    if (!profile) {
      continue;
    }
    const key = `${profile.scope}:${profile.targetId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    profiles.push(profile);
  }

  return profiles;
}

function canHydrateTaskAdaptiveHarnessFromProfiles(params: {
  selectedFiles: string[];
  requestedFeatureIds: string[];
  historySessionIds?: string[];
  snapshot: TaskAdaptiveFrictionProfileSnapshot | null;
}): boolean {
  if (!params.snapshot || (params.historySessionIds?.length ?? 0) > 0) {
    return false;
  }

  const { fileProfiles, featureProfiles } = params.snapshot;
  const hasFiles = params.selectedFiles.length > 0;
  const hasFeatures = params.requestedFeatureIds.length > 0;

  return (hasFiles && params.selectedFiles.every((filePath) => Boolean(fileProfiles[filePath])))
    || (hasFeatures && params.requestedFeatureIds.every((featureId) => Boolean(featureProfiles[featureId])));
}

function mergeProfilesIntoTaskAdaptiveHarnessPack(
  locale: string,
  taskLabel: string | undefined,
  primaryFeature: FeatureTreeFeature | undefined,
  requestedFeatureIds: string[],
  inferenceSeed: TaskAdaptiveInferenceSeed,
  explicitFileCount: number,
  explicitFeatureCount: number,
  historySessionCount: number,
  selectedFiles: string[],
  matchedFileDetails: TaskAdaptiveMatchedFileDetail[],
  warnings: string[],
  taskType: TaskAdaptiveHarnessTaskType | undefined,
  role: string | undefined,
  profiles: TaskAdaptiveFrictionProfile[],
  maxSessions: number,
): TaskAdaptiveHarnessPack {
  const sessions = mergeSessionSummaries(
    profiles.flatMap((profile) => profile.sessions),
    maxSessions,
  );
  const mergedSelectedFiles = uniqueSorted([
    ...selectedFiles,
    ...profiles.flatMap((profile) => profile.selectedFiles),
  ]);
  const mergedMatchedFileDetails = mergeMatchedFileDetails([
    ...matchedFileDetails,
    ...profiles.flatMap((profile) =>
      profile.matchedFileDetails.length > 0
        ? profile.matchedFileDetails
        : profile.selectedFiles.map((filePath) => ({
          filePath,
          changes: 0,
          sessions: profile.matchedSessionIds.length,
          updatedAt: profile.updatedAt,
        }))
    ),
  ]);
  const mergedWarnings = [
    ...warnings,
    `Loaded ${profiles.length} reusable friction profile${profiles.length === 1 ? "" : "s"} before transcript fallback.`,
  ];

  return buildTaskAdaptiveHarnessPack({
    locale,
    taskLabel,
    primaryFeature,
    requestedFeatureIds,
    explicitFileCount,
    explicitFeatureCount,
    historySessionCount,
    inferenceSeed,
    selectedFiles: mergedSelectedFiles,
    matchedFileDetails: mergedMatchedFileDetails,
    sessions,
    warnings: mergedWarnings,
    taskType,
    role,
    frictionProfiles: profiles,
  });
}

function toTaskAdaptiveFrictionProfile(
  scope: TaskAdaptiveFrictionProfileScope,
  targetId: string,
  targetLabel: string,
  generatedAt: string,
  pack: TaskAdaptiveHarnessPack,
): TaskAdaptiveFrictionProfile {
  const updatedAt = pack.sessions[0]?.updatedAt
    ?? pack.frictionProfiles[0]?.updatedAt
    ?? generatedAt;

  return {
    scope,
    targetId,
    targetLabel,
    generatedAt,
    updatedAt,
    featureId: pack.featureId,
    featureName: pack.featureName,
    selectedFiles: [...pack.selectedFiles],
    matchedFileDetails: pack.matchedFileDetails.map((detail) => ({ ...detail })),
    matchedSessionIds: [...pack.matchedSessionIds],
    failures: [...pack.failures],
    repeatedReadFiles: [...pack.repeatedReadFiles],
    sessions: pack.sessions.map((session) => ({
      ...session,
      matchedFiles: [...session.matchedFiles],
      matchedChangedFiles: [...session.matchedChangedFiles],
      matchedReadFiles: [...session.matchedReadFiles],
      matchedWrittenFiles: [...session.matchedWrittenFiles],
      repeatedReadFiles: [...session.repeatedReadFiles],
      toolNames: [...session.toolNames],
      failedReadSignals: [...session.failedReadSignals],
    })),
  };
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
    query: normalizeString(value.query),
    featureId: normalizeString(value.featureId),
    featureIds: normalizeStringArray(value.featureIds),
    filePaths: normalizeStringArray(value.filePaths),
    routeCandidates: normalizeStringArray(value.routeCandidates),
    apiCandidates: normalizeStringArray(value.apiCandidates),
    historySessionIds: normalizeStringArray(value.historySessionIds),
    moduleHints: normalizeStringArray(value.moduleHints),
    symptomHints: normalizeStringArray(value.symptomHints),
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

function normalizeRouteCandidate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "/") {
    return "/";
  }
  return trimmed.replace(/\/+$/u, "");
}

function normalizeApiCandidate(value: string): { method?: string; path: string } {
  const trimmed = value.trim().replace(/\s+/g, " ");
  const match = trimmed.match(/^([A-Za-z]+)\s+(.+)$/u);
  if (match?.[2]) {
    return {
      method: match[1]?.toUpperCase(),
      path: match[2].trim(),
    };
  }
  return { path: trimmed };
}

function splitHintTokens(values: string[]): string[] {
  const asciiTokens = values.flatMap((value) =>
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !TASK_ADAPTIVE_HINT_STOPWORDS.has(token))
  );
  const cjkTokens = values.flatMap((value) => {
    const segments = value.match(/[\p{Script=Han}]{2,}/gu) ?? [];
    return segments.flatMap((segment) => {
      const tokens = new Set<string>([segment]);
      for (let start = 0; start < segment.length; start += 1) {
        for (let width = 2; width <= 4; width += 1) {
          const token = segment.slice(start, start + width);
          if (token.length >= 2) {
            tokens.add(token);
          }
        }
      }
      return [...tokens];
    });
  });

  return uniqueSorted([...asciiTokens, ...cjkTokens]);
}

function countTokenMatches(haystack: string, tokens: string[]): number {
  if (tokens.length === 0) {
    return 0;
  }

  const lowered = haystack.toLowerCase();
  return tokens.reduce((score, token) => score + (lowered.includes(token) ? 1 : 0), 0);
}

function featureApiMatchesCandidate(featureApis: string[], candidate: { method?: string; path: string }): boolean {
  const candidatePath = candidate.path.trim().toLowerCase();
  if (!candidatePath) {
    return false;
  }

  return featureApis.some((api) => {
    const normalized = api.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (candidate.method) {
      return normalized === `${candidate.method.toLowerCase()} ${candidatePath}`
        || normalized.endsWith(` ${candidatePath}`);
    }
    return normalized === candidatePath || normalized.endsWith(` ${candidatePath}`) || normalized.includes(candidatePath);
  });
}

function inferFeatureIdsFromFiles(
  featureTreeFeatures: FeatureTreeFeature[],
  filePaths: string[],
): string[] {
  const fileSet = new Set(filePaths);
  return featureTreeFeatures
    .filter((feature) => feature.sourceFiles.some((filePath) => fileSet.has(filePath)))
    .map((feature) => feature.id)
    .filter(Boolean);
}

function collectTaskAdaptiveHintTexts(options: TaskAdaptiveHarnessOptions): string[] {
  return [
    ...(options.taskLabel ? [options.taskLabel] : []),
    ...(options.query ? [options.query] : []),
    ...normalizeUniqueStringArray(options.moduleHints),
    ...normalizeUniqueStringArray(options.symptomHints),
  ];
}

function inferSignalBackedFiles(input: {
  options: TaskAdaptiveHarnessOptions;
  fileSignals: Record<string, TaskAdaptiveFileSignal>;
  maxFiles: number;
}): string[] {
  const hintTokens = splitHintTokens(collectTaskAdaptiveHintTexts(input.options));

  if (hintTokens.length === 0) {
    return [];
  }

  const scored = Object.entries(input.fileSignals)
    .map(([filePath, signal]) => {
      const signalText = [
        filePath,
        ...signal.promptHistory,
        ...signal.toolHistory,
        ...signal.sessions.flatMap((session) => [
          session.promptSnippet,
          ...(session.changedFiles ?? []),
          ...session.toolNames,
        ]),
      ].join(" ");
      const score = (countTokenMatches(filePath, hintTokens) * 3) + (countTokenMatches(signalText, hintTokens) * 2);
      return { filePath, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));

  return trimTo(scored.map((entry) => entry.filePath), input.maxFiles);
}

function inferTaskAdaptiveSeed(input: {
  options: TaskAdaptiveHarnessOptions;
  featureTreeFeatures: FeatureTreeFeature[];
  surfaceIndex: FeatureSurfaceIndexResponse;
  fileSignals: Record<string, TaskAdaptiveFileSignal>;
  maxFiles: number;
}): TaskAdaptiveInferenceSeed {
  const routeCandidates = normalizeUniqueStringArray(input.options.routeCandidates).map(normalizeRouteCandidate).filter(Boolean);
  const apiCandidates = normalizeUniqueStringArray(input.options.apiCandidates).map(normalizeApiCandidate).filter((candidate) => candidate.path.length > 0);
  const hintTokens = splitHintTokens(collectTaskAdaptiveHintTexts(input.options));

  const pageScores = new Map<string, number>();
  for (const page of input.surfaceIndex.pages) {
    const route = normalizeRouteCandidate(page.route);
    let score = 0;
    if (routeCandidates.includes(route)) {
      score += 12;
    }
    score += countTokenMatches([page.route, page.title, page.description, page.sourceFile].join(" "), hintTokens);
    if (score > 0 && page.sourceFile) {
      pageScores.set(page.sourceFile, score);
    }
  }

  const apiFileScores = new Map<string, number>();
  for (const api of input.surfaceIndex.implementationApis) {
    let score = 0;
    for (const candidate of apiCandidates) {
      const apiPath = api.path.trim().toLowerCase();
      const candidatePath = candidate.path.trim().toLowerCase();
      if (!candidatePath) {
        continue;
      }
      const methodMatches = !candidate.method || candidate.method === api.method.trim().toUpperCase();
      if (methodMatches && (apiPath === candidatePath || apiPath.includes(candidatePath) || candidatePath.includes(apiPath))) {
        score += 12;
      }
    }
    score += countTokenMatches([
      api.domain,
      api.method,
      api.path,
      ...api.sourceFiles,
    ].join(" "), hintTokens);
    if (score > 0) {
      for (const sourceFile of api.sourceFiles) {
        if (!sourceFile) {
          continue;
        }
        apiFileScores.set(sourceFile, Math.max(apiFileScores.get(sourceFile) ?? 0, score));
      }
    }
  }

  const matchedRoutes = routeCandidates.filter((route) =>
    input.surfaceIndex.pages.some((page) => normalizeRouteCandidate(page.route) === route)
  );
  const matchedApis = apiCandidates
    .filter((candidate) =>
      input.surfaceIndex.implementationApis.some((api) => {
        const apiPath = api.path.trim().toLowerCase();
        const candidatePath = candidate.path.trim().toLowerCase();
        if (!candidatePath) {
          return false;
        }
        const methodMatches = !candidate.method || candidate.method === api.method.trim().toUpperCase();
        return methodMatches && (apiPath === candidatePath || apiPath.includes(candidatePath) || candidatePath.includes(apiPath));
      })
    )
    .map((candidate) => candidate.method ? `${candidate.method} ${candidate.path}` : candidate.path);

  const featureScores = new Map<string, number>();
  const explicitFeatureIds = new Set(normalizeUniqueStringArray(input.options.featureIds));
  for (const feature of input.featureTreeFeatures) {
    let score = 0;
    if (explicitFeatureIds.has(feature.id)) {
      score += 20;
    }
    if (routeCandidates.some((route) => feature.pages.includes(route))) {
      score += 10;
    }
    if (apiCandidates.some((candidate) => featureApiMatchesCandidate(feature.apis, candidate))) {
      score += 10;
    }
    score += countTokenMatches([
      feature.id,
      feature.name,
      feature.summary,
      ...feature.pages,
      ...feature.apis,
      ...feature.sourceFiles,
      ...feature.relatedFeatures,
      ...feature.domainObjects,
    ].join(" "), hintTokens) * 2;
    if (score > 0) {
      featureScores.set(feature.id, score);
    }
  }

  const inferredFeatureIds = trimTo(
    [...featureScores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([featureId]) => featureId),
    MAX_INFERRED_FEATURES,
  );

  const pageFiles = [...pageScores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([filePath]) => filePath);
  const apiFiles = [...apiFileScores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([filePath]) => filePath);
  const featureFiles = inferredFeatureIds.flatMap((featureId) =>
      collectFeatureFiles(
        input.featureTreeFeatures.find((feature) => feature.id === featureId),
        input.maxFiles,
      )
    );
  const shouldUseSignalFallback = pageFiles.length === 0
    && apiFiles.length === 0
    && inferredFeatureIds.length === 0
    && (input.options.filePaths?.length ?? 0) === 0
    && (input.options.historySessionIds?.length ?? 0) === 0;
  const signalFiles = shouldUseSignalFallback
    ? inferSignalBackedFiles({
      options: input.options,
      fileSignals: input.fileSignals,
      maxFiles: input.maxFiles,
    })
    : [];
  const signalFeatureIds = inferFeatureIdsFromFiles(input.featureTreeFeatures, signalFiles);
  const allFeatureIds = trimTo(uniqueSorted([
    ...inferredFeatureIds,
    ...signalFeatureIds,
  ]), MAX_INFERRED_FEATURES);
  const inferredFiles = uniqueSorted([
    ...pageFiles,
    ...apiFiles,
    ...featureFiles,
    ...signalFiles,
  ]);

  return {
    featureIds: allFeatureIds,
    filePaths: trimTo(inferredFiles, input.maxFiles),
    pageFiles: trimTo(pageFiles, input.maxFiles),
    apiFiles: trimTo(apiFiles, input.maxFiles),
    signalFiles: trimTo(signalFiles, input.maxFiles),
    matchedRoutes,
    matchedApis,
  };
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

type DetailedSessionAccumulator = {
  provider: string;
  sessionId: string;
  updatedAt: string;
  promptSnippet: string;
  promptHistory: Set<string>;
  matchedFiles: Set<string>;
  matchedChangedFiles: Set<string>;
  matchedReadFiles: Set<string>;
  matchedWrittenFiles: Set<string>;
  relatedFiles: Set<string>;
  repeatedReadFiles: Set<string>;
  repeatedCommands: Set<string>;
  toolNames: Set<string>;
  failedReadSignals: TaskAdaptiveHarnessFailureSignal[];
  failedTools: FileSessionToolFailure[];
  resumeCommand?: string;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupeFileSessionToolFailures(
  failures: FileSessionToolFailure[],
  limit = MAX_FAILURE_SIGNALS,
): FileSessionToolFailure[] {
  const seen = new Set<string>();
  const deduped: FileSessionToolFailure[] = [];

  for (const failure of failures) {
    const key = [
      failure.toolName,
      failure.command ?? "",
      failure.message,
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(failure);
    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

function normalizeRepeatedCommandHotspot(value: string): string | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  if (
    normalized.startsWith("git status --short")
    || normalized.startsWith("git status --short --branch")
    || normalized.includes("\"session_id\"")
    || normalized.includes("write_stdin")
  ) {
    return null;
  }

  return normalized;
}

function repoLikePathsFromPrompt(value: string): string[] {
  const matches = value.match(/(?:src|docs|crates|apps|resources|tools)\/[^\s"'`]+/g) ?? [];
  return uniqueSorted(matches.map((match) => match.replace(/[),.;]+$/u, "")));
}

function promptFeatureParam(value: string): string | undefined {
  const match = value.match(/[?&]feature=([^&\s]+)/u);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function promptHasLocalUrl(value: string): boolean {
  return /https?:\/\/(?:localhost|127\.0\.0\.1)/iu.test(value);
}

function promptHasIssueUrl(value: string): boolean {
  return /https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+/iu.test(value);
}

function promptHasImageMarker(value: string): boolean {
  return /<image|\[Image/iu.test(value);
}

function promptLooksLikeBriefFollowUp(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  const exactMatches = new Set([
    "提交一下？",
    "提交一下",
    "commit 吧",
    "commit吧",
    "提交吧",
    "先提交一下吧",
    "然后继续实现，然后搞个 pr 吧",
    "然后再继续？",
    "行啊，开始实现吧",
    "行啊，试试",
    "继续实现",
    "then continue",
    "commit it",
    "push it",
    "start implementing",
  ]);

  return exactMatches.has(normalized)
    || normalized === "继续"
    || normalized === "continue"
    || normalized === "继续吧";
}

function promptLooksLikeMetaFileAnalysis(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  return normalized.includes("you analyze historical coding sessions for one or more specific files")
    || normalized.includes("run a read-only retrospective on these file-linked coding sessions")
    || normalized.includes("请对这些与文件相关的历史编码会话做一次只读复盘")
    || normalized.includes("你是一个只读的文件会话分析师");
}

function classifyEnvironmentFailureCategory(failure: FileSessionToolFailure): string {
  const combined = `${failure.message} ${failure.command ?? ""}`.toLowerCase();

  if (combined.includes("no matches found")) {
    return "shell_glob_path";
  }
  if (
    combined.includes("command not found")
    || combined.includes("cannot find package")
    || combined.includes("unresolved_import")
    || combined.includes("could not resolve")
  ) {
    return "missing_dependency";
  }
  if (combined.includes("node_modules") && combined.includes("no such file")) {
    return "missing_installation";
  }
  if (combined.includes("operation not permitted") || combined.includes("permission denied")) {
    return "permission_or_worktree";
  }
  if (
    combined.includes("no such file or directory")
    || combined.includes("not found")
    || combined.includes("enoent")
  ) {
    return "missing_file_or_path";
  }
  if (combined.includes("connection refused") || combined.includes("econnrefused")) {
    return "service_unavailable";
  }

  return "tooling_failure";
}

function detailSessionKey(provider: string, sessionId: string): string {
  return `${provider}:${sessionId}`;
}

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

function buildHistorySeedSessionSummaries(
  historySessionIds: string[] | undefined,
  fileSignals: Record<string, TaskAdaptiveFileSignal>,
  maxSessions: number,
): TaskAdaptiveHistorySeedSessionSummary[] {
  if (!historySessionIds || historySessionIds.length === 0) {
    return [];
  }

  const wanted = new Set(historySessionIds);
  const sessionsByKey = new Map<string, CompiledSessionAccumulator>();

  for (const [filePath, signal] of Object.entries(fileSignals)) {
    for (const session of signal.sessions) {
      if (!wanted.has(session.sessionId)) {
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
        compiled.matchedChangedFiles.add(changedFile);
      }

      const diagnostics = session.diagnostics;
      if (!diagnostics) {
        continue;
      }

      for (const readFile of diagnostics.readFiles) {
        compiled.matchedReadFiles.add(readFile);
      }
      for (const writtenFile of diagnostics.writtenFiles) {
        compiled.matchedWrittenFiles.add(writtenFile);
      }
      for (const repeatedRead of diagnostics.repeatedReadFiles) {
        compiled.repeatedReadFiles.add(normalizeRepeatedReadFile(repeatedRead));
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

  return trimTo(
    [...sessionsByKey.values()]
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
      )
      .map<TaskAdaptiveHistorySeedSessionSummary>((session) => ({
        provider: session.provider,
        sessionId: session.sessionId,
        updatedAt: session.updatedAt,
        promptSnippet: session.promptSnippet || truncateSnippet([...session.promptHistory][0]),
        touchedFiles: trimTo(uniqueSorted(session.matchedFiles), DEFAULT_MAX_FILES),
        repeatedReadFiles: trimTo(uniqueSorted(session.repeatedReadFiles), MAX_REPEATED_READS),
        toolNames: trimTo(uniqueSorted(session.toolNames), MAX_TOOLS_PER_SESSION),
        failedReadSignals: trimTo(session.failedReadSignals, MAX_FAILURE_SIGNALS),
      })),
    maxSessions,
  );
}

function buildMatchedFileDetails(
  selectedFiles: string[],
  fileSignals: Record<string, TaskAdaptiveFileSignal>,
): TaskAdaptiveMatchedFileDetail[] {
  return selectedFiles.map((filePath) => {
    const signal = fileSignals[filePath];
    if (!signal) {
      return {
        filePath,
        changes: 0,
        sessions: 0,
        updatedAt: "",
      };
    }

    let updatedAt = "";
    let changes = 0;
    const seenSessions = new Set<string>();
    for (const session of signal.sessions) {
      seenSessions.add(`${session.provider}:${session.sessionId}`);
      if (session.changedFiles?.includes(filePath)) {
        changes += 1;
      }
      if (session.updatedAt && session.updatedAt > updatedAt) {
        updatedAt = session.updatedAt;
      }
    }

    return {
      filePath,
      changes,
      sessions: seenSessions.size,
      updatedAt,
    };
  });
}

function ensureDetailedAccumulator(
  map: Map<string, DetailedSessionAccumulator>,
  signal: FileSessionSignal,
): DetailedSessionAccumulator {
  const key = detailSessionKey(signal.provider, signal.sessionId);
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

  const created: DetailedSessionAccumulator = {
    provider: signal.provider,
    sessionId: signal.sessionId,
    updatedAt: signal.updatedAt,
    promptSnippet: truncateSnippet(signal.promptSnippet),
    promptHistory: new Set(signal.promptHistory),
    matchedFiles: new Set<string>(),
    matchedChangedFiles: new Set<string>(),
    matchedReadFiles: new Set<string>(),
    matchedWrittenFiles: new Set<string>(),
    relatedFiles: new Set<string>(),
    repeatedReadFiles: new Set<string>(),
    repeatedCommands: new Set<string>(),
    toolNames: new Set(signal.toolNames),
    failedReadSignals: [],
    failedTools: [],
    resumeCommand: signal.resumeCommand,
  };
  map.set(key, created);
  return created;
}

function compileDetailedSessionContext(
  selectedFiles: string[],
  fileSignals: Record<string, TaskAdaptiveFileSignal>,
  matchedSessionIds?: string[],
): Map<string, DetailedSessionAccumulator> {
  const selectedSet = new Set(selectedFiles);
  const wantedSessions = matchedSessionIds ? new Set(matchedSessionIds) : undefined;
  const compiled = new Map<string, DetailedSessionAccumulator>();

  for (const filePath of selectedFiles) {
    const signal = fileSignals[filePath];
    if (!signal) {
      continue;
    }

    for (const session of signal.sessions) {
      if (wantedSessions && !wantedSessions.has(session.sessionId)) {
        continue;
      }

      const detail = ensureDetailedAccumulator(compiled, session);
      detail.matchedFiles.add(filePath);

      for (const prompt of session.promptHistory) {
        detail.promptHistory.add(prompt);
      }
      for (const toolName of session.toolNames) {
        detail.toolNames.add(toolName);
      }
      for (const changedFile of session.changedFiles ?? []) {
        if (selectedSet.has(changedFile)) {
          detail.matchedChangedFiles.add(changedFile);
        } else {
          detail.relatedFiles.add(changedFile);
        }
      }

      const diagnostics = session.diagnostics;
      if (!diagnostics) {
        continue;
      }

      for (const readFile of diagnostics.readFiles) {
        if (selectedSet.has(readFile)) {
          detail.matchedReadFiles.add(readFile);
        } else {
          detail.relatedFiles.add(readFile);
        }
      }
      for (const writtenFile of diagnostics.writtenFiles) {
        if (selectedSet.has(writtenFile)) {
          detail.matchedWrittenFiles.add(writtenFile);
        } else {
          detail.relatedFiles.add(writtenFile);
        }
      }
      for (const repeatedRead of diagnostics.repeatedReadFiles) {
        const normalizedRepeatedRead = normalizeRepeatedReadFile(repeatedRead);
        if (selectedSet.has(normalizedRepeatedRead)) {
          detail.repeatedReadFiles.add(normalizedRepeatedRead);
        } else {
          detail.relatedFiles.add(normalizedRepeatedRead);
        }
      }
      for (const repeatedCommand of diagnostics.repeatedCommands) {
        const normalizedCommand = normalizeRepeatedCommandHotspot(repeatedCommand);
        if (normalizedCommand) {
          detail.repeatedCommands.add(normalizedCommand);
        }
      }
      for (const failure of diagnostics.failedTools) {
        detail.failedTools.push(failure);
        if (!isHighSignalReadFailure(failure)) {
          continue;
        }
        detail.failedReadSignals.push({
          provider: session.provider,
          sessionId: session.sessionId,
          message: failure.message,
          toolName: failure.toolName,
          command: failure.command,
        });
      }
    }
  }

  for (const detail of compiled.values()) {
    detail.failedReadSignals = dedupeFailureSignals(detail.failedReadSignals, MAX_FAILURE_SIGNALS);
    detail.failedTools = dedupeFileSessionToolFailures(detail.failedTools, MAX_FAILURE_SIGNALS);
  }

  return compiled;
}

function mapDetailedSessionSummary(
  summary: TaskAdaptiveHarnessSessionSummary,
  detail: DetailedSessionAccumulator | undefined,
): FileSessionContextSessionSummary {
  const promptHistory = detail ? [...detail.promptHistory] : [];
  const openingPrompt = promptHistory[0];

  return {
    provider: summary.provider,
    sessionId: summary.sessionId,
    updatedAt: summary.updatedAt,
    promptSnippet: summary.promptSnippet,
    ...(openingPrompt ? { openingPrompt } : {}),
    promptHistory,
    matchedFiles: detail ? uniqueSorted([...detail.matchedFiles]) : [...summary.matchedFiles],
    matchedChangedFiles: detail ? uniqueSorted([...detail.matchedChangedFiles]) : [...summary.matchedChangedFiles],
    matchedReadFiles: detail ? uniqueSorted([...detail.matchedReadFiles]) : [...summary.matchedReadFiles],
    matchedWrittenFiles: detail ? uniqueSorted([...detail.matchedWrittenFiles]) : [...summary.matchedWrittenFiles],
    relatedFiles: detail ? trimTo(uniqueSorted([...detail.relatedFiles]), DEFAULT_MAX_FILES) : [],
    repeatedReadFiles: detail ? uniqueSorted([...detail.repeatedReadFiles]) : [...summary.repeatedReadFiles],
    repeatedCommands: detail ? trimTo(uniqueSorted([...detail.repeatedCommands]), MAX_FILE_SIGNAL_REPEATED_COMMANDS) : [],
    toolNames: detail ? trimTo(uniqueSorted([...detail.toolNames]), MAX_TOOLS_PER_SESSION) : [...summary.toolNames],
    failedReadSignals: detail ? [...detail.failedReadSignals] : [...summary.failedReadSignals],
    failedTools: detail ? [...detail.failedTools] : [],
    ...(summary.resumeCommand ? { resumeCommand: summary.resumeCommand } : {}),
  };
}

function mergeMatchedFileDetails(
  details: TaskAdaptiveMatchedFileDetail[],
): TaskAdaptiveMatchedFileDetail[] {
  const merged = new Map<string, TaskAdaptiveMatchedFileDetail>();

  for (const detail of details) {
    const existing = merged.get(detail.filePath);
    if (!existing) {
      merged.set(detail.filePath, { ...detail });
      continue;
    }

    existing.changes = Math.max(existing.changes, detail.changes);
    existing.sessions = Math.max(existing.sessions, detail.sessions);
    if (detail.updatedAt && detail.updatedAt > existing.updatedAt) {
      existing.updatedAt = detail.updatedAt;
    }
  }

  return [...merged.values()].sort((left, right) => left.filePath.localeCompare(right.filePath));
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
  matchConfidence: TaskAdaptiveMatchConfidence;
  matchReasons: string[];
  selectedFiles: string[];
  matchedFileDetails: TaskAdaptiveMatchedFileDetail[];
  matchedSessionIds: string[];
  failures: TaskAdaptiveHarnessFailureSignal[];
  repeatedReadFiles: string[];
  sessions: TaskAdaptiveHarnessSessionSummary[];
  warnings: string[];
  frictionProfiles: TaskAdaptiveFrictionProfile[];
}): string {
  const isZh = input.locale.startsWith("zh");
  const none = isZh ? "无" : "None";
  const taskLabel = input.taskLabel ?? (isZh ? "未命名任务" : "Unnamed task");
  const featureLabel = input.featureName
    ? `${input.featureName}${input.featureId ? ` (${input.featureId})` : ""}`
    : (input.featureId ?? none);

  const failureLines = trimTo(input.failures, MAX_FAILURE_SIGNALS).map((failure) =>
    `${failure.provider}:${failure.sessionId} | ${failure.toolName} | ${failure.message}${failure.command ? ` | ${failure.command}` : ""}`);
  const fileLines = input.matchedFileDetails.map((detail) => {
    const stats: string[] = [];
    if (detail.changes > 0) {
      stats.push(`${isZh ? "变更" : "changes"} ${detail.changes}`);
    }
    if (detail.sessions > 0) {
      stats.push(`${isZh ? "会话" : "sessions"} ${detail.sessions}`);
    }
    if (detail.updatedAt) {
      stats.push(`${isZh ? "更新于" : "updated"} ${detail.updatedAt}`);
    }

    return stats.length > 0
      ? `${detail.filePath} | ${stats.join(" | ")}`
      : detail.filePath;
  });
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
  const profileLines = input.frictionProfiles.map((profile) =>
    `${profile.scope}:${profile.targetLabel} | ${isZh ? "会话" : "sessions"} ${profile.matchedSessionIds.length} | ${isZh ? "失败读取" : "failed reads"} ${profile.failures.length} | ${isZh ? "重复读取" : "repeated reads"} ${profile.repeatedReadFiles.length}`);

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
    `- ${isZh ? "检索置信度" : "Match confidence"}: ${input.matchConfidence}`,
    `- ${isZh ? "选中文件" : "Selected files"}: ${input.selectedFiles.length}`,
    `- ${isZh ? "匹配会话" : "Matched sessions"}: ${input.matchedSessionIds.length}`,
    "",
    isZh ? "### 命中原因" : "### Match Reasons",
    formatBulletList(input.matchReasons, isZh ? "没有额外命中原因" : "No additional match reasons"),
    "",
    isZh ? "### 高优先级摩擦信号" : "### High-Priority Friction Signals",
    formatBulletList(failureLines, isZh ? "没有高信号读取失败" : "No high-signal read failures"),
    "",
    isZh ? "### 重复读取文件" : "### Repeated-Read Files",
    formatBulletList(input.repeatedReadFiles, isZh ? "没有高信号重复读取" : "No high-signal repeated reads"),
    "",
    isZh ? "### 可复用摩擦画像" : "### Reusable Friction Profiles",
    formatBulletList(profileLines, isZh ? "没有命中的可复用画像" : "No reusable friction profiles matched"),
    "",
    isZh ? "### 已恢复的相关文件" : "### Recovered Relevant Files",
    formatBulletList(fileLines, none),
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

function buildTaskAdaptiveHistorySummary(input: {
  locale: string;
  historySessionIds?: string[];
  seedSessions: TaskAdaptiveHistorySeedSessionSummary[];
  matchedSessionIds: string[];
  selectedFiles: string[];
  failures: TaskAdaptiveHarnessFailureSignal[];
  repeatedReadFiles: string[];
}): TaskAdaptiveHistorySummary | undefined {
  const seedSessionCount = input.historySessionIds?.length ?? 0;
  if (seedSessionCount === 0) {
    return undefined;
  }

  const isZh = input.locale.startsWith("zh");
  const repeatedHotspots = trimTo(uniqueSorted([
    ...input.repeatedReadFiles,
    ...input.seedSessions.flatMap((session) => session.repeatedReadFiles),
  ]), 3);
  const priorityFailures = trimTo(dedupeFailureSignals([
    ...input.failures,
    ...input.seedSessions.flatMap((session) => session.failedReadSignals),
  ], MAX_FAILURE_SIGNALS), 2);

  const overviewParts = isZh
    ? [
        `先从 ${seedSessionCount} 个已关联 history session 里抽取上下文种子，当前收敛到 ${input.matchedSessionIds.length} 个最终命中会话和 ${input.selectedFiles.length} 个候选文件。`,
        input.matchedSessionIds.length === 0
          ? "这些种子会话已经帮助定位文件范围，但还没有形成文件级直接命中会话。"
          : "这些种子会话已经被进一步压缩成可复用的文件级命中会话。",
        repeatedHotspots.length > 0
          ? `优先关注的重复读取热点：${repeatedHotspots.join("，")}。`
          : null,
        priorityFailures.length > 0
          ? `优先关注的历史读取问题：${priorityFailures.map((failure) => failure.message).join("；")}。`
          : null,
        input.seedSessions.length > 0
          ? "如果要继续深挖，优先看下面列出的种子会话，而不是一次性回读全部 transcript。"
          : input.matchedSessionIds.length > 0
            ? "当前还没有可直接展开的种子会话摘要，优先看下面恢复出来的 Codex/Claude 命中会话。"
            : "当前还没有恢复出可展示的 transcript 种子摘要；继续分析前，先补更强的文件或 feature 线索。",
      ]
    : [
        `Started from ${seedSessionCount} linked history sessions and narrowed the search to ${input.matchedSessionIds.length} recovered sessions plus ${input.selectedFiles.length} candidate files.`,
        input.matchedSessionIds.length === 0
          ? "These seed sessions already helped localize files, but none of them have turned into file-grounded recovered sessions yet."
          : "These seed sessions have already been compressed into reusable file-grounded recovered sessions.",
        repeatedHotspots.length > 0
          ? `Repeated-read hotspots to inspect first: ${repeatedHotspots.join(", ")}.`
          : null,
        priorityFailures.length > 0
          ? `Priority historical read failures: ${priorityFailures.map((failure) => failure.message).join("; ")}.`
          : null,
        input.seedSessions.length > 0
          ? "If you need deeper analysis, start from the seed sessions below instead of rereading every transcript."
          : input.matchedSessionIds.length > 0
            ? "No seed-session summaries were materialized from the linked ACP sessions, so start from the recovered Codex or Claude sessions below."
            : "No transcript-level seed-session summaries were recovered yet; add stronger file or feature hints before going deeper.",
      ];

  return {
    overview: overviewParts.filter((part): part is string => Boolean(part)).join(" "),
    seedSessionCount,
    recoveredSessionCount: input.matchedSessionIds.length,
    matchedFileCount: input.selectedFiles.length,
    seedSessions: input.seedSessions,
  };
}

function attachTaskAdaptiveHistorySummary(
  pack: TaskAdaptiveHarnessPack,
  options: TaskAdaptiveHarnessOptions,
  fileSignals: Record<string, TaskAdaptiveFileSignal>,
): TaskAdaptiveHarnessPack {
  const historySessionIds = normalizeUniqueStringArray(options.historySessionIds);
  if (historySessionIds.length === 0) {
    return pack;
  }

  const historySummary = buildTaskAdaptiveHistorySummary({
    locale: options.locale ?? "en",
    historySessionIds,
    seedSessions: buildHistorySeedSessionSummaries(
      historySessionIds,
      fileSignals,
      options.maxSessions ?? DEFAULT_MAX_SESSIONS,
    ),
    matchedSessionIds: pack.matchedSessionIds,
    selectedFiles: pack.selectedFiles,
    failures: pack.failures,
    repeatedReadFiles: pack.repeatedReadFiles,
  });

  return historySummary
    ? {
        ...pack,
        historySummary,
      }
    : pack;
}

async function assembleTaskAdaptiveHarnessRaw(
  repoRoot: string,
  options: TaskAdaptiveHarnessOptions = {},
  preloaded?: {
    featureTree?: FeatureTreeFeature[];
    fileSignals?: Record<string, TaskAdaptiveFileSignal>;
    surfaceIndex?: FeatureSurfaceIndexResponse;
  },
): Promise<TaskAdaptiveHarnessPack> {
  const locale = options.locale ?? "en";
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const warnings: string[] = [];

  const surfaceIndex = preloaded?.surfaceIndex ?? await readFeatureSurfaceIndex(repoRoot);
  warnings.push(...surfaceIndex.warnings);
  const featureTree = {
    features: preloaded?.featureTree ?? mergeFeatureTreeFeatures(readFeatureTreeFeatures(repoRoot), surfaceIndex),
  };
  const fileSignals = preloaded?.fileSignals ?? collectTaskAdaptiveFileSignals(repoRoot);
  const inferredSeed = inferTaskAdaptiveSeed({
    options,
    featureTreeFeatures: featureTree.features,
    surfaceIndex,
    fileSignals,
    maxFiles,
  });
  const requestedFeatureIds = mergeRequestedFeatureIds(options, inferredSeed.featureIds);
  const features = requestedFeatureIds
    .map((featureId) => featureTree.features.find((item) => item.id === featureId))
    .filter((feature): feature is FeatureTreeFeature => Boolean(feature));

  for (const featureId of requestedFeatureIds) {
    if (!features.some((feature) => feature.id === featureId)) {
      warnings.push(`Feature not found: ${featureId}`);
    }
  }
  const primaryFeature = features[0];

  const selectedFiles = trimTo(
    mergePreferredStringGroups(
      options.filePaths,
      collectPreferredFeatureFiles(options, features, maxFiles),
      inferredSeed.filePaths,
      inferFilesFromSessionIds(options.historySessionIds, fileSignals, maxFiles),
    ),
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

  return buildTaskAdaptiveHarnessPack({
    locale,
    taskLabel: options.taskLabel,
    primaryFeature,
    requestedFeatureIds,
    explicitFileCount: options.filePaths?.length ?? 0,
    explicitFeatureCount: (options.featureIds?.length ?? 0) + (options.featureId ? 1 : 0),
    historySessionCount: options.historySessionIds?.length ?? 0,
    inferenceSeed: inferredSeed,
    selectedFiles,
    matchedFileDetails: buildMatchedFileDetails(selectedFiles, fileSignals),
    sessions,
    warnings,
    taskType: options.taskType,
    role: options.role,
  });
}

export function loadTaskAdaptiveFrictionProfiles(
  repoRoot: string,
): TaskAdaptiveFrictionProfileSnapshot | null {
  return loadTaskAdaptiveFrictionProfilesSnapshot(repoRoot);
}

export async function refreshTaskAdaptiveFrictionProfiles(
  repoRoot: string,
  options: RefreshTaskAdaptiveFrictionProfilesOptions = {},
): Promise<TaskAdaptiveFrictionProfileSnapshot> {
  const surfaceIndex = await readFeatureSurfaceIndex(repoRoot);
  const featureTree = mergeFeatureTreeFeatures(readFeatureTreeFeatures(repoRoot), surfaceIndex);
  const fileSignals = collectTaskAdaptiveFileSignals(repoRoot);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const minFileSessions = options.minFileSessions ?? DEFAULT_MIN_FILE_PROFILE_SESSIONS;
  const minFeatureSessions = options.minFeatureSessions ?? DEFAULT_MIN_FEATURE_PROFILE_SESSIONS;
  const generatedAt = new Date().toISOString();

  const fileProfiles: Record<string, TaskAdaptiveFrictionProfile> = {};
  const featureProfiles: Record<string, TaskAdaptiveFrictionProfile> = {};

  for (const [filePath, signal] of Object.entries(fileSignals)) {
    if (signal.sessions.length < minFileSessions) {
      continue;
    }

    const pack = await assembleTaskAdaptiveHarnessRaw(repoRoot, {
      filePaths: [filePath],
      taskType: "analysis",
      maxFiles: 1,
      maxSessions,
    }, {
      featureTree,
      fileSignals,
      surfaceIndex,
    });

    if (pack.matchedSessionIds.length < minFileSessions) {
      continue;
    }

    fileProfiles[filePath] = toTaskAdaptiveFrictionProfile("file", filePath, filePath, generatedAt, pack);
  }

  for (const feature of featureTree) {
    const touchesSignals = feature.sourceFiles.some((filePath) => Boolean(fileSignals[filePath]));
    if (!touchesSignals) {
      continue;
    }

    const pack = await assembleTaskAdaptiveHarnessRaw(repoRoot, {
      featureId: feature.id,
      taskType: "analysis",
      maxFiles,
      maxSessions,
    }, {
      featureTree,
      fileSignals,
      surfaceIndex,
    });

    if (pack.matchedSessionIds.length < minFeatureSessions) {
      continue;
    }

    featureProfiles[feature.id] = toTaskAdaptiveFrictionProfile(
      "feature",
      feature.id,
      feature.name || feature.id,
      generatedAt,
      pack,
    );
  }

  const snapshot: TaskAdaptiveFrictionProfileSnapshot = {
    generatedAt,
    thresholds: {
      minFileSessions,
      minFeatureSessions,
    },
    fileProfiles,
    featureProfiles,
  };

  persistTaskAdaptiveFrictionProfilesSnapshot(repoRoot, snapshot);
  return snapshot;
}

export async function assembleTaskAdaptiveHarness(
  repoRoot: string,
  options: TaskAdaptiveHarnessOptions = {},
): Promise<TaskAdaptiveHarnessPack> {
  const locale = options.locale ?? "en";
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const surfaceIndex = await readFeatureSurfaceIndex(repoRoot);
  const mergedFeatureTree = mergeFeatureTreeFeatures(readFeatureTreeFeatures(repoRoot), surfaceIndex);
  const fileSignals = collectTaskAdaptiveFileSignals(repoRoot);
  const inferredSeed = inferTaskAdaptiveSeed({
    options,
    featureTreeFeatures: mergedFeatureTree,
    surfaceIndex,
    fileSignals,
    maxFiles,
  });
  const requestedFeatureIds = mergeRequestedFeatureIds(options, inferredSeed.featureIds);
  const features = requestedFeatureIds
    .map((featureId) => mergedFeatureTree.find((item) => item.id === featureId))
    .filter((feature): feature is FeatureTreeFeature => Boolean(feature));
  const selectedFiles = trimTo(
    mergePreferredStringGroups(
      options.filePaths,
      collectPreferredFeatureFiles(options, features, maxFiles),
      inferredSeed.filePaths,
    ),
    maxFiles,
  );
  const snapshot = loadTaskAdaptiveFrictionProfilesSnapshot(repoRoot);
  const matchedProfiles = selectStoredFrictionProfiles(snapshot, selectedFiles, requestedFeatureIds);

  if (canHydrateTaskAdaptiveHarnessFromProfiles({
    selectedFiles,
    requestedFeatureIds,
    historySessionIds: options.historySessionIds,
    snapshot,
  }) && matchedProfiles.length > 0) {
    return attachTaskAdaptiveHistorySummary(
      mergeProfilesIntoTaskAdaptiveHarnessPack(
        locale,
        options.taskLabel,
        features[0],
      requestedFeatureIds,
      inferredSeed,
      options.filePaths?.length ?? 0,
      (options.featureIds?.length ?? 0) + (options.featureId ? 1 : 0),
      options.historySessionIds?.length ?? 0,
      selectedFiles,
      [],
      [
        ...surfaceIndex.warnings,
        ...requestedFeatureIds
          .filter((featureId) => !features.some((feature) => feature.id === featureId))
          .map((featureId) => `Feature not found: ${featureId}`),
        ...(selectedFiles.length === 0 ? ["No task-adaptive files could be resolved from the current request."] : []),
      ],
      options.taskType,
      options.role,
        matchedProfiles,
        options.maxSessions ?? DEFAULT_MAX_SESSIONS,
      ),
      options,
      fileSignals,
    );
  }

  const pack = attachTaskAdaptiveHistorySummary(await assembleTaskAdaptiveHarnessRaw(repoRoot, options, {
    featureTree: mergedFeatureTree,
    fileSignals,
    surfaceIndex,
  }), options, fileSignals);

  if (matchedProfiles.length === 0) {
    return pack;
  }

  return attachTaskAdaptiveHistorySummary({
    ...mergeProfilesIntoTaskAdaptiveHarnessPack(
      locale,
      options.taskLabel,
      features[0],
      requestedFeatureIds,
      inferredSeed,
      options.filePaths?.length ?? 0,
      (options.featureIds?.length ?? 0) + (options.featureId ? 1 : 0),
      options.historySessionIds?.length ?? 0,
      uniqueSorted([...selectedFiles, ...pack.selectedFiles]),
      pack.matchedFileDetails,
      pack.warnings,
      options.taskType,
      options.role,
      matchedProfiles,
      options.maxSessions ?? DEFAULT_MAX_SESSIONS,
    ),
    recommendedToolMode: pack.recommendedToolMode,
    recommendedMcpProfile: pack.recommendedMcpProfile,
    recommendedAllowedNativeTools: pack.recommendedAllowedNativeTools,
  }, options, fileSignals);
}

function sessionHasDirectFocusEvidence(
  session: FileSessionContextSessionSummary,
  focusFiles: ReadonlySet<string>,
): boolean {
  const directCandidates = [
    ...session.matchedChangedFiles,
    ...session.matchedReadFiles,
    ...session.matchedWrittenFiles,
  ];
  return directCandidates.some((filePath) => focusFiles.has(filePath));
}

function sessionHasFocusMutationEvidence(
  session: FileSessionContextSessionSummary,
  focusFiles: ReadonlySet<string>,
): boolean {
  return [...session.matchedChangedFiles, ...session.matchedWrittenFiles]
    .some((filePath) => focusFiles.has(filePath));
}

function sessionHasSelectedMutationEvidence(
  session: FileSessionContextSessionSummary,
  selectedFiles: ReadonlySet<string>,
): boolean {
  return [...session.matchedChangedFiles, ...session.matchedWrittenFiles]
    .some((filePath) => selectedFiles.has(filePath));
}

function sessionPromptMentionsFocusContext(
  session: FileSessionContextSessionSummary,
  focusFiles: string[],
  featureId: string | undefined,
): boolean {
  const focusSet = new Set(focusFiles);
  const focusBasenames = focusFiles
    .map((filePath) => filePath.split("/").pop()?.toLowerCase())
    .filter((value): value is string => Boolean(value));
  const normalizedFeatureId = featureId?.toLowerCase();

  return session.promptHistory.some((prompt) => {
    const normalizedPrompt = normalizeWhitespace(prompt).toLowerCase();
    if (normalizedFeatureId && normalizedPrompt.includes(normalizedFeatureId)) {
      return true;
    }

    if (repoLikePathsFromPrompt(prompt).some((filePath) => focusSet.has(filePath))) {
      return true;
    }

    return focusBasenames.some((basename) => normalizedPrompt.includes(basename));
  });
}

function scoreFileSessionContextSession(
  session: FileSessionContextSessionSummary,
  focusFiles: string[],
  selectedFiles: string[],
  featureId: string | undefined,
): number {
  const focusSet = new Set(focusFiles);
  const selectedSet = new Set(selectedFiles);
  const focusChanges = session.matchedChangedFiles.filter((filePath) => focusSet.has(filePath)).length;
  const focusWrites = session.matchedWrittenFiles.filter((filePath) => focusSet.has(filePath)).length;
  const focusReads = session.matchedReadFiles.filter((filePath) => focusSet.has(filePath)).length;
  const focusRepeatedReads = session.repeatedReadFiles.filter((filePath) => focusSet.has(filePath)).length;
  const selectedMutations = [...session.matchedChangedFiles, ...session.matchedWrittenFiles]
    .filter((filePath) => selectedSet.has(filePath)).length;
  const promptAligned = sessionPromptMentionsFocusContext(session, focusFiles, featureId);
  const openingPrompt = session.promptHistory[0] ?? session.promptSnippet;

  let score = (focusChanges * 12)
    + (focusWrites * 12)
    + (focusReads * 5)
    + (focusRepeatedReads * 2)
    + (selectedMutations * 4)
    + (session.failedReadSignals.length * 2);

  if (promptAligned) {
    score += 4;
  }

  if (
    focusReads > 0
    && focusChanges === 0
    && focusWrites === 0
    && selectedMutations === 0
    && !promptAligned
  ) {
    score -= 3;
  }

  if (openingPrompt && promptLooksLikeMetaFileAnalysis(openingPrompt)) {
    score -= 20;
  }

  return score;
}

function classifyFileSessionContextBuckets(
  sessions: FileSessionContextSessionSummary[],
  focusFiles: string[],
  selectedFiles: string[],
  featureId: string | undefined,
): Pick<FileSessionContextSummary, "directSessions" | "adjacentSessions" | "weakSessions"> {
  const focusSet = new Set(focusFiles);
  const selectedSet = new Set(selectedFiles);
  const directSessions: FileSessionContextSessionSummary[] = [];
  const adjacentSessions: FileSessionContextSessionSummary[] = [];
  const weakSessions: FileSessionContextSessionSummary[] = [];

  for (const session of sessions) {
    const openingPrompt = session.promptHistory[0] ?? session.promptSnippet;
    const relevanceScore = scoreFileSessionContextSession(session, focusFiles, selectedFiles, featureId);

    if (openingPrompt && promptLooksLikeMetaFileAnalysis(openingPrompt)) {
      weakSessions.push(session);
      continue;
    }

    if (sessionHasFocusMutationEvidence(session, focusSet)) {
      directSessions.push(session);
      continue;
    }

    if (
      sessionHasDirectFocusEvidence(session, focusSet)
      && (
        relevanceScore >= 8
        || sessionHasSelectedMutationEvidence(session, selectedSet)
      )
    ) {
      directSessions.push(session);
      continue;
    }

    if (
      session.matchedChangedFiles.length > 0
      || session.matchedReadFiles.length > 0
      || session.matchedWrittenFiles.length > 0
      || session.relatedFiles.length > 0
    ) {
      adjacentSessions.push(session);
      continue;
    }

    weakSessions.push(session);
  }

  return {
    directSessions,
    adjacentSessions,
    weakSessions,
  };
}

function summarizeTaskAdaptiveSessionFromDetail(
  detail: DetailedSessionAccumulator,
): TaskAdaptiveHarnessSessionSummary {
  return {
    provider: detail.provider,
    sessionId: detail.sessionId,
    updatedAt: detail.updatedAt,
    promptSnippet: detail.promptSnippet || truncateSnippet([...detail.promptHistory][0]),
    matchedFiles: uniqueSorted([...detail.matchedFiles]),
    matchedChangedFiles: uniqueSorted([...detail.matchedChangedFiles]),
    matchedReadFiles: uniqueSorted([...detail.matchedReadFiles]),
    matchedWrittenFiles: uniqueSorted([...detail.matchedWrittenFiles]),
    repeatedReadFiles: uniqueSorted([...detail.repeatedReadFiles]),
    toolNames: trimTo(uniqueSorted([...detail.toolNames]), MAX_TOOLS_PER_SESSION),
    failedReadSignals: [...detail.failedReadSignals],
    ...(detail.resumeCommand ? { resumeCommand: detail.resumeCommand } : {}),
  };
}

function buildRankedFileSessionContextSummaries(params: {
  pack: TaskAdaptiveHarnessPack;
  fileSignals: Record<string, TaskAdaptiveFileSignal>;
  focusFiles: string[];
  maxSessions: number;
}): FileSessionContextSessionSummary[] {
  const detailedSessions = compileDetailedSessionContext(params.pack.selectedFiles, params.fileSignals);
  const baseSummaries = new Map(
    params.pack.sessions.map((session) => [detailSessionKey(session.provider, session.sessionId), session]),
  );

  const sessions = [...detailedSessions.values()]
    .map((detail) => {
      const key = detailSessionKey(detail.provider, detail.sessionId);
      const baseSummary = baseSummaries.get(key) ?? summarizeTaskAdaptiveSessionFromDetail(detail);
      return mapDetailedSessionSummary(baseSummary, detail);
    })
    .sort((left, right) =>
      scoreFileSessionContextSession(right, params.focusFiles, params.pack.selectedFiles, params.pack.featureId)
        - scoreFileSessionContextSession(left, params.focusFiles, params.pack.selectedFiles, params.pack.featureId)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.sessionId.localeCompare(right.sessionId),
    );

  return trimTo(sessions, params.maxSessions);
}

function buildFileSessionContextPromptSignals(
  sessions: FileSessionContextSessionSummary[],
): FileSessionContextPromptSignal[] {
  return sessions
    .filter((session) => session.promptHistory.length > 0)
    .map((session) => ({
      provider: session.provider,
      sessionId: session.sessionId,
      updatedAt: session.updatedAt,
      openingPrompt: session.promptHistory[0] ?? session.promptSnippet,
      followUpPrompts: session.promptHistory.slice(1),
    }));
}

function buildFileSessionContextScopeDriftSignals(
  sessions: FileSessionContextSessionSummary[],
  featureId: string | undefined,
  focusFiles: string[],
  selectedFiles: string[],
): FileSessionContextScopeDriftSignal[] {
  const focusSet = new Set(focusFiles);
  const selectedSet = new Set(selectedFiles);
  const signals: FileSessionContextScopeDriftSignal[] = [];

  for (const session of sessions) {
    if (session.promptHistory.length < 2) {
      continue;
    }

    const openingPrompt = session.promptHistory[0] ?? session.promptSnippet;
    for (const laterPrompt of session.promptHistory.slice(1)) {
      const laterFeatureParam = promptFeatureParam(laterPrompt);
      if (featureId && laterFeatureParam && laterFeatureParam !== featureId) {
        signals.push({
          provider: session.provider,
          sessionId: session.sessionId,
          updatedAt: session.updatedAt,
          reason: `Later prompt switched feature anchor from ${featureId} to ${laterFeatureParam}.`,
          openingPrompt,
          laterPrompts: [laterPrompt],
        });
        break;
      }

      const laterPaths = repoLikePathsFromPrompt(laterPrompt);
      if (
        laterPaths.length > 0
        && (
          (focusSet.size > 0 && laterPaths.every((filePath) => !focusSet.has(filePath)))
          || laterPaths.every((filePath) => !focusSet.has(filePath) && !selectedSet.has(filePath))
        )
      ) {
        signals.push({
          provider: session.provider,
          sessionId: session.sessionId,
          updatedAt: session.updatedAt,
          reason: "Later prompt shifted to different repository files than the current focus.",
          openingPrompt,
          laterPrompts: [laterPrompt],
        });
        break;
      }
    }
  }

  return signals;
}

function buildFileSessionContextInputFrictions(
  sessions: FileSessionContextSessionSummary[],
  featureId: string | undefined,
): FileSessionContextFrictionSignal[] {
  const frictions: FileSessionContextFrictionSignal[] = [];
  const seen = new Set<string>();

  for (const session of sessions) {
    const openingPrompt = session.promptHistory[0] ?? session.promptSnippet;
    if (!openingPrompt) {
      continue;
    }

    const openingPaths = repoLikePathsFromPrompt(openingPrompt);
    const openingFeatureParam = promptFeatureParam(openingPrompt);
    const candidates: Array<{ category: string; detail: string; evidence: string }> = [];

    if (promptHasLocalUrl(openingPrompt) && openingPaths.length === 0) {
      candidates.push({
        category: "ui_url_without_entry_file",
        detail: "The request started from a local UI URL without naming a concrete repository file.",
        evidence: openingPrompt,
      });
    }

    if (promptHasIssueUrl(openingPrompt) && openingPaths.length === 0) {
      candidates.push({
        category: "issue_reference_only",
        detail: "The request referenced an issue URL but did not provide a concrete entry file.",
        evidence: openingPrompt,
      });
    }

    if (promptHasImageMarker(openingPrompt) && openingPaths.length === 0) {
      candidates.push({
        category: "image_led_context",
        detail: "The request relied on screenshots or images without grounding the task in a file path.",
        evidence: openingPrompt,
      });
    }

    if (featureId && openingFeatureParam && openingFeatureParam !== featureId) {
      candidates.push({
        category: "feature_anchor_mismatch",
        detail: `The opening prompt anchored on feature=${openingFeatureParam} while the recovered file context points to ${featureId}.`,
        evidence: openingPrompt,
      });
    }

    const followUpWithoutScope = session.promptHistory
      .slice(1)
      .find((prompt) => promptLooksLikeBriefFollowUp(prompt) && repoLikePathsFromPrompt(prompt).length === 0);
    if (followUpWithoutScope) {
      candidates.push({
        category: "follow_up_without_scope",
        detail: "A later prompt asked to continue or commit without restating scope.",
        evidence: followUpWithoutScope,
      });
    }

    for (const candidate of candidates) {
      const key = [
        session.provider,
        session.sessionId,
        candidate.category,
        candidate.evidence,
      ].join("|");
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      frictions.push({
        provider: session.provider,
        sessionId: session.sessionId,
        updatedAt: session.updatedAt,
        category: candidate.category,
        detail: candidate.detail,
        evidence: candidate.evidence,
      });
    }
  }

  return frictions;
}

function buildFileSessionContextEnvironmentFrictions(
  sessions: FileSessionContextSessionSummary[],
): FileSessionContextFrictionSignal[] {
  const frictions: FileSessionContextFrictionSignal[] = [];
  const seen = new Set<string>();

  for (const session of sessions) {
    for (const failure of session.failedTools) {
      const category = classifyEnvironmentFailureCategory(failure);
      const evidence = `${failure.toolName}${failure.command ? ` | ${failure.command}` : ""} | ${failure.message}`;
      const key = [
        session.provider,
        session.sessionId,
        category,
        evidence,
      ].join("|");
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      frictions.push({
        provider: session.provider,
        sessionId: session.sessionId,
        updatedAt: session.updatedAt,
        category,
        detail: failure.message,
        evidence,
        toolName: failure.toolName,
        command: failure.command,
      });
    }
  }

  return frictions;
}

function buildFileSessionContextHotspots(
  sessions: FileSessionContextSessionSummary[],
): Pick<FileSessionContextSummary, "repeatedFileHotspots" | "repeatedCommandHotspots"> {
  const repeatedFileCounts = new Map<string, { count: number; sessions: Set<string> }>();
  const repeatedCommandCounts = new Map<string, { count: number; sessions: Set<string> }>();

  for (const session of sessions) {
    const sessionKey = detailSessionKey(session.provider, session.sessionId);
    for (const filePath of session.repeatedReadFiles) {
      const existing = repeatedFileCounts.get(filePath) ?? { count: 0, sessions: new Set<string>() };
      existing.count += 1;
      existing.sessions.add(sessionKey);
      repeatedFileCounts.set(filePath, existing);
    }
    for (const command of session.repeatedCommands) {
      const existing = repeatedCommandCounts.get(command) ?? { count: 0, sessions: new Set<string>() };
      existing.count += 1;
      existing.sessions.add(sessionKey);
      repeatedCommandCounts.set(command, existing);
    }
  }

  const toHotspots = (
    source: Map<string, { count: number; sessions: Set<string> }>,
  ): FileSessionContextHotspot[] =>
    [...source.entries()]
      .map(([value, stats]) => ({
        value,
        count: stats.count,
        sessions: uniqueSorted([...stats.sessions]),
      }))
      .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));

  return {
    repeatedFileHotspots: toHotspots(repeatedFileCounts),
    repeatedCommandHotspots: toHotspots(repeatedCommandCounts),
  };
}

export async function summarizeFileSessionContext(
  repoRoot: string,
  options: TaskAdaptiveHarnessOptions = {},
): Promise<FileSessionContextSummary> {
  const pack = await assembleTaskAdaptiveHarness(repoRoot, options);
  const fileSignals = collectTaskAdaptiveFileSignals(repoRoot);
  const focusFiles = uniqueSorted(options.filePaths?.length ? options.filePaths : pack.selectedFiles);
  const sessionSummaries = buildRankedFileSessionContextSummaries({
    pack,
    fileSignals,
    focusFiles,
    maxSessions: options.maxSessions ?? DEFAULT_MAX_SESSIONS,
  });
  const buckets = classifyFileSessionContextBuckets(
    sessionSummaries,
    focusFiles,
    pack.selectedFiles,
    pack.featureId,
  );
  const openingPrompts = buildFileSessionContextPromptSignals(sessionSummaries);
  const scopeDriftSignals = buildFileSessionContextScopeDriftSignals(
    sessionSummaries,
    pack.featureId,
    focusFiles,
    pack.selectedFiles,
  );
  const inputFrictions = buildFileSessionContextInputFrictions(sessionSummaries, pack.featureId);
  const environmentFrictions = buildFileSessionContextEnvironmentFrictions(sessionSummaries);
  const hotspots = buildFileSessionContextHotspots(sessionSummaries);

  return {
    featureId: pack.featureId,
    featureName: pack.featureName,
    matchConfidence: pack.matchConfidence,
    matchReasons: [...pack.matchReasons],
    selectedFiles: [...pack.selectedFiles],
    focusFiles,
    matchedFileDetails: pack.matchedFileDetails.map((detail) => ({ ...detail })),
    matchedSessionIds: sessionSummaries.map((session) => session.sessionId),
    directSessions: buckets.directSessions,
    adjacentSessions: buckets.adjacentSessions,
    weakSessions: buckets.weakSessions,
    openingPrompts,
    scopeDriftSignals,
    inputFrictions,
    environmentFrictions,
    repeatedFileHotspots: hotspots.repeatedFileHotspots,
    repeatedCommandHotspots: hotspots.repeatedCommandHotspots,
    transcriptHints: uniqueSorted(
      pack.sessions.map((session) => `~/.codex/sessions/**/${session.sessionId}*.jsonl`),
    ),
    warnings: [...pack.warnings],
  };
}
