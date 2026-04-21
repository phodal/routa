import { resolveEntrixShellCommand, runCommand } from "./process.js";
import path from "node:path";
import {
  runReviewTriggerSpecialist,
  type ReviewReportPayload,
  type ReviewTrigger,
  type ReviewTriggerLayer,
} from "./specialist-review.js";
import type { OwnershipRoutingContext } from "../../../src/core/harness/codeowners-types";
import * as codeownersImport from "../../../src/core/harness/codeowners";
import * as reviewTriggersImport from "../../../src/core/harness/review-triggers";

const codeownersRuntimeModule = codeownersImport as typeof codeownersImport & { default?: typeof codeownersImport };
const reviewTriggersRuntimeModule = reviewTriggersImport as typeof reviewTriggersImport & {
  default?: typeof reviewTriggersImport;
};

const codeownersModule = (codeownersRuntimeModule.default ?? codeownersImport) as typeof codeownersImport;
const reviewTriggersModule = (reviewTriggersRuntimeModule.default ?? reviewTriggersImport) as typeof reviewTriggersImport;

const {
  buildOwnershipRoutingContext,
  loadCodeownersRules,
  resolveOwnership,
} = codeownersModule;

const { loadReviewTriggerRules } = reviewTriggersModule;

const REVIEW_UNAVAILABLE_BYPASS_ENV = "ROUTA_ALLOW_REVIEW_UNAVAILABLE";
const ANSI_RESET = "\u001B[0m";
const ANSI_BOLD = "\u001B[1m";
const ANSI_DIM = "\u001B[2m";
const ANSI_RED = "\u001B[31m";
const ANSI_YELLOW = "\u001B[33m";
const ANSI_GREEN = "\u001B[32m";
const ANSI_CYAN = "\u001B[36m";
const LOW_SIGNAL_REVIEW_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less", ".md", ".mdx"]);

type ReviewReport = ReviewReportPayload;
type ReviewTone = "danger" | "warning" | "success" | "info" | "muted";
type EffectiveReviewTriggerAction = "advisory" | "block" | "require_human_review" | "staged";
type ReviewTableRow = {
  key: string;
  value: string;
  tone?: ReviewTone;
};
type OversizedMetricKey = "file_count" | "added_lines" | "deleted_lines";
type OversizedMetricSummary = Partial<Record<OversizedMetricKey, {
  actual: number;
  threshold: number;
  severity: string;
}>>;
type StagedReviewGroup = {
  confidenceThreshold: number;
  context: string[];
  fallbackAction: EffectiveReviewTriggerAction;
  model: string | null;
  provider: string | null;
  specialistId: string | null;
  reviewLayers: ReviewTriggerLayer[];
  triggers: ReviewTrigger[];
};

type ResolvedStagedReviewLayer = {
  confidenceThreshold: number;
  context: string[];
  model: string | null;
  provider: string | null;
  specialistId: string | null;
};

const DEFAULT_STAGED_CONFIDENCE_THRESHOLD = 8;

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

function shouldUseColor(stream?: NodeJS.WriteStream): boolean {
  if (!stream?.isTTY) {
    return false;
  }

  if (process.env.NO_COLOR === "1") {
    return false;
  }

  if (process.env.FORCE_COLOR === "0") {
    return false;
  }

  return true;
}

function styleText(stream: NodeJS.WriteStream | undefined, styleCode: string, text: string): string {
  if (!shouldUseColor(stream)) {
    return text;
  }

  return `${styleCode}${text}${ANSI_RESET}`;
}

function colorByTone(stream: NodeJS.WriteStream | undefined, tone: ReviewTone | undefined, text: string): string {
  switch (tone) {
    case "danger":
      return styleText(stream, `${ANSI_BOLD}${ANSI_RED}`, text);
    case "warning":
      return styleText(stream, `${ANSI_BOLD}${ANSI_YELLOW}`, text);
    case "success":
      return styleText(stream, `${ANSI_BOLD}${ANSI_GREEN}`, text);
    case "info":
      return styleText(stream, `${ANSI_BOLD}${ANSI_CYAN}`, text);
    case "muted":
      return styleText(stream, ANSI_DIM, text);
    default:
      return text;
  }
}

