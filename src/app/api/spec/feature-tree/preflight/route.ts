import { NextRequest, NextResponse } from "next/server";

import {
  type FitnessContext,
  isFitnessContextError,
  normalizeFitnessContextValue,
  resolveFitnessRepoRoot,
} from "@/core/fitness/repo-root";
import { preflightFeatureTreeViaCli } from "@/core/spec/feature-tree-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const context: FitnessContext = {
    workspaceId: normalizeFitnessContextValue(searchParams.get("workspaceId")),
    codebaseId: normalizeFitnessContextValue(searchParams.get("codebaseId")),
    repoPath: normalizeFitnessContextValue(searchParams.get("repoPath")),
  };

  let repoRoot: string;
  try {
    repoRoot = await resolveFitnessRepoRoot(context, {
      preferCurrentRepoForDefaultWorkspace: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isFitnessContextError(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    return NextResponse.json(await preflightFeatureTreeViaCli(repoRoot));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
