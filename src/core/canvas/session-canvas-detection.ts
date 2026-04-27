import { extractCanvasSourceFromSpecialistOutput } from "./specialist-source";

const CANVAS_FILE_SUFFIX = ".canvas.tsx";

const PATH_KEYS = [
  "path",
  "file_path",
  "filePath",
  "filepath",
  "absolute_path",
  "target_file",
  "filename",
];

const SOURCE_KEYS = [
  "content",
  "new_string",
  "text",
  "source",
  "file_content",
  "code",
];

const TOOL_UPDATE_KINDS = new Set([
  "tool_call",
  "tool_call_update",
  "tool_call_params_delta",
]);

export interface CanvasToolWriteCandidate {
  fileName: string;
  filePath: string;
  sessionId: string;
  source: string;
  title: string;
  toolCallId?: string;
}

export interface CanvasToolWriteCandidateInput {
  previousRawInput?: Record<string, unknown>;
  sessionId: string;
  update: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function isCanvasFilePath(value: string): boolean {
  return value.trim().toLowerCase().endsWith(CANVAS_FILE_SUFFIX);
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

function toTitle(filePath: string): string {
  const fileName = getFileName(filePath);
  const stem = fileName.slice(0, -CANVAS_FILE_SUFFIX.length);
  const words = stem
    .split(/[-_\s.]+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (words.length === 0) return "Canvas";

  return words
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function normalizeCanvasSource(source: string): string | null {
  return extractCanvasSourceFromSpecialistOutput(source);
}

function buildCandidate(
  sessionId: string,
  filePath: string,
  rawSource: string,
  toolCallId?: string,
): CanvasToolWriteCandidate | null {
  if (!isCanvasFilePath(filePath)) return null;

  const source = normalizeCanvasSource(rawSource);
  if (!source) return null;

  return {
    fileName: getFileName(filePath),
    filePath,
    sessionId,
    source,
    title: toTitle(filePath),
    toolCallId,
  };
}

function extractApplyPatchCandidate(
  sessionId: string,
  patch: string,
  toolCallId?: string,
): CanvasToolWriteCandidate | null {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^\*\*\* (Add|Update) File:\s+(.+\.canvas\.tsx)\s*$/i);
    if (!match) continue;

    const operation = match[1]?.toLowerCase();
    const sourceLines: string[] = [];
    for (let lineIndex = index + 1; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? "";
      if (line.startsWith("*** ")) break;
      if (line.startsWith("@@")) continue;
      // Update patches only contain the changed hunk, so extraction is best-effort:
      // it only materializes when the hunk includes enough context to form a full Canvas module.
      if (line.startsWith("+") || (operation === "update" && line.startsWith(" "))) {
        sourceLines.push(line.slice(1));
      }
    }

    const candidate = buildCandidate(sessionId, match[2].trim(), sourceLines.join("\n"), toolCallId);
    if (candidate) return candidate;
  }

  return null;
}

function extractGitDiffNewFileCandidate(
  sessionId: string,
  patch: string,
  toolCallId?: string,
): CanvasToolWriteCandidate | null {
  const sections = patch.replace(/\r\n/g, "\n").split(/^diff --git /gm);

  for (const section of sections) {
    const filePath = section.match(/^\+\+\+\s+b\/(.+\.canvas\.tsx)\s*$/im)?.[1]?.trim();
    if (!filePath) continue;
    if (!/new file mode/im.test(section)) continue;

    const source = section
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1))
      .join("\n");

    const candidate = buildCandidate(sessionId, filePath, source, toolCallId);
    if (candidate) return candidate;
  }

  return null;
}

export function getCanvasToolInputFromUpdate(
  update: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const rawInput = update.rawInput;
  if (isPlainObject(rawInput)) return rawInput;

  const parsedInput = update.parsedInput;
  if (isPlainObject(parsedInput)) return parsedInput;

  return undefined;
}

export function mergeCanvasToolInputs(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!previous) return next;
  if (!next) return previous;
  return { ...previous, ...next };
}

export function extractCanvasToolWriteCandidate({
  previousRawInput,
  sessionId,
  update,
}: CanvasToolWriteCandidateInput): CanvasToolWriteCandidate | null {
  const sessionUpdate = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";
  if (!TOOL_UPDATE_KINDS.has(sessionUpdate)) return null;

  const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : undefined;
  const rawInput = mergeCanvasToolInputs(previousRawInput, getCanvasToolInputFromUpdate(update));
  if (!rawInput) return null;

  const patch = readString(rawInput, ["patch", "diff"]);
  if (patch) {
    const applyPatchCandidate = extractApplyPatchCandidate(sessionId, patch, toolCallId);
    if (applyPatchCandidate) return applyPatchCandidate;

    const gitDiffCandidate = extractGitDiffNewFileCandidate(sessionId, patch, toolCallId);
    if (gitDiffCandidate) return gitDiffCandidate;
  }

  const filePath = readString(rawInput, PATH_KEYS);
  const rawSource = readString(rawInput, SOURCE_KEYS);
  if (!filePath || !rawSource) return null;

  return buildCandidate(sessionId, filePath, rawSource, toolCallId);
}

function hashCanvasSource(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

export function getCanvasToolWriteCandidateKey(candidate: CanvasToolWriteCandidate): string {
  return [
    candidate.sessionId,
    candidate.toolCallId ?? "",
    candidate.filePath,
    hashCanvasSource(candidate.source),
  ].join(":");
}