function severityToTone(severity: string | undefined): ReviewTone {
  switch ((severity ?? "").toLowerCase()) {
    case "high":
      return "danger";
    case "medium":
      return "warning";
    case "low":
      return "info";
    default:
      return "muted";
  }
}

function compareSeverity(left: string | undefined, right: string | undefined): number {
  const order = new Map<string, number>([
    ["high", 3],
    ["medium", 2],
    ["low", 1],
  ]);
  return (order.get((left ?? "").toLowerCase()) ?? 0) - (order.get((right ?? "").toLowerCase()) ?? 0);
}

function normalizeTriggerAction(action: string | undefined): EffectiveReviewTriggerAction {
  const normalized = action?.trim().toLowerCase();
  switch (normalized) {
    case "advisory":
    case "warn":
      return "advisory";
    case "block":
    case "block_push":
      return "block";
    case "review":
    case "auto_review":
    case "staged":
      return "staged";
    case "require_human_review":
    case "human_review":
    default:
      return "require_human_review";
  }
}

function normalizeTriggerConfidenceThreshold(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_STAGED_CONFIDENCE_THRESHOLD;
  }

  return Math.min(10, Math.max(1, Math.round(value)));
}

function summarizeTriggerTitles(triggers: ReviewTrigger[], maxItems = 3): string {
  const names = triggers.map((trigger) => titleCaseTriggerName(trigger.name));
  if (names.length <= maxItems) {
    return names.join(", ");
  }

  return `${names.slice(0, maxItems).join(", ")}, +${names.length - maxItems} more`;
}

function summarizeReviewIntent(triggers: ReviewTrigger[]): {
  label: string;
  tone: ReviewTone;
} {
  const actions = triggers.map((trigger) => normalizeTriggerAction(trigger.action));
  if (actions.includes("block")) {
    return { label: "Push blocked", tone: "danger" };
  }
  if (actions.includes("require_human_review")) {
    return { label: "Human review required", tone: "danger" };
  }
  if (actions.includes("staged")) {
    return { label: "Automatic review required", tone: "warning" };
  }

  return { label: "Review advisory", tone: "info" };
}

function buildStagedReviewGroups(triggers: ReviewTrigger[]): StagedReviewGroup[] {
  const groups = new Map<string, StagedReviewGroup>();

  for (const trigger of triggers) {
    const context = [...(trigger.context ?? [])]
      .map((value) => value.trim())
      .filter(Boolean)
      .sort();
    const group: Omit<StagedReviewGroup, "triggers"> = {
      confidenceThreshold: normalizeTriggerConfidenceThreshold(trigger.confidence_threshold),
      context,
      fallbackAction: normalizeTriggerAction(trigger.fallback_action ?? "require_human_review"),
      model: trigger.model?.trim() || null,
      provider: trigger.provider?.trim() || null,
      specialistId: trigger.specialist_id?.trim() || null,
      reviewLayers: (trigger.review_layers ?? []).map((layer) => ({
        confidence_threshold: typeof layer.confidence_threshold === "number" && Number.isFinite(layer.confidence_threshold)
          ? normalizeTriggerConfidenceThreshold(layer.confidence_threshold)
          : null,
        specialist_id: layer.specialist_id?.trim() || null,
        provider: layer.provider?.trim() || null,
        model: layer.model?.trim() || null,
        context: [...(layer.context ?? [])]
          .map((value) => value.trim())
          .filter(Boolean)
          .sort(),
      })),
    };
    const key = JSON.stringify(group);
    const existing = groups.get(key);
    if (existing) {
      existing.triggers.push(trigger);
      continue;
    }

    groups.set(key, {
      ...group,
      triggers: [trigger],
    });
  }

  return [...groups.values()];
}

