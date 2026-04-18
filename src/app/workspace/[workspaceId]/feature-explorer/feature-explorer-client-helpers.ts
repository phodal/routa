import type { RepoSelection } from "@/client/components/repo-picker";
import { loadRepoSelection } from "@/client/utils/repo-selection-storage";

import type { FeatureDetail, FileSessionDiagnostics } from "./types";

export type FeatureExplorerUrlState = {
  featureId: string;
  filePath: string;
};

export function loadInitialRepoSelection(workspaceId: string): RepoSelection | null {
  return loadRepoSelection("featureExplorer", workspaceId);
}

function mergeDistinctStrings(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])];
}

export function mergeSessionDiagnostics(
  left?: FileSessionDiagnostics,
  right?: FileSessionDiagnostics,
): FileSessionDiagnostics | undefined {
  if (!left) {
    return right ? {
      ...right,
      toolCallsByName: { ...right.toolCallsByName },
      readFiles: [...right.readFiles],
      writtenFiles: [...right.writtenFiles],
      repeatedReadFiles: [...right.repeatedReadFiles],
      repeatedCommands: [...right.repeatedCommands],
      failedTools: right.failedTools.map((failure) => ({ ...failure })),
    } : undefined;
  }

  if (!right) {
    return left;
  }

  const toolCallsByName: Record<string, number> = { ...left.toolCallsByName };
  for (const [toolName, count] of Object.entries(right.toolCallsByName)) {
    toolCallsByName[toolName] = Math.max(toolCallsByName[toolName] ?? 0, count);
  }

  const failedTools = new Map(
    left.failedTools.map((failure) => [`${failure.toolName}|${failure.command ?? ""}|${failure.message}`, failure] as const),
  );
  for (const failure of right.failedTools) {
    failedTools.set(`${failure.toolName}|${failure.command ?? ""}|${failure.message}`, failure);
  }

  return {
    toolCallCount: Math.max(left.toolCallCount, right.toolCallCount),
    failedToolCallCount: Math.max(left.failedToolCallCount, right.failedToolCallCount),
    toolCallsByName,
    readFiles: mergeDistinctStrings(left.readFiles, right.readFiles).sort((a, b) => a.localeCompare(b)),
    writtenFiles: mergeDistinctStrings(left.writtenFiles, right.writtenFiles).sort((a, b) => a.localeCompare(b)),
    repeatedReadFiles: mergeDistinctStrings(left.repeatedReadFiles, right.repeatedReadFiles).sort((a, b) => a.localeCompare(b)),
    repeatedCommands: mergeDistinctStrings(left.repeatedCommands, right.repeatedCommands),
    failedTools: [...failedTools.values()],
  };
}

export function readFeatureExplorerUrlState(): FeatureExplorerUrlState {
  if (typeof window === "undefined") {
    return { featureId: "", filePath: "" };
  }

  const params = new URLSearchParams(window.location.search);
  return {
    featureId: params.get("feature") ?? "",
    filePath: params.get("file") ?? "",
  };
}

export function replaceFeatureExplorerUrlState(nextState: FeatureExplorerUrlState): void {
  if (typeof window === "undefined") {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  if (nextState.featureId) {
    params.set("feature", nextState.featureId);
  } else {
    params.delete("feature");
  }
  if (nextState.filePath) {
    params.set("file", nextState.filePath);
  } else {
    params.delete("file");
  }

  const query = params.toString();
  const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState(window.history.state, "", nextUrl);
}

export function buildSessionAnalysisSessionName(
  locale: string,
  featureDetail: FeatureDetail | null,
  selectedFilePaths: string[],
): string {
  const firstFile = selectedFilePaths[0]?.split("/").pop() ?? "";
  const focus = firstFile || featureDetail?.name || "feature";

  if (selectedFilePaths.length > 1) {
    return locale === "zh"
      ? `文件会话分析 · ${focus} +${selectedFilePaths.length - 1}`
      : `File session analysis · ${focus} +${selectedFilePaths.length - 1}`;
  }

  return locale === "zh"
    ? `文件会话分析 · ${focus}`
    : `File session analysis · ${focus}`;
}
