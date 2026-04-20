import { NextRequest, NextResponse } from "next/server";

import { FeatureTree, isContextError, parseContext, parseFeatureTree, resolveRepoRoot } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  try {
    const { featureId } = await params;
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    const featureTree = parseFeatureTree(repoRoot);
    const feature = featureTree.features.find((item: FeatureTree["features"][number]) => item.id === featureId);

    if (!feature) {
      return NextResponse.json(
        {
          error: "Feature not found",
          featureId,
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      featureId,
      apis: feature.apis,
      pages: feature.pages,
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
      { error: "Feature explorer failed", details: message },
      { status: 500 },
    );
  }
}
