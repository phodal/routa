import { runCommand } from "./process.js";
import path from "node:path";
import {
  runReviewTriggerSpecialist,
  type ReviewReportPayload,
  type ReviewTrigger,
} from "./specialist-review.js";
import type { OwnershipRoutingContext } from "../../../src/core/harness/codeowners-types";
import codeownersModule from "../../../src/core/harness/codeowners";
import reviewTriggersModule from "../../../src/core/harness/review-triggers";

const {
  buildOwnershipRoutingContext,
  loadCodeownersRules,
  resolveOwnership,
} = codeownersModule;

const { loadReviewTriggerRules } = reviewTriggersModule;

const REVIEW_UNAVAILABLE_BYPASS_ENV = "ROUTA_ALLOW_REVIEW_UNAVAILABLE";

type ReviewReport = ReviewReportPayload;

export type ReviewPhaseResult = {
  base: string;
  allowed: boolean;
  bypassed: boolean;
  status: "passed" | "blocked" | "unavailable" | "error";
  triggers: ReviewTrigger[];
  changedFiles?: string[];
  committedFiles?: string[];
  workingTreeFiles?: string[];
  untrackedFiles?: string[];
  diffFileCount?: number;
  ownershipRouting?: OwnershipRoutingContext | null;
  message: string;
};

function emptyReport(): ReviewReport {
  return {
    triggers: [],
    changed_files: [],
    committed_files: [],
    working_tree_files: [],
    untracked_files: [],
    diff_stats: { file_count: 0 },
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseNameOnlyOutput(output: string): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    files.push(trimmed);
  }
  return files;
}

async function resolveReviewBase(): Promise<string> {
  const upstream = await runCommand("git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'", {
    stream: false,
  });
  return upstream.exitCode === 0 ? upstream.output.trim() : "HEAD~1";
}

