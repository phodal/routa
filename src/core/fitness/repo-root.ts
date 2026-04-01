import * as fs from "fs";
import * as path from "path";

import { getRoutaSystem } from "@/core/routa-system";

export type FitnessContext = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
};

type ResolveFitnessRepoRootOptions = {
  preferCurrentRepoForDefaultWorkspace?: boolean;
};

export function normalizeFitnessContextValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isRoutaRepoRoot(repoRoot: string): boolean {
  return (
    fs.existsSync(path.join(repoRoot, "docs", "fitness", "harness-fluency.model.yaml"))
    && fs.existsSync(path.join(repoRoot, "crates", "routa-cli"))
  );
}

export function getCurrentRoutaRepoRoot(): string | undefined {
  const candidate = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
  );
  return isRoutaRepoRoot(candidate) ? candidate : undefined;
}

function validateRepoDirectory(candidate: string, label: string) {
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error(`${label}不存在或不是目录: ${candidate}`);
  }
}

export async function resolveFitnessRepoRoot(
  context: FitnessContext,
  options?: ResolveFitnessRepoRootOptions,
): Promise<string> {
  const workspaceId = normalizeFitnessContextValue(context.workspaceId);
  const codebaseId = normalizeFitnessContextValue(context.codebaseId);
  const repoPath = normalizeFitnessContextValue(context.repoPath);
  const system = getRoutaSystem();

  const directPath = repoPath ? path.resolve(/* turbopackIgnore: true */ repoPath) : undefined;
  if (directPath) {
    validateRepoDirectory(directPath, "repoPath ");
    return directPath;
  }

  if (codebaseId) {
    const codebase = await system.codebaseStore.get(codebaseId);
    if (!codebase) {
      throw new Error(`Codebase 未找到: ${codebaseId}`);
    }

    const candidate = path.resolve(codebase.repoPath);
    validateRepoDirectory(candidate, "Codebase 的路径");
    return candidate;
  }

  if (!workspaceId) {
    throw new Error("缺少 fitness 上下文，请提供 workspaceId / codebaseId / repoPath 之一");
  }

  if (options?.preferCurrentRepoForDefaultWorkspace && workspaceId === "default") {
    const currentRepoRoot = getCurrentRoutaRepoRoot();
    if (currentRepoRoot) {
      return currentRepoRoot;
    }
  }

  const codebases = await system.codebaseStore.listByWorkspace(workspaceId);
  if (codebases.length === 0) {
    throw new Error(`Workspace 下没有配置 codebase: ${workspaceId}`);
  }

  const fallback = codebases.find((codebase) => codebase.isDefault) ?? codebases[0];
  const candidate = path.resolve(fallback.repoPath);
  validateRepoDirectory(candidate, "默认 codebase 的路径");
  return candidate;
}

export function isFitnessContextError(message: string) {
  return message.includes("缺少 fitness 上下文")
    || message.includes("Codebase 未找到")
    || message.includes("Codebase 的路径")
    || message.includes("repoPath")
    || message.includes("Workspace 下没有配置 codebase")
    || message.includes("不存在或不是目录");
}
