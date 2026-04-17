import {
  buildCanvasSpecialistContractLines,
  getCanvasGenerationContract,
} from "./generation-contract";

const JSON_SOURCE_KEYS = getCanvasGenerationContract().output.jsonSourceKeys;

export type CanvasSpecialistHistoryEntry = {
  update?: Record<string, unknown>;
  [key: string]: unknown;
};

function normalizeRawOutput(raw: string): string {
  return raw.replace(/^\uFEFF/, "").trim();
}

function extractFromJsonPayload(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  for (const key of JSON_SOURCE_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function extractFencedCodeBlock(raw: string): string | null {
  const matches = [...raw.matchAll(/```(?:tsx|jsx|typescript|javascript)?\s*([\s\S]*?)```/gi)];
  for (const match of matches) {
    const candidate = match[1]?.trim();
    if (candidate && candidate.includes("export default")) {
      return candidate;
    }
  }

  const first = matches[0]?.[1]?.trim();
  return first && first.length > 0 ? first : null;
}

function normalizeCanvasModuleSource(raw: string): string | null {
  const trimmed = normalizeRawOutput(raw);
  if (!trimmed) return null;

  const startMarkers = [
    'import ',
    "export default",
    "function Canvas(",
    "const Canvas =",
  ];
  const startIndex = startMarkers
    .map((marker) => trimmed.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const candidate = startIndex !== undefined ? trimmed.slice(startIndex).trim() : trimmed;

  if (candidate.includes("export default")) {
    return candidate;
  }

  if (candidate.startsWith("function Canvas(")) {
    return `export default ${candidate}`;
  }

  if (candidate.startsWith("const Canvas =")) {
    return `${candidate}\n\nexport default Canvas;`;
  }

  return null;
}

export function buildCanvasSpecialistPrompt(userPrompt: string): string {
  return [
    ...buildCanvasSpecialistContractLines(),
    "",
    "User request:",
    userPrompt.trim(),
  ].join("\n");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractUpdateText(update: Record<string, unknown>): string {
  const data = update.data;
  if (typeof data === "string") {
    const nonDeltaMarker = 'Agent message (non-delta) received: "';
    const deltaMarker = 'delta: "';
    for (const marker of [nonDeltaMarker, deltaMarker]) {
      const start = data.indexOf(marker);
      if (start >= 0) {
        const tail = data.slice(start + marker.length);
        const end = tail.lastIndexOf("\"");
        if (end >= 0) {
          try {
            return JSON.parse(`"${tail.slice(0, end)}"`) as string;
          } catch {
            return tail.slice(0, end).replaceAll("\\n", "\n");
          }
        }
      }
    }
  }

  if (typeof update.delta === "string") return update.delta;
  if (typeof update.text === "string") return update.text;
  if (typeof update.content === "string") return update.content;

  const content = update.content;
  if (isPlainObject(content) && typeof content.text === "string") {
    return content.text;
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (!isPlainObject(entry)) return "";
        if (typeof entry.text === "string") return entry.text;
        if (typeof entry.content === "string") return entry.content;
        return "";
      })
      .join("");
  }

  const message = update.message;
  if (typeof message === "string") return message;
  if (isPlainObject(message)) {
    if (typeof message.text === "string") return message.text;

    const nested = message.content;
    if (typeof nested === "string") return nested;
    if (isPlainObject(nested) && typeof nested.text === "string") {
      return nested.text;
    }
    if (Array.isArray(nested)) {
      return nested
        .map((entry) => {
          if (!isPlainObject(entry)) return "";
          if (typeof entry.text === "string") return entry.text;
          if (typeof entry.content === "string") return entry.content;
          return "";
        })
        .join("");
    }
  }

  return "";
}

function extractToolCallCanvasCandidate(update: Record<string, unknown>): string {
  const sessionUpdate = typeof update.sessionUpdate === "string"
    ? update.sessionUpdate
    : "";
  if (sessionUpdate !== "tool_call" && sessionUpdate !== "tool_call_update") {
    return "";
  }

  const kind = typeof update.kind === "string" ? update.kind : "";
  const title = typeof update.title === "string" ? update.title.toLowerCase() : "";
  if (kind !== "edit" && title !== "write" && title !== "edit") {
    return "";
  }

  const rawInput = isPlainObject(update.rawInput) ? update.rawInput : null;
  if (!rawInput) return "";

  const candidateKeys = ["content", "new_string", "text", "source"];
  for (const key of candidateKeys) {
    const candidate = rawInput[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

export function extractCanvasSpecialistOutputFromHistory(
  history: CanvasSpecialistHistoryEntry[],
): string {
  const directOutput = history
    .map((entry) => {
      const update = isPlainObject(entry.update) ? entry.update : null;
      if (!update) return "";
      const sessionUpdate = typeof update.sessionUpdate === "string"
        ? update.sessionUpdate
        : "";
      if (
        sessionUpdate === "agent_message"
        || sessionUpdate === "agent_message_chunk"
        || sessionUpdate === "agent_chunk"
      ) {
        return extractUpdateText(update);
      }
      return "";
    })
    .join("")
    .trim();

  if (directOutput) {
    return directOutput;
  }

  const processOutput = history
    .map((entry) => {
      const update = isPlainObject(entry.update) ? entry.update : null;
      if (!update) return "";
      return typeof update.sessionUpdate === "string" && update.sessionUpdate === "process_output"
        ? extractUpdateText(update)
        : "";
    })
    .join("")
    .trim();

  if (processOutput) {
    return processOutput;
  }

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const update = isPlainObject(history[index]?.update) ? history[index]?.update as Record<string, unknown> : null;
    if (!update) continue;
    const candidate = extractToolCallCanvasCandidate(update);
    if (candidate) {
      return candidate;
    }
  }

  return "";
}

export function extractCanvasSourceFromSpecialistOutput(output: string): string | null {
  const normalized = normalizeRawOutput(output);
  if (!normalized) return null;

  try {
    const parsed = JSON.parse(normalized) as unknown;
    const sourceFromJson = extractFromJsonPayload(parsed);
    if (sourceFromJson) {
      return normalizeCanvasModuleSource(sourceFromJson);
    }
  } catch {
    // Ignore non-JSON output.
  }

  const fenced = extractFencedCodeBlock(normalized);
  if (fenced) {
    const normalizedFenced = normalizeCanvasModuleSource(fenced);
    if (normalizedFenced) return normalizedFenced;
  }

  return normalizeCanvasModuleSource(normalized);
}
