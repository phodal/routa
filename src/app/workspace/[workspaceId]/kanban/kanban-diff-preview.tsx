"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { ReactNode } from "react";
import { FileDiff as PierreFileDiffInstance, parseDiffFromFile } from "@pierre/diffs";
import type { FileContents, FileDiffMetadata } from "@pierre/diffs";
import type { KanbanCommitChangeItem, KanbanCommitDiffPreview, KanbanFileChangeItem, KanbanFileDiffPreview } from "./kanban-file-changes-types";
import { splitFilePath, STATUS_BADGE } from "./kanban-file-changes-panel";
import { isDarkThemeActive, subscribeToThemePreference } from "@/client/utils/theme";
import { useTranslation } from "@/i18n";

export interface ParsedDiffPreview {
  additions: number;
  deletions: number;
  lines: Array<{
    kind: "meta" | "hunk" | "add" | "remove" | "context";
    text: string;
    oldLineNumber?: number;
    newLineNumber?: number;
    sourceLineIndex?: number;
  }>;
}

export interface CommitDiffFile {
  path: string;
  previousPath?: string;
  status: "modified" | "added" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  startLineIndex: number; // Line index in the patch where this file's diff starts
}

export interface CommitDiffFileSection extends CommitDiffFile {
  patch: string;
}

const PIERRE_DIFF_OPTIONS = {
  diffStyle: "unified" as const,
  diffIndicators: "classic" as const,
  disableBackground: false,
  disableFileHeader: true,
  disableLineNumbers: false,
  hunkSeparators: "line-info" as const,
  onPostRender: normalizeKanbanPierreDiff,
  expansionLineCount: 100,
  lineDiffType: "word-alt" as const,
  maxLineDiffLength: 1000,
  overflow: "scroll" as const,
  parseDiffOptions: { context: 3 },
  theme: {
    dark: "github-dark" as const,
    light: "github-light" as const,
  },
  themeType: "light" as const,
  unsafeCSS: `
    :host {
      --diffs-bg: light-dark(#ffffff, #0d1018) !important;
      --diffs-bg-context-override: light-dark(#ffffff, #0d1018);
      --diffs-bg-separator-override: light-dark(#f8fafc, #171b27);
      --diffs-bg-addition-emphasis-override: rgba(0, 188, 125, 0.2);
      --diffs-bg-deletion-emphasis-override: rgba(240, 100, 73, 0.2);
      --diffs-addition-color-override: #00a86b;
    }
    pre[data-diffs] {
      background: var(--diffs-bg) !important;
    }
    [data-code] {
      padding-block: 0;
    }
    [data-column-number],
    [data-gutter] {
      position: sticky;
      left: 0;
    }
    [data-gutter] {
      z-index: 4;
    }
    [data-column-number] {
      z-index: 3;
    }
    [data-separator='line-info'] {
      height: 32px;
      margin-block: 0;
      background: var(--diffs-bg);
      border-block: 1px dashed light-dark(#d4d4d8, #374151);
    }
    [data-separator='line-info'] [data-separator-wrapper] {
      padding-inline: 0;
      background: var(--diffs-bg);
    }
    [data-separator='line-info'] [data-expand-button],
    [data-separator='line-info'] [data-separator-content] {
      background: light-dark(#f4f4f5, #171b27);
      color: light-dark(#71717a, #a1a1aa);
    }
    [data-separator='line-info'] [data-expand-button] {
      min-width: 32px;
      border-right: 2px solid var(--diffs-bg);
    }
    [data-separator='line-info'] [data-separator-content] {
      border-radius: 0;
      padding-inline: 10px;
    }
  `,
};

interface DiffSearchResult {
  element: HTMLElement;
}

interface DiffSearchOptions {
  matchCase: boolean;
  useRegex: boolean;
  wholeWord: boolean;
}

interface DiffSearchMatch {
  node: Text;
  start: number;
  end: number;
}

interface DiffSearchResultSet {
  invalidPattern: boolean;
  results: DiffSearchResult[];
}

const DEFAULT_DIFF_SEARCH_OPTIONS: DiffSearchOptions = {
  matchCase: false,
  useRegex: false,
  wholeWord: false,
};

function normalizeKanbanPierreDiff(node: HTMLElement) {
  for (const searchRoot of getDiffSearchRoots(node)) {
    for (const label of searchRoot.querySelectorAll("[data-unmodified-lines]")) {
      label.textContent = (label.textContent ?? "").replace(
        /unmodified line(s?)/g,
        "hidden line$1",
      );
    }
  }
}

function clearDiffSearchHighlights(root: HTMLElement) {
  for (const searchRoot of getDiffSearchRoots(root)) {
    for (const highlight of searchRoot.querySelectorAll(".kanban-diff-search-highlight")) {
      const parent = highlight.parentNode;
      if (!parent) {
        continue;
      }
      parent.replaceChild(document.createTextNode(highlight.textContent ?? ""), highlight);
      parent.normalize();
    }
  }
}