function buildResolvedStagedReviewLayers(group: StagedReviewGroup): ResolvedStagedReviewLayer[] {
  if (group.reviewLayers.length === 0) {
    return [{
      confidenceThreshold: group.confidenceThreshold,
      context: [...group.context],
      model: group.model,
      provider: group.provider,
      specialistId: group.specialistId,
    }];
  }

  return group.reviewLayers.map((layer) => ({
    confidenceThreshold: normalizeTriggerConfidenceThreshold(layer.confidence_threshold ?? group.confidenceThreshold),
    context: [...new Set([
      ...group.context,
      ...((layer.context ?? [])
        .map((value) => value.trim())
        .filter(Boolean)),
    ])].sort(),
    model: layer.model?.trim() || group.model,
    provider: layer.provider?.trim() || group.provider,
    specialistId: layer.specialist_id?.trim() || group.specialistId,
  }));
}

function formatReviewLayerLabel(index: number, total: number): string {
  return total <= 1 ? "Automatic review" : `Review layer ${index + 1}/${total}`;
}

function printDecisionFindings(findings: Array<{
  severity?: string;
  title?: string;
  reason?: string;
  location?: string;
}>): void {
  if (findings.length === 0) {
    return;
  }

  for (const finding of findings) {
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

function buildActionMessage(prefix: string, triggers: ReviewTrigger[], suffix?: string): string {
  const summary = summarizeTriggerTitles(triggers);
  return `${prefix}: ${summary}.${suffix ? ` ${suffix}` : ""}`;
}

function highestTriggerSeverity(triggers: ReviewTrigger[]): string | undefined {
  return triggers.reduce<string | undefined>((current, trigger) => {
    if (!current || compareSeverity(trigger.severity, current) > 0) {
      return trigger.severity;
    }
    return current;
  }, undefined);
}

function isLikelyPathValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  return trimmed.includes("/")
    || trimmed.includes("\\")
    || /(?:^|[^0-9])\.[A-Za-z0-9_-]+$/.test(trimmed);
}

function isLowerSignalPath(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!isLikelyPathValue(normalized)) {
    return false;
  }

  if (normalized.startsWith("docs/") || normalized.includes("/docs/")) {
    return true;
  }

  if (/(^|\/)(readme|changelog)(\.[^.]+)?$/.test(normalized)) {
    return true;
  }

  return LOW_SIGNAL_REVIEW_EXTENSIONS.has(path.extname(normalized));
}

function summarizeReasonValues(values: string[], maxItems = 4): {
  preview: string[];
  hiddenCount: number;
  hiddenLowerSignalCount: number;
} {
  if (values.length <= maxItems) {
    return { preview: values, hiddenCount: 0, hiddenLowerSignalCount: 0 };
  }

  const important: string[] = [];
  const deferred: string[] = [];
  for (const value of values) {
    if (isLowerSignalPath(value)) {
      deferred.push(value);
      continue;
    }
    important.push(value);
  }

  const ordered = important.length > 0 ? important.concat(deferred) : values;
  const preview = ordered.slice(0, maxItems);
  const hiddenValues = ordered.slice(maxItems);

  return {
    preview,
    hiddenCount: hiddenValues.length,
    hiddenLowerSignalCount: hiddenValues.filter((value) => isLowerSignalPath(value)).length,
  };
}

function formatHiddenReasonCount(hiddenCount: number, hiddenLowerSignalCount: number): string {
  if (hiddenCount <= 0) {
    return "";
  }

  if (hiddenLowerSignalCount === hiddenCount) {
    return `+${hiddenCount} more lower-signal file${hiddenCount === 1 ? "" : "s"}`;
  }

  if (hiddenLowerSignalCount > 0) {
    return `+${hiddenCount} more (${hiddenLowerSignalCount} lower-signal)`;
  }

  return `+${hiddenCount} more`;
}

function renderTriggerReasons(
  reasons: string[],
  severity: string,
  stream: NodeJS.WriteStream | undefined,
): string[] {
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
    const labelText = colorByTone(stream, "muted", label);

    if (values.length === 1) {
      summary.push(`  - ${labelText}: ${values[0]}`);
      continue;
    }

    if ((severity ?? "").toLowerCase() === "high") {
      summary.push(`  - ${labelText}:`);
      for (const value of values) {
        const renderedValue = isLowerSignalPath(value)
          ? colorByTone(stream, "muted", value)
          : value;
        summary.push(`    - ${renderedValue}`);
      }
      continue;
    }

    const { preview, hiddenCount, hiddenLowerSignalCount } = summarizeReasonValues(values);
    const suffix = formatHiddenReasonCount(hiddenCount, hiddenLowerSignalCount);
    const line = `  - ${labelText}: ${values.length} items. Examples: ${preview.join(", ")}${suffix ? `, ${suffix}` : ""}`;
    summary.push(line);
  }

  return [
    ...summary,
    ...passthrough.map((reason) => `  - ${reason}`),
  ];
}

