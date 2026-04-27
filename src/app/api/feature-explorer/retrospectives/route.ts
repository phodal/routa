import { NextRequest, NextResponse } from "next/server";

import {
  isContextError,
  parseContext,
  resolveRepoRoot,
} from "../shared";
import { loadMatchingFeatureRetrospectiveMemories } from "@/core/harness/retrospective-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    const featureIds = request.nextUrl.searchParams
      .getAll("featureId")
      .map((value) => value.trim())
      .filter(Boolean);
    const filePaths = request.nextUrl.searchParams
      .getAll("filePath")
      .map((value) => value.trim())
      .filter(Boolean);

    return NextResponse.json(loadMatchingFeatureRetrospectiveMemories(repoRoot, {
      featureIds,
      filePaths,
    }));
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      { error: "Feature explorer retrospectives failed", details: message },
      { status: 500 },
    );
  }
}