function getDiffSearchRoots(root: HTMLElement): Array<ShadowRoot | HTMLElement> {
  const searchRoots: Array<ShadowRoot | HTMLElement> = [];
  if (root.matches("diffs-container") && root.shadowRoot) {
    searchRoots.push(root.shadowRoot);
  }
  for (const diffContainer of root.querySelectorAll("diffs-container")) {
    if (diffContainer.shadowRoot) {
      searchRoots.push(diffContainer.shadowRoot);
    }
  }
  return searchRoots.length > 0 ? searchRoots : [root];
}

function highlightDiffSearchMatches(root: HTMLElement, query: string, options: DiffSearchOptions): DiffSearchResultSet {
  clearDiffSearchHighlights(root);
  if (!query) {
    return { invalidPattern: false, results: [] };
  }

  const matcher = createDiffSearchMatcher(query, options);
  if (!matcher) {
    return { invalidPattern: true, results: [] };
  }

  const results: DiffSearchResult[] = [];
  for (const searchRoot of getDiffSearchRoots(root)) {
    for (const codeNode of getDiffSearchContentNodes(searchRoot)) {
      highlightTextNodeMatches(codeNode, matcher, options, results);
    }
  }

  return { invalidPattern: false, results };
}

function getDiffSearchContentNodes(searchRoot: ShadowRoot | HTMLElement): HTMLElement[] {
  const nodes = Array.from(searchRoot.querySelectorAll<HTMLElement>("[data-column-content], [data-content]"));
  return nodes.filter((node) => !nodes.some((candidate) => candidate !== node && node.contains(candidate)));
}

function createDiffSearchMatcher(query: string, options: DiffSearchOptions): RegExp | null {
  const source = options.useRegex ? query : escapeDiffSearchRegex(query);
  try {
    return new RegExp(source, options.matchCase ? "g" : "gi");
  } catch {
    return null;
  }
}

function escapeDiffSearchRegex(query: string) {
  return query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightTextNodeMatches(root: Node, matcher: RegExp, options: DiffSearchOptions, results: DiffSearchResult[]) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const matches: DiffSearchMatch[] = [];
  let currentNode = walker.nextNode();

  while (currentNode) {
    const node = currentNode as Text;
    matches.push(...findDiffSearchTextMatches(node, matcher, options));
    currentNode = walker.nextNode();
  }

  for (let index = matches.length - 1; index >= 0; index--) {
    addDiffSearchHighlight(matches[index], results);
  }
}

function findDiffSearchTextMatches(node: Text, matcher: RegExp, options: DiffSearchOptions): DiffSearchMatch[] {
  const text = node.textContent ?? "";
  const matches: DiffSearchMatch[] = [];
  matcher.lastIndex = 0;

  let match = matcher.exec(text);
  while (match) {
    const matchedText = match[0];
    const end = match.index + matchedText.length;
    if (matchedText && (!options.wholeWord || isWholeWordDiffSearchMatch(text, match.index, end))) {
      matches.push({ node, start: match.index, end });
    }
    if (!matchedText) {
      matcher.lastIndex += 1;
    }
    match = matcher.exec(text);
  }

  return matches;
}

function isWholeWordDiffSearchMatch(text: string, start: number, end: number) {
  return !isDiffSearchWordCharacter(text[start - 1]) && !isDiffSearchWordCharacter(text[end]);
}

function isDiffSearchWordCharacter(character: string | undefined) {
  return character != null && /[\p{L}\p{N}_]/u.test(character);
}

function addDiffSearchHighlight(match: DiffSearchMatch, results: DiffSearchResult[]) {
  const text = match.node.textContent ?? "";
  const before = text.slice(0, match.start);
  const matchedText = text.slice(match.start, match.end);
  const after = text.slice(match.end);
  const highlight = document.createElement("span");
  highlight.className = "kanban-diff-search-highlight";
  highlight.style.backgroundColor = "rgba(250, 204, 21, 0.45)";
  highlight.style.color = "inherit";
  highlight.textContent = matchedText;

  const parent = match.node.parentNode;
  if (!parent) {
    return;
  }
  if (after) {
    parent.insertBefore(document.createTextNode(after), match.node.nextSibling);
  }
  parent.insertBefore(highlight, match.node.nextSibling);
  if (before) {
    match.node.textContent = before;
  } else {
    parent.removeChild(match.node);
  }
  results.unshift({ element: highlight });
}

function selectDiffSearchResult(results: DiffSearchResult[], index: number) {
  results.forEach(({ element }) => {
    element.style.backgroundColor = "rgba(250, 204, 21, 0.45)";
  });

  const result = results[index];
  if (!result) {
    return;
  }

  result.element.style.backgroundColor = "rgba(59, 130, 246, 0.55)";
  result.element.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "nearest" });
}

