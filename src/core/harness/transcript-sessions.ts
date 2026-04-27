import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

const MAX_TRANSCRIPT_FILES = 200;
const MAX_TRANSCRIPT_FILE_SIZE = 10 * 1024 * 1024;
const BROAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PROMPT_SNIPPET_LENGTH = 180;
const MAX_SIGNAL_EXCERPT_LENGTH = 240;
const DEFAULT_TURN_INSPECTION_MAX_USER_PROMPTS = 6;
const DEFAULT_TURN_INSPECTION_MAX_SIGNALS = 8;
const IGNORED_PATHS = new Set([".git", "node_modules", ".next", "dist", "out", "target"]);

export type TranscriptProvider = "codex" | "qoder" | "augment" | "claude" | "unknown";

interface TranscriptCandidate {
  transcriptPath: string;
  modifiedMs: number;
  provider: TranscriptProvider;
}

export interface ParsedFeatureTranscript {
  sessionId: string;
  cwd: string;
  updatedAt: string;
  provider: TranscriptProvider;
  promptHistory: string[];
  toolHistory: string[];
  resumeCommand?: string;
  events: unknown[];
}

export interface TranscriptInspectionSignal {
  kind: "command" | "patch" | "failure";
  toolName: string;
  command?: string;
  excerpt: string;
  matchedFilePaths: string[];
  mentionsFeature: boolean;
  exitCode?: number;
  outputSnippet?: string;
}

export interface InspectedTranscriptSession {
  provider: TranscriptProvider;
  sessionId: string;
  updatedAt: string;
  transcriptPath: string;
  openingUserPrompt?: string;
  followUpUserPrompts: string[];
  matchedFilePaths: string[];
  relevantSignals: TranscriptInspectionSignal[];
  failedSignals: TranscriptInspectionSignal[];
  scopeDriftPrompts: string[];
  resumeCommand?: string;
}

export interface TranscriptTurnInspectionOptions {
  sessionIds: string[];
  filePaths?: string[];
  featureId?: string;
  maxUserPrompts?: number;
  maxSignals?: number;
}

export interface TranscriptTurnInspectionResult {
  sessions: InspectedTranscriptSession[];
  missingSessionIds: string[];
  warnings: string[];
}

interface RepoIdentity {
  topLevel: string;
  commonDir: string;
}

interface ResolvedTranscriptSession extends ParsedFeatureTranscript {
  transcriptPath: string;
  modifiedMs: number;
}

function stringifyCommand(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const parts = value.filter((part): part is string => typeof part === "string");
    return parts.length > 0 ? parts.join(" ") : undefined;
  }

  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSignalPromptText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isDuplicateSignalPrompt(existing: string, next: string): boolean {
  if (!existing || !next) {
    return false;
  }

  return existing === next || existing.startsWith(next) || next.startsWith(existing);
}

function truncatePrompt(text: string): string {
  if (text.length <= MAX_PROMPT_SNIPPET_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_PROMPT_SNIPPET_LENGTH - 3)}...`;
}

function truncateSignalExcerpt(text: string): string {
  const normalized = normalizeSignalPromptText(text);
  if (normalized.length <= MAX_SIGNAL_EXCERPT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SIGNAL_EXCERPT_LENGTH - 3)}...`;
}

function normalizeUserPrompt(text: string): string {
  let normalized = text.trim();
  const instructionsEnd = normalized.lastIndexOf("</INSTRUCTIONS>");
  if (instructionsEnd >= 0) {
    normalized = normalized.slice(instructionsEnd + "</INSTRUCTIONS>".length).trim();
  }

  normalized = normalized
    .replace(/<image[^>]*>[\s\S]*?<\/image>/g, " ")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, " ")
    .replace(/<[^>]+>/g, " ");

  return truncatePrompt(normalizeSignalPromptText(normalized));
}

function isSyntheticUserPrompt(text: string): boolean {
  const normalized = normalizeSignalPromptText(text).toLowerCase();
  return normalized.includes("<turn_aborted>")
    || normalized.includes("the user interrupted the previous turn on purpose")
    || normalized.includes("any running unified exec processes may still be running in the background");
}

