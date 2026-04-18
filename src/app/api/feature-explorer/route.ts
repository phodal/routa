import { NextRequest, NextResponse } from "next/server";

import {
  collectFeatureSessionStats,
  FeatureTreeFeature,
  isContextError,
  parseContext,
  parseFeatureTree,
  resolveRepoRoot,
} from "./shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CapabilityGroupResponse {
  id: string;
  name: string;
  description: string;
}

interface FeatureSummaryResponse {
  id: string;
  name: string;
  group: string;
  summary: string;
  status: string;
  sessionCount: number;
  changedFiles: number;
  updatedAt: string;
  sourceFileCount: number;
  pageCount: number;
  apiCount: number;
}

interface FeatureListResponse {
  capabilityGroups: CapabilityGroupResponse[];
  features: FeatureSummaryResponse[];
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toSummaryResponse(
  feature: FeatureTreeFeature,
  stats: { sessionCount: number; changedFiles: number; updatedAt: string },
) {
  return {
    id: feature.id,
    name: feature.name,
    group: feature.group,
    summary: feature.summary,
    status: feature.status,
    sessionCount: stats?.sessionCount ?? 0,
    changedFiles: stats?.changedFiles ?? feature.sourceFiles.length,
    updatedAt: stats?.updatedAt && stats.updatedAt !== "" ? stats.updatedAt : "-",
    sourceFileCount: feature.sourceFiles.length,
    pageCount: feature.pages.length,
    apiCount: feature.apis.length,
  };
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    const featureTree = parseFeatureTree(repoRoot);
    const { featureStats } = collectFeatureSessionStats(repoRoot, featureTree);

    const capabilityGroups = featureTree.capabilityGroups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
    }));

    const features = featureTree.features.map((feature) => {
      const stats = featureStats[feature.id] ?? {
        sessionCount: 0,
        changedFiles: feature.sourceFiles.length,
        updatedAt: "",
        matchedFiles: [],
      };
      return toSummaryResponse(feature, stats);
    });

    return NextResponse.json({
      capabilityGroups,
      features,
    } as FeatureListResponse);
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      { error: "Feature explorer failed", details: message },
      { status: 500 },
    );
  }
}