function useResolvedRoutaTheme() {
  const [themeType, setThemeType] = useState<"dark" | "light">(() => isDarkThemeActive() ? "dark" : "light");

  useEffect(() => subscribeToThemePreference((_preference, resolvedTheme) => {
    setThemeType(resolvedTheme);
  }), []);

  return themeType;
}

function KanbanPierreFileDiff({ fileDiff }: { fileDiff: FileDiffMetadata }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<PierreFileDiffInstance | null>(null);
  const themeType = useResolvedRoutaTheme();
  const diffOptions = useMemo(() => ({ ...PIERRE_DIFF_OPTIONS, themeType }), [themeType]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const instance = new PierreFileDiffInstance(diffOptions);
    instanceRef.current = instance;
    instance.render({
      fileDiff,
      containerWrapper: containerRef.current,
    });

    return () => {
      instance.cleanUp();
      instanceRef.current = null;
    };
  }, [fileDiff, diffOptions]);

  return (
    <div
      ref={containerRef}
      className="kanban-pierre-diff min-w-full text-[11px]"
      style={{
        "--diffs-font-size": "12px",
        "--diffs-line-height": "20px",
        "--diffs-header-font-family": "var(--font-sans)",
        "--diffs-font-family": "var(--font-mono)",
      } as CSSProperties}
    />
  );
}

/**
 * Parse commit diff to extract list of changed files with their stats.
 * Parses unified diff format to find file headers and count additions/deletions per file.
 */
export function parseCommitDiffFiles(patch: string): CommitDiffFile[] {
  const lines = patch.split("\n");
  const files: CommitDiffFile[] = [];
  let currentFile: Partial<CommitDiffFile> | null = null;
  let currentFileAdditions = 0;
  let currentFileDeletions = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file starts with "diff --git a/... b/..."
    if (line.startsWith("diff --git ")) {
      // Save previous file if exists
      if (currentFile) {
        files.push({
          ...currentFile,
          additions: currentFileAdditions,
          deletions: currentFileDeletions,
        } as CommitDiffFile);
      }

      // Parse paths from "diff --git a/path1 b/path2"
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (match) {
        const previousPath = match[1];
        const path = match[2];
        currentFile = {
          path,
          previousPath: previousPath !== path ? previousPath : undefined,
          status: "modified", // Default, will be refined below
          startLineIndex: i,
        };
        currentFileAdditions = 0;
        currentFileDeletions = 0;
      }
      continue;
    }

    // Detect file status from metadata lines
    if (currentFile) {
      if (line.startsWith("new file mode ")) {
        currentFile.status = "added";
      } else if (line.startsWith("deleted file mode ")) {
        currentFile.status = "deleted";
      } else if (line.startsWith("rename from ")) {
        currentFile.status = "renamed";
      }
    }

    // Count additions and deletions for current file
    if (currentFile && line.startsWith("+") && !line.startsWith("+++")) {
      currentFileAdditions += 1;
    } else if (currentFile && line.startsWith("-") && !line.startsWith("---")) {
      currentFileDeletions += 1;
    }
  }

  // Save last file
  if (currentFile) {
    files.push({
      ...currentFile,
      additions: currentFileAdditions,
      deletions: currentFileDeletions,
    } as CommitDiffFile);
  }

  return files;
}

export function splitCommitDiffIntoFileSections(patch: string): CommitDiffFileSection[] {
  const lines = patch.split("\n");
  const files = parseCommitDiffFiles(patch);

  return files.map((file, index) => {
    const nextFile = files[index + 1];
    const endLineIndex = nextFile?.startLineIndex ?? lines.length;
    return {
      ...file,
      patch: lines.slice(file.startLineIndex, endLineIndex).join("\n"),
    };
  });
}

export function parseUnifiedDiffPreview(diff: { patch: string; additions?: number; deletions?: number }): ParsedDiffPreview {
  const lines = diff.patch.split("\n");
  let additions = diff.additions ?? 0;
  let deletions = diff.deletions ?? 0;
  let oldLineNumber = 0;
  let newLineNumber = 0;
  let countedBodyLines = false;

  const parsedLines = lines.map((line, sourceLineIndex) => {
    if (line.startsWith("+++ b/")) return { kind: "meta" as const, text: line, sourceLineIndex };
    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (diff.additions == null) additions += 1;
      countedBodyLines = true;
      const parsedLine = { kind: "add" as const, text: line, newLineNumber, sourceLineIndex };
      newLineNumber += 1;
      return parsedLine;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      if (diff.deletions == null) deletions += 1;
      countedBodyLines = true;
      const parsedLine = { kind: "remove" as const, text: line, oldLineNumber, sourceLineIndex };
      oldLineNumber += 1;
      return parsedLine;
    }
    if (line.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        oldLineNumber = Number.parseInt(match[1] ?? "0", 10);
        newLineNumber = Number.parseInt(match[2] ?? "0", 10);
      }
      return { kind: "hunk" as const, text: line, sourceLineIndex };
    }
    if (
      line.startsWith("diff --git ")
      || line.startsWith("index ")
      || line.startsWith("--- ")
      || line.startsWith("new file mode ")
      || line.startsWith("deleted file mode ")
      || line.startsWith("similarity index ")
      || line.startsWith("rename from ")
      || line.startsWith("rename to ")
    ) {
      return { kind: "meta" as const, text: line, sourceLineIndex };
    }
    if (line.startsWith(" ")) {
      countedBodyLines = true;
      const parsedLine = { kind: "context" as const, text: line, oldLineNumber, newLineNumber, sourceLineIndex };
      oldLineNumber += 1;
      newLineNumber += 1;
      return parsedLine;
    }
    return { kind: "context" as const, text: line, sourceLineIndex };
  });

  return {
    additions: countedBodyLines ? additions : diff.additions ?? additions,
    deletions: countedBodyLines ? deletions : diff.deletions ?? deletions,
    lines: parsedLines,
  };
}

