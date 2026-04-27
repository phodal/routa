import fs from "node:fs";
import path from "node:path";

import { getProjectStorageDir } from "@/core/storage/folder-slug";

export type FeatureRetrospectiveMemoryScope = "file" | "feature";

export interface FeatureRetrospectiveMemoryEntry {
  scope: FeatureRetrospectiveMemoryScope;
  targetId: string;
  updatedAt: string;
  summary: string;
  featureId?: string;
  featureName?: string;
}

export interface LoadFeatureRetrospectiveMemoryParams {
  filePaths?: string[];
  featureId?: string;
  featureIds?: string[];
}

export interface SaveFeatureRetrospectiveMemoryInput {
  scope: FeatureRetrospectiveMemoryScope;
  targetId?: string;
  filePath?: string;
  featureId?: string;
  featureName?: string;
  summary: string;
}

const FEATURE_RETROSPECTIVE_DIR = path.join("feature-explorer", "retrospectives");

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeFileTarget(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) {
    throw new Error("File retrospective memory requires a repository-relative file path.");
  }

  const segments = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("File retrospective memory requires a safe repository-relative file path.");
  }

  return segments.join("/");
}

function normalizeFeatureTarget(featureId: string): string {
  const normalized = featureId.trim();
  if (!normalized || normalized.includes("\0")) {
    throw new Error("Feature retrospective memory requires a featureId.");
  }

  return normalized;
}

function sanitizeFeatureFileName(featureId: string): string {
  return encodeURIComponent(featureId.trim()) || "feature";
}

function normalizeEntry(
  value: unknown,
  scope: FeatureRetrospectiveMemoryScope,
  fallbackTargetId: string,
): FeatureRetrospectiveMemoryEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const targetId = normalizeString(candidate.targetId) ?? fallbackTargetId;
  const summary = normalizeString(candidate.summary);

  if (!targetId || !summary) {
    return null;
  }

  return {
    scope,
    targetId,
    updatedAt: normalizeString(candidate.updatedAt) ?? "",
    summary,
    featureId: normalizeString(candidate.featureId),
    featureName: normalizeString(candidate.featureName),
  };
}

function uniquePreserveOrder(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function getFeatureRetrospectiveMemoryRoot(repoRoot: string): string {
  return path.join(
    getProjectStorageDir(path.resolve(repoRoot)),
    FEATURE_RETROSPECTIVE_DIR,
  );
}

export function getFeatureRetrospectiveMemoryPath(
  repoRoot: string,
  input: Pick<SaveFeatureRetrospectiveMemoryInput, "scope" | "targetId" | "filePath" | "featureId">,
): string {
  const root = getFeatureRetrospectiveMemoryRoot(repoRoot);

  if (input.scope === "file") {
    const fileTarget = normalizeFileTarget(normalizeString(input.filePath) ?? normalizeString(input.targetId) ?? "");
    return path.join(root, "files", ...fileTarget.split("/")) + ".json";
  }

  const featureTarget = normalizeFeatureTarget(normalizeString(input.featureId) ?? normalizeString(input.targetId) ?? "");
  return path.join(root, "features", `${sanitizeFeatureFileName(featureTarget)}.json`);
}

function loadFeatureRetrospectiveMemoryEntry(
  repoRoot: string,
  input: Pick<SaveFeatureRetrospectiveMemoryInput, "scope" | "targetId" | "filePath" | "featureId">,
): FeatureRetrospectiveMemoryEntry | null {
  const memoryPath = getFeatureRetrospectiveMemoryPath(repoRoot, input);
  if (!fs.existsSync(memoryPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(memoryPath, "utf8");
    const fallbackTargetId = input.scope === "file"
      ? normalizeFileTarget(normalizeString(input.filePath) ?? normalizeString(input.targetId) ?? "")
      : normalizeFeatureTarget(normalizeString(input.featureId) ?? normalizeString(input.targetId) ?? "");
    return normalizeEntry(JSON.parse(raw) as unknown, input.scope, fallbackTargetId);
  } catch {
    return null;
  }
}

export function loadMatchingFeatureRetrospectiveMemories(
  repoRoot: string,
  params: LoadFeatureRetrospectiveMemoryParams,
): {
  storageRoot: string;
  matchedMemories: FeatureRetrospectiveMemoryEntry[];
} {
  const matchedMemories: FeatureRetrospectiveMemoryEntry[] = [];

  for (const filePath of uniquePreserveOrder(params.filePaths ?? [])) {
    const entry = loadFeatureRetrospectiveMemoryEntry(repoRoot, {
      scope: "file",
      filePath,
    });
    if (entry) {
      matchedMemories.push(entry);
    }
  }

  const featureIds = uniquePreserveOrder([
    ...(params.featureIds ?? []),
    ...(params.featureId ? [params.featureId] : []),
  ]);

  for (const featureId of featureIds) {
    const featureEntry = loadFeatureRetrospectiveMemoryEntry(repoRoot, {
      scope: "feature",
      featureId,
    });
    if (featureEntry) {
      matchedMemories.push(featureEntry);
    }
  }

  return {
    storageRoot: getFeatureRetrospectiveMemoryRoot(repoRoot),
    matchedMemories,
  };
}

export function saveFeatureRetrospectiveMemory(
  repoRoot: string,
  input: SaveFeatureRetrospectiveMemoryInput,
): {
  storagePath: string;
  saved: FeatureRetrospectiveMemoryEntry;
} {
  const summary = normalizeString(input.summary);
  if (!summary) {
    throw new Error("Retrospective summary is required.");
  }

  const targetId = input.scope === "file"
    ? normalizeFileTarget(normalizeString(input.filePath) ?? normalizeString(input.targetId) ?? "")
    : normalizeFeatureTarget(normalizeString(input.featureId) ?? normalizeString(input.targetId) ?? "");
  const updatedAt = new Date().toISOString();
  const saved: FeatureRetrospectiveMemoryEntry = {
    scope: input.scope,
    targetId,
    updatedAt,
    summary,
    featureId: normalizeString(input.featureId),
    featureName: normalizeString(input.featureName),
  };

  const storagePath = getFeatureRetrospectiveMemoryPath(repoRoot, {
    scope: input.scope,
    targetId,
    filePath: input.filePath,
    featureId: input.featureId,
  });
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  fs.writeFileSync(storagePath, `${JSON.stringify(saved, null, 2)}\n`, "utf8");

  return {
    storagePath,
    saved,
  };
}
