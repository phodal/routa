import * as path from "path";

import { getRoutaSystem } from "@/core/routa-system";
import { readFeatureSurfaceIndex, type FeatureSurfaceMetadataItem } from "@/core/spec/feature-surface-index";
import {
  normalizeTaskContextSearchSpec,
  type Task,
  type TaskContextSearchSpec,
  type TaskJitContextAnalysis,
  type TaskJitContextAnalysisSessionLead,
} from "@/core/models/task";

export interface RelevantHistoryMemoryEntry {
  taskId: string;
  title: string;
  summary: string;
  topFiles: string[];
  topSessions: TaskJitContextAnalysisSessionLead[];
  reusablePrompts: string[];
  recommendedContextSearchSpec?: TaskContextSearchSpec;
  matchReasons: string[];
  score: number;
  updatedAt?: string;
}

export interface RelevantFeatureTreeContextEntry {
  id: string;
  name: string;
  summary?: string;
  pages: string[];
  apis: string[];
  sourceFiles: string[];
  relatedFeatures: string[];
  matchReasons: string[];
  score: number;
}

export interface ConfirmedFeatureTreeStoryContext {
  selectedFeature?: RelevantFeatureTreeContextEntry;
  confirmedContextSearchSpec?: TaskContextSearchSpec;
  featureTreeYamlBlock?: string;
  warnings: string[];
}

interface HistoryMemoryRetrievalHints {
  taskId?: string;
  taskLabel?: string;
  query?: string;
  featureIds?: string[];
  filePaths?: string[];
  routeCandidates?: string[];
  apiCandidates?: string[];
  moduleHints?: string[];
  symptomHints?: string[];
}

interface FeatureTreeRetrievalHints {
  featureIds?: string[];
  query?: string;
  filePaths?: string[];
  routeCandidates?: string[];
  apiCandidates?: string[];
  moduleHints?: string[];
  symptomHints?: string[];
}