export function reconstructFileContentsFromUnifiedDiff(parsedDiff: ParsedDiffPreview): { oldContents: string; newContents: string } | null {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let foundBodyLine = false;
  let oldEndsWithNewline = true;
  let newEndsWithNewline = true;
  let lastBodyLineKind: "context" | "remove" | "add" | null = null;

  for (const line of parsedDiff.lines) {
    if (line.kind === "context" && line.text.startsWith(" ")) {
      const content = line.text.slice(1);
      oldLines.push(content);
      newLines.push(content);
      foundBodyLine = true;
      lastBodyLineKind = "context";
    } else if (line.kind === "remove") {
      oldLines.push(line.text.slice(1));
      foundBodyLine = true;
      lastBodyLineKind = "remove";
    } else if (line.kind === "add") {
      newLines.push(line.text.slice(1));
      foundBodyLine = true;
      lastBodyLineKind = "add";
    } else if (line.text === "\\ No newline at end of file") {
      if (lastBodyLineKind === "context") {
        oldEndsWithNewline = false;
        newEndsWithNewline = false;
      } else if (lastBodyLineKind === "remove") {
        oldEndsWithNewline = false;
      } else if (lastBodyLineKind === "add") {
        newEndsWithNewline = false;
      }
    }
  }

  if (!foundBodyLine) {
    return null;
  }

  return {
    oldContents: joinReconstructedFileLines(oldLines, oldEndsWithNewline),
    newContents: joinReconstructedFileLines(newLines, newEndsWithNewline),
  };
}

function joinReconstructedFileLines(lines: string[], endsWithNewline: boolean): string {
  if (lines.length === 0) return "";
  return `${lines.join("\n")}${endsWithNewline ? "\n" : ""}`;
}

export function buildPierreDiffFromFullUnifiedPatch(file: CommitDiffFileSection): FileDiffMetadata | null {
  const parsedDiff = parseUnifiedDiffPreview({
    patch: file.patch,
    additions: file.additions,
    deletions: file.deletions,
  });
  const contents = reconstructFileContentsFromUnifiedDiff(parsedDiff);

  if (!contents) {
    return null;
  }

  const oldFile: FileContents = {
    name: file.previousPath ?? file.path,
    contents: contents.oldContents,
    cacheKey: `${file.startLineIndex}:old:${file.previousPath ?? file.path}:${contents.oldContents.length}`,
  };
  const newFile: FileContents = {
    name: file.path,
    contents: contents.newContents,
    cacheKey: `${file.startLineIndex}:new:${file.path}:${contents.newContents.length}`,
  };

  try {
    return parseDiffFromFile(oldFile, newFile, { context: 3 });
  } catch {
    return null;
  }
}

export function renderUnifiedDiffLines(parsedDiff: ParsedDiffPreview) {
  return parsedDiff.lines.map((line, index) => (
    <div
      key={`${line.kind}-${line.sourceLineIndex ?? index}-${line.oldLineNumber ?? ""}-${line.newLineNumber ?? ""}`}
      className={
        line.kind === "add"
          ? "grid grid-cols-[3rem_3rem_1.5rem_minmax(0,1fr)] bg-emerald-950/70 px-3 text-emerald-100"
          : line.kind === "remove"
            ? "grid grid-cols-[3rem_3rem_1.5rem_minmax(0,1fr)] bg-rose-950/60 px-3 text-rose-100"
            : line.kind === "hunk"
              ? "bg-sky-950/60 px-3 text-sky-100"
              : line.kind === "meta"
                ? "bg-slate-900 px-3 text-slate-400"
                : "grid grid-cols-[3rem_3rem_1.5rem_minmax(0,1fr)] px-3 text-slate-200"
      }
    >
      {line.kind === "add" || line.kind === "remove" || line.kind === "context" ? (
        <>
          <span className="select-none pr-2 text-right text-slate-500">
            {typeof line.oldLineNumber === "number" ? (
              <span data-testid={`kanban-diff-old-line-${index}`}>{line.oldLineNumber}</span>
            ) : ""}
          </span>
          <span className="select-none pr-2 text-right text-slate-500">
            {typeof line.newLineNumber === "number" ? (
              <span data-testid={`kanban-diff-new-line-${index}`}>{line.newLineNumber}</span>
            ) : ""}
          </span>
          <span className="select-none text-center">
            {line.text[0] ?? " "}
          </span>
          <span>{line.text.slice(1) || " "}</span>
        </>
      ) : (
        line.text || " "
      )}
    </div>
  ));
}

