import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";

const FITNESS_PROFILES = ["generic", "agent_orchestrator"] as const;

type FitnessProfile = (typeof FITNESS_PROFILES)[number];

type ReportApiProfileResult = {
  profile: FitnessProfile;
  status: "ok" | "missing" | "error";
  source: "snapshot";
  report?: unknown;
  error?: string;
};

type ReportResponse = {
  generatedAt: string;
  requestedProfiles: FitnessProfile[];
  profiles: ReportApiProfileResult[];
};

type FitnessContext = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeContextValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseReportContext(searchParams: URLSearchParams): FitnessContext {
  return {
    workspaceId: normalizeContextValue(searchParams.get("workspaceId")),
    codebaseId: normalizeContextValue(searchParams.get("codebaseId")),
    repoPath: normalizeContextValue(searchParams.get("repoPath")),
  };
}

function isRoutaRepoRoot(repoRoot: string): boolean {
  return (
    fs.existsSync(path.join(repoRoot, "docs", "fitness", "harness-fluency.model.yaml"))
    && fs.existsSync(path.join(repoRoot, "crates", "routa-cli"))
  );
}

async function resolveRepoRoot(context: FitnessContext): Promise<string> {
  const workspaceId = normalizeContextValue(context.workspaceId);
  const codebaseId = normalizeContextValue(context.codebaseId);
  const repoPath = normalizeContextValue(context.repoPath);
  const system = getRoutaSystem();

  const directPath = repoPath ? path.resolve(repoPath) : undefined;
  if (directPath) {
    if (!fs.existsSync(directPath) || !fs.statSync(directPath).isDirectory()) {
      throw new Error(`repoPath 不存在或不是目录: ${directPath}`);
    }
    if (!isRoutaRepoRoot(directPath)) {
      throw new Error(`repoPath 不是 Routa 仓库: ${directPath}`);
    }
    return directPath;
  }

  if (codebaseId) {
    const codebase = await system.codebaseStore.get(codebaseId);
    if (!codebase) {
      throw new Error(`Codebase 未找到: ${codebaseId}`);
    }

    const candidate = path.resolve(codebase.repoPath);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      throw new Error(`Codebase 的路径不存在或不是目录: ${candidate}`);
    }
    if (!isRoutaRepoRoot(candidate)) {
      throw new Error(`Codebase 的路径不是 Routa 仓库: ${candidate}`);
    }

    return candidate;
  }

  if (!workspaceId) {
    throw new Error("缺少 fitness 上下文，请提供 workspaceId / codebaseId / repoPath 之一");
  }

  const codebases = await system.codebaseStore.listByWorkspace(workspaceId);
  if (codebases.length === 0) {
    throw new Error(`Workspace 下没有配置 codebase: ${workspaceId}`);
  }

  const fallback = codebases.find((codebase) => codebase.isDefault) ?? codebases[0];
  const candidate = path.resolve(fallback.repoPath);

  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error(`默认 codebase 的路径不存在或不是目录: ${candidate}`);
  }
  if (!isRoutaRepoRoot(candidate)) {
    throw new Error(`默认 codebase 的路径不是 Routa 仓库: ${candidate}`);
  }

  return candidate;
}

function isContextError(message: string) {
  return message.includes("缺少 fitness 上下文")
    || message.includes("Codebase 未找到")
    || message.includes("Codebase 的路径")
    || message.includes("repoPath")
    || message.includes("Workspace 下没有配置 codebase")
    || message.includes("不是 Routa 仓库")
    || message.includes("不存在或不是目录");
}

function profileSnapshotPath(repoRoot: string, profile: FitnessProfile) {
  return path.join(
    repoRoot,
    "docs/fitness/reports",
    profile === "generic" ? "harness-fluency-latest.json" : "harness-fluency-agent-orchestrator-latest.json",
  );
}

export async function GET(request: NextRequest) {
  try {
    const context = parseReportContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    const results: ReportApiProfileResult[] = [];

    for (const profile of FITNESS_PROFILES) {
      const snapshotPath = profileSnapshotPath(repoRoot, profile);

      try {
        await fsp.access(snapshotPath);
        const raw = await fsp.readFile(snapshotPath, "utf-8");
        results.push({
          profile,
          source: "snapshot",
          status: "ok",
          report: JSON.parse(raw),
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          results.push({
            profile,
            source: "snapshot",
            status: "missing",
            error: "快照文件不存在",
          });
          continue;
        }

        results.push({
          profile,
          source: "snapshot",
          status: "error",
          error: toMessage(error),
        });
      }
    }

    const response: ReportResponse = {
      generatedAt: new Date().toISOString(),
      requestedProfiles: [...FITNESS_PROFILES],
      profiles: results,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "Fitness 快照上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "获取 Fitness 快照失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
