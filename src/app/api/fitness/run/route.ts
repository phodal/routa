import { NextRequest, NextResponse } from "next/server";

import type { EntrixRunScope, EntrixRunTier } from "@/core/fitness/entrix-run-types";
import { executeEntrixRun, formatEntrixAutoresearchOutput } from "@/core/fitness/entrix-runner";
import {
  isFitnessContextError,
  normalizeFitnessContextValue,
  resolveFitnessRepoRoot,
  type FitnessContext,
} from "@/core/fitness/repo-root";

type RunFitnessBody = {
  workspaceId?: string;
  codebaseId?: string;
  repoPath?: string;
  tier?: string;
  scope?: string;
  outputFormat?: string;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseContext(body: RunFitnessBody): FitnessContext {
  return {
    workspaceId: normalizeFitnessContextValue(body.workspaceId),
    codebaseId: normalizeFitnessContextValue(body.codebaseId),
    repoPath: normalizeFitnessContextValue(body.repoPath),
  };
}

function parseTier(value: string | undefined): EntrixRunTier {
  return value === "fast" || value === "normal" || value === "deep" ? value : "fast";
}

function parseScope(value: string | undefined): EntrixRunScope {
  return value === "local" || value === "ci" || value === "staging" || value === "prod_observation"
    ? value
    : "local";
}

function parseOutputFormat(value: string | undefined): "json" | "metrics" {
  return value === "metrics" ? "metrics" : "json";
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => ({}));
    const body = (rawBody && typeof rawBody === "object" ? rawBody : {}) as RunFitnessBody;
    const repoRoot = await resolveFitnessRepoRoot(parseContext(body), {
      preferCurrentRepoForDefaultWorkspace: true,
    });
    const payload = await executeEntrixRun({
      repoRoot,
      tier: parseTier(body.tier),
      scope: parseScope(body.scope),
    });
    if (parseOutputFormat(body.outputFormat) === "metrics") {
      return new NextResponse(`${formatEntrixAutoresearchOutput(payload)}\n`, {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }
    return NextResponse.json(payload);
  } catch (error) {
    const message = toMessage(error);
    if (isFitnessContextError(message)) {
      return NextResponse.json(
        {
          error: "Fitness run 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "执行 Entrix Fitness 失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
