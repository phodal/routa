import { NextRequest, NextResponse } from "next/server";
import { isContextError, parseContext, parseFeatureTree, resolveRepoRoot } from "./shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    const result = parseFeatureTree(repoRoot);

    const features = result.features.map((f) => ({
      id: f.id,
      name: f.name,
      group: f.group,
      summary: f.summary,
      status: f.status,
      sessionCount: 0,
      changedFiles: f.source_files.length,
      updatedAt: "-",
      sourceFileCount: f.source_files.length,
      pageCount: f.pages.length,
      apiCount: f.apis.length,
    }));

    return NextResponse.json({
      capabilityGroups: result.capabilityGroups,
      features,
    });
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        { error: "Feature explorer context error", details: message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Feature explorer error", details: message },
      { status: 500 },
    );
  }
}
