import { NextRequest, NextResponse } from "next/server";
import { isContextError } from "@/app/api/harness/hooks/shared";
import { summarizeTaskHistoryContextFromToolArgs } from "@/core/harness/task-adaptive-tool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await summarizeTaskHistoryContextFromToolArgs(body ?? {}));
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "Task history summary 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "Task history summary 组装失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
