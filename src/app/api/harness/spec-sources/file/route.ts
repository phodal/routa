import { promises as fsp } from "fs";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import { isContextError, normalizeContextValue, parseContext, resolveRepoRoot } from "../../hooks/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  try {
    const filePath = normalizeContextValue(request.nextUrl.searchParams.get("filePath"));
    if (!filePath) {
      return NextResponse.json(
        { error: "filePath 参数是必填项" },
        { status: 400 },
      );
    }

    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);

    // Resolve and validate no path traversal outside repoRoot
    const resolvedFilePath = path.resolve(/* turbopackIgnore: true */ repoRoot, filePath);
    if (!resolvedFilePath.startsWith(repoRoot + path.sep) && resolvedFilePath !== repoRoot) {
      return NextResponse.json(
        { error: "文件路径超出仓库根目录范围，不允许访问" },
        { status: 400 },
      );
    }

    let content: string;
    try {
      content = await fsp.readFile(resolvedFilePath, "utf-8");
    } catch (readError) {
      const msg = toMessage(readError);
      if (msg.includes("ENOENT") || msg.includes("no such file")) {
        return NextResponse.json(
          { error: "文件未找到", details: filePath },
          { status: 404 },
        );
      }
      throw readError;
    }

    return NextResponse.json({ content, filePath });
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        { error: "Spec 文件读取上下文无效", details: message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "读取 spec 文件失败", details: message },
      { status: 500 },
    );
  }
}
