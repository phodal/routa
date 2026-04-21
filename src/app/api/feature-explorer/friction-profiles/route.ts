import { NextRequest, NextResponse } from "next/server";

import {
  isContextError,
  parseContext,
  resolveRepoRoot,
} from "../shared";
import {
  loadTaskAdaptiveFrictionProfiles,
  refreshTaskAdaptiveFrictionProfiles,
} from "@/core/harness/task-adaptive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    return NextResponse.json(loadTaskAdaptiveFrictionProfiles(repoRoot) ?? {
      generatedAt: "",
      thresholds: {
        minFileSessions: 2,
        minFeatureSessions: 2,
      },
      fileProfiles: {},
      featureProfiles: {},
    });
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      { error: "Feature explorer friction profiles failed", details: message },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    const body = await request.json().catch(() => ({}));
    const snapshot = await refreshTaskAdaptiveFrictionProfiles(repoRoot, {
      minFileSessions: typeof body.minFileSessions === "number" ? body.minFileSessions : undefined,
      minFeatureSessions: typeof body.minFeatureSessions === "number" ? body.minFeatureSessions : undefined,
      maxFiles: typeof body.maxFiles === "number" ? body.maxFiles : undefined,
      maxSessions: typeof body.maxSessions === "number" ? body.maxSessions : undefined,
    });

    return NextResponse.json({
      generatedAt: snapshot.generatedAt,
      thresholds: snapshot.thresholds,
      fileProfileCount: Object.keys(snapshot.fileProfiles).length,
      featureProfileCount: Object.keys(snapshot.featureProfiles).length,
      fileProfiles: snapshot.fileProfiles,
      featureProfiles: snapshot.featureProfiles,
    });
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      { error: "Feature explorer friction profile refresh failed", details: message },
      { status: 500 },
    );
  }
}
