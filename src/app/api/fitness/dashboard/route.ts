import { spawn } from "child_process";
import * as path from "path";
import { promises as fsp } from "fs";
import { NextRequest, NextResponse } from "next/server";
import {
  isFitnessContextError,
  normalizeFitnessContextValue,
  resolveFitnessRepoRoot,
  type FitnessContext,
} from "@/core/fitness/repo-root";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DashboardOutputFormat = "json" | "html";

type DashboardQuery = FitnessContext & {
  format?: DashboardOutputFormat;
  compareLast?: boolean;
};

type DashboardApiResponse = {
  generatedAt: string;
  format: DashboardOutputFormat;
  dashboard?: unknown;
  html?: string;
  error?: string;
};

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseDashboardQuery(searchParams: URLSearchParams): DashboardQuery {
  return {
    workspaceId: normalizeFitnessContextValue(searchParams.get("workspaceId")),
    codebaseId: normalizeFitnessContextValue(searchParams.get("codebaseId")),
    repoPath: normalizeFitnessContextValue(searchParams.get("repoPath")),
    format: (searchParams.get("format") ?? "json") as DashboardOutputFormat,
    compareLast: searchParams.get("compareLast") === "true",
  };
}

async function runDashboardCli(
  repoRoot: string,
  format: DashboardOutputFormat,
  compareLast: boolean,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const args = [
      "run", "-p", "routa-cli", "--",
      "fitness", "dashboard",
      "--repo-root", repoRoot,
      "--format", format,
    ];

    if (compareLast) {
      args.push("--compare-last");
    }

    const child = spawn("cargo", args, {
      cwd: repoRoot,
      timeout: 300_000,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });

    child.on("error", (error) => {
      resolve({ stdout, stderr: stderr + "\n" + toMessage(error), exitCode: 1 });
    });
  });
}

export async function GET(request: NextRequest) {
  try {
    const query = parseDashboardQuery(request.nextUrl.searchParams);
    const repoRoot = await resolveFitnessRepoRoot(
      { workspaceId: query.workspaceId, codebaseId: query.codebaseId, repoPath: query.repoPath },
      { preferCurrentRepoForDefaultWorkspace: true },
    );
    const format = query.format === "html" ? "html" : "json";

    // Check for a snapshot first; if available, return it directly for JSON format
    if (format === "json") {
      const snapshotPath = path.join(repoRoot, "docs/fitness/reports/dashboard-latest.json");
      try {
        await fsp.access(snapshotPath);
        const raw = await fsp.readFile(snapshotPath, "utf-8");
        const dashboard = JSON.parse(raw);
        return NextResponse.json({
          generatedAt: new Date().toISOString(),
          format: "json",
          source: "snapshot",
          dashboard,
        } satisfies DashboardApiResponse & { source: string });
      } catch {
        // No snapshot; fall through to CLI generation
      }
    }

    const result = await runDashboardCli(repoRoot, format, query.compareLast ?? false);

    if (result.exitCode !== 0) {
      return NextResponse.json(
        {
          generatedAt: new Date().toISOString(),
          format,
          error: `Dashboard CLI exited with code ${result.exitCode}: ${result.stderr.slice(0, 1000)}`,
        } satisfies DashboardApiResponse,
        { status: 500 },
      );
    }

    if (format === "html") {
      return new Response(result.stdout, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    const dashboard = JSON.parse(result.stdout);
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      format: "json",
      source: "cli",
      dashboard,
    } satisfies DashboardApiResponse & { source: string });
  } catch (error) {
    const message = toMessage(error);
    if (isFitnessContextError(message)) {
      return NextResponse.json(
        { error: "Fitness Dashboard 上下文无效", details: message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: "生成 Fitness Dashboard 失败", details: message },
      { status: 500 },
    );
  }
}