function renderKeyValueTable(
  rows: ReviewTableRow[],
  stream: NodeJS.WriteStream | undefined,
): string[] {
  const normalized = rows.filter((row) => row.value.trim().length > 0);
  if (normalized.length === 0) {
    return [];
  }

  const keyWidth = Math.max(...normalized.map((row) => row.key.length));
  const valueWidth = Math.max(...normalized.map((row) => row.value.length));
  const border = `+${"-".repeat(keyWidth + 2)}+${"-".repeat(valueWidth + 2)}+`;

  return [
    colorByTone(stream, "muted", border),
    ...normalized.map((row) => {
      const key = colorByTone(stream, "muted", row.key.padEnd(keyWidth));
      const value = colorByTone(stream, row.tone, row.value.padEnd(valueWidth));
      return `| ${key} | ${value} |`;
    }),
    colorByTone(stream, "muted", border),
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

function parseOversizedMetricSummary(triggers: ReviewTrigger[]): OversizedMetricSummary {
  const summary: OversizedMetricSummary = {};
  const patterns: Array<{ key: OversizedMetricKey; regex: RegExp }> = [
    { key: "file_count", regex: /^diff touched (\d+) files \(threshold:\s*(\d+)\)$/i },
    { key: "added_lines", regex: /^diff added (\d+) lines \(threshold:\s*(\d+)\)$/i },
    { key: "deleted_lines", regex: /^diff deleted (\d+) lines \(threshold:\s*(\d+)\)$/i },
  ];

  for (const trigger of triggers) {
    for (const reason of trigger.reasons ?? []) {
      for (const { key, regex } of patterns) {
        const match = reason.match(regex);
        if (!match) {
          continue;
        }

        summary[key] = {
          actual: Number(match[1]),
          threshold: Number(match[2]),
          severity: trigger.severity,
        };
      }
    }
  }

  return summary;
}

function formatDiffMetric(
  actual: number | undefined,
  metric: { actual: number; threshold: number; severity: string } | undefined,
): { value: string; tone?: ReviewTone } {
  if (actual === undefined) {
    return { value: "" };
  }

  if (!metric) {
    return { value: String(actual) };
  }

  const value = `${actual} (limit ${metric.threshold})`;
  return {
    value,
    tone: severityToTone(metric.severity),
  };
}

function printReviewReport(report: ReviewReport, ownershipRouting?: OwnershipRoutingContext | null): void {
  const stream = process.stdout;
  const committedFiles = report.committed_files ?? report.changed_files ?? [];
  const triggers = report.triggers ?? [];
  const highestSeverity = highestTriggerSeverity(triggers);
  const intent = summarizeReviewIntent(triggers);
  const diffStats = report.diff_stats;
  const oversizedMetrics = parseOversizedMetricSummary(triggers);
  const workingTreeFiles = report.working_tree_files ?? [];
  const untrackedFiles = report.untracked_files ?? [];
  const residueSummary = [
    workingTreeFiles.length > 0 ? `${workingTreeFiles.length} tracked` : "",
    untrackedFiles.length > 0 ? `${untrackedFiles.length} untracked` : "",
  ]
    .filter(Boolean)
    .join(", ");

  console.log(
    colorByTone(
      stream,
      highestSeverity ? severityToTone(highestSeverity) : intent.tone,
      `${intent.label}: ${triggers.length} trigger${triggers.length === 1 ? "" : "s"} across ${committedFiles.length} committed file${committedFiles.length === 1 ? "" : "s"}.`,
    ),
  );
  for (const line of renderKeyValueTable([
    { key: "Base", value: report.base ?? "unknown", tone: "info" },
    { key: "Committed files", value: String(committedFiles.length), tone: triggers.length > 0 ? severityToTone(highestSeverity) : undefined },
    { key: "Trigger count", value: String(triggers.length), tone: triggers.length > 0 ? severityToTone(highestSeverity) : undefined },
    { key: "Diff files", ...formatDiffMetric(diffStats?.file_count, oversizedMetrics.file_count) },
    { key: "Added lines", ...formatDiffMetric(diffStats?.added_lines, oversizedMetrics.added_lines) },
    { key: "Deleted lines", ...formatDiffMetric(diffStats?.deleted_lines, oversizedMetrics.deleted_lines) },
    { key: "Workspace residue", value: residueSummary, tone: residueSummary ? "warning" : undefined },
    { key: "Touched owners", value: summarizeValueList(ownershipRouting?.touchedOwners ?? []), tone: "info" },
    { key: "Unowned changed", value: summarizeValueList(ownershipRouting?.unownedChangedFiles ?? []), tone: (ownershipRouting?.unownedChangedFiles?.length ?? 0) > 0 ? "danger" : undefined },
    { key: "Overlap changed", value: summarizeValueList(ownershipRouting?.overlappingChangedFiles ?? []), tone: (ownershipRouting?.overlappingChangedFiles?.length ?? 0) > 0 ? "warning" : undefined },
    { key: "Cross-owner triggers", value: summarizeValueList(ownershipRouting?.crossOwnerTriggers ?? []), tone: (ownershipRouting?.crossOwnerTriggers?.length ?? 0) > 0 ? "warning" : undefined },
  ], stream)) {
    console.log(line);
  }
  if (triggers.length > 0) {
    console.log(colorByTone(stream, "info", "Matched triggers:"));
  }
  for (const trigger of triggers) {
    const reasons = renderTriggerReasons(trigger.reasons ?? [], trigger.severity, stream);
    const title = titleCaseTriggerName(trigger.name);
    const reasonCount = trigger.reasons?.length ?? 0;
    const severityLabel = colorByTone(stream, severityToTone(trigger.severity), `[${trigger.severity.toUpperCase()}]`);
    console.log(`- ${severityLabel} ${title}${reasonCount > 0 ? ` (${reasonCount} signal${reasonCount === 1 ? "" : "s"})` : ""}`);
    for (const reason of reasons) {
      console.log(reason);
    }
  }
  if (workingTreeFiles.length > 0 || untrackedFiles.length > 0) {
    console.log("");
    console.log(colorByTone(stream, "warning", "Local workspace residue excluded from push review:"));
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

  const triggers = report.triggers ?? [];
  const advisoryTriggers = triggers.filter((trigger) => normalizeTriggerAction(trigger.action) === "advisory");
  const directBlockTriggers = triggers.filter((trigger) => normalizeTriggerAction(trigger.action) === "block");
  const humanReviewTriggers = triggers.filter((trigger) => normalizeTriggerAction(trigger.action) === "require_human_review");
  const stagedTriggers = triggers.filter((trigger) => normalizeTriggerAction(trigger.action) === "staged");

  if (directBlockTriggers.length > 0) {
    const message = buildActionMessage(
      "Review trigger blocked the push",
      directBlockTriggers,
      "The configured trigger action is block.",
    );
    if (outputMode === "human") {
      console.log(message);
      console.log("");
    }
    return buildResultBase(base, report, "blocked", false, false, ownershipRouting, message);
  }

  if (humanReviewTriggers.length > 0) {
    const message = buildActionMessage(
      "Human review required before push",
      humanReviewTriggers,
      "The matched trigger configuration requires manual review.",
    );
    if (outputMode === "human") {
      console.log(message);
      console.log("");
    }
    return buildResultBase(base, report, "blocked", false, false, ownershipRouting, message);
  }

  if (stagedTriggers.length === 0) {
    const message = advisoryTriggers.length > 0
      ? buildActionMessage("Review advisory", advisoryTriggers, "Push allowed.")
      : "No blocking review action matched.";
    if (outputMode === "human") {
      console.log(message);
      console.log("");
    }
    return buildResultBase(base, report, "passed", true, false, ownershipRouting, message);
  }

  try {
    const advisoryNotes = advisoryTriggers.length > 0
      ? [buildActionMessage("Review advisory", advisoryTriggers, "Push allowed.")]
      : [];
    const routingNotes: string[] = [];
    const stagedGroups = buildStagedReviewGroups(stagedTriggers);
    const passNotes: string[] = [];

    for (const group of stagedGroups) {
      const reviewLayers = buildResolvedStagedReviewLayers(group);
      const layeredReview = reviewLayers.length > 1;

      for (const [layerIndex, layer] of reviewLayers.entries()) {
        const layerLabel = formatReviewLayerLabel(layerIndex, reviewLayers.length);
        const decision = await runReviewTriggerSpecialist({
          reviewRoot,
          base,
          report: {
            ...report,
            triggers: group.triggers,
            ownership_routing: ownershipRouting,
          },
          overrides: {
            context: layer.context,
            model: layer.model,
            provider: layer.provider,
            specialistId: layer.specialistId,
          },
        });
        const decisionOutcome = decision.outcome ?? (decision.allowed ? "pass" : "block");
        const decisionConfidence = decision.confidence ?? null;
        const lowConfidence =
          decisionConfidence === null || decisionConfidence < layer.confidenceThreshold;
        const shouldFallback = decisionOutcome === "escalate" || lowConfidence;
        const triggerSummary = summarizeTriggerTitles(group.triggers);
        const decisionSummary = layeredReview ? `${layerLabel}: ${decision.summary}` : decision.summary;

        if (outputMode === "human") {
          console.log(decisionSummary);
          printDecisionFindings(decision.findings);
          console.log("");
        }

        if (decisionOutcome === "block") {
          return buildResultBase(
            base,
            report,
            "blocked",
            false,
            false,
            ownershipRouting,
            decisionSummary,
          );
        }

        if (shouldFallback && layerIndex < reviewLayers.length - 1) {
          if (decisionOutcome === "escalate") {
            routingNotes.push(`${decisionSummary} ${layerLabel} requested escalation for ${triggerSummary}. Moving to the next review layer.`);
            continue;
          }

          if (decisionConfidence === null) {
            routingNotes.push(`${decisionSummary} ${layerLabel} did not return usable confidence for ${triggerSummary}. Moving to the next review layer.`);
            continue;
          }

          routingNotes.push(`${decisionSummary} ${layerLabel} confidence ${decisionConfidence}/10 was below the required ${layer.confidenceThreshold}/10 for ${triggerSummary}. Moving to the next review layer.`);
          continue;
        }

        if (shouldFallback) {
          const fallbackAction = group.fallbackAction;
          const suffix = decisionOutcome === "escalate"
            ? `${layerLabel} requested escalation for ${triggerSummary}.`
            : decisionConfidence === null
              ? `${layerLabel} did not return usable confidence for ${triggerSummary}.`
              : `${layerLabel} confidence ${decisionConfidence}/10 was below the required ${layer.confidenceThreshold}/10 for ${triggerSummary}.`;

          if (fallbackAction === "advisory") {
            advisoryNotes.push(`${decisionSummary} ${suffix} Advisory fallback applied.`);
            break;
          }

          if (fallbackAction === "block") {
            const message = `${decisionSummary} ${suffix} Blocking fallback applied.`;
            return buildResultBase(base, report, "blocked", false, false, ownershipRouting, message);
          }

          const message = `${decisionSummary} ${suffix} Human review fallback required.`;
          return buildResultBase(base, report, "blocked", false, false, ownershipRouting, message);
        }

        if (decisionOutcome === "advisory") {
          advisoryNotes.push(decisionSummary);
          break;
        }

        passNotes.push(decisionSummary);
        break;
      }
    }

    const message = [...advisoryNotes, ...routingNotes, ...passNotes].filter(Boolean).join(" ").trim()
      || "Automatic review specialist approved the push.";
    return buildResultBase(base, report, "passed", true, false, ownershipRouting, message);
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
  const entrixBase = `${reviewBase}...HEAD`;
  const reviewCommand = resolveEntrixShellCommand(
    [
      "review-trigger",
      "--base",
      entrixBase,
      "--json",
      "--fail-on-trigger",
      ...scopeFiles.committedFiles,
    ],
    reviewRoot,
  );

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
