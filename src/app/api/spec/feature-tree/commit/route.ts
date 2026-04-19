import fs from "node:fs";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import {
  type FitnessContext,
  isFitnessContextError,
  normalizeFitnessContextValue,
  resolveFitnessRepoRoot,
} from "@/core/fitness/repo-root";
import {
  type FeatureTreeMetadata,
  generateFeatureTree,
  preflightFeatureTree,
} from "@/core/spec/feature-tree-generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CommitRequestBody {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
  scanRoot?: string;
  metadata?: FeatureTreeMetadata | null;
}

export async function POST(request: NextRequest) {
  let body: CommitRequestBody;
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
    let scanRoot: string;
    if (body.scanRoot) {
      const resolved = path.resolve(body.scanRoot);
      if (!fs.existsSync(resolved)) {
        return NextResponse.json(
          { error: "scanRoot does not exist" },
          { status: 400 },
        );
      }
      const realScanRoot = fs.realpathSync(resolved);
      const realRepoRoot = fs.realpathSync(path.resolve(repoRoot));
      if (realScanRoot !== realRepoRoot && !realScanRoot.startsWith(realRepoRoot + path.sep)) {
        return NextResponse.json(
          { error: "scanRoot must be inside the repository" },
          { status: 400 },
        );
      }
      scanRoot = realScanRoot;
    } else {
      scanRoot = preflightFeatureTree(repoRoot).selectedScanRoot;
    }

    let metadata: FeatureTreeMetadata | null = null;
    if (body.metadata != null) {
      if (typeof body.metadata !== "object" || !Array.isArray(body.metadata.features)) {
        return NextResponse.json(
          { error: "Invalid metadata: must contain a features array" },
          { status: 400 },
        );
      }
      metadata = body.metadata;
    }

    const result = await generateFeatureTree({
      repoRoot,
      scanRoot,
      metadata,
      dryRun: false,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
