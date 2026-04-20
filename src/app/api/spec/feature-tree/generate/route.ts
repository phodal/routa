import { NextRequest, NextResponse } from "next/server";
import {
  type FitnessContext,
  isFitnessContextError,
  normalizeFitnessContextValue,
  resolveFitnessRepoRoot,
} from "@/core/fitness/repo-root";
import { generateFeatureTreeViaCli } from "@/core/spec/feature-tree-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GenerateRequestBody {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
  dryRun?: boolean;
}

export async function POST(request: NextRequest) {
  let body: GenerateRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const context: FitnessContext = {
    workspaceId: normalizeFitnessContextValue(body.workspaceId ?? null),
    codebaseId: normalizeFitnessContextValue(body.codebaseId ?? null),
    repoPath: normalizeFitnessContextValue(body.repoPath ?? null),
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
    const result = await generateFeatureTreeViaCli({
      repoRoot,
      dryRun: body.dryRun ?? false,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