function extractUserPromptFromResponseItem(event: Record<string, unknown>): string | undefined {
  if (event.type !== "message" || event.role !== "user" || !Array.isArray(event.content)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const item of event.content) {
    if (!isRecord(item) || item.type !== "input_text" || typeof item.text !== "string") {
      continue;
    }
    const text = item.text.trim();
    if (text) {
      parts.push(text);
    }
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join("\n");
}

function userPromptFromUnknown(event: unknown): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  if (event.type === "user_message") {
    return firstString(event.message);
  }

  return extractUserPromptFromResponseItem(event);
}

export function commandFromUnknown(event: unknown): string | undefined {
  if (!event || typeof event !== "object") {
    return undefined;
  }

  const map = event as Record<string, unknown>;
  if (map.type === "function_call" && typeof map.arguments === "string") {
    const rawArguments = map.arguments.trim();
    if (typeof map.name === "string" && map.name === "exec_command") {
      try {
        const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
        const command = stringifyCommand(parsed.command) ?? stringifyCommand(parsed.cmd);
        if (command) {
          return command;
        }
      } catch {
        // Fall through to other heuristics when arguments are not JSON.
      }
    }

    return rawArguments;
  }

  const directCommand = stringifyCommand(map.command) ?? stringifyCommand(map.cmd);
  if (directCommand) return directCommand;

  if (typeof map.tool_input === "object" && map.tool_input !== null) {
    const toolInput = map.tool_input as Record<string, unknown>;
    return stringifyCommand(toolInput.command) ?? stringifyCommand(toolInput.cmd);
  }

  return undefined;
}

export function commandOutputFromUnknown(event: unknown): string | undefined {
  if (!event || typeof event !== "object") {
    return undefined;
  }

  const map = event as Record<string, unknown>;
  const directOutput = firstString(
    map.aggregated_output,
    map.output,
    map.stdout,
    map.stderr,
    map.result,
  );
  if (directOutput) {
    return directOutput;
  }

  if (typeof map.tool_output === "object" && map.tool_output !== null) {
    const toolOutput = map.tool_output as Record<string, unknown>;
    return firstString(
      toolOutput.aggregated_output,
      toolOutput.output,
      toolOutput.stdout,
      toolOutput.stderr,
      toolOutput.result,
    );
  }

  return undefined;
}

function toolNameFromUnknown(event: unknown): string | undefined {
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

function inspectionToolNameFromUnknown(event: unknown): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  if (typeof event.type === "string" && event.type === "custom_tool_call" && typeof event.name === "string") {
    return event.name;
  }

  return toolNameFromUnknown(event);
}

function inspectionInputFromUnknown(event: unknown): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  if (typeof event.type === "string" && event.type === "custom_tool_call" && typeof event.input === "string") {
    return event.input;
  }

  return commandFromUnknown(event);
}

function exitCodeFromUnknown(event: unknown): number | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  if (typeof event.exit_code === "number") {
    return event.exit_code;
  }

  if (isRecord(event.tool_output) && typeof event.tool_output.exit_code === "number") {
    return event.tool_output.exit_code;
  }

  return undefined;
}

function statusFromUnknown(event: unknown): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  if (typeof event.status === "string") {
    return event.status;
  }

  if (isRecord(event.tool_output) && typeof event.tool_output.status === "string") {
    return event.tool_output.status;
  }

  return undefined;
}

function isFailedCommandEvent(event: unknown): boolean {
  const exitCode = exitCodeFromUnknown(event);
  if (typeof exitCode === "number") {
    return exitCode !== 0;
  }

  const status = statusFromUnknown(event);
  return status === "failed" || status === "error";
}

function collectTranscriptPromptHistory(events: unknown[]): string[] {
  const prompts: string[] = [];

  for (const event of events) {
    const prompt = userPromptFromUnknown(event);
    if (!prompt || isSyntheticUserPrompt(prompt)) {
      continue;
    }

    const normalized = normalizeUserPrompt(prompt);
    if (!normalized) {
      continue;
    }

    const lastPrompt = prompts[prompts.length - 1] ?? "";
    if (isDuplicateSignalPrompt(lastPrompt, normalized)) {
      continue;
    }

    prompts.push(normalized);
  }

  return prompts;
}

