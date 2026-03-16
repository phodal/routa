import { NextRequest, NextResponse } from "next/server";

import { analyzeReview } from "@/core/review/review-analysis";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const result = await analyzeReview({
      repoPath: typeof body.repoPath === "string" ? body.repoPath : undefined,
      base: typeof body.base === "string" ? body.base : undefined,
      head: typeof body.head === "string" ? body.head : undefined,
      rulesFile: typeof body.rulesFile === "string" ? body.rulesFile : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Review analysis failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
