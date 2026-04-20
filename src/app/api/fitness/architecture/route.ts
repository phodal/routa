import { promises as fsp } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { safeSpawn } from "@/core/utils/safe-exec";
import {
  type FitnessContext,
  isFitnessContextError,
  normalizeFitnessContextValue,
  resolveFitnessRepoRoot,
} from "@/core/fitness/repo-root";

type SuiteName = "boundaries" | "cycles";
type SummaryStatus = "pass" | "fail" | "skipped";

type ArchitectureViolation =
  | {
    kind: "dependency";
    source: string;
    target: string;
    edgeCount: number;
  }
  | {
    kind: "cycle";
    path: string[];
    edgeCount: number;
  }
  | {
    kind: "empty-test";
    message: string;
  }
  | {
    kind: "unknown";
    summary: string;
  };

type RuleResult = {
  id: string;
  title: string;
  suite: SuiteName;
  status: "pass" | "fail";
  violationCount: number;
  violations: ArchitectureViolation[];
};

type ArchitectureSuiteReport = {
  generatedAt: string;
  repoRoot: string;
  suite: SuiteName;
  summaryStatus: SummaryStatus;
  archUnitSource: string | null;
  tsconfigPath: string;
  ruleCount: number;
  failedRuleCount: number;
  results: RuleResult[];
  notes: string[];
};

type ArchitectureQualityResponse = {
  generatedAt: string;
  repoRoot: string;
  summaryStatus: SummaryStatus;
  archUnitSource: string | null;
  tsconfigPath: string;
  snapshotPath: string;
  suiteCount: number;
  ruleCount: number;
  failedRuleCount: number;
  violationCount: number;
  reports: ArchitectureSuiteReport[];
  notes: string[];
  comparison: ArchitectureComparison | null;
};

type ArchitectureRuleChangeStatus = "pass" | "fail" | "missing";

type ArchitectureRuleChange = {
  id: string;
  title: string;
  suite: SuiteName;
  previousStatus: ArchitectureRuleChangeStatus;
  currentStatus: ArchitectureRuleChangeStatus;
  previousViolationCount: number;
  currentViolationCount: number;
  violationDelta: number;
};

type ArchitectureComparison = {
  previousGeneratedAt: string;
  previousSummaryStatus: SummaryStatus;
  currentSummaryStatus: SummaryStatus;
  ruleDelta: number;
  failedRuleDelta: number;
  violationDelta: number;
  changedRules: ArchitectureRuleChange[];
  newFailingRules: ArchitectureRuleChange[];
  resolvedRules: ArchitectureRuleChange[];
};

const SUITES: SuiteName[] = ["boundaries", "cycles"];
const EXECUTION_TIMEOUT_MS = 120_000;
const SNAPSHOT_FILE = "backend-architecture-latest.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeContextValue(value: unknown): string | undefined {
  return normalizeFitnessContextValue(value);
}

function parseContext(searchParams: URLSearchParams): FitnessContext {
  return {
    workspaceId: normalizeContextValue(searchParams.get("workspaceId")),
    codebaseId: normalizeContextValue(searchParams.get("codebaseId")),
    repoPath: normalizeContextValue(searchParams.get("repoPath")),
  };
}

function isContextError(message: string) {
  return isFitnessContextError(message);
}

function extractJsonOutput(raw: string): string {
  const candidate = raw.trim();
  if (!candidate) {
    throw new Error("Command produced no output");
  }

  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    // Fall through and try extracting a trailing JSON object.
  }

  const lastOpen = candidate.lastIndexOf("{");
  if (lastOpen < 0) {
    throw new Error("Unable to locate JSON output");
  }

  for (let index = lastOpen; index >= 0; index -= 1) {
    if (candidate[index] !== "{") continue;
    const snippet = candidate.slice(index).trim();
    if (!snippet.endsWith("}")) continue;
    try {
      JSON.parse(snippet);
      return snippet;
    } catch {
      // Keep searching for a parsable trailing JSON object.
    }
  }

  throw new Error("Unable to parse command JSON output");
}