function collectTranscriptToolHistory(events: unknown[]): string[] {
  const tools: string[] = [];

  for (const event of events) {
    const toolName = toolNameFromUnknown(event);
    if (!toolName || tools.includes(toolName)) {
      continue;
    }
    tools.push(toolName);
  }

  return tools;
}

function repoLikePathsFromPrompt(value: string): string[] {
  const matches = value.match(/(?:src|docs|crates|apps|resources|tools)\/[^\s"'`]+/g) ?? [];
  return [...new Set(matches.map((match) => match.replace(/[),.;]+$/u, "")))].sort((left, right) => left.localeCompare(right));
}

function promptFeatureParam(value: string): string | undefined {
  const match = value.match(/[?&]feature=([^&\s]+)/u);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function buildResumeCommand(provider: TranscriptProvider, sessionId: string): string | undefined {
  if (provider === "codex" && sessionId) {
    return `codex resume ${sessionId}`;
  }
  return undefined;
}

function collectTranscriptCandidates(): TranscriptCandidate[] {
  const roots: Array<{ provider: TranscriptProvider; rootPath: string }> = [
    { provider: "codex", rootPath: path.join(process.env.HOME ?? "", ".codex", "sessions") },
    { provider: "qoder", rootPath: path.join(process.env.HOME ?? "", ".qoder", "projects") },
    { provider: "augment", rootPath: path.join(process.env.HOME ?? "", ".augment", "sessions") },
    { provider: "claude", rootPath: path.join(process.env.HOME ?? "", ".claude", "projects") },
  ];

  if (process.env.CLAUDE_CONFIG_DIR) {
    roots.push({ provider: "claude", rootPath: path.join(process.env.CLAUDE_CONFIG_DIR, "projects") });
  }

  const queue = roots
    .filter((entry) => Boolean(entry.rootPath))
    .map((entry) => ({ path: entry.rootPath, provider: entry.provider }));
  const visited = new Set<string>();
  const collected: TranscriptCandidate[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.path)) {
      continue;
    }
    visited.add(current.path);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(current.path);
    } catch {
      continue;
    }

    if (!stat.isDirectory()) {
      const lower = current.path.toLowerCase();
      if ((lower.endsWith(".jsonl") || lower.endsWith(".json")) && stat.size < MAX_TRANSCRIPT_FILE_SIZE) {
        collected.push({ transcriptPath: current.path, modifiedMs: stat.mtimeMs, provider: current.provider });
      }
      continue;
    }

    let entries: string[];
    try {
      entries = fs.readdirSync(current.path);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (IGNORED_PATHS.has(entry)) {
        continue;
      }
      queue.push({ path: path.join(current.path, entry), provider: current.provider });
    }
  }

  return collected.sort((left, right) => right.modifiedMs - left.modifiedMs);
}

function parseTranscriptUpdatedAt(root: Record<string, unknown>): string {
  const candidates = [
    root.last_seen_at_ms,
    root.updated_at,
    root.updatedAt,
    root.timestamp,
    root.created_at,
    root.createdAt,
  ];

  for (const value of candidates) {
    if (typeof value === "number") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 19);
      }
    }

    if (typeof value === "string") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return value.slice(0, 19);
      }
    }
  }

  return "";
}

function parseTranscriptEntries(transcriptPath: string, content: string): Record<string, unknown>[] {
  const lines = content.split(/\r?\n/).filter(Boolean);
  const payloads: Record<string, unknown>[] = [];

  if (transcriptPath.endsWith(".jsonl")) {
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (isRecord(parsed)) {
          payloads.push(parsed);
        }
      } catch {
        continue;
      }
    }
    return payloads;
  }

  try {
    const parsed = JSON.parse(content);
    if (isRecord(parsed)) {
      payloads.push(parsed);
      return payloads;
    }
  } catch {
    // Fallback to line-oriented parsing below.
  }

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (isRecord(parsed)) {
        payloads.push(parsed);
      }
    } catch {
      continue;
    }
  }

  return payloads;
}

