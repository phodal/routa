import { NextRequest, NextResponse } from "next/server";
import {
  isFitnessContextError,
  normalizeFitnessContextValue,
  resolveFitnessRepoRoot,
  type FitnessContext,
} from "@/core/fitness/repo-root";
import { readRuntimeFitnessStatus } from "@/core/fitness/runtime-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseRuntimeContext(searchParams: URLSearchParams): FitnessContext {
  return {
    workspaceId: normalizeFitnessContextValue(searchParams.get("workspaceId")),
    codebaseId: normalizeFitnessContextValue(searchParams.get("codebaseId")),
    repoPath: normalizeFitnessContextValue(searchParams.get("repoPath")),
  };
}

export async function GET(request: NextRequest) {
  try {
    const context = parseRuntimeContext(request.nextUrl.searchParams);
    const repoRoot = await resolveFitnessRepoRoot(context, {
      preferCurrentRepoForDefaultWorkspace: true,
    });
    const payload = await readRuntimeFitnessStatus(repoRoot);
    return NextResponse.json(payload);
  } catch (error) {
    const message = toMessage(error);
    if (isFitnessContextError(message)) {
      return NextResponse.json(
        {
          error: "Runtime Fitness 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "读取 Runtime Fitness 状态失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