function normalizeString(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringArray(values: ReadonlyArray<string | undefined> | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function normalizeRoute(value: string): string {
  return value.trim().replace(/\/+$/u, "") || "/";
}

function normalizeApi(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function normalizeRepoPath(repoPath: string | undefined): string | undefined {
  const normalized = normalizeString(repoPath);
  return normalized ? path.resolve(normalized) : undefined;
}

function tokenize(values: Array<string | undefined>): string[] {
  const tokens = new Set<string>();

  for (const value of values) {
    if (!value) {
      continue;
    }

    for (const token of value.toLowerCase().split(/[^a-z0-9]+/u)) {
      const trimmed = token.trim();
      if (trimmed.length >= 3) {
        tokens.add(trimmed);
      }
    }

    for (const segment of value.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
      tokens.add(segment);
      for (let start = 0; start < segment.length; start += 1) {
        for (let width = 2; width <= 4; width += 1) {
          const token = segment.slice(start, start + width);
          if (token.length >= 2) {
            tokens.add(token);
          }
        }
      }
    }
  }

  return [...tokens];
}

function countTokenOverlap(texts: string[], tokens: string[]): number {
  if (tokens.length === 0) {
    return 0;
  }

  const haystack = texts.join(" ").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function uniqueReasons(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function mergeSpecs(
  primary: TaskContextSearchSpec | undefined,
  fallback: TaskContextSearchSpec | undefined,
): TaskContextSearchSpec | undefined {
  const merged: TaskContextSearchSpec = {
    query: normalizeString(primary?.query) ?? normalizeString(fallback?.query),
    featureCandidates: normalizeStringArray([
      ...(primary?.featureCandidates ?? []),
      ...(fallback?.featureCandidates ?? []),
    ]),
    relatedFiles: normalizeStringArray([
      ...(primary?.relatedFiles ?? []),
      ...(fallback?.relatedFiles ?? []),
    ]),
    routeCandidates: normalizeStringArray([
      ...(primary?.routeCandidates ?? []),
      ...(fallback?.routeCandidates ?? []),
    ]),
    apiCandidates: normalizeStringArray([
      ...(primary?.apiCandidates ?? []),
      ...(fallback?.apiCandidates ?? []),
    ]),
    moduleHints: normalizeStringArray([
      ...(primary?.moduleHints ?? []),
      ...(fallback?.moduleHints ?? []),
    ]),
    symptomHints: normalizeStringArray([
      ...(primary?.symptomHints ?? []),
      ...(fallback?.symptomHints ?? []),
    ]),
  };

  return Object.values(merged).some((value) =>
    typeof value === "string" ? value.length > 0 : Array.isArray(value) && value.length > 0
  )
    ? merged
    : undefined;
}

function collectCandidateSpec(task: Task): TaskContextSearchSpec | undefined {
  return mergeSpecs(
    task.contextSearchSpec,
    task.jitContextSnapshot?.analysis?.recommendedContextSearchSpec
      ?? task.jitContextSnapshot?.recommendedContextSearchSpec,
  );
}

function buildHistoryMemoryCandidate(task: Task): {
  task: Task;
  analysis: TaskJitContextAnalysis;
  repoPath?: string;
  featureIds: string[];
  files: string[];
  routes: string[];
  apis: string[];
  modules: string[];
  symptoms: string[];
  queryTexts: string[];
  updatedAt?: string;
} | null {
  const analysis = task.jitContextSnapshot?.analysis;
  if (!analysis) {
    return null;
  }

  const candidateSpec = collectCandidateSpec(task);
  const snapshotRepoPath = normalizeRepoPath(task.jitContextSnapshot?.repoPath);
  const featureIds = normalizeStringArray([
    ...(candidateSpec?.featureCandidates ?? []),
    ...(task.jitContextSnapshot?.featureId ? [task.jitContextSnapshot.featureId] : []),
  ]);
  const files = normalizeStringArray([
    ...(candidateSpec?.relatedFiles ?? []),
    ...analysis.topFiles,
  ]);
  const routes = normalizeStringArray(candidateSpec?.routeCandidates).map(normalizeRoute);
  const apis = normalizeStringArray(candidateSpec?.apiCandidates).map(normalizeApi);
  const modules = normalizeStringArray(candidateSpec?.moduleHints);
  const symptoms = normalizeStringArray(candidateSpec?.symptomHints);
  const queryTexts = normalizeStringArray([
    task.title,
    task.objective,
    candidateSpec?.query,
    analysis.summary,
  ]);

  return {
    task,
    analysis,
    repoPath: snapshotRepoPath,
    featureIds,
    files,
    routes,
    apis,
    modules,
    symptoms,
    queryTexts,
    updatedAt: normalizeString(analysis.updatedAt) ?? normalizeString(task.jitContextSnapshot?.generatedAt),
  };
}

type HistoryMemoryCandidate = NonNullable<ReturnType<typeof buildHistoryMemoryCandidate>>;

function scoreHistoryMemoryCandidate(
  candidate: HistoryMemoryCandidate,
  hints: HistoryMemoryRetrievalHints,
  normalizedRepoPath: string | undefined,
): RelevantHistoryMemoryEntry | null {
  if (normalizedRepoPath && candidate.repoPath && candidate.repoPath !== normalizedRepoPath) {
    return null;
  }

  const requestedFeatureIds = new Set(normalizeStringArray(hints.featureIds));
  const requestedFiles = new Set(normalizeStringArray(hints.filePaths));
  const requestedRoutes = new Set(normalizeStringArray(hints.routeCandidates).map(normalizeRoute));
  const requestedApis = new Set(normalizeStringArray(hints.apiCandidates).map(normalizeApi));
  const requestedModules = normalizeStringArray(hints.moduleHints);
  const requestedSymptoms = normalizeStringArray(hints.symptomHints);
  const queryTokens = tokenize([
    hints.taskLabel,
    hints.query,
    ...(hints.moduleHints ?? []),
    ...(hints.symptomHints ?? []),
  ]);

  let score = 0;
  const reasons: string[] = [];

  const overlappingFeatures = candidate.featureIds.filter((featureId) => requestedFeatureIds.has(featureId));
  if (overlappingFeatures.length > 0) {
    score += overlappingFeatures.length * 30;
    reasons.push(`Shared feature candidates: ${overlappingFeatures.join(", ")}`);
  }

  const overlappingFiles = candidate.files.filter((filePath) => requestedFiles.has(filePath));
  if (overlappingFiles.length > 0) {
    score += Math.min(overlappingFiles.length, 4) * 18;
    reasons.push(`Shared files: ${overlappingFiles.slice(0, 4).join(", ")}`);
  }

  const overlappingRoutes = candidate.routes.filter((route) => requestedRoutes.has(route));
  if (overlappingRoutes.length > 0) {
    score += overlappingRoutes.length * 14;
    reasons.push(`Shared routes: ${overlappingRoutes.join(", ")}`);
  }

  const overlappingApis = candidate.apis.filter((api) => requestedApis.has(api));
  if (overlappingApis.length > 0) {
    score += overlappingApis.length * 14;
    reasons.push(`Shared APIs: ${overlappingApis.join(", ")}`);
  }

  const overlappingModules = requestedModules.filter((hint) => candidate.modules.includes(hint));
  if (overlappingModules.length > 0) {
    score += overlappingModules.length * 10;
    reasons.push(`Shared module hints: ${overlappingModules.join(", ")}`);
  }

  const overlappingSymptoms = requestedSymptoms.filter((hint) => candidate.symptoms.includes(hint));
  if (overlappingSymptoms.length > 0) {
    score += overlappingSymptoms.length * 10;
    reasons.push(`Shared symptom hints: ${overlappingSymptoms.join(", ")}`);
  }

  const tokenOverlap = countTokenOverlap(candidate.queryTexts, queryTokens);
  if (tokenOverlap > 0) {
    score += tokenOverlap * 2;
    reasons.push("Query/title overlap with saved history memory");
  }

  if (candidate.updatedAt) {
    const ageMs = Date.now() - Date.parse(candidate.updatedAt);
    if (Number.isFinite(ageMs) && ageMs <= 7 * 24 * 60 * 60 * 1000) {
      score += 3;
      reasons.push("Recent saved history memory");
    }
  }

  if (score <= 0) {
    return null;
  }

  return {
    taskId: candidate.task.id,
    title: candidate.task.title,
    summary: candidate.analysis.summary,
    topFiles: [...candidate.analysis.topFiles],
    topSessions: candidate.analysis.topSessions.map((session) => ({ ...session })),
    reusablePrompts: [...candidate.analysis.reusablePrompts],
    recommendedContextSearchSpec: candidate.analysis.recommendedContextSearchSpec,
    matchReasons: uniqueReasons(reasons),
    score,
    updatedAt: candidate.updatedAt,
  };
}

export async function loadRelevantTaskHistoryMemories(params: {
  workspaceId: string;
  repoPath?: string;
  hints: HistoryMemoryRetrievalHints;
  maxEntries?: number;
}): Promise<RelevantHistoryMemoryEntry[]> {
  const system = getRoutaSystem();
  const normalizedRepoPath = normalizeRepoPath(params.repoPath);
  const allTasks = await system.taskStore.listByWorkspace(params.workspaceId);
  const maxEntries = params.maxEntries ?? 3;

  return allTasks
    .filter((task) => task.id !== params.hints.taskId)
    .map((task) => buildHistoryMemoryCandidate(task))
    .filter((candidate): candidate is Exclude<typeof candidate, null> => Boolean(candidate))
    .map((candidate) => scoreHistoryMemoryCandidate(candidate, params.hints, normalizedRepoPath))
    .filter((entry): entry is RelevantHistoryMemoryEntry => Boolean(entry))
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, maxEntries);
}

function scoreFeatureTreeEntry(
  feature: FeatureSurfaceMetadataItem,
  hints: FeatureTreeRetrievalHints,
): RelevantFeatureTreeContextEntry | null {
  const requestedFeatureIds = new Set(normalizeStringArray(hints.featureIds));
  const requestedFiles = new Set(normalizeStringArray(hints.filePaths));
  const requestedRoutes = new Set(normalizeStringArray(hints.routeCandidates).map(normalizeRoute));
  const requestedApis = new Set(normalizeStringArray(hints.apiCandidates).map(normalizeApi));
  const queryTokens = tokenize([
    hints.query,
    ...(hints.moduleHints ?? []),
    ...(hints.symptomHints ?? []),
  ]);

  let score = 0;
  const reasons: string[] = [];
  const featureId = normalizeString(feature.id) ?? "";
  const featureName = normalizeString(feature.name) ?? featureId;
  const pages = normalizeStringArray(feature.pages);
  const apis = normalizeStringArray(feature.apis);
  const sourceFiles = normalizeStringArray(feature.sourceFiles);
  const relatedFeatures = normalizeStringArray(feature.relatedFeatures);
  const summary = normalizeString(feature.summary);

  if (!featureId && !featureName) {
    return null;
  }

  if (featureId && requestedFeatureIds.has(featureId)) {
    score += 30;
    reasons.push(`Explicit feature candidate: ${featureId}`);
  }

  const overlappingFiles = sourceFiles.filter((filePath) => requestedFiles.has(filePath));
  if (overlappingFiles.length > 0) {
    score += Math.min(overlappingFiles.length, 4) * 14;
    reasons.push(`Overlapping files: ${overlappingFiles.slice(0, 4).join(", ")}`);
  }

  const overlappingRoutes = pages.filter((route) => requestedRoutes.has(normalizeRoute(route)));
  if (overlappingRoutes.length > 0) {
    score += overlappingRoutes.length * 12;
    reasons.push(`Matching routes: ${overlappingRoutes.join(", ")}`);
  }

  const overlappingApis = apis.filter((api) => requestedApis.has(normalizeApi(api)));
  if (overlappingApis.length > 0) {
    score += overlappingApis.length * 12;
    reasons.push(`Matching APIs: ${overlappingApis.join(", ")}`);
  }

  const tokenOverlap = countTokenOverlap([
    featureId,
    featureName,
    summary ?? "",
    ...pages,
    ...apis,
    ...sourceFiles,
    ...relatedFeatures,
  ], queryTokens);
  if (tokenOverlap > 0) {
    score += tokenOverlap * 3;
    reasons.push("Query/module overlap with feature tree surface");
  }

  if (score <= 0) {
    return null;
  }

  return {
    id: featureId,
    name: featureName,
    summary,
    pages,
    apis,
    sourceFiles,
    relatedFeatures,
    matchReasons: uniqueReasons(reasons),
    score,
  };
}

export async function loadRelevantFeatureTreeContext(params: {
  repoPath: string;
  hints: FeatureTreeRetrievalHints;
  maxEntries?: number;
}): Promise<{ features: RelevantFeatureTreeContextEntry[]; warnings: string[] }> {
  const surfaceIndex = await readFeatureSurfaceIndex(params.repoPath);
  const maxEntries = params.maxEntries ?? 3;
  const features = (surfaceIndex.metadata?.features ?? [])
    .map((feature) => scoreFeatureTreeEntry(feature, params.hints))
    .filter((entry): entry is RelevantFeatureTreeContextEntry => Boolean(entry))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, maxEntries);

  return {
    features,
    warnings: [...surfaceIndex.warnings],
  };
}

function trimList(values: string[], maxEntries: number): string[] {
  return values.slice(0, maxEntries);
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"")}"`;
}

function buildFeatureTreeYamlBlock(entry: RelevantFeatureTreeContextEntry): string {
  const pages = normalizeStringArray(entry.pages).map(normalizeRoute);
  const apis = normalizeStringArray(entry.apis).map(normalizeApi);
  const sourceFiles = normalizeStringArray(entry.sourceFiles);
  const lines = [
    "  feature_tree:",
    `    feature_id: ${yamlQuote(entry.id)}`,
    `    feature_name: ${yamlQuote(entry.name)}`,
  ];

  if (pages.length > 0) {
    lines.push("    pages:");
    pages.slice(0, 6).forEach((page) => {
      lines.push(`      - ${yamlQuote(page)}`);
    });
  }

  if (apis.length > 0) {
    lines.push("    apis:");
    apis.slice(0, 6).forEach((api) => {
      lines.push(`      - ${yamlQuote(api)}`);
    });
  }

  if (sourceFiles.length > 0) {
    lines.push("    source_files:");
    sourceFiles.slice(0, 8).forEach((filePath) => {
      lines.push(`      - ${yamlQuote(filePath)}`);
    });
  }

  return lines.join("\n");
}

export async function confirmFeatureTreeStoryContext(params: {
  repoPath: string;
  hints: FeatureTreeRetrievalHints;
  maxEntries?: number;
}): Promise<ConfirmedFeatureTreeStoryContext> {
  const { features, warnings } = await loadRelevantFeatureTreeContext(params);
  const selectedFeature = features[0];
  if (!selectedFeature) {
    return { warnings: [...warnings] };
  }

  const confirmedContextSearchSpec = normalizeTaskContextSearchSpec({
    query: params.hints.query,
    featureCandidates: [selectedFeature.id],
    relatedFiles: selectedFeature.sourceFiles,
    routeCandidates: selectedFeature.pages.map(normalizeRoute),
    apiCandidates: selectedFeature.apis.map(normalizeApi),
    moduleHints: params.hints.moduleHints,
    symptomHints: params.hints.symptomHints,
  });

  return {
    selectedFeature,
    confirmedContextSearchSpec,
    featureTreeYamlBlock: buildFeatureTreeYamlBlock(selectedFeature),
    warnings: [...warnings],
  };
}

export function buildRelevantHistoryMemoryPromptSection(
  entries: RelevantHistoryMemoryEntry[],
  locale = "en",
): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  const isZh = locale.startsWith("zh");
  const title = isZh ? "## Relevant History Memory" : "## Relevant History Memory";
  const lines = [title, ""];

  entries.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.title} (task ${entry.taskId})`);
    lines.push(isZh ? `   匹配原因: ${entry.matchReasons.join("；")}` : `   Match reasons: ${entry.matchReasons.join("; ")}`);
    lines.push(isZh ? `   结论: ${entry.summary}` : `   Summary: ${entry.summary}`);
    if (entry.topFiles.length > 0) {
      lines.push(isZh ? `   优先文件: ${trimList(entry.topFiles, 5).join(", ")}` : `   Top files: ${trimList(entry.topFiles, 5).join(", ")}`);
    }
    if (entry.topSessions.length > 0) {
      const sessionLeads = trimList(
        entry.topSessions.map((session) => `${session.sessionId}${session.provider ? ` (${session.provider})` : ""}: ${session.reason}`),
        3,
      );
      lines.push(isZh ? `   优先会话: ${sessionLeads.join(" | ")}` : `   Top sessions: ${sessionLeads.join(" | ")}`);
    }
    if (entry.reusablePrompts.length > 0) {
      lines.push(isZh ? `   可复用提示词: ${trimList(entry.reusablePrompts, 2).join(" | ")}` : `   Reusable prompts: ${trimList(entry.reusablePrompts, 2).join(" | ")}`);
    }
    lines.push("");
  });

  return lines.join("\n").trim();
}

export function buildRelevantFeatureTreePromptSection(
  entries: RelevantFeatureTreeContextEntry[],
  locale = "en",
  warnings: string[] = [],
): string | undefined {
  if (entries.length === 0 && warnings.length === 0) {
    return undefined;
  }

  const isZh = locale.startsWith("zh");
  const lines = [isZh ? "## Relevant Feature Tree Context" : "## Relevant Feature Tree Context", ""];

  if (entries.length === 0) {
    lines.push(isZh ? "- 当前没有命中的 feature tree 上下文。" : "- No matching feature tree context was resolved.");
  } else {
    entries.forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.name}${entry.id ? ` (${entry.id})` : ""}`);
      lines.push(isZh ? `   匹配原因: ${entry.matchReasons.join("；")}` : `   Match reasons: ${entry.matchReasons.join("; ")}`);
      if (entry.summary) {
        lines.push(isZh ? `   摘要: ${entry.summary}` : `   Summary: ${entry.summary}`);
      }
      if (entry.pages.length > 0) {
        lines.push(isZh ? `   页面: ${trimList(entry.pages, 4).join(", ")}` : `   Pages: ${trimList(entry.pages, 4).join(", ")}`);
      }
      if (entry.apis.length > 0) {
        lines.push(isZh ? `   APIs: ${trimList(entry.apis, 4).join(", ")}` : `   APIs: ${trimList(entry.apis, 4).join(", ")}`);
      }
      if (entry.sourceFiles.length > 0) {
        lines.push(isZh ? `   相关文件: ${trimList(entry.sourceFiles, 6).join(", ")}` : `   Source files: ${trimList(entry.sourceFiles, 6).join(", ")}`);
      }
      lines.push("");
    });
  }

  if (warnings.length > 0) {
    lines.push(isZh ? `Warnings: ${warnings.join(" | ")}` : `Warnings: ${warnings.join(" | ")}`);
  }

  return lines.join("\n").trim();
}

