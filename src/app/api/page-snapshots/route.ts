import fs from "node:fs";

import { NextRequest, NextResponse } from "next/server";

import {
  getPageSnapshotTarget,
  listPageSnapshotTargets,
  parsePageSnapshotContent,
  readPageSnapshot,
  resolvePageSnapshotPath,
} from "@/core/testing/page-snapshots";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const pageId = searchParams.get("page");
  const group = searchParams.get("group");
  const elementType = searchParams.get("elementType") ?? undefined;

  if (!pageId) {
    const snapshots = listPageSnapshotTargets()
      .filter((target) => !group || target.group === group)
      .map((target) => ({
        ...target,
        snapshotExists: fs.existsSync(resolvePageSnapshotPath(target.snapshotFile)),
      }));

    return NextResponse.json({ snapshots });
  }

  const target = getPageSnapshotTarget(pageId);
  if (!target) {
    return NextResponse.json(
      { error: `Unknown page snapshot target: ${pageId}` },
      { status: 404 },
    );
  }

  const snapshot = readPageSnapshot(pageId);
  if (!snapshot) {
    return NextResponse.json(
      { error: `Snapshot not found for ${pageId}. Run npm run snapshots:generate first.` },
      { status: 404 },
    );
  }

  const parsed = parsePageSnapshotContent(snapshot.rawContent);
  const elements = elementType
    ? parsed.elements.filter((element) => element.type === elementType.toLowerCase())
    : parsed.elements;

  return NextResponse.json({
    page: target,
    metadata: parsed.metadata,
    content: parsed.snapshotText,
    elements,
    totalElements: parsed.elements.length,
    filteredElementType: elementType ?? null,
  });
}