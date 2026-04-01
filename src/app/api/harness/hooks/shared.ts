import * as fs from "fs";
import * as path from "path";
import { getRoutaSystem } from "@/core/routa-system";

export type HarnessContext = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
};

export type HookProfileName = string;
export type RuntimePhase = string;

export function normalizeContextValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseContext(searchParams: URLSearchParams): HarnessContext {
  return {
    workspaceId: normalizeContextValue(searchParams.get("workspaceId")),
    codebaseId: normalizeContextValue(searchParams.get("codebaseId")),
    repoPath: normalizeContextValue(searchParams.get("repoPath")),
  };
}

export function isHookProfileName(value: string | undefined): value is HookProfileName {
  return normalizeContextValue(value) !== undefined;
}

function validateRepoDirectory(candidate: string, label: string) {
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error(`${label}不存在或不是目录: ${candidate}`);
  }
}

export async function resolveRepoRoot(context: HarnessContext): Promise<string> {
  const workspaceId = normalizeContextValue(context.workspaceId);
  const codebaseId = normalizeContextValue(context.codebaseId);
  const repoPath = normalizeContextValue(context.repoPath);
  const system = getRoutaSystem();

  const directPath = repoPath
    ? path.resolve(/* turbopackIgnore: true */ repoPath)
    : undefined;
  if (directPath) {
    validateRepoDirectory(directPath, "repoPath ");
    return directPath;
  }

  if (codebaseId) {
    const codebase = await system.codebaseStore.get(codebaseId);
    if (!codebase) {
      throw new Error(`Codebase 未找到: ${codebaseId}`);
    }

    const candidate = path.resolve(/* turbopackIgnore: true */ codebase.repoPath);
    validateRepoDirectory(candidate, "Codebase 的路径");
    return candidate;
  }

  if (!workspaceId) {
    throw new Error("缺少 harness 上下文，请提供 workspaceId / codebaseId / repoPath 之一");
  }

  const codebases = await system.codebaseStore.listByWorkspace(workspaceId);
  if (codebases.length === 0) {
    throw new Error(`Workspace 下没有配置 codebase: ${workspaceId}`);
  }

  const fallback = codebases.find((codebase) => codebase.isDefault) ?? codebases[0];
  const candidate = path.resolve(/* turbopackIgnore: true */ fallback.repoPath);
  validateRepoDirectory(candidate, "默认 codebase 的路径");
  return candidate;
}

export function isContextError(message: string) {
  return message.includes("缺少 harness 上下文")
    || message.includes("Codebase 未找到")
    || message.includes("Codebase 的路径")
    || message.includes("repoPath")
    || message.includes("Workspace 下没有配置 codebase")
    || message.includes("不存在或不是目录");
}
