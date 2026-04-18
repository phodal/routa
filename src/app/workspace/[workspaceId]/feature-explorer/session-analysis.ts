import type { Locale } from "@/i18n";

import type { AggregatedSelectionSession, FeatureDetail } from "./types";

const MAX_PROMPT_HISTORY_ITEMS = 4;
const MAX_TOOL_BREAKDOWN_ITEMS = 6;
const MAX_KEY_RELATED_FILES = 8;
const MAX_REPEATED_READ_ITEMS = 4;
const MAX_REPEATED_COMMAND_ITEMS = 4;
const MAX_FAILED_TOOL_ITEMS = 4;
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

function buildSessionBlocks(
  locale: Locale,
  selectedFiles: string[],
  sessions: AggregatedSelectionSession[],
): string {
  const noChangedFiles = locale === "zh" ? "未捕获到可信的 changed files" : "No trustworthy changed files captured";
  const noPrompts = locale === "zh" ? "没有额外提示词历史" : "No additional prompt history";
  const noToolBreakdown = locale === "zh" ? "没有可信的工具调用分布" : "No trustworthy tool-call breakdown";
  const noSelectedEvidence = locale === "zh" ? "无" : "None";

  return sessions
    .map((session) => ({
      session,
      evidence: buildSessionFileEvidence(locale, selectedFiles, session),
    }))
    .sort((left, right) => {
      if (right.evidence.relevanceScore !== left.evidence.relevanceScore) {
        return right.evidence.relevanceScore - left.evidence.relevanceScore;
      }
      return right.session.updatedAt.localeCompare(left.session.updatedAt);
    })
    .map(({ session, evidence }, index) => {
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
    })
    .join("\n\n");
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
  const featureName = featureDetail?.name ?? (locale === "zh" ? "未命名 Feature" : "Unnamed feature");
  const featureSummary = featureDetail?.summary?.trim()
    || (locale === "zh" ? "无摘要" : "No summary");
  const transcriptHint = sessions
    .map((session) => `~/.codex/sessions/**/${session.sessionId}*.jsonl`)
    .join("\n");

  if (locale === "zh") {
    return [
      "请对这些与文件相关的历史编码会话做一次只读复盘，目标是帮用户下次更快地把任务说清楚、减少来回探索。",
      "",
      "你的任务：",
      "1. 先把会话按“直接涉及选中文件 / 只是 feature 邻近 / 证据很弱或可能是噪音”做分层，不要把所有 session 当成同等证据。",
      "2. 优先基于高相关会话，总结这些会话在这个文件/功能上的共同模式。",
      "3. 找出拖慢过程的输入问题，例如目标不清、缺上下文、范围太大、没有先给验收标准、没有先给入口文件等。",
      "4. 明确区分“证据支持”的判断和“你的推断”。每条结论尽量引用具体 session ID。",
      "5. 给出更好的用户输入建议，重点是下一次应该怎样一句话开场、怎样补上下文、怎样限定范围。",
      "6. 产出 2 到 4 个可直接复用的提示词模板，偏向这个文件/这个 feature 的真实场景。",
      "7. 只有在下面的摘要证据仍不足以支撑判断时，才去读 transcript JSONL；如果权限被拒或读取受阻，就基于现有证据继续，并把这个限制写出来。",
      "",
      "输出格式：",
      "## 会话相关性分层",
      "## 结论",
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
      `- Feature: ${featureName}`,
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
      "### Transcript Hints（可选，仅在证据不足时使用）",
      formatBulletList(uniqueSorted(transcriptHint ? transcriptHint.split("\n") : []), "无"),
      "",
      "### Session Evidence",
      buildSessionBlocks(locale, files, sessions),
      "",
      "重点：不要给泛泛而谈的 prompt engineering 建议，要尽量贴合这里的文件、feature、会话历史和真实摩擦点。低置信会话只能作为弱证据，不能主导结论。",
    ].join("\n");
  }

  return [
    "Run a read-only retrospective on these file-linked coding sessions. The goal is to help the user phrase future requests better and reduce iteration time.",
    "",
    "Your tasks:",
    "1. First triage the sessions into direct selected-file evidence, feature-adjacent evidence, and weak/noisy evidence. Do not treat every session as equally trustworthy.",
    "2. Prioritize the high-relevance sessions and summarize the recurring patterns across them for this file or feature.",
    "3. Identify what slowed the work down: vague goals, missing context, unclear scope, missing acceptance criteria, missing entry files, or late constraint changes.",
    "4. Distinguish clearly between evidence-backed conclusions and your own inference. Cite concrete session IDs when possible.",
    "5. Recommend better user inputs for next time: how to open the request, what context to include up front, and how to constrain the scope.",
    "6. Produce 2 to 4 reusable prompt templates tailored to this file or feature, not generic prompt-engineering advice.",
    "7. Only inspect the matching transcript JSONL files if the summarized evidence below is still insufficient. If permissions are blocked, continue with the available evidence and state that limitation explicitly.",
    "",
    "Output format:",
    "## Session Relevance",
    "## Conclusion",
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
    `- Feature: ${featureName}`,
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
    "### Transcript Hints (optional, only if the summary evidence is insufficient)",
    formatBulletList(uniqueSorted(transcriptHint ? transcriptHint.split("\n") : []), "None"),
    "",
    "### Session Evidence",
    buildSessionBlocks(locale, files, sessions),
    "",
    "Important: avoid generic advice. Tie recommendations to the actual files, feature context, session evidence, and observed workflow friction. Lower-confidence sessions are weak evidence and should not drive the main conclusion.",
  ].join("\n");
}
