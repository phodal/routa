const JSON_SOURCE_KEYS = ["source", "tsx", "code", "canvasSource", "component"];

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
    "Create a Routa browser canvas as TSX source code.",
    "Return only the TSX source.",
    "Do not include markdown code fences.",
    "Do not include explanations, notes, or prose before or after the code.",
    "The source must `export default function Canvas()` or `export default Canvas`.",
    "Prefer a self-contained component with inline styles.",
    'If you import anything, you may only import from `react` or `@canvas-sdk`.',
    "Do not use browser globals or side effects such as `window`, `document`, `fetch`, or `localStorage`.",
    "",
    "User request:",
    userPrompt.trim(),
  ].join("\n");
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
