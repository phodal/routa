import { NextRequest, NextResponse } from "next/server";
import {
  doctorHarnessTemplates,
  listHarnessTemplates,
  validateHarnessTemplate,
} from "@/core/harness/templates";
import { isContextError, parseContext, resolveRepoRoot } from "../hooks/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action") ?? "list";

  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);

    switch (action) {
      case "list":
        return NextResponse.json(await listHarnessTemplates(repoRoot));

      case "validate": {
        const templateId = request.nextUrl.searchParams.get("templateId");
        if (!templateId) {
          return NextResponse.json(
            { error: "缺少 templateId 参数", details: "templateId is required" },
            { status: 400 },
          );
        }
        return NextResponse.json(
          await validateHarnessTemplate(repoRoot, templateId),
        );
      }

      case "doctor":
        return NextResponse.json(await doctorHarnessTemplates(repoRoot));

      default:
        return NextResponse.json(
          { error: "未知的 action", details: `action '${action}' is not supported` },
          { status: 400 },
        );
    }
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "Harness template 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "读取 Harness template 失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
