import { NextRequest, NextResponse } from "next/server";
import { detectCodeowners } from "@/core/harness/codeowners";
import { isContextError, parseContext, resolveRepoRoot } from "../hooks/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    return NextResponse.json(await detectCodeowners(repoRoot));
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "CODEOWNERS 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "读取 CODEOWNERS 失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