function extractEventsFromTranscript(root: unknown): unknown[] {
  if (!root || typeof root !== "object") {
    return [];
  }

  const map = root as Record<string, unknown>;
  const events: unknown[] = [];

  if (Array.isArray(map.events)) {
    events.push(...map.events);
  }

  if (Array.isArray(map.tool_uses)) {
    events.push(...map.tool_uses);
  }

  if (Array.isArray(map.recovered_events)) {
    events.push(...map.recovered_events);
  }

  if (Array.isArray(map.tool_calls)) {
    events.push(...map.tool_calls);
  }

  if (events.length === 0) {
    events.push(root);
  }

  return events;
}

function canonicalizePath(value: string): string {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

function gitRevParsePath(cwd: string, args: string[]): string | null {
  try {
    const raw = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!raw) {
      return null;
    }
    return path.isAbsolute(raw) ? canonicalizePath(raw) : canonicalizePath(path.join(cwd, raw));
  } catch {
    return null;
  }
}

function resolveRepoIdentity(repoRoot: string): RepoIdentity | null {
  const topLevel = gitRevParsePath(repoRoot, ["rev-parse", "--show-toplevel"]);
  if (!topLevel) {
    return null;
  }

  const commonDir = gitRevParsePath(repoRoot, ["rev-parse", "--git-common-dir"]) ?? canonicalizePath(path.join(topLevel, ".git"));
  return {
    topLevel,
    commonDir,
  };
}

function isSameOrDescendant(basePath: string, candidatePath: string): boolean {
  const relative = path.relative(basePath, candidatePath);
  return relative === "" || (!relative.startsWith("../") && !path.isAbsolute(relative));
}

function repoPathMatches(
  repoRoot: string,
  sessionCwd: string,
  repoIdentity: RepoIdentity | null,
  identityCache: Map<string, RepoIdentity | null>,
): boolean {
  const normalizedRepoRoot = canonicalizePath(repoRoot);
  const normalizedSessionCwd = canonicalizePath(sessionCwd);

  if (
    normalizedRepoRoot === normalizedSessionCwd
    || isSameOrDescendant(normalizedRepoRoot, normalizedSessionCwd)
    || isSameOrDescendant(normalizedSessionCwd, normalizedRepoRoot)
  ) {
    return true;
  }

  if (!repoIdentity) {
    return false;
  }

  const cached = identityCache.get(normalizedSessionCwd);
  const sessionIdentity = cached !== undefined ? cached : resolveRepoIdentity(normalizedSessionCwd);
  if (cached === undefined) {
    identityCache.set(normalizedSessionCwd, sessionIdentity);
  }

  return !!sessionIdentity && (
    sessionIdentity.topLevel === repoIdentity.topLevel
    || sessionIdentity.commonDir === repoIdentity.commonDir
  );
}

function parseTranscriptSession(
  transcriptPath: string,
  modifiedMs: number,
  provider: TranscriptProvider,
): ParsedFeatureTranscript | null {
  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }

  const entries = parseTranscriptEntries(transcriptPath, content);
  if (entries.length === 0) {
    return null;
  }

  let sessionId = path.basename(transcriptPath);
  let cwd = "";
  let updatedAt = new Date(modifiedMs).toISOString().slice(0, 19);
  const events: unknown[] = [];

  for (const entry of entries) {
    const payload = isRecord(entry.payload) ? entry.payload : undefined;
    const topLevelType = typeof entry.type === "string" ? entry.type : undefined;

    if (topLevelType === "session_meta" && payload) {
      sessionId = firstString(
        payload.id,
        payload.session_id,
        payload.sessionId,
        entry.session_id,
        entry.sessionId,
      ) ?? sessionId;
      cwd = firstString(payload.cwd, entry.cwd) ?? cwd;
      updatedAt = parseTranscriptUpdatedAt(payload) || parseTranscriptUpdatedAt(entry) || updatedAt;
      continue;
    }

    sessionId = firstString(
      entry.session_id,
      entry.sessionId,
      payload?.session_id,
      payload?.sessionId,
    ) ?? sessionId;
    cwd = firstString(entry.cwd, payload?.cwd) ?? cwd;
    updatedAt = parseTranscriptUpdatedAt(entry) || parseTranscriptUpdatedAt(payload ?? {}) || updatedAt;

    if ((topLevelType === "event_msg" || topLevelType === "response_item") && payload) {
      events.push(payload);
      continue;
    }

    const nestedEvents = extractEventsFromTranscript(entry);
    if (nestedEvents.length > 0 && !(nestedEvents.length === 1 && nestedEvents[0] === entry)) {
      events.push(...nestedEvents);
    }
  }

  if (!cwd) {
    return null;
  }

  return {
    sessionId,
    cwd,
    updatedAt,
    provider,
    promptHistory: collectTranscriptPromptHistory(events),
    toolHistory: collectTranscriptToolHistory(events),
    resumeCommand: buildResumeCommand(provider, sessionId),
    events,
  };
}

