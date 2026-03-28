import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import yaml from "js-yaml";
import { NextRequest, NextResponse } from "next/server";
import { isContextError, parseContext, resolveRepoRoot } from "../hooks/shared";

type WorkflowJobKind = "job" | "approval" | "release";

type GitHubActionsJob = {
  id: string;
  name: string;
  runner: string;
  kind: WorkflowJobKind;
  stepCount: number | null;
  needs: string[];
};

type GitHubActionsFlow = {
  id: string;
  name: string;
  event: string;
  yaml: string;
  jobs: GitHubActionsJob[];
  relativePath: string;
};

type GitHubActionsFlowsResponse = {
  generatedAt: string;
  repoRoot: string;
  workflowsDir: string;
  flows: GitHubActionsFlow[];
  warnings: string[];
};

type RawWorkflow = {
  name?: unknown;
  jobs?: Record<string, RawJob> | unknown;
  on?: unknown;
  true?: unknown;
};

type RawJob = {
  name?: unknown;
  "runs-on"?: unknown;
  needs?: unknown;
  environment?: unknown;
  steps?: unknown;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

function summarizeRunner(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const parts = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    return parts.length > 0 ? parts.join(" + ") : "unspecified";
  }
  if (value && typeof value === "object") {
    return "expression";
  }
  return "unspecified";
}

function inferJobKind(job: RawJob): WorkflowJobKind {
  if (job.environment) {
    return "approval";
  }
  const runner = summarizeRunner(job["runs-on"]).toLowerCase();
  if (runner.includes("release")) {
    return "release";
  }
  return "job";
}

function summarizeEvent(value: unknown): { event: string } {
  if (typeof value === "string") {
    return { event: value };
  }
  if (Array.isArray(value)) {
    const events = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    return {
      event: events.join(", ") || "unknown",
    };
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return { event: keys.join(", ") || "unknown" };
  }
  return { event: "unknown" };
}

function parseFlow(id: string, relativePath: string, source: string): GitHubActionsFlow | null {
  const parsed = (yaml.load(source) ?? {}) as RawWorkflow;
  const trigger = parsed.on ?? parsed.true;
  const eventSummary = summarizeEvent(trigger);
  const rawJobs = parsed.jobs && typeof parsed.jobs === "object" && !Array.isArray(parsed.jobs)
    ? parsed.jobs as Record<string, RawJob>
    : {};
  const jobs = Object.entries(rawJobs).map(([jobId, job]) => ({
    id: jobId,
    name: typeof job.name === "string" && job.name.trim() ? job.name.trim() : jobId,
    runner: summarizeRunner(job["runs-on"]),
    kind: inferJobKind(job),
    stepCount: Array.isArray(job.steps) ? job.steps.length : null,
    needs: normalizeStringList(job.needs),
  }));

  if (jobs.length === 0) {
    return null;
  }

  return {
    id,
    name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : id,
    event: eventSummary.event,
    yaml: source,
    jobs,
    relativePath,
  };
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    const workflowsDir = path.join(repoRoot, ".github", "workflows");
    const warnings: string[] = [];

    if (!fs.existsSync(workflowsDir) || !fs.statSync(workflowsDir).isDirectory()) {
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        repoRoot,
        workflowsDir,
        flows: [],
        warnings: ['No ".github/workflows" directory found for this repository.'],
      } satisfies GitHubActionsFlowsResponse);
    }

    const entries = await fsp.readdir(workflowsDir, { withFileTypes: true });
    const flows: GitHubActionsFlow[] = [];

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !/\.(ya?ml)$/u.test(entry.name)) {
        continue;
      }

      const absolutePath = path.join(workflowsDir, entry.name);
      const relativePath = path.relative(repoRoot, absolutePath);
      try {
        const source = await fsp.readFile(absolutePath, "utf-8");
        const id = entry.name.replace(/\.(yaml|yml)$/u, "");
        const flow = parseFlow(id, relativePath, source);
        if (flow) {
          flows.push(flow);
        } else {
          warnings.push(`Skipped ${entry.name} because it does not define any jobs.`);
        }
      } catch (error) {
        warnings.push(`Failed to parse ${entry.name}: ${toMessage(error)}`);
      }
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      repoRoot,
      workflowsDir,
      flows,
      warnings,
    } satisfies GitHubActionsFlowsResponse);
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "GitHub Actions 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "读取 GitHub Actions workflows 失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