function HiddenContextRun({
  lines,
  indexOffset,
  hiddenLinesLabel,
}: {
  lines: ParsedDiffPreview["lines"];
  indexOffset: number;
  hiddenLinesLabel: (count: number) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = Math.max(0, lines.length - 6);
  const prefix = lines.slice(0, expanded ? lines.length : 3);
  const suffix = expanded || hiddenCount === 0 ? [] : lines.slice(-3);

  return (
    <>
      {renderUnifiedDiffLines({ additions: 0, deletions: 0, lines: prefix })}
      {!expanded && hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-3 border-y border-dashed border-slate-300/70 bg-slate-50 px-3 py-1.5 text-left text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700/70 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          data-testid={`kanban-diff-hidden-lines-${indexOffset + 3}`}
        >
          <span className="select-none text-slate-400">↕</span>
          <span>{hiddenLinesLabel(hiddenCount)}</span>
        </button>
      ) : null}
      {suffix.length > 0 ? renderUnifiedDiffLines({ additions: 0, deletions: 0, lines: suffix }) : null}
    </>
  );
}

function renderUnifiedDiffWithHiddenContext(
  parsedDiff: ParsedDiffPreview,
  hiddenLinesLabel: (count: number) => string,
) {
  const rendered: ReactNode[] = [];
  let contextRun: ParsedDiffPreview["lines"] = [];
  let contextStartIndex = 0;

  const flushContextRun = () => {
    if (contextRun.length === 0) {
      return;
    }

    if (contextRun.length > 12) {
      rendered.push(
        <HiddenContextRun
          key={`context-${contextStartIndex}`}
          lines={contextRun}
          indexOffset={contextStartIndex}
          hiddenLinesLabel={hiddenLinesLabel}
        />,
      );
    } else {
      rendered.push(...renderUnifiedDiffLines({ additions: 0, deletions: 0, lines: contextRun }));
    }
    contextRun = [];
  };

  parsedDiff.lines.forEach((line, index) => {
    if (line.kind === "context" && typeof line.oldLineNumber === "number") {
      if (contextRun.length === 0) {
        contextStartIndex = index;
      }
      contextRun.push(line);
      return;
    }

    flushContextRun();
    rendered.push(...renderUnifiedDiffLines({ additions: 0, deletions: 0, lines: [line] }));
  });

  flushContextRun();
  return rendered;
}