export function buildSavedHistoryMemoryPromptSection(
  task: Task,
): string | undefined {
  const analysis = task.jitContextSnapshot?.analysis;
  if (!analysis) {
    return undefined;
  }

  const lines = [
    "## Saved History Memory",
    "",
    analysis.updatedAt ? `Saved at: ${analysis.updatedAt}` : undefined,
    `Summary: ${analysis.summary}`,
    analysis.topFiles.length > 0 ? `Top files: ${analysis.topFiles.slice(0, 6).join(", ")}` : undefined,
    analysis.topSessions.length > 0
      ? `Top sessions: ${analysis.topSessions
        .slice(0, 3)
        .map((session) => `${session.sessionId}${session.provider ? ` (${session.provider})` : ""}: ${session.reason}`)
        .join(" | ")}`
      : undefined,
    analysis.reusablePrompts.length > 0
      ? `Reusable prompts: ${analysis.reusablePrompts.slice(0, 3).join(" | ")}`
      : undefined,
    analysis.recommendedContextSearchSpec
      ? `Recommended context search spec: ${JSON.stringify(analysis.recommendedContextSearchSpec)}`
      : undefined,
    "",
  ].filter((line): line is string => typeof line === "string" && line.length > 0);

  return lines.join("\n");
}

export function buildHistoryMemoryRetrievalHints(input: {
  taskId?: string;
  taskLabel?: string;
  query?: string;
  featureIds?: string[];
  filePaths?: string[];
  routeCandidates?: string[];
  apiCandidates?: string[];
  moduleHints?: string[];
  symptomHints?: string[];
}): HistoryMemoryRetrievalHints {
  return {
    taskId: normalizeString(input.taskId),
    taskLabel: normalizeString(input.taskLabel),
    query: normalizeString(input.query),
    featureIds: normalizeStringArray(input.featureIds),
    filePaths: normalizeStringArray(input.filePaths),
    routeCandidates: normalizeStringArray(input.routeCandidates),
    apiCandidates: normalizeStringArray(input.apiCandidates),
    moduleHints: normalizeStringArray(input.moduleHints),
    symptomHints: normalizeStringArray(input.symptomHints),
  };
}

export function buildFeatureTreeRetrievalHints(input: {
  featureIds?: string[];
  query?: string;
  filePaths?: string[];
  routeCandidates?: string[];
  apiCandidates?: string[];
  moduleHints?: string[];
  symptomHints?: string[];
}): FeatureTreeRetrievalHints {
  return {
    featureIds: normalizeStringArray(input.featureIds),
    query: normalizeString(input.query),
    filePaths: normalizeStringArray(input.filePaths),
    routeCandidates: normalizeStringArray(input.routeCandidates),
    apiCandidates: normalizeStringArray(input.apiCandidates),
    moduleHints: normalizeStringArray(input.moduleHints),
    symptomHints: normalizeStringArray(input.symptomHints),
  };
}
