import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

const MAX_TRANSCRIPT_FILES = 200;
const MAX_TRANSCRIPT_FILE_SIZE = 10 * 1024 * 1024;
const BROAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PROMPT_SNIPPET_LENGTH = 180;
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

interface RepoIdentity {
  topLevel: string;
  commonDir: string;
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

function collectTranscriptPromptHistory(events: unknown[]): string[] {
  const prompts: string[] = [];

  for (const event of events) {
    const prompt = userPromptFromUnknown(event);
    if (!prompt) {
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
