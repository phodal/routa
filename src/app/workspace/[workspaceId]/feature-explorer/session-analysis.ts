import type { Locale } from "@/i18n";

import type { AggregatedSelectionSession, FeatureDetail } from "./types";

const MAX_PROMPT_HISTORY_ITEMS = 4;
const MAX_TOOL_BREAKDOWN_ITEMS = 6;
const MAX_KEY_RELATED_FILES = 8;
const MAX_REPEATED_READ_ITEMS = 4;
const MAX_REPEATED_COMMAND_ITEMS = 4;
const MAX_FAILED_TOOL_ITEMS = 4;
const MAX_TRANSCRIPT_HINT_SESSIONS = 4;
const COMPACT_SESSION_THRESHOLD = 4;
const NOISE_TOOL_NAMES = new Set(["update_plan", "write_stdin"]);

export interface BuildSessionAnalysisPromptInput {
  locale: Locale;
  workspaceId: string;
  repoName?: string;
  repoPath?: string;
  branch?: string;
  featureDetail: FeatureDetail | null;
  selectedFilePaths: string[];
  sessions: AggregatedSelectionSession[];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function uniquePreserveOrder(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function limitItems<T>(items: T[], limit: number): T[] {
  return items.slice(0, limit);
}

export function isNoiseChangedFileEntry(entry: string): boolean {
  const value = entry.trim();
  if (!value) return true;

  return value.startsWith("fatal:")
    || value.startsWith("index ")
    || value.startsWith("@@")
    || value.startsWith("---")
    || value.startsWith("+++")
    || value.includes("Operation not permitted")
    || value.includes("Permission denied")
    || value.includes("No such file or directory");
}

export function sanitizeChangedFiles(entries: string[]): string[] {
  return uniqueSorted(entries.filter((entry) => !isNoiseChangedFileEntry(entry)));
}

function isLikelyRepoFileEntry(entry: string): boolean {
  const value = entry.trim();
  if (!value) {
    return false;
  }

  if (isNoiseChangedFileEntry(value)) {
    return false;
  }

  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("![")) {
    return false;
  }

  if (value.includes("screenshots/") || value.includes("://")) {
    return false;
  }

  if (/^[0-9.]+$/.test(value)) {
    return false;
  }

  if (/^[A-Za-z0-9_-]+\.$/.test(value)) {
    return false;
  }

  return /[\\/]/.test(value) || /\.[A-Za-z0-9]{1,8}$/.test(value);
}

function sanitizeDiagnosticFiles(entries: string[]): string[] {
  return uniqueSorted(entries.filter((entry) => isLikelyRepoFileEntry(entry)));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function promptLooksLikeMetaAnalysisOrPromptTuning(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) {
    return false;
  }

  const hasTranscriptMarker = normalized.includes("jsonl") || normalized.includes("transcript");
  const hasPromptTuningMarker = [
    "prompt",
    "提示词",
    "summary",
    "specialist",
    "file-session-analyst",
    "session id",
    "会话 id",
    "session-analysis",
    "会话分析",
  ].some((marker) => normalized.includes(marker));

  return normalized.includes("you analyze historical coding sessions for one or more specific files")
    || normalized.includes("run a read-only retrospective on these file-linked coding sessions")
    || normalized.includes("请对这些与文件相关的历史编码会话做一次只读复盘")
    || normalized.includes("你是一个只读的文件会话分析师")
    || normalized.includes("这个生成的 prompt 有问题")
    || normalized.includes("specialist 的 prompt 有没有问题")
    || normalized.includes("让 ai 去分析")
    || normalized.includes("读取那些 jsonl")
    || normalized.includes("session id:")
    || (hasTranscriptMarker && hasPromptTuningMarker);
}

function sessionLooksLikeMetaAnalysisOrPromptTuning(session: AggregatedSelectionSession): boolean {
  return [session.promptSnippet, ...session.promptHistory]
    .filter(Boolean)
    .some((prompt) => promptLooksLikeMetaAnalysisOrPromptTuning(prompt));
}

function sanitizeRepeatedCommands(entries: string[]): string[] {
  return uniquePreserveOrder(entries.filter((entry) => {
    const value = normalizeWhitespace(entry);
    if (!value) {
      return false;
    }

    return !value.startsWith("{")
      && !value.startsWith("[")
      && !value.includes("\"session_id\"")
      && !value.includes("\"toolCallId\"")
      && !value.includes("\"yield_time_ms\"")
      && !value.includes("\"max_output_tokens\"")
      && !value.includes("request-permission")
      && !value.includes("write_stdin")
      && !value.includes("session_id")
      && !value.startsWith("git status --short")
      && !value.startsWith("git status --short --branch")
      && !value.startsWith("git rev-list")
      && !value.startsWith("git push ")
      && !value.startsWith("agent-browser snapshot");
  }));
}

function sanitizeFailedTools(
  failures: NonNullable<AggregatedSelectionSession["diagnostics"]>["failedTools"],
  selectedFiles: string[],
): Array<{ toolName: string; command?: string; message: string }> {
  return failures.filter((failure) => {
    const command = failure.command?.trim() ?? "";
    const message = normalizeWhitespace(failure.message);
    const combined = `${command} ${message}`;
    const touchesSelectedFile = selectedFiles.some((file) => combined.includes(file));

    return !combined.includes("Operation not permitted")
      && !combined.includes("Permission denied")
      && !combined.includes("index.lock")
      && !combined.includes("no matches found:")
      && !combined.includes("Unknown JSON field")
      && !combined.includes("command not found: entrix")
      && (!combined.includes("could not write index") || touchesSelectedFile);
  });
}

function pathTokens(value: string): string[] {
  return value
    .split(/[\\/[\]._-]+/)
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
}

function sortRelatedFiles(entries: string[], selectedFiles: string[]): string[] {
  const selectedTokens = new Set(selectedFiles.flatMap((file) => pathTokens(file)));
  const selectedDirs = selectedFiles
    .map((file) => file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "")
    .filter(Boolean);

  const scoreEntry = (entry: string): number => {
    let score = 0;

    if (selectedDirs.some((dir) => entry.startsWith(`${dir}/`))) {
      score += 5;
    }

    const overlap = pathTokens(entry).filter((token) => selectedTokens.has(token)).length;
    score += overlap * 2;

    if (entry.startsWith(".agents/") || entry.startsWith(".claude/")) {
      score -= 4;
    } else if (entry.startsWith("docs/")) {
      score -= 1;
    }

    return score;
  };

  return [...entries]
    .map((entry) => ({ entry, score: scoreEntry(entry) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.localeCompare(right.entry))
    .map((entry) => entry.entry);
}

function formatOrderedList(items: string[], emptyFallback: string): string {
  if (items.length === 0) {
    return `- ${emptyFallback}`;
  }

  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function formatBulletList(items: string[], emptyFallback: string): string {
  if (items.length === 0) {
    return `- ${emptyFallback}`;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function formatInlineValue(items: string[], emptyFallback: string): string {
  return items.length > 0 ? items.join(", ") : emptyFallback;
}

interface SessionFileEvidence {
  relevanceScore: number;
  relevanceLabel: string;
  matchedReadFiles: string[];
  matchedWrittenFiles: string[];
  matchedChangedFiles: string[];
  relatedFiles: string[];
  repeatedSelectedReads: string[];
}

function buildSessionFileEvidence(
  locale: Locale,
  selectedFiles: string[],
  session: AggregatedSelectionSession,
): SessionFileEvidence {
  const selectedSet = new Set(selectedFiles);
  const diagnostics = session.diagnostics;
  const readFiles = sanitizeDiagnosticFiles(diagnostics?.readFiles ?? []);
  const writtenFiles = sanitizeDiagnosticFiles(diagnostics?.writtenFiles ?? []);
  const changedFiles = sanitizeChangedFiles(session.changedFiles);
  const matchedReadFiles = readFiles.filter((entry) => selectedSet.has(entry));
  const matchedWrittenFiles = writtenFiles.filter((entry) => selectedSet.has(entry));
  const matchedChangedFiles = changedFiles.filter((entry) => selectedSet.has(entry));
  const repeatedSelectedReads = limitItems(
    uniqueSorted((diagnostics?.repeatedReadFiles ?? []).filter((entry) => selectedFiles.some((file) => entry.includes(file)))),
    MAX_REPEATED_READ_ITEMS,
  );
  const relatedFiles = limitItems(
    sortRelatedFiles(uniqueSorted([
      ...changedFiles,
      ...readFiles,
      ...writtenFiles,
    ].filter((entry) => !selectedSet.has(entry))), selectedFiles),
    MAX_KEY_RELATED_FILES,
  );

  if (sessionLooksLikeMetaAnalysisOrPromptTuning(session)) {
    return {
      relevanceScore: 0,
      relevanceLabel: locale === "zh"
        ? "这是当前复盘 / prompt / JSONL 调试元会话；即便触及了文件，也优先按弱证据或噪音处理"
        : "This is a retrospective/prompt/JSONL tuning meta-session; treat it as weak or noisy evidence even if it touched the file(s)",
      matchedReadFiles,
      matchedWrittenFiles,
      matchedChangedFiles,
      relatedFiles,
      repeatedSelectedReads,
    };
  }

  if (matchedWrittenFiles.length > 0 || matchedChangedFiles.length > 0) {
    return {
      relevanceScore: 2,
      relevanceLabel: locale === "zh"
        ? "直接改动了选中文件"
        : "Direct write/change on the selected file(s)",
      matchedReadFiles,
      matchedWrittenFiles,
      matchedChangedFiles,
      relatedFiles,
      repeatedSelectedReads,
    };
  }

  if (matchedReadFiles.length > 0) {
    return {
      relevanceScore: 1,
      relevanceLabel: locale === "zh"
        ? "直接读取了选中文件，但没有直接改动证据"
        : "Direct read of the selected file(s), but no direct write/change evidence",
      matchedReadFiles,
      matchedWrittenFiles,
      matchedChangedFiles,
      relatedFiles,
      repeatedSelectedReads,
    };
  }

  return {
    relevanceScore: 0,
    relevanceLabel: locale === "zh"
      ? "没有直接选中文件证据，优先当作邻近或噪音会话处理"
      : "No direct selected-file evidence; treat as adjacent or noisy unless other evidence proves otherwise",
    matchedReadFiles,
    matchedWrittenFiles,
    matchedChangedFiles,
    relatedFiles,
    repeatedSelectedReads,
  };
}

function buildRelevanceOverview(
  locale: Locale,
  selectedFiles: string[],
  sessions: AggregatedSelectionSession[],
): string {
  const evidence = sessions.map((session) => ({
    session,
    summary: buildSessionFileEvidence(locale, selectedFiles, session),
  }));
  const directWriteSessions = evidence
    .filter((entry) => entry.summary.relevanceScore >= 2)
    .map((entry) => entry.session.sessionId);
  const directReadOnlySessions = evidence
    .filter((entry) => entry.summary.relevanceScore === 1)
    .map((entry) => entry.session.sessionId);
  const weakSessions = evidence
    .filter((entry) => entry.summary.relevanceScore === 0)
    .map((entry) => entry.session.sessionId);

  if (locale === "zh") {
    return [
      `- 直接改动选中文件的会话: ${directWriteSessions.length}/${sessions.length}`,
      `- 只读取了选中文件的会话: ${directReadOnlySessions.length}/${sessions.length}`,
      `- 没有直接选中文件证据的会话: ${weakSessions.length}/${sessions.length}`,
      weakSessions.length > 0
        ? `- 低置信会话 ID: ${weakSessions.join(", ")}`
        : "- 低置信会话 ID: 无",
    ].join("\n");
  }

  return [
    `- Sessions with direct writes/changes on selected files: ${directWriteSessions.length}/${sessions.length}`,
    `- Sessions that only read selected files: ${directReadOnlySessions.length}/${sessions.length}`,
    `- Sessions with no direct selected-file evidence: ${weakSessions.length}/${sessions.length}`,
    weakSessions.length > 0
      ? `- Lower-confidence session IDs: ${weakSessions.join(", ")}`
      : "- Lower-confidence session IDs: None",
  ].join("\n");
}

function buildPreferredTranscriptHintSessions(
  selectedFiles: string[],
  sessions: AggregatedSelectionSession[],
): AggregatedSelectionSession[] {
  const rankedSessions = sessions
    .filter((session) => !sessionLooksLikeMetaAnalysisOrPromptTuning(session))
    .map((session) => ({
      session,
      relevanceScore: buildSessionFileEvidence("en", selectedFiles, session).relevanceScore,
    }))
    .sort((left, right) => {
      if (right.relevanceScore !== left.relevanceScore) {
        return right.relevanceScore - left.relevanceScore;
      }
      return right.session.updatedAt.localeCompare(left.session.updatedAt);
    });

  const strongerSessions = rankedSessions.filter((entry) => entry.relevanceScore > 0);
  const source = strongerSessions.length > 0 ? strongerSessions : rankedSessions;
  return source
    .slice(0, MAX_TRANSCRIPT_HINT_SESSIONS)
    .map((entry) => entry.session);
}

function buildSessionBlocks(
  locale: Locale,
  selectedFiles: string[],
  sessions: AggregatedSelectionSession[],
): string {
  const noChangedFiles = locale === "zh" ? "未捕获到可信的 changed files" : "No trustworthy changed files captured";
  const noPrompts = locale === "zh" ? "没有额外提示词历史" : "No additional prompt history";
  const noToolBreakdown = locale === "zh" ? "没有可信的工具调用分布" : "No trustworthy tool-call breakdown";
  const noSelectedEvidence = locale === "zh" ? "无" : "None";

  const rankedSessions = sessions
    .map((session) => ({
      session,
      evidence: buildSessionFileEvidence(locale, selectedFiles, session),
    }))
    .sort((left, right) => {
      if (right.evidence.relevanceScore !== left.evidence.relevanceScore) {
        return right.evidence.relevanceScore - left.evidence.relevanceScore;
      }
      return right.session.updatedAt.localeCompare(left.session.updatedAt);
    });
  const skippedMetaSessions = uniqueSorted(
    rankedSessions
      .filter(({ session }) => sessionLooksLikeMetaAnalysisOrPromptTuning(session))
      .map(({ session }) => session.sessionId),
  );
  const compactMode = rankedSessions.length >= COMPACT_SESSION_THRESHOLD;
  if (compactMode) {
    return locale === "zh"
      ? [
        `- 当前共有 ${rankedSessions.length} 个已选 session。为避免 prompt 过长，这里不再内联逐条 session 证据块。`,
        "- 请直接使用上面的 Transcript Hints 读取对应 JSONL，并以你自己的分析为主。",
        skippedMetaSessions.length > 0
          ? `- 已从 Transcript Hints 中省略明显是在调当前复盘 / prompt / JSONL 流程本身的元会话: ${skippedMetaSessions.join(", ")}`
          : "",
        "- 如果可以使用 `inspect_transcript_turns`，优先用它抽取真实用户 turns、目标文件相关命令、失败命令和范围漂移；如果它不可用，优先运行 `node --import tsx scripts/harness/inspect-transcript-turns.ts --session-id <id> --file <path> [--feature-id <id>]`。",
        "- 只有在上面的 tool / script 仍不足以支撑判断时，才编写临时小脚本补充 opening prompt、prompt history、selected-file read/write/change、failed tools、scope drift 等结构化信号。",
        "- 读取 JSONL 时，只提取真实用户 turns（例如 user_message、role=user 的 message），以及与选中文件或 feature 直接相关的 exec_command / apply_patch / failed command 信号。忽略 developer/system/base instructions、token_count 和无关长输出。",
        "- 不要用 rg/grep 按关键字扫描整行 JSONL 再回显整段对象；先按 row type 过滤，再抽需要字段。",
        "- 不要把任务改写成整个仓库的架构评审、静态 codebase review 或 ADR/ARCHITECTURE 对账；如果没有先读这些 session 的 JSONL，就不要下仓库级结论。",
        "- 如果这些 JSONL 读不到，就在输出中明确写出限制并停止，不要退化成基于 git 历史、仓库文档或全仓代码扫描的替代分析。",
      ].filter(Boolean).join("\n")
      : [
        `- There are ${rankedSessions.length} selected sessions. To keep the prompt compact, detailed per-session evidence blocks are omitted.`,
        "- Read the matching JSONL files from Transcript Hints directly and prioritize your own analysis over the pre-baked summary.",
        skippedMetaSessions.length > 0
          ? `- Transcript Hints already omit clear prompt/JSONL retrospective meta-sessions: ${skippedMetaSessions.join(", ")}`
          : "",
        "- If `inspect_transcript_turns` is available, prefer it for extracting real user turns, target-file commands, failed commands, and scope drift. If it is unavailable, prefer `node --import tsx scripts/harness/inspect-transcript-turns.ts --session-id <id> --file <path> [--feature-id <id>]`.",
        "- Only write a one-off script after that tool/script path is still insufficient for opening prompts, prompt history, selected-file reads/writes/changes, failed tools, scope drift, and other structured signals.",
        "- When reading JSONL, only extract real user turns (for example user_message or role=user messages) plus exec_command/apply_patch/failed-command evidence that directly touches the selected file or feature. Ignore developer/system/base instructions, token_count, and unrelated long outputs.",
        "- Do not grep whole JSONL rows by generic keywords and print entire objects. Filter by row type first, then extract only the fields you need.",
        "- Do not turn this into a repo-wide architecture review, static codebase audit, or ADR/ARCHITECTURE consistency check. If you have not read the linked session JSONL files first, do not make repo-level conclusions.",
        "- If those JSONL files are inaccessible, state that limitation and stop. Do not fall back to git history, repository documents, or full-codebase scanning as a substitute analysis path.",
      ].filter(Boolean).join("\n");
  }

  return rankedSessions.map(({ session, evidence }, index) => {
      const promptHistory = limitItems(uniquePreserveOrder(session.promptHistory), MAX_PROMPT_HISTORY_ITEMS);
      const diagnostics = session.diagnostics;
      const toolCallBreakdown = diagnostics
        ? limitItems(
          Object.entries(diagnostics.toolCallsByName)
            .filter(([toolName]) => !NOISE_TOOL_NAMES.has(toolName))
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .map(([toolName, count]) => `${toolName}: ${count}`),
          MAX_TOOL_BREAKDOWN_ITEMS,
        )
        : [];
      const repeatedCommands = limitItems(
        sanitizeRepeatedCommands(diagnostics?.repeatedCommands ?? []),
        MAX_REPEATED_COMMAND_ITEMS,
      );
      const failedTools = limitItems(
        sanitizeFailedTools(diagnostics?.failedTools ?? [], selectedFiles),
        MAX_FAILED_TOOL_ITEMS,
      );

      return [
        `## Session ${index + 1}`,
        `- Provider: ${session.provider}`,
        `- Session ID: ${session.sessionId}`,
        `- Updated At: ${session.updatedAt}`,
        session.resumeCommand ? `- Resume Command: ${session.resumeCommand}` : "",
        `- Prompt Snippet: ${session.promptSnippet || (locale === "zh" ? "无" : "None")}`,
        diagnostics ? `- Tool Calls: ${diagnostics.toolCallCount}` : "",
        diagnostics ? `- Failed Tool Calls: ${failedTools.length}` : "",
        locale === "zh" ? "### 选中文件证据" : "### Selected File Evidence",
        `- ${locale === "zh" ? "相关性" : "Relevance"}: ${evidence.relevanceLabel}`,
        `- ${locale === "zh" ? "读取选中文件" : "Read selected files"}: ${formatInlineValue(evidence.matchedReadFiles, noSelectedEvidence)}`,
        `- ${locale === "zh" ? "写入选中文件" : "Wrote selected files"}: ${formatInlineValue(evidence.matchedWrittenFiles, noSelectedEvidence)}`,
        `- ${locale === "zh" ? "changed files 命中选中文件" : "Changed-files matches"}: ${formatInlineValue(evidence.matchedChangedFiles, noSelectedEvidence)}`,
        locale === "zh" ? "### Prompt History" : "### Prompt History",
        formatOrderedList(promptHistory, noPrompts),
        locale === "zh" ? "### 关键相关文件" : "### Key Related Files",
        formatBulletList(evidence.relatedFiles, noChangedFiles),
        locale === "zh" ? "### 工具调用分布" : "### Tool Call Breakdown",
        formatBulletList(toolCallBreakdown, noToolBreakdown),
        locale === "zh" ? "### 选中文件重复读取" : "### Repeated Reads Of Selected Files",
        formatBulletList(
          evidence.repeatedSelectedReads,
          locale === "zh" ? "没有发现针对选中文件的重复读取" : "No repeated selected-file reads detected",
        ),
        locale === "zh" ? "### 重复命令" : "### Repeated Commands",
        formatBulletList(
          repeatedCommands,
          locale === "zh" ? "没有发现高价值的重复命令" : "No high-signal repeated commands detected",
        ),
        locale === "zh" ? "### 失败工具" : "### Failed Tools",
        formatBulletList(
          failedTools.map((failure) =>
            `${failure.toolName}${failure.command ? ` | ${failure.command}` : ""} | ${failure.message}`),
          locale === "zh" ? "没有发现高价值的失败工具调用" : "No high-signal failed tool calls detected",
        ),
      ].filter(Boolean).join("\n");
    }).join("\n\n");
}

export function buildSessionAnalysisPrompt({
  locale,
  workspaceId,
  repoName,
  repoPath,
  branch,
  featureDetail,
  selectedFilePaths,
  sessions,
}: BuildSessionAnalysisPromptInput): string {
  const files = uniqueSorted(selectedFilePaths);
  const featureId = featureDetail?.id?.trim() || "unknown";
  const featureName = featureDetail?.name ?? (locale === "zh" ? "未命名 Feature" : "Unnamed feature");
  const featureSummary = featureDetail?.summary?.trim()
    || (locale === "zh" ? "无摘要" : "No summary");
  const transcriptHint = buildPreferredTranscriptHintSessions(files, sessions)
    .map((session) => `~/.codex/sessions/**/${session.sessionId}*.jsonl`)
    .join("\n");

  if (locale === "zh") {
    return [
      "请对这些与文件相关的历史编码会话做一次只读复盘，目标是帮用户下次更快地把任务说清楚、减少来回探索。",
      "",
      "你的任务：",
      "1. 先把会话按“直接涉及选中文件 / 只是 feature 邻近 / 证据很弱或可能是噪音”做分层，不要把所有 session 当成同等证据。",
      "2. 如果某个 session 里混入了多个不同任务或后续范围漂移，优先使用最贴近目标文件/feature 的那些 turns；不要让偏题回合主导结论。",
      "3. 如果 opening prompt 明显是自动 review gate、specialist/system boilerplate，或者明显属于别的功能面而只是偶然碰到了邻近文件，要主动降权到弱证据或噪音。",
      "4. 如果 MCP 里有 `load_feature_retrospective_memory`，先用当前 Repo Path + Selected Files + Feature 调它，看看之前有没有已经保存过的 prompt-ready memory；把它当作 warm-start context，不要把它当成替代新证据的唯一来源。",
      "5. 先基于这些摘要证据做你自己的综合分析，再决定是否需要回读 transcript。",
      "6. 优先基于高相关会话，总结这些会话在这个文件/功能上的共同模式。",
      "7. 把拖慢过程的问题拆开：一类是用户输入问题，例如目标不清、缺上下文、范围太大、没有先给验收标准、没有先给入口文件；另一类是环境/工具问题，例如路径引用、依赖缺失、命令执行失败。",
      "8. 明确区分“证据支持”的判断和“你的推断”。每条结论尽量引用具体 session ID。",
      "9. 给出更好的用户输入建议，重点是下一次应该怎样一句话开场、怎样补上下文、怎样限定范围。",
      "10. 产出 2 到 4 个可直接复用的提示词模板，偏向这个文件/这个 feature 的真实场景。",
      "11. 如果 session 数量较多，优先直接读 Transcript Hints 里的 JSONL；先走现成 tool / script，再决定是否需要临时补脚本。",
      "11a. 如果 MCP 里有 `inspect_transcript_turns`，优先调用它来抽取真实用户 turns、目标文件相关命令、失败命令和范围漂移；如果没有，就优先运行 `node --import tsx scripts/harness/inspect-transcript-turns.ts --session-id <id> --file <path> [--feature-id <id>]`，而不是手写临时 JSONL 解析。",
      "11b. 如果 MCP 里有 `summarize_file_session_context`，做这类只读 retrospective 时，把 `taskType` 固定成 `analysis`；不要自造 `retrospective` 这类未支持值。",
      "12. 只有在下面的摘要证据仍不足以支撑判断，或者你需要恢复真实用户开场、确认范围漂移时，才去读少量 transcript JSONL。优先读取高相关 session；如果权限被拒或读取受阻，就基于现有证据继续，并把这个限制写出来。",
      "13. 不要把任务扩写成整个仓库的架构评审、工程治理盘点或 ADR/ARCHITECTURE 对账。除非这些结论直接来自目标 session 的 transcript 证据，否则不要输出仓库级判断。",
      "14. 对于多 session 模式，如果目标 JSONL 无法访问，就只输出限制、缺失证据和下一步需要的访问条件；不要用 git 历史、仓库文档或全仓扫描来替代 session 分析。",
      "14a. 把 Next.js 路由目录里的 `[workspaceId]`、`[featureId]` 当成字面路径片段，不要把它们当 glob / regex 占位符；读这类路径时，要么整体安全引用，要么显式转义。",
      "14b. 如果当前 `Repo Path` 里读不到选中文件，只能说“当前 repo snapshot / codebase checkout 中不存在”；除非有更强证据，不要直接推断文件已经移动或删除。",
      "15. 如果某个 session 明显是在调当前 retrospective / prompt / JSONL 工作流本身，即便它触及了目标文件，也优先视为弱证据或噪音，不要把它混进历史样本主结论。",
      "16. 读取 transcript 时，只抽取真实用户消息，以及与目标文件或 feature 直接相关的 function_call / exec_command_end / apply_patch / failed-command 信号。忽略 developer/system/base instructions、token_count、无关长命令输出和大段工具回显。",
      "17. 不要按关键字扫描整行 JSONL 并回显整段 JSON；先按 row type 过滤，再提取你要的字段。",
      "17a. 如果本次分析过程本身出现问题，例如无效 MCP 参数、陈旧 codebase snapshot、生成索引缺失、shell/path 检查失败，要在输出里单独点出来，归到环境/工具问题或限制，而不是静默转成仓库事实。",
      "18. 如果 MCP 里有 `save_feature_retrospective_memory`，在结论收敛后保存一条简短、可直接注入下次 prompt 的 memory。单文件证据最强时优先存 file 级；如果模式明显覆盖整个 feature，再额外存一条 feature 级。不要把整份长报告原样写进去。",
      "18a. 做 feature 级保存时，必须传上下文里的精确 `featureId`；`featureName` 只能作显示，不能替代 `featureId`。",
      "18b. 保存 memory 时，不要自由发挥，统一写成下面这 5 行英文标签骨架，便于后续 agent 稳定读取：",
      "Scope: file:<path> | feature:<id>",
      "Next ask: <one sentence>",
      "Must include: <4-6 comma-separated fields>",
      "Avoid: <2-4 concise pitfalls or scope drifts>",
      "Still need: <what still requires repo or transcript reread>",
      "18c. 这 5 个标签必须全部出现；如果某一项没有额外内容，也明确写 `none`，不要省略整行。",
      "18d. 每一行只保留高信号、可复用内容。除非证据明确，否则不要编造命令、文件名、测试名或结论。",
      "18e. 如果某个字段提到文件、命令、运行面或测试名，已知时必须写精确值；未知时明确写 `unknown`，不要写成 `paired UI file`、`repo/runtime surface` 这类未展开缩略词。",
      "",
      "输出格式：",
      "## 会话相关性分层",
      "## 结论",
      "## 输入问题 vs 环境问题",
      "## 本次分析过程中的问题",
      "## 反复出现的问题",
      "## 更快的输入方式",
      "## 可直接复用的提示词模板",
      "## 还缺什么上下文",
      "## 证据与推断边界",
      "",
      "上下文：",
      `- Workspace: ${workspaceId}`,
      `- Repository: ${repoName || "unknown"}`,
      `- Repo Path: ${repoPath || "unknown"}`,
      `- Branch: ${branch || "unknown"}`,
      `- Feature ID: ${featureId}`,
      `- Feature Name: ${featureName}`,
      `- Feature Summary: ${featureSummary}`,
      `- Selected Files: ${files.length}`,
      `- Selected Sessions: ${sessions.length}`,
      "",
      "### 会话相关性总览",
      buildRelevanceOverview(locale, files, sessions),
      "",
      "### Selected Files",
      formatBulletList(files, "无"),
      "",
      "### Transcript Hints（可选：仅在需要恢复真实开场、确认范围漂移时，优先少量读取高相关 JSONL）",
      formatBulletList(uniqueSorted(transcriptHint ? transcriptHint.split("\n") : []), "无"),
      "",
      "### Session Evidence",
      buildSessionBlocks(locale, files, sessions),
      "",
      "重点：不要给泛泛而谈的 prompt engineering 建议，要尽量贴合这里的文件、feature、会话历史和真实摩擦点。低置信会话只能作为弱证据，不能主导结论。如果 URL/feature 提示和文件级证据冲突，优先相信文件级证据。",
    ].join("\n");
  }

  return [
    "Run a read-only retrospective on these file-linked coding sessions. The goal is to help the user phrase future requests better and reduce iteration time.",
    "",
    "Your tasks:",
    "1. First triage the sessions into direct selected-file evidence, feature-adjacent evidence, and weak/noisy evidence. Do not treat every session as equally trustworthy.",
    "2. If a session contains mixed intent or later scope drift, prioritize the turns that are most directly tied to the selected file or feature. Do not let unrelated later turns dominate the conclusion.",
    "3. If the opening prompt is clearly an automatic review gate, specialist/system boilerplate, or another feature surface that only brushed against adjacent files, proactively demote it to weak/noisy evidence.",
    "4. If MCP exposes `load_feature_retrospective_memory`, call it first with the current Repo Path, Selected Files, and Feature. Use any saved memory as warm-start context, not as a substitute for fresh evidence.",
    "5. Start with your own synthesis from the summarized evidence below before deciding whether transcript rereads are necessary.",
    "6. Prioritize the high-relevance sessions and summarize the recurring patterns across them for this file or feature.",
    "7. Split the slowdown analysis into user-input friction and environment/tooling friction. Do not collapse them into a single diagnosis.",
    "8. Distinguish clearly between evidence-backed conclusions and your own inference. Cite concrete session IDs when possible.",
    "9. Recommend better user inputs for next time: how to open the request, what context to include up front, and how to constrain the scope.",
    "10. Produce 2 to 4 reusable prompt templates tailored to this file or feature, not generic prompt-engineering advice.",
    "11. If there are many sessions, prefer reading the JSONL files from Transcript Hints directly; use the provided tool/script path before deciding whether a one-off helper script is still necessary.",
    "11a. If MCP exposes `inspect_transcript_turns`, prefer that tool for extracting real user turns, target-file commands, failed commands, and scope drift. If it does not, prefer `node --import tsx scripts/harness/inspect-transcript-turns.ts --session-id <id> --file <path> [--feature-id <id>]` before any raw JSONL parsing.",
    "11b. If MCP exposes `summarize_file_session_context`, use the supported `taskType` value `analysis` for this kind of read-only retrospective. Do not invent unsupported values such as `retrospective`.",
    "12. Only inspect a small number of matching transcript JSONL files if the summarized evidence is still insufficient or if you need to recover the user's true opening request or confirm scope drift. If permissions are blocked, continue with the available evidence and state that limitation explicitly.",
    "13. Do not expand this into a repo-wide architecture review, engineering-governance audit, or ADR/ARCHITECTURE consistency check. Unless those conclusions come directly from the target session transcripts, do not make repo-level claims.",
    "14. In multi-session mode, if the target JSONL files are inaccessible, only report the limitation, the missing evidence, and the access you need next. Do not substitute git history, repository documents, or full-codebase scanning for session analysis.",
    "14a. Treat Next.js route folders such as `[workspaceId]` and `[featureId]` as literal path segments, not as glob or regex placeholders. Use shell-safe quoting or explicit escaping when reading them.",
    "14b. If the selected file cannot be read from the current `Repo Path`, only say it is absent from the current repo snapshot or codebase checkout. Do not jump from one failed read or search to claims that the file was moved or deleted.",
    "15. If a session is clearly about tuning the current retrospective, prompt, or JSONL workflow itself, treat it as weak or noisy evidence even if it touched the target file. Do not let it contaminate the historical sample.",
    "16. When reading transcripts, only extract real user messages plus function_call / exec_command_end / apply_patch / failed-command evidence that directly touches the target file or feature. Ignore developer/system/base instructions, token_count, unrelated long command output, and bulk tool echoes.",
    "17. Do not grep whole JSONL rows by generic keywords and print entire JSON objects. Filter by row type first, then extract the specific fields you need.",
    "17a. If this analysis run itself hits invalid MCP arguments, stale codebase snapshots, missing generated indexes, or failed shell/path checks, call those out explicitly as environment/tooling friction or analysis limitations instead of silently turning them into repo facts.",
    "18. If MCP exposes `save_feature_retrospective_memory`, save one short prompt-ready memory after the conclusion stabilizes. Prefer a file-level save when one file has the strongest direct evidence, and add a feature-level save only when the pattern clearly generalizes beyond that file. Do not dump the whole report into memory.",
    "18a. For feature-level saves, you must pass the exact `featureId` from the context below. `featureName` is display-only and is not a substitute for `featureId`.",
    "18b. Do not improvise the memory format. Save it using exactly this 5-line skeleton so later agents can parse it quickly:",
    "Scope: file:<path> | feature:<id>",
    "Next ask: <one sentence>",
    "Must include: <4-6 comma-separated fields>",
    "Avoid: <2-4 concise pitfalls or scope drifts>",
    "Still need: <what still requires repo or transcript reread>",
    "18c. All 5 labels must always be present. If one line has no extra content, write `none` rather than omitting the line.",
    "18d. Keep each line high-signal and reusable. Do not invent commands, filenames, test names, or conclusions unless the evidence is explicit.",
    "18e. If a field refers to a file, command, runtime surface, or test name, write the exact value when known; otherwise write `unknown`. Do not leave shorthand such as `paired UI file` or `repo/runtime surface` unexplained.",
    "",
    "Output format:",
    "## Session Relevance",
    "## Conclusion",
    "## Input Friction vs Environment Friction",
    "## Issues In This Analysis Run",
    "## Repeated Friction",
    "## Faster Input Strategy",
    "## Reusable Prompt Templates",
    "## Missing Context",
    "## Evidence vs Inference",
    "",
    "Context:",
    `- Workspace: ${workspaceId}`,
    `- Repository: ${repoName || "unknown"}`,
    `- Repo Path: ${repoPath || "unknown"}`,
    `- Branch: ${branch || "unknown"}`,
    `- Feature ID: ${featureId}`,
    `- Feature Name: ${featureName}`,
    `- Feature Summary: ${featureSummary}`,
    `- Selected Files: ${files.length}`,
    `- Selected Sessions: ${sessions.length}`,
    "",
    "### Session Relevance Overview",
    buildRelevanceOverview(locale, files, sessions),
    "",
    "### Selected Files",
    formatBulletList(files, "None"),
    "",
    "### Transcript Hints (optional: use only to recover the true opening request or confirm scope drift, starting with the highest-relevance sessions)",
    formatBulletList(uniqueSorted(transcriptHint ? transcriptHint.split("\n") : []), "None"),
    "",
    "### Session Evidence",
    buildSessionBlocks(locale, files, sessions),
    "",
    "Important: avoid generic advice. Tie recommendations to the actual files, feature context, session evidence, and observed workflow friction. Lower-confidence sessions are weak evidence and should not drive the main conclusion. If URL or feature hints conflict with file-grounded evidence, prioritize the file-grounded evidence.",
  ].join("\n");
}