function parseResolvedTranscriptSession(
  transcriptPath: string,
  modifiedMs: number,
  provider: TranscriptProvider,
): ResolvedTranscriptSession | null {
  const transcript = parseTranscriptSession(transcriptPath, modifiedMs, provider);
  if (!transcript) {
    return null;
  }

  return {
    ...transcript,
    transcriptPath,
    modifiedMs,
  };
}

function resolveTranscriptSessionsById(sessionIds: string[]): ResolvedTranscriptSession[] {
  const pending = new Set(sessionIds.map((value) => value.trim()).filter(Boolean));
  if (pending.size === 0) {
    return [];
  }

  const candidates = collectTranscriptCandidates();
  const resolved = new Map<string, ResolvedTranscriptSession>();
  const parsedTranscriptPaths = new Set<string>();
  const directPathCandidates = candidates.filter((candidate) =>
    [...pending].some((sessionId) => candidate.transcriptPath.includes(sessionId)));

  for (const candidate of directPathCandidates) {
    const transcript = parseResolvedTranscriptSession(
      candidate.transcriptPath,
      candidate.modifiedMs,
      candidate.provider,
    );
    if (!transcript) {
      continue;
    }
    parsedTranscriptPaths.add(candidate.transcriptPath);

    if (pending.has(transcript.sessionId)) {
      resolved.set(transcript.sessionId, transcript);
      pending.delete(transcript.sessionId);
    }

    for (const sessionId of [...pending]) {
      if (candidate.transcriptPath.includes(sessionId)) {
        resolved.set(sessionId, transcript);
        pending.delete(sessionId);
      }
    }

    if (pending.size === 0) {
      return sessionIds
        .map((sessionId) => resolved.get(sessionId.trim()))
        .filter((session): session is ResolvedTranscriptSession => Boolean(session));
    }
  }

  for (const candidate of candidates) {
    if (parsedTranscriptPaths.has(candidate.transcriptPath)) {
      continue;
    }

    const transcript = parseResolvedTranscriptSession(
      candidate.transcriptPath,
      candidate.modifiedMs,
      candidate.provider,
    );
    if (!transcript || !pending.has(transcript.sessionId)) {
      continue;
    }

    parsedTranscriptPaths.add(candidate.transcriptPath);
    resolved.set(transcript.sessionId, transcript);
    pending.delete(transcript.sessionId);
    if (pending.size === 0) {
      break;
    }
  }

  return sessionIds
    .map((sessionId) => resolved.get(sessionId.trim()))
    .filter((session): session is ResolvedTranscriptSession => Boolean(session));
}

function normalizeFocusFileCandidates(repoRoot: string, filePath: string): string[] {
  const relative = filePath.replace(/\\/g, "/");
  const absolute = path.join(repoRoot, filePath).replace(/\\/g, "/");
  return [relative.toLowerCase(), absolute.toLowerCase()];
}

function matchFocusFilesInText(
  repoRoot: string,
  filePaths: string[],
  value: string,
): string[] {
  const normalizedValue = value.replace(/\\/g, "/").toLowerCase();
  return filePaths.filter((filePath) =>
    normalizeFocusFileCandidates(repoRoot, filePath)
      .some((candidate) => normalizedValue.includes(candidate)));
}