export function TaskFileDiffPreview({
  file,
  diff,
  loading,
  error,
  compact = false,
}: {
  file: KanbanFileChangeItem | null;
  diff?: KanbanFileDiffPreview;
  loading: boolean;
  error?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();

  if (!file) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200/80 px-3 py-4 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        {t.kanbanDetail.clickFileToInspectDiff}
      </div>
    );
  }

  const badge = STATUS_BADGE[file.status];
  const parsedDiff = diff ? parseUnifiedDiffPreview(diff) : null;
  const previewPath = diff?.path ?? file.path;
  const lastSlash = previewPath.lastIndexOf("/");
  const fileName = lastSlash === -1 ? previewPath : previewPath.slice(lastSlash + 1);
  const fileDirectory = lastSlash === -1 ? null : previewPath.slice(0, lastSlash);
  const additions = parsedDiff?.additions ?? diff?.additions ?? file.additions ?? 0;
  const deletions = parsedDiff?.deletions ?? diff?.deletions ?? file.deletions ?? 0;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-[#202433] dark:bg-[#0d1018]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-3 py-2 dark:border-[#202433]">
        <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
          <span className={`inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${badge.className}`}>
            {badge.short}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={fileName}>
              {fileName}
            </div>
            {fileDirectory && (
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={fileDirectory}>
                {fileDirectory}
              </div>
            )}
          </div>
          {file.previousPath && (
            <>
              <span />
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={file.previousPath}>
                {t.kanban.fromPath} {file.previousPath}
              </div>
            </>
          )}
        </div>
        <div className="shrink-0 text-[11px] font-mono">
          <span className="text-emerald-600 dark:text-emerald-300">+{additions}</span>
          {" "}
          <span className="text-rose-600 dark:text-rose-300">-{deletions}</span>
        </div>
      </div>

      {loading ? (
        <div className={`px-3 py-3 text-sm text-slate-500 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
          {t.kanbanDetail.loadingFileDiff}
        </div>
      ) : error ? (
        <div className={`border-l-2 border-rose-400/80 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/70 dark:text-rose-300 ${compact ? "leading-5" : "leading-6"}`}>
          {error}
        </div>
      ) : !diff?.patch.trim() || !parsedDiff ? (
        <div className={`px-3 py-3 text-sm text-slate-500 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
          {t.kanbanDetail.noDiffAvailable}
        </div>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <pre className="min-w-full bg-slate-950/95 px-0 py-0 text-[11px] leading-5 text-slate-100">
            {renderUnifiedDiffLines(parsedDiff)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function CommitRow({
  commit,
  selected = false,
  onClick,
}: {
  commit: KanbanCommitChangeItem;
  selected?: boolean;
  onClick?: () => void;
}) {
  const timestamp = new Date(commit.authoredAt);
  const renderedTimestamp = Number.isNaN(timestamp.getTime()) ? commit.authoredAt : timestamp.toLocaleString();
  return (
    <button
      type="button"
      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        selected ? "bg-amber-50/80 dark:bg-amber-900/10" : "hover:bg-slate-100/80 dark:hover:bg-[#171b27]"
      }`}
      onClick={onClick}
      aria-pressed={selected}
      data-testid={`kanban-commit-row-${commit.sha}`}
    >
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium leading-4 text-slate-800 dark:text-slate-100" title={commit.summary}>
          {commit.summary}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[9px] leading-3.5 text-slate-500 dark:text-slate-400">
          <span className="rounded-sm border border-slate-200 px-1 py-0 dark:border-slate-700">{commit.shortSha}</span>
          <span>{commit.authorName}</span>
          <span>{renderedTimestamp}</span>
        </div>
      </div>
      <div className="mt-0.5 flex min-w-[3.25rem] shrink-0 items-center justify-end gap-1 self-start text-[10px] font-mono leading-4">
        <span className="text-emerald-600 dark:text-emerald-300">+{commit.additions}</span>
        <span className="text-rose-600 dark:text-rose-300">-{commit.deletions}</span>
      </div>
    </button>
  );
}

export function CommitFileList({
  files,
  expanded,
  onToggle,
  onFileClick,
  activeFilePath,
}: {
  files: CommitDiffFile[];
  expanded: boolean;
  onToggle: () => void;
  onFileClick: (file: CommitDiffFile) => void;
  activeFilePath: string | null;
}) {
  const { t } = useTranslation();
  const statusBadges = {
    modified: { icon: "M", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200" },
    added: { icon: "A", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" },
    deleted: { icon: "D", className: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200" },
    renamed: { icon: "R", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200" },
  };

  return (
    <div className="border-b border-slate-200/70 dark:border-[#202433]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-[#171b27]"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t.kanbanDetail.filesChanged} ({files.length})
        </span>
        <svg
          className={`h-3.5 w-3.5 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="max-h-[16rem] space-y-0.5 overflow-y-auto px-2 pb-2">
          {files.map((file) => {
            const badge = statusBadges[file.status];
            const active = file.path === activeFilePath;
            const { name, directory } = splitFilePath(file.path);

            return (
              <button
                key={file.path}
                type="button"
                onClick={() => onFileClick(file)}
                className={`grid w-full grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                  active
                    ? "bg-amber-50/80 dark:bg-amber-900/10"
                    : "hover:bg-slate-100/80 dark:hover:bg-[#171b27]"
                }`}
              >
                <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold ${badge.className}`}>
                  {badge.icon}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-slate-900 dark:text-slate-100" title={file.path}>
                    {name}
                  </div>
                  {directory && (
                    <div className="truncate text-[10px] text-slate-500 dark:text-slate-400" title={directory}>
                      {directory}
                    </div>
                  )}
                  {file.previousPath && file.status === "renamed" && (
                    <div className="mt-0.5 truncate text-[10px] text-slate-400 dark:text-slate-500" title={file.previousPath}>
                      {splitFilePath(file.previousPath).name}
                    </div>
                  )}
                </div>
                <div className="flex min-w-[3.5rem] shrink-0 items-center justify-end gap-1 self-start text-[10px] font-mono leading-4">
                  <span className="text-emerald-600 dark:text-emerald-300">+{file.additions}</span>
                  <span className="text-rose-600 dark:text-rose-300">-{file.deletions}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CommitFileDiffSection({
  file,
  defaultOpen,
}: {
  file: CommitDiffFileSection;
  defaultOpen: boolean;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const statusBadges = {
    modified: { icon: "M", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200" },
    added: { icon: "A", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" },
    deleted: { icon: "D", className: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200" },
    renamed: { icon: "R", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200" },
  };
  const badge = statusBadges[file.status];
  const parsedDiff = parseUnifiedDiffPreview({
    patch: file.patch,
    additions: file.additions,
    deletions: file.deletions,
  });
  const pierreDiff = useMemo(() => buildPierreDiffFromFullUnifiedPatch(file), [file]);
  const { name, directory } = splitFilePath(file.path);

  return (
    <details
      className="group overflow-hidden border-b border-slate-200/70 last:border-b-0 dark:border-[#202433]"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      data-testid={`kanban-commit-file-section-${file.path}`}
    >
      <summary className="grid cursor-pointer list-none grid-cols-[auto_20px_minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-[#171b27] [&::-webkit-details-marker]:hidden">
        <svg
          className="h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold ${badge.className}`}>
          {badge.icon}
        </span>
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="shrink-0 truncate text-xs font-medium text-slate-900 dark:text-slate-100" title={file.path}>
            {name}
          </div>
          {directory ? (
            <div className="min-w-0 truncate text-[10px] text-slate-500 dark:text-slate-400" title={directory}>
              {directory}
            </div>
          ) : null}
        </div>
        <div className="flex min-w-[3.5rem] shrink-0 items-center justify-end gap-1 self-start text-[10px] font-mono leading-4">
          <span className="text-emerald-600 dark:text-emerald-300">+{file.additions}</span>
          <span className="text-rose-600 dark:text-rose-300">-{file.deletions}</span>
        </div>
      </summary>
      {isOpen ? (
        <div className="overflow-auto border-t border-slate-200/70 dark:border-[#202433]">
          {pierreDiff ? (
            <KanbanPierreFileDiff fileDiff={pierreDiff} />
          ) : (
            <pre className="min-w-full bg-slate-950/95 px-0 py-0 text-[11px] leading-5 text-slate-100">
              {renderUnifiedDiffWithHiddenContext(
                parsedDiff,
                (count) => t.kanbanDetail.hiddenLines.replace("{count}", String(count)),
              )}
            </pre>
          )}
        </div>
      ) : null}
    </details>
  );
}

function CommitDiffSearchOverlay({
  query,
  options,
  currentIndex,
  resultCount,
  invalidPattern,
  inputRef,
  onQueryChange,
  onOptionsChange,
  onNavigate,
  onClear,
}: {
  query: string;
  options: DiffSearchOptions;
  currentIndex: number;
  resultCount: number;
  invalidPattern: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onOptionsChange: (options: DiffSearchOptions) => void;
  onNavigate: (direction: -1 | 1) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const countText = invalidPattern ? "!" : resultCount > 0 ? `${currentIndex + 1}/${resultCount}` : "0/0";

  return (
    <div className="absolute right-3 top-12 z-20 flex min-w-[min(22rem,calc(100%-1.5rem))] items-center gap-1 rounded-md border border-slate-200 bg-white/98 p-1.5 text-[11px] font-normal normal-case tracking-normal shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-[#0d1018]/98 dark:shadow-black/30">
      <div className="flex min-w-0 flex-1 items-center rounded border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-[#0a0d14]">
        <input
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onNavigate(event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClear();
            }
          }}
          placeholder={t.common.search}
          data-testid="kanban-commit-diff-search-input"
        />
        {query ? (
          <span
            className={`ml-2 shrink-0 tabular-nums ${invalidPattern ? "font-semibold text-rose-500" : "text-slate-400"}`}
            data-testid="kanban-commit-diff-search-count"
          >
            {countText}
          </span>
        ) : null}
      </div>
      <DiffSearchOptionButton
        active={options.matchCase}
        onClick={() => onOptionsChange({ ...options, matchCase: !options.matchCase })}
        testId="kanban-commit-diff-search-case"
      >
        Aa
      </DiffSearchOptionButton>
      <DiffSearchOptionButton
        active={options.wholeWord}
        onClick={() => onOptionsChange({ ...options, wholeWord: !options.wholeWord })}
        testId="kanban-commit-diff-search-word"
      >
        W
      </DiffSearchOptionButton>
      <DiffSearchOptionButton
        active={options.useRegex}
        onClick={() => onOptionsChange({ ...options, useRegex: !options.useRegex })}
        testId="kanban-commit-diff-search-regex"
      >
        .*
      </DiffSearchOptionButton>
      {query ? (
        <>
          <button
            type="button"
            onClick={() => onNavigate(-1)}
            disabled={resultCount === 0}
            className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-100"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onNavigate(1)}
            disabled={resultCount === 0}
            className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-100"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-500 transition-colors hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-100"
          >
            {t.common.close}
          </button>
        </>
      ) : null}
      {!query ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-500 transition-colors hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-100"
        >
          {t.common.close}
        </button>
      ) : null}
    </div>
  );
}

function DiffSearchOptionButton({
  active,
  children,
  onClick,
  testId,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={`rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
        active
          ? "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200"
          : "border-slate-200 text-slate-500 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

export function TaskCommitDiffPreview({
  commit,
  diff,
  loading,
  error,
  compact = false,
  onClose,
}: {
  commit: KanbanCommitChangeItem | null;
  diff?: KanbanCommitDiffPreview;
  loading: boolean;
  error?: string;
  compact?: boolean;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const diffSearchRootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOptions, setSearchOptions] = useState<DiffSearchOptions>(DEFAULT_DIFF_SEARCH_OPTIONS);
  const [searchResults, setSearchResults] = useState<DiffSearchResult[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchInvalidPattern, setSearchInvalidPattern] = useState(false);

  // Calculate file list and diff preview from commit
  const preview = commit ? (diff ?? { ...commit, patch: "" }) : null;
  const parsedDiff = preview?.patch ? parseUnifiedDiffPreview(preview) : null;
  const fileSections = preview?.patch ? splitCommitDiffIntoFileSections(preview.patch) : [];

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [searchOpen]);

  if (!commit) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200/80 px-3 py-4 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        {t.kanbanDetail.clickCommitToInspectDiff}
      </div>
    );
  }

  // TypeScript guard: preview is guaranteed to be non-null here due to commit check above
  if (!preview) return null;

  const openSearch = () => {
    setSearchOpen(true);
  };

  const runSearch = (query: string, nextIndex = 0, options = searchOptions) => {
    const root = diffSearchRootRef.current;
    if (!root) {
      return;
    }
    const { invalidPattern, results } = highlightDiffSearchMatches(root, query, options);
    const boundedIndex = results.length > 0 ? Math.max(0, Math.min(nextIndex, results.length - 1)) : 0;
    setSearchInvalidPattern(invalidPattern);
    setSearchResults(results);
    setSearchIndex(boundedIndex);
    selectDiffSearchResult(results, boundedIndex);
  };

  const updateSearchQuery = (query: string) => {
    setSearchQuery(query);
    runSearch(query);
  };

  const updateSearchOptions = (options: DiffSearchOptions) => {
    setSearchOptions(options);
    runSearch(searchQuery, 0, options);
  };

  const navigateSearchResults = (direction: -1 | 1) => {
    if (searchResults.length === 0) {
      return;
    }
    const nextIndex = (searchIndex + direction + searchResults.length) % searchResults.length;
    setSearchIndex(nextIndex);
    selectDiffSearchResult(searchResults, nextIndex);
  };

  const clearSearch = () => {
    if (diffSearchRootRef.current) {
      clearDiffSearchHighlights(diffSearchRootRef.current);
    }
    setSearchQuery("");
    setSearchResults([]);
    setSearchIndex(0);
    setSearchInvalidPattern(false);
  };

  const closeSearch = () => {
    clearSearch();
    setSearchOpen(false);
  };

  const handleCommitDiffKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openSearch();
      return;
    }
    if (event.key === "Escape" && searchOpen) {
      event.preventDefault();
      closeSearch();
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-[#202433] dark:bg-[#0d1018]">
      {loading ? (
        <div className={`px-3 py-3 text-sm text-slate-500 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
          {t.kanbanDetail.loadingCommitDiff}
        </div>
      ) : error ? (
        <div className={`border-l-2 border-rose-400/80 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/70 dark:text-rose-300 ${compact ? "leading-5" : "leading-6"}`}>
          {error}
        </div>
      ) : fileSections.length > 0 ? (
        <div
          className="relative"
          data-testid="kanban-commit-files-changed"
          onKeyDown={handleCommitDiffKeyDown}
          tabIndex={-1}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 bg-slate-50/80 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-[#202433] dark:bg-[#0a0d14] dark:text-slate-400">
            <span className="shrink-0">{fileSections.length} {t.kanbanDetail.filesChanged}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openSearch}
                className="rounded border border-slate-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 transition-colors hover:border-amber-300 hover:text-amber-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-amber-700 dark:hover:text-amber-200"
              >
                {t.common.search}
              </button>
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-slate-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 transition-colors hover:border-amber-300 hover:text-amber-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-amber-700 dark:hover:text-amber-200"
              >
                {t.common.close}
              </button>
            ) : null}
            </div>
          </div>
          {searchOpen ? (
            <CommitDiffSearchOverlay
              inputRef={searchInputRef}
              query={searchQuery}
              options={searchOptions}
              currentIndex={searchIndex}
              resultCount={searchResults.length}
              invalidPattern={searchInvalidPattern}
              onQueryChange={updateSearchQuery}
              onOptionsChange={updateSearchOptions}
              onNavigate={navigateSearchResults}
              onClear={closeSearch}
            />
          ) : null}
          <div
            ref={diffSearchRootRef}
            className="max-h-[70vh] overflow-auto"
            data-testid="kanban-commit-diff-scroll-area"
          >
            {fileSections.map((file) => (
              <CommitFileDiffSection
                key={`${file.path}-${file.startLineIndex}`}
                file={file}
                defaultOpen={true}
              />
            ))}
          </div>
        </div>
      ) : !parsedDiff ? (
        <div className={`px-3 py-3 text-sm text-slate-500 dark:text-slate-400 ${compact ? "leading-5" : "leading-6"}`}>
          {t.kanbanDetail.noDiffAvailable}
        </div>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <pre className="min-w-full bg-slate-950/95 px-0 py-0 text-[11px] leading-5 text-slate-100">
            {renderUnifiedDiffLines(parsedDiff)}
          </pre>
        </div>
      )}
    </div>
  );
}
