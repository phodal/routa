import { NextRequest, NextResponse } from "next/server";
import { isContextError, resolveRepoRoot } from "../hooks/shared";
import {
  assembleTaskAdaptiveHarness,
  parseTaskAdaptiveHarnessOptions,
} from "./shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const repoRoot = await resolveRepoRoot(body ?? {});
    const options = parseTaskAdaptiveHarnessOptions((body ?? {})["taskAdaptiveHarness"]) ?? {};
    return NextResponse.json(await assembleTaskAdaptiveHarness(repoRoot, options));
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "Task-Adaptive Harness 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "Task-Adaptive Harness 组装失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