function signalExcerptFromInput(
  toolName: string,
  input: string,
  outputSnippet?: string,
): string {
  if (toolName === "apply_patch") {
    const patchHeaders = input.match(/\*\*\* (?:Update|Add|Delete) File: [^\n]+/g)?.slice(0, 2);
    if (patchHeaders && patchHeaders.length > 0) {
      return truncateSignalExcerpt(patchHeaders.join(" | "));
    }
  }

  return truncateSignalExcerpt(outputSnippet || input);
}

function buildInspectionSignal(
  event: unknown,
  repoRoot: string,
  filePaths: string[],
  featureId: string | undefined,
): TranscriptInspectionSignal | null {
  if (!isRecord(event) || typeof event.type !== "string") {
    return null;
  }

  const toolName = inspectionToolNameFromUnknown(event);
  const input = inspectionInputFromUnknown(event);
  const outputSnippet = commandOutputFromUnknown(event);
  const featureMentioned = Boolean(featureId && truncateSignalExcerpt(`${input ?? ""} ${outputSnippet ?? ""}`).toLowerCase().includes(featureId.toLowerCase()));
  const matchedFilePaths = matchFocusFilesInText(
    repoRoot,
    filePaths,
    `${input ?? ""}\n${outputSnippet ?? ""}`,
  );

  if (event.type === "function_call" && toolName === "exec_command" && input) {
    if (matchedFilePaths.length === 0 && !featureMentioned) {
      return null;
    }

    return {
      kind: "command",
      toolName,
      command: input,
      excerpt: signalExcerptFromInput(toolName, input),
      matchedFilePaths,
      mentionsFeature: featureMentioned,
    };
  }

  if (event.type === "custom_tool_call" && toolName === "apply_patch" && input) {
    if (matchedFilePaths.length === 0 && !featureMentioned) {
      return null;
    }

    return {
      kind: "patch",
      toolName,
      command: input,
      excerpt: signalExcerptFromInput(toolName, input),
      matchedFilePaths,
      mentionsFeature: featureMentioned,
    };
  }

  if (event.type === "exec_command_end" && isFailedCommandEvent(event)) {
    const command = commandFromUnknown(event);
    if (!command) {
      return null;
    }

    if (matchedFilePaths.length === 0 && !featureMentioned) {
      return null;
    }

    return {
      kind: "failure",
      toolName: toolName ?? "exec_command",
      command,
      excerpt: signalExcerptFromInput(toolName ?? "exec_command", command, outputSnippet),
      matchedFilePaths,
      mentionsFeature: featureMentioned,
      exitCode: exitCodeFromUnknown(event),
      outputSnippet: outputSnippet ? truncateSignalExcerpt(outputSnippet) : undefined,
    };
  }

  return null;
}