async function resolveReviewGitRoot(): Promise<string | null> {
  const root = await runCommand("git rev-parse --show-toplevel", {
    stream: false,
  });

  if (root.exitCode !== 0) {
    return null;
  }

  const trimmed = root.output.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

async function collectReviewScopeFiles(
  root: string,
  base: string,
): Promise<{ committedFiles: string[]; workingTreeFiles: string[]; untrackedFiles: string[] }> {
  const [committed, workingTree, untracked] = await Promise.all([
    runCommand(`git diff --name-only --diff-filter=ACMR ${shellQuote(`${base}...HEAD`)}`, {
      cwd: root,
      stream: false,
    }),
    runCommand("git diff --name-only --diff-filter=ACMR", {
      cwd: root,
      stream: false,
    }),
    runCommand("git ls-files --others --exclude-standard", {
      cwd: root,
      stream: false,
    }),
  ]);

  return {
    committedFiles: parseNameOnlyOutput(committed.output),
    workingTreeFiles: parseNameOnlyOutput(workingTree.output),
    untrackedFiles: parseNameOnlyOutput(untracked.output),
  };
}

function getReviewScopeMismatchMessage(rootPath: string): string {
  return `Review scope mismatch: hook-runtime expected to run in repository root "${rootPath}", but current directory is "${path.resolve(process.cwd())}".` +
    ` Set ${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 only if you intentionally want to proceed with potentially shifted scope.`;
}

function parseReport(reviewOutput: string): ReviewReport {
  if (!reviewOutput) {
    return emptyReport();
  }

  try {
    const report = JSON.parse(reviewOutput) as ReviewReport;
    return {
      ...emptyReport(),
      ...report,
      committed_files: report.committed_files ?? report.changed_files ?? [],
    };
  } catch {
    return emptyReport();
  }
}

function titleCaseTriggerName(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function summarizeReasonValues(values: string[]): string {
  if (values.length === 0) {
    return "";
  }
  if (values.length === 1) {
    return values[0];
  }
  const preview = values.slice(0, 2).join(", ");
  const remaining = values.length - 2;
  return remaining > 0 ? `${preview}, +${remaining} more` : preview;
}

function summarizeTriggerReasons(reasons: string[]): string[] {
  const grouped = new Map<string, string[]>();
  const passthrough: string[] = [];

  for (const reason of reasons) {
    const separatorIndex = reason.indexOf(":");
    if (separatorIndex === -1) {
      passthrough.push(reason);
      continue;
    }

    const label = reason.slice(0, separatorIndex).trim();
    const value = reason.slice(separatorIndex + 1).trim();
    if (!label || !value) {
      passthrough.push(reason);
      continue;
    }

    const items = value.split(",").map((item) => item.trim()).filter(Boolean);
    const existing = grouped.get(label) ?? [];
    grouped.set(label, existing.concat(items.length > 0 ? items : [value]));
  }

  const summary: string[] = [];
  for (const [label, values] of grouped) {
    if (values.length === 1) {
      summary.push(`${label}: ${values[0]}`);
      continue;
    }
    summary.push(`${label}: ${values.length} items. Examples: ${summarizeReasonValues(values)}`);
  }

  return [...summary, ...passthrough];
}

function renderKeyValueTable(rows: Array<[string, string]>): string[] {
  const normalized = rows.filter(([, value]) => value.trim().length > 0);
  if (normalized.length === 0) {
    return [];
  }

  const keyWidth = Math.max(...normalized.map(([key]) => key.length));
  const valueWidth = Math.max(...normalized.map(([, value]) => value.length));
  const border = `+${"-".repeat(keyWidth + 2)}+${"-".repeat(valueWidth + 2)}+`;

  return [
    border,
    ...normalized.map(([key, value]) => `| ${key.padEnd(keyWidth)} | ${value.padEnd(valueWidth)} |`),
    border,
  ];
}

function summarizeValueList(values: string[], maxItems = 3): string {
  if (values.length === 0) {
    return "";
  }
  if (values.length <= maxItems) {
    return values.join(", ");
  }
  return `${values.slice(0, maxItems).join(", ")}, +${values.length - maxItems} more`;
}

function printReviewReport(report: ReviewReport, ownershipRouting?: OwnershipRoutingContext | null): void {
  const committedFiles = report.committed_files ?? report.changed_files ?? [];
  const triggers = report.triggers ?? [];
  const diffStats = report.diff_stats;
  const workingTreeFiles = report.working_tree_files ?? [];
  const untrackedFiles = report.untracked_files ?? [];
  const residueSummary = [
    workingTreeFiles.length > 0 ? `${workingTreeFiles.length} tracked` : "",
    untrackedFiles.length > 0 ? `${untrackedFiles.length} untracked` : "",
  ]
    .filter(Boolean)
    .join(", ");

  console.log(
    `Human review required: ${triggers.length} trigger${triggers.length === 1 ? "" : "s"} across ${committedFiles.length} committed file${committedFiles.length === 1 ? "" : "s"}.`,
  );
  for (const line of renderKeyValueTable([
    ["Base", report.base ?? "unknown"],
    ["Committed files", String(committedFiles.length)],
    ["Trigger count", String(triggers.length)],
    ["Diff files", diffStats?.file_count === undefined ? "" : String(diffStats.file_count)],
    ["Added lines", diffStats?.added_lines === undefined ? "" : String(diffStats.added_lines)],
    ["Deleted lines", diffStats?.deleted_lines === undefined ? "" : String(diffStats.deleted_lines)],
    ["Workspace residue", residueSummary],
    ["Touched owners", summarizeValueList(ownershipRouting?.touchedOwners ?? [])],
    ["Unowned changed", summarizeValueList(ownershipRouting?.unownedChangedFiles ?? [])],
    ["Overlap changed", summarizeValueList(ownershipRouting?.overlappingChangedFiles ?? [])],
    ["Cross-owner triggers", summarizeValueList(ownershipRouting?.crossOwnerTriggers ?? [])],
  ])) {
    console.log(line);
  }
  if (triggers.length > 0) {
    console.log("Matched triggers:");
  }
  for (const trigger of triggers) {
    const reasons = summarizeTriggerReasons(trigger.reasons ?? []);
    const title = titleCaseTriggerName(trigger.name);
    const reasonCount = trigger.reasons?.length ?? 0;
    console.log(`- [${trigger.severity}] ${title}${reasonCount > 0 ? ` (${reasonCount} signal${reasonCount === 1 ? "" : "s"})` : ""}`);
    for (const reason of reasons.slice(0, 3)) {
      console.log(`  - ${reason}`);
    }
    if (reasons.length > 3) {
      console.log(`  - ... ${reasons.length - 3} more summarized reason${reasons.length - 3 === 1 ? "" : "s"}`);
    }
  }
  if (workingTreeFiles.length > 0 || untrackedFiles.length > 0) {
    console.log("");
    console.log("Local workspace residue excluded from push review:");
    if (workingTreeFiles.length > 0) {
      console.log(`- tracked but uncommitted: ${workingTreeFiles.length}`);
    }
    if (untrackedFiles.length > 0) {
      console.log(`- untracked: ${untrackedFiles.length}`);
    }
  }
  console.log("");
}

function buildResultBase(
  base: string,
  report: ReviewReport,
  status: ReviewPhaseResult["status"],
  allowed: boolean,
  bypassed: boolean,
  ownershipRouting: OwnershipRoutingContext | null,
  message: string,
): ReviewPhaseResult {
  return {
    allowed,
    bypassed,
    base,
    status,
    triggers: report.triggers ?? [],
    changedFiles: report.committed_files ?? report.changed_files,
    committedFiles: report.committed_files ?? report.changed_files,
    workingTreeFiles: report.working_tree_files,
    untrackedFiles: report.untracked_files,
    diffFileCount: report.diff_stats?.file_count,
    ownershipRouting,
    message,
  };
}

async function loadOwnershipRoutingContext(
  reviewRoot: string,
  report: ReviewReport,
): Promise<OwnershipRoutingContext | null> {
  const changedFiles = report.committed_files ?? report.changed_files ?? [];
  if (changedFiles.length === 0) {
    return null;
  }

  const { rules: codeownersRules } = await loadCodeownersRules(reviewRoot);
  const matches = resolveOwnership(changedFiles, codeownersRules);
  const { rules: triggerRules } = await loadReviewTriggerRules(reviewRoot);

  return buildOwnershipRoutingContext({
    changedFiles,
    matches,
    triggerRules,
    matchedTriggerNames: (report.triggers ?? []).map((trigger) => trigger.name),
  });
}

async function parseDecision(
  report: ReviewReport,
  base: string,
  reviewRoot: string,
  outputMode: "human" | "jsonl",
  ownershipRouting: OwnershipRoutingContext | null,
): Promise<ReviewPhaseResult> {
  if (process.env.ROUTA_ALLOW_REVIEW_TRIGGER_PUSH === "1") {
    const message = "ROUTA_ALLOW_REVIEW_TRIGGER_PUSH=1 set, bypassing review gate.";
    if (outputMode === "human") {
      console.log(message);
      console.log("");
    }
    return buildResultBase(base, report, "passed", true, true, ownershipRouting, message);
  }

  try {
    const decision = await runReviewTriggerSpecialist({
      reviewRoot,
      base,
      report: {
        ...report,
        ownership_routing: ownershipRouting,
      },
    });
    const message = decision.summary;
    if (outputMode === "human") {
      console.log(message);
      if (decision.findings.length > 0) {
        for (const finding of decision.findings) {
          const severity = finding.severity?.toUpperCase() ?? "INFO";
          const title = finding.title?.trim() || "Unnamed finding";
          const reason = finding.reason?.trim();
          const location = finding.location?.trim();
          console.log(`- [${severity}] ${title}${location ? ` (${location})` : ""}`);
          if (reason) {
            console.log(`  ${reason}`);
          }
        }
      }
      console.log("");
    }
    return buildResultBase(
      base,
      report,
      decision.allowed ? "passed" : "blocked",
      decision.allowed,
      false,
      ownershipRouting,
      message,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (shouldBypassUnavailableReviewGate()) {
      const message = `${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 set, bypassing automatic specialist review failure. ${detail}`;
      if (outputMode === "human") {
        console.log(message);
        console.log("");
      }
      return buildResultBase(base, report, "unavailable", true, true, ownershipRouting, message);
    }

    const message =
      `Automatic review specialist failed, so the push is blocked. ${detail} ` +
      `Fix the review environment and rerun, or set ${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 to bypass intentionally.`;
    if (outputMode === "human") {
      console.log("Automatic review specialist unavailable.");
      console.log(`- ${detail}`);
      console.log(`- Fix the review environment and rerun, or set ${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 to bypass intentionally.`);
      console.log("");
    }
    return buildResultBase(base, report, "unavailable", false, false, ownershipRouting, message);
  }
}

function shouldBypassUnavailableReviewGate(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[REVIEW_UNAVAILABLE_BYPASS_ENV] === "1";
}

export async function runReviewTriggerPhase(outputMode: "human" | "jsonl" = "human"): Promise<ReviewPhaseResult> {
  const reviewBase = await resolveReviewBase();
  const reviewRoot = await resolveReviewGitRoot();

  if (reviewRoot && reviewRoot !== path.resolve(process.cwd())) {
    const message = getReviewScopeMismatchMessage(reviewRoot);
    if (shouldBypassUnavailableReviewGate()) {
      if (outputMode === "human") {
        console.log(message);
        console.log("");
      }
      return buildResultBase(reviewBase, emptyReport(), "unavailable", true, true, null, message);
    }

    return buildResultBase(reviewBase, emptyReport(), "unavailable", false, false, null, message);
  }

  if (!reviewRoot) {
    const message =
      `No git repository root found from current directory (${path.resolve(process.cwd())}). ` +
      `Review phase requires git context and is blocked by default. Set ${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 to bypass intentionally.`;

    if (shouldBypassUnavailableReviewGate()) {
      if (outputMode === "human") {
        console.log(message);
        console.log("");
      }
      return buildResultBase(reviewBase, emptyReport(), "unavailable", true, true, null, message);
    }

    return buildResultBase(reviewBase, emptyReport(), "unavailable", false, false, null, message);
  }

  if (outputMode === "human") {
    console.log(`[review] Base: ${reviewBase}`);
    console.log("");
  }

  const scopeFiles = await collectReviewScopeFiles(reviewRoot, reviewBase);
  if (scopeFiles.committedFiles.length === 0) {
    const report = {
      ...emptyReport(),
      base: reviewBase,
      committed_files: [],
      changed_files: [],
      working_tree_files: scopeFiles.workingTreeFiles,
      untracked_files: scopeFiles.untrackedFiles,
    } satisfies ReviewReport;
    const message = "No committed changes in push scope.";
    if (outputMode === "human") {
      console.log(message);
      if (scopeFiles.workingTreeFiles.length > 0 || scopeFiles.untrackedFiles.length > 0) {
        console.log("");
        console.log("Local workspace residue not included in push decision:");
        if (scopeFiles.workingTreeFiles.length > 0) {
          console.log(`- tracked but uncommitted: ${scopeFiles.workingTreeFiles.length}`);
        }
        if (scopeFiles.untrackedFiles.length > 0) {
          console.log(`- untracked: ${scopeFiles.untrackedFiles.length}`);
        }
      }
      console.log("");
    }
    return buildResultBase(reviewBase, report, "passed", true, false, null, message);
  }
  const reviewFilesArg = scopeFiles.committedFiles.map(shellQuote).join(" ");
  const entrixBase = `${reviewBase}...HEAD`;
  const reviewCommand =
    `PYTHONPATH=tools/entrix python3 -m entrix.cli review-trigger --base ${shellQuote(entrixBase)} --json --fail-on-trigger`
    + (reviewFilesArg ? ` ${reviewFilesArg}` : "");

  const review = await runCommand(reviewCommand, { stream: false, cwd: reviewRoot });

  if (review.exitCode === 0) {
    if (outputMode === "human") {
      console.log("No review trigger matched.");
      console.log("");
    }
    return buildResultBase(
      reviewBase,
      emptyReport(),
      "passed",
      true,
      false,
      null,
      "No review trigger matched.",
    );
  }

  const report = {
    ...parseReport(review.output),
    base: reviewBase,
    committed_files: scopeFiles.committedFiles,
    changed_files: scopeFiles.committedFiles,
    working_tree_files: scopeFiles.workingTreeFiles,
    untracked_files: scopeFiles.untrackedFiles,
  } satisfies ReviewReport;
  const ownershipRouting = await loadOwnershipRoutingContext(reviewRoot, report);
  if (review.exitCode !== 3) {
    if (shouldBypassUnavailableReviewGate()) {
      const message = `${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 set, bypassing unavailable review gate.`;
      if (outputMode === "human") {
        console.log(message);
        console.log("");
      }
      return buildResultBase(reviewBase, report, "unavailable", true, true, ownershipRouting, message);
    }

    const message =
      `Unable to evaluate review triggers. Blocking push because the review gate could not be evaluated. ` +
      `Fix the review environment and rerun, or set ${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 to bypass intentionally.`;
    if (outputMode === "human") {
      console.log("Review trigger evaluation unavailable.");
      console.log("- Unable to evaluate review-trigger rules for the current push scope.");
      console.log(`- Fix the review environment and rerun, or set ${REVIEW_UNAVAILABLE_BYPASS_ENV}=1 to bypass intentionally.`);
      console.log("");
    }
    return buildResultBase(reviewBase, report, "unavailable", false, false, ownershipRouting, message);
  }

  if (outputMode === "human") {
    printReviewReport(report, ownershipRouting);
  }

  return parseDecision(report, reviewBase, reviewRoot, outputMode, ownershipRouting);
}
