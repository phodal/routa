import type { McpServerProfile } from "@/core/mcp/mcp-server-profiles";
import {
  collectFeatureSessionStats,
  parseFeatureTree,
  type FeatureTreeFeature,
  type FileSessionSignal,
  type FileSessionToolFailure,
} from "@/app/api/feature-explorer/shared";

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

const DEFAULT_MAX_FILES = 8;
const DEFAULT_MAX_SESSIONS = 6;
const MAX_FAILURE_SIGNALS = 8;
const MAX_REPEATED_READS = 8;
const MAX_TOOLS_PER_SESSION = 6;
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

  const featureTree = parseFeatureTree(repoRoot);
  const feature = options.featureId
    ? featureTree.features.find((item) => item.id === options.featureId)
    : undefined;

  if (options.featureId && !feature) {
    warnings.push(`Feature not found: ${options.featureId}`);
  }

  const stats = collectFeatureSessionStats(repoRoot, featureTree);
  const selectedFiles = trimTo(
    uniqueSorted([
      ...(options.filePaths ?? []),
      ...collectFeatureFiles(feature, maxFiles),
      ...inferFilesFromSessionIds(options.historySessionIds, stats.fileSignals, maxFiles),
    ]),
    maxFiles,
  );

  if (selectedFiles.length === 0) {
    warnings.push("No task-adaptive files could be resolved from the current request.");
  }

  const filteredSessionIds = options.historySessionIds ? new Set(options.historySessionIds) : undefined;
  const sessionsByKey = new Map<string, CompiledSessionAccumulator>();

  for (const filePath of selectedFiles) {
    const signal = stats.fileSignals[filePath];
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
