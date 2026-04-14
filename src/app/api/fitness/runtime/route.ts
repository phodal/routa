import { NextRequest, NextResponse } from "next/server";

import {
  isFitnessContextError,
  normalizeFitnessContextValue,
  type FitnessContext,
} from "@/core/fitness/repo-root";
import { readFitnessRuntimeStatus } from "@/core/fitness/runtime-status";

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
    const status = await readFitnessRuntimeStatus(context);
    return NextResponse.json(status);
  } catch (error) {
    const message = toMessage(error);
    if (isFitnessContextError(message)) {
      return NextResponse.json(
        {
          error: "Fitness runtime 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "获取 Fitness runtime 状态失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