function dedupeInspectionSignals(
  signals: TranscriptInspectionSignal[],
  limit: number,
): TranscriptInspectionSignal[] {
  const seen = new Set<string>();
  const deduped: TranscriptInspectionSignal[] = [];

  for (const signal of signals) {
    const key = [
      signal.kind,
      signal.toolName,
      signal.command ?? "",
      signal.excerpt,
      signal.matchedFilePaths.join(","),
      signal.exitCode ?? "",
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(signal);
    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

function collectScopeDriftPrompts(
  prompts: string[],
  filePaths: string[],
  featureId: string | undefined,
  limit: number,
): string[] {
  if (prompts.length < 2) {
    return [];
  }

  const focusSet = new Set(filePaths);
  const drifts: string[] = [];

  for (const prompt of prompts.slice(1)) {
    if (isSyntheticUserPrompt(prompt)) {
      continue;
    }

    const featureParam = promptFeatureParam(prompt);
    if (featureId && featureParam && featureParam !== featureId) {
      drifts.push(prompt);
      continue;
    }

    const promptPaths = repoLikePathsFromPrompt(prompt);
    if (promptPaths.length > 0 && promptPaths.every((filePath) => !focusSet.has(filePath))) {
      drifts.push(prompt);
    }

    if (drifts.length >= limit) {
      break;
    }
  }

  return drifts;
}

export function collectMatchingTranscriptSessions(repoRoot: string): ParsedFeatureTranscript[] {
  const now = Date.now();
  const repoIdentity = resolveRepoIdentity(repoRoot);
  const identityCache = new Map<string, RepoIdentity | null>();
  const matched: ParsedFeatureTranscript[] = [];

  for (const candidate of collectTranscriptCandidates()) {
    if (matched.length >= MAX_TRANSCRIPT_FILES) {
      break;
    }
    if (now - candidate.modifiedMs > BROAD_WINDOW_MS) {
      continue;
    }

    const transcript = parseTranscriptSession(candidate.transcriptPath, candidate.modifiedMs, candidate.provider);
    if (!transcript) {
      continue;
    }

    if (!repoPathMatches(repoRoot, transcript.cwd, repoIdentity, identityCache)) {
      continue;
    }

    matched.push(transcript);
  }

  return matched;
}

export function inspectTranscriptTurns(
  repoRoot: string,
  options: TranscriptTurnInspectionOptions,
): TranscriptTurnInspectionResult {
  const sessionIds = [...new Set(options.sessionIds.map((value) => value.trim()).filter(Boolean))];
  const filePaths = [...new Set((options.filePaths ?? []).map((value) => value.trim()).filter(Boolean))];
  const maxUserPrompts = Math.max(1, options.maxUserPrompts ?? DEFAULT_TURN_INSPECTION_MAX_USER_PROMPTS);
  const maxSignals = Math.max(1, options.maxSignals ?? DEFAULT_TURN_INSPECTION_MAX_SIGNALS);
  const transcripts = resolveTranscriptSessionsById(sessionIds);
  const repoIdentity = resolveRepoIdentity(repoRoot);
  const identityCache = new Map<string, RepoIdentity | null>();
  const warnings: string[] = [];
  const missingSessionIds: string[] = [];
  const sessions: InspectedTranscriptSession[] = [];

  for (const sessionId of sessionIds) {
    const transcript = transcripts.find((entry) => entry.sessionId === sessionId || entry.transcriptPath.includes(sessionId));
    if (!transcript) {
      missingSessionIds.push(sessionId);
      continue;
    }

    if (!repoPathMatches(repoRoot, transcript.cwd, repoIdentity, identityCache)) {
      warnings.push(`Session ${sessionId} was resolved outside the current repo root: ${transcript.cwd}`);
    }

    const relevantSignals: TranscriptInspectionSignal[] = [];
    const failedSignals: TranscriptInspectionSignal[] = [];
    const matchedFilePaths = new Set<string>();

    for (const event of transcript.events) {
      const signal = buildInspectionSignal(event, repoRoot, filePaths, options.featureId);
      if (!signal) {
        continue;
      }

      signal.matchedFilePaths.forEach((filePath) => matchedFilePaths.add(filePath));

      if (signal.kind === "failure") {
        failedSignals.push(signal);
      } else {
        relevantSignals.push(signal);
      }
    }

    const promptHistory = transcript.promptHistory.slice(0, maxUserPrompts);
    sessions.push({
      provider: transcript.provider,
      sessionId: transcript.sessionId,
      updatedAt: transcript.updatedAt,
      transcriptPath: transcript.transcriptPath,
      openingUserPrompt: promptHistory[0],
      followUpUserPrompts: promptHistory.slice(1),
      matchedFilePaths: [...matchedFilePaths].sort((left, right) => left.localeCompare(right)),
      relevantSignals: dedupeInspectionSignals(relevantSignals, maxSignals),
      failedSignals: dedupeInspectionSignals(failedSignals, maxSignals),
      scopeDriftPrompts: collectScopeDriftPrompts(transcript.promptHistory, filePaths, options.featureId, maxSignals),
      ...(transcript.resumeCommand ? { resumeCommand: transcript.resumeCommand } : {}),
    });
  }

  return {
    sessions,
    missingSessionIds,
    warnings: [...new Set(warnings)].sort((left, right) => left.localeCompare(right)),
  };
}