function normalizeSummaryStatus(value: unknown): SummaryStatus {
  return value === "fail" || value === "skipped" ? value : "pass";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function normalizeViolation(value: unknown): ArchitectureViolation {
  const record = asRecord(value);
  if (!record) {
    return {
      kind: "unknown",
      summary: String(value),
    };
  }

  if (record.kind === "dependency") {
    return {
      kind: "dependency",
      source: typeof record.source === "string" ? record.source : "",
      target: typeof record.target === "string" ? record.target : "",
      edgeCount: typeof record.edgeCount === "number" ? record.edgeCount : 0,
    };
  }

  if (record.kind === "cycle") {
    return {
      kind: "cycle",
      path: Array.isArray(record.path) ? record.path.filter((entry): entry is string => typeof entry === "string") : [],
      edgeCount: typeof record.edgeCount === "number" ? record.edgeCount : 0,
    };
  }

  if (record.kind === "empty-test") {
    return {
      kind: "empty-test",
      message: typeof record.message === "string" ? record.message : "",
    };
  }

  return {
    kind: "unknown",
    summary: typeof record.summary === "string" ? record.summary : JSON.stringify(record),
  };
}

function normalizeRuleResult(value: unknown, suite: SuiteName): RuleResult {
  const record = asRecord(value);
  return {
    id: typeof record?.id === "string" ? record.id : "",
    title: typeof record?.title === "string" ? record.title : "",
    suite: record?.suite === "cycles" ? "cycles" : suite,
    status: record?.status === "fail" ? "fail" : "pass",
    violationCount: typeof record?.violationCount === "number" ? record.violationCount : 0,
    violations: Array.isArray(record?.violations) ? record.violations.map((item) => normalizeViolation(item)) : [],
  };
}

function normalizeSuiteReport(value: unknown, suite: SuiteName, repoRoot: string): ArchitectureSuiteReport {
  const record = asRecord(value);
  return {
    generatedAt: typeof record?.generatedAt === "string" ? record.generatedAt : new Date().toISOString(),
    repoRoot: typeof record?.repoRoot === "string" ? record.repoRoot : repoRoot,
    suite: record?.suite === "cycles" ? "cycles" : suite,
    summaryStatus: normalizeSummaryStatus(record?.summaryStatus),
    archUnitSource: typeof record?.archUnitSource === "string" ? record.archUnitSource : null,
    tsconfigPath: typeof record?.tsconfigPath === "string" ? record.tsconfigPath : "",
    ruleCount: typeof record?.ruleCount === "number" ? record.ruleCount : 0,
    failedRuleCount: typeof record?.failedRuleCount === "number" ? record.failedRuleCount : 0,
    results: Array.isArray(record?.results) ? record.results.map((item) => normalizeRuleResult(item, suite)) : [],
    notes: Array.isArray(record?.notes) ? record.notes.filter((item): item is string => typeof item === "string") : [],
  };
}

function architectureSnapshotPath(repoRoot: string) {
  return path.join(repoRoot, "docs", "fitness", "reports", SNAPSHOT_FILE);
}

function normalizeArchitectureResponse(
  value: unknown,
  repoRoot: string,
  snapshotPath: string,
): ArchitectureQualityResponse {
  const record = asRecord(value);
  const reports = Array.isArray(record?.reports)
    ? record.reports.map((report) => normalizeSuiteReport(report, report && typeof report === "object" && (report as Record<string, unknown>).suite === "cycles" ? "cycles" : "boundaries", repoRoot))
    : [];
  const notes = Array.isArray(record?.notes) ? record.notes.filter((item): item is string => typeof item === "string") : [];

  return {
    generatedAt: typeof record?.generatedAt === "string" ? record.generatedAt : new Date().toISOString(),
    repoRoot: typeof record?.repoRoot === "string" ? record.repoRoot : repoRoot,
    summaryStatus: normalizeSummaryStatus(record?.summaryStatus),
    archUnitSource: typeof record?.archUnitSource === "string" ? record.archUnitSource : null,
    tsconfigPath: typeof record?.tsconfigPath === "string" ? record.tsconfigPath : "",
    snapshotPath,
    suiteCount: typeof record?.suiteCount === "number" ? record.suiteCount : reports.length,
    ruleCount: typeof record?.ruleCount === "number" ? record.ruleCount : reports.reduce((sum, report) => sum + report.ruleCount, 0),
    failedRuleCount: typeof record?.failedRuleCount === "number" ? record.failedRuleCount : reports.reduce((sum, report) => sum + report.failedRuleCount, 0),
    violationCount: typeof record?.violationCount === "number"
      ? record.violationCount
      : reports.reduce((sum, report) => sum + report.results.reduce((inner, result) => inner + result.violationCount, 0), 0),
    reports,
    notes,
    comparison: null,
  };
}

type ArchitectureRuleSnapshot = {
  id: string;
  title: string;
  suite: SuiteName;
  status: "pass" | "fail";
  violationCount: number;
};

function flattenRuleSnapshots(report: ArchitectureQualityResponse): ArchitectureRuleSnapshot[] {
  return report.reports.flatMap((suiteReport) => suiteReport.results.map((result) => ({
    id: result.id,
    title: result.title,
    suite: result.suite,
    status: result.status,
    violationCount: result.violationCount,
  })));
}

function buildArchitectureComparison(
  previous: ArchitectureQualityResponse,
  current: ArchitectureQualityResponse,
): ArchitectureComparison {
  const previousRules = new Map(flattenRuleSnapshots(previous).map((rule) => [`${rule.suite}:${rule.id}`, rule] as const));
  const currentRules = new Map(flattenRuleSnapshots(current).map((rule) => [`${rule.suite}:${rule.id}`, rule] as const));
  const keys = new Set([...previousRules.keys(), ...currentRules.keys()]);
  const changedRules: ArchitectureRuleChange[] = [];

  for (const key of keys) {
    const previousRule = previousRules.get(key);
    const currentRule = currentRules.get(key);
    const previousStatus: ArchitectureRuleChangeStatus = previousRule?.status ?? "missing";
    const currentStatus: ArchitectureRuleChangeStatus = currentRule?.status ?? "missing";
    const previousViolationCount = previousRule?.violationCount ?? 0;
    const currentViolationCount = currentRule?.violationCount ?? 0;

    if (previousStatus === currentStatus && previousViolationCount === currentViolationCount) {
      continue;
    }

    changedRules.push({
      id: currentRule?.id ?? previousRule?.id ?? "",
      title: currentRule?.title ?? previousRule?.title ?? "",
      suite: currentRule?.suite ?? previousRule?.suite ?? "boundaries",
      previousStatus,
      currentStatus,
      previousViolationCount,
      currentViolationCount,
      violationDelta: currentViolationCount - previousViolationCount,
    });
  }

  const sortRuleChanges = (left: ArchitectureRuleChange, right: ArchitectureRuleChange) => (
    right.currentViolationCount - left.currentViolationCount
    || left.suite.localeCompare(right.suite)
    || left.title.localeCompare(right.title)
  );

  return {
    previousGeneratedAt: previous.generatedAt,
    previousSummaryStatus: previous.summaryStatus,
    currentSummaryStatus: current.summaryStatus,
    ruleDelta: current.ruleCount - previous.ruleCount,
    failedRuleDelta: current.failedRuleCount - previous.failedRuleCount,
    violationDelta: current.violationCount - previous.violationCount,
    changedRules: [...changedRules].sort(sortRuleChanges),
    newFailingRules: changedRules
      .filter((rule) => rule.currentStatus === "fail" && rule.previousStatus !== "fail")
      .sort(sortRuleChanges),
    resolvedRules: changedRules
      .filter((rule) => rule.previousStatus === "fail" && rule.currentStatus !== "fail")
      .sort(sortRuleChanges),
  };
}

async function loadPreviousSnapshot(
  repoRoot: string,
  snapshotPath: string,
): Promise<ArchitectureQualityResponse | null> {
  try {
    const raw = await fsp.readFile(snapshotPath, "utf-8");
    return normalizeArchitectureResponse(JSON.parse(raw), repoRoot, snapshotPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function persistArchitectureSnapshot(
  report: ArchitectureQualityResponse,
  snapshotPath: string,
) {
  await fsp.mkdir(path.dirname(snapshotPath), { recursive: true });
  const payload = {
    ...report,
    comparison: null,
  };
  await fsp.writeFile(snapshotPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

async function executeSuite(repoRoot: string, suite: SuiteName): Promise<ArchitectureSuiteReport> {
  const appRoot = process.cwd();
  const command = "cargo";
  const args = [
    "run",
    "-q",
    "-p",
    "routa-cli",
    "--",
    "fitness",
    "arch-dsl",
    "--report",
    "backend-core-suite",
    "--repo-root",
    repoRoot,
    "--suite",
    suite,
    "--json",
  ];

  const child = safeSpawn(command, args, {
    cwd: appRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Architecture suite timed out after ${EXECUTION_TIMEOUT_MS}ms`));
    }, EXECUTION_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  try {
    const payload = JSON.parse(extractJsonOutput(stdout));
    return normalizeSuiteReport(payload, suite, repoRoot);
  } catch (error) {
    const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
    throw new Error(
      `Failed to execute architecture suite ${suite} (exit ${exitCode ?? "unknown"})${suffix || `: ${toMessage(error)}`}`,
      { cause: error },
    );
  }
}

function summarizeReports(repoRoot: string, reports: ArchitectureSuiteReport[], snapshotPath: string): ArchitectureQualityResponse {
  const ruleCount = reports.reduce((sum, report) => sum + report.ruleCount, 0);
  const failedRuleCount = reports.reduce((sum, report) => sum + report.failedRuleCount, 0);
  const violationCount = reports.reduce(
    (sum, report) => sum + report.results.reduce((inner, result) => inner + result.violationCount, 0),
    0,
  );
  const notes = [...new Set(reports.flatMap((report) => report.notes))];
  const archUnitSource = reports.find((report) => report.archUnitSource)?.archUnitSource ?? null;
  const tsconfigPath = reports.find((report) => report.tsconfigPath)?.tsconfigPath ?? "";
  const summaryStatus: SummaryStatus = reports.some((report) => report.summaryStatus === "fail")
    ? "fail"
    : reports.some((report) => report.summaryStatus === "skipped")
      ? "skipped"
      : "pass";

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    summaryStatus,
    archUnitSource,
    tsconfigPath,
    snapshotPath,
    suiteCount: reports.length,
    ruleCount,
    failedRuleCount,
    violationCount,
    reports,
    notes,
    comparison: null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveFitnessRepoRoot(context, {
      preferCurrentRepoForDefaultWorkspace: true,
    });
    const reports = await Promise.all(SUITES.map((suite) => executeSuite(repoRoot, suite)));
    const snapshotPath = architectureSnapshotPath(repoRoot);
    const currentReport = summarizeReports(repoRoot, reports, snapshotPath);
    const notes = [...currentReport.notes];
    let comparison: ArchitectureComparison | null = null;

    try {
      const previousSnapshot = await loadPreviousSnapshot(repoRoot, snapshotPath);
      if (previousSnapshot) {
        comparison = buildArchitectureComparison(previousSnapshot, currentReport);
      }
    } catch (error) {
      notes.push(`Unable to read previous architecture snapshot: ${toMessage(error)}`);
    }

    try {
      await persistArchitectureSnapshot(currentReport, snapshotPath);
    } catch (error) {
      notes.push(`Unable to persist architecture snapshot: ${toMessage(error)}`);
    }

    return NextResponse.json({
      ...currentReport,
      notes: [...new Set(notes)],
      comparison,
    } satisfies ArchitectureQualityResponse);
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        {
          error: "Architecture quality 上下文无效",
          details: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "加载 Architecture quality 失败",
        details: message,
      },
      { status: 500 },
    );
  }
}
