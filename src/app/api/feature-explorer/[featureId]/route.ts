import { NextRequest, NextResponse } from "next/server";
import {
  buildFileTree,
  isContextError,
  parseContext,
  parseFeatureTree,
  resolveRepoRoot,
} from "../shared";

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
    const { features } = parseFeatureTree(repoRoot);

    const feature = features.find((f) => f.id === featureId);
    if (!feature) {
      return NextResponse.json(
        { error: "Feature not found", featureId },
        { status: 404 },
      );
    }

    const allFiles = [...feature.source_files].sort();
    const fileTree = buildFileTree(allFiles);

    const surfaceLinks = [
      ...feature.pages.map((route) => ({ kind: "Page", route, sourcePath: "" })),
      ...feature.apis.map((route) => ({ kind: "API", route, sourcePath: "" })),
    ];

    return NextResponse.json({
      id: feature.id,
      name: feature.name,
      group: feature.group,
      summary: feature.summary,
      status: feature.status,
      pages: feature.pages,
      apis: feature.apis,
      sourceFiles: allFiles,
      relatedFeatures: feature.related_features,
      domainObjects: feature.domain_objects,
      sessionCount: 0,
      changedFiles: allFiles.length,
      updatedAt: "-",
      fileTree,
      surfaceLinks,
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
