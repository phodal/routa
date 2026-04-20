import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import { execFile as execFileCallback } from "child_process";
import { promisify } from "util";
import yaml from "js-yaml";
import type { Schedule } from "@/core/models/schedule";
import type {
  HarnessAutomationDefinitionSummary,
  HarnessAutomationPendingSignal,
  HarnessAutomationRecentRun,
  HarnessAutomationResponse,
  HarnessAutomationRuntimeStatus,
  HarnessAutomationSeverity,
  HarnessAutomationSourceType,
  HarnessAutomationTargetType,
} from "./automation-types";

type AutomationSourceConfig = {
  type?: string;
  findingType?: string;
  cron?: string;
  timezone?: string;
  maxItems?: number;
  minLines?: number;
  deferUntilCron?: string;
};

type AutomationTargetConfig = {
  type?: string;
  ref?: string;
  prompt?: string;
  agentId?: string;
};

type AutomationRuntimeConfig = {
  scheduleId?: string;
  scheduleName?: string;
};

type AutomationDefinitionConfig = {
  id?: string;
  name?: string;
  description?: string;
  source?: AutomationSourceConfig;
  target?: AutomationTargetConfig;
  runtime?: AutomationRuntimeConfig;
};

type AutomationConfigFile = {
  schema?: string;
  definitions?: AutomationDefinitionConfig[];
};

type FileBudgetOverride = {
  path?: string;
  max_lines?: number;
  reason?: string;
};

type FileBudgetConfig = {
  default_max_lines?: number;
  include_roots?: string[];
  extensions?: string[];
  extension_max_lines?: Record<string, number>;
  excluded_parts?: string[];
  overrides?: FileBudgetOverride[];
};

type LongFileFinding = {
  relativePath: string;
  lineCount: number;
  budgetLimit: number;
  excessLines: number;
  severity: HarnessAutomationSeverity;
  reason?: string;
};

type DetectHarnessAutomationsOptions = {
  schedules?: Schedule[];
};

const AUTOMATION_CONFIG_RELATIVE_PATH = path.join("docs", "harness", "automations.yml");
const FILE_BUDGETS_RELATIVE_PATH = path.join("docs", "fitness", "file_budgets.json");
const ISSUE_SCANNER_RELATIVE_PATH = path.join(".github", "scripts", "issue-scanner.py");
const DEFAULT_FILE_BUDGETS: FileBudgetConfig = {
  default_max_lines: 1600,
  include_roots: ["src", "apps", "crates"],
  extensions: [".ts", ".tsx", ".rs"],
  extension_max_lines: {
    ".rs": 1600,
    ".ts": 1600,
    ".tsx": 1600,
  },
  excluded_parts: ["/node_modules/", "/target/", "/.next/", "/_next/", "/bundled/"],
  overrides: [],
};
const execFile = promisify(execFileCallback);

type IssueScannerSuspect = {
  file_a?: string;
  file_b?: string | null;
  reason?: string;
  type?: string;
};

function joinRepoPath(repoRoot: string, ...relativeSegments: string[]) {
  return path.join(/* turbopackIgnore: true */ repoRoot, ...relativeSegments);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toIsoString(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  return undefined;
}

function summarizeTarget(target: AutomationTargetConfig | undefined, type: HarnessAutomationTargetType) {
  const ref = normalizeString(target?.ref);
  const agentId = normalizeString(target?.agentId);
  const prompt = normalizeString(target?.prompt);
  const suffix = ref ?? agentId ?? (prompt ? prompt.slice(0, 72) : "Unbound");
  switch (type) {
    case "specialist":
      return `Specialist · ${suffix}`;
    case "workflow":
      return `Workflow · ${suffix}`;
    case "background-task":
      return `Background task · ${suffix}`;
  }
}

function summarizeSource(source: AutomationSourceConfig | undefined, type: HarnessAutomationSourceType) {
  if (type === "schedule") {
    const cron = normalizeString(source?.cron) ?? "No cron";
    const timezone = normalizeString(source?.timezone);
    return timezone ? `${cron} · ${timezone}` : cron;
  }

  if (type === "finding") {
    const findingType = normalizeString(source?.findingType) ?? "generic";
    if (findingType === "issue-suspect") {
      const deferUntilCron = normalizeString(source?.deferUntilCron);
      return deferUntilCron
        ? `issue-suspect · docs/issues scan · defer ${deferUntilCron}`
        : "issue-suspect · docs/issues scan";
    }
    const minLines = normalizeNumber(source?.minLines);
    const deferUntilCron = normalizeString(source?.deferUntilCron);
    const linePart = minLines ? `>= ${minLines} lines` : "budget overrun";
    return deferUntilCron
      ? `${findingType} · ${linePart} · defer ${deferUntilCron}`
      : `${findingType} · ${linePart}`;
  }

  return normalizeString(source?.type) ?? type;
}

function classifySeverity(excessLines: number): HarnessAutomationSeverity {
  if (excessLines >= 250) {
    return "high";
  }
  if (excessLines >= 100) {
    return "medium";
  }
  return "low";
}

function walkFiles(dir: string, collected: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolutePath, collected);
      continue;
    }
    if (entry.isFile()) {
      collected.push(absolutePath);
    }
  }
}

async function loadFileBudgets(repoRoot: string, warnings: string[]) {
  const absolutePath = joinRepoPath(repoRoot, FILE_BUDGETS_RELATIVE_PATH);
  if (!fs.existsSync(absolutePath)) {
    warnings.push(`Missing ${FILE_BUDGETS_RELATIVE_PATH}; using default long-file budget thresholds.`);
    return DEFAULT_FILE_BUDGETS;
  }

  try {
    const raw = await fsp.readFile(absolutePath, "utf-8");
    const parsed = JSON.parse(raw) as FileBudgetConfig;
    return {
      ...DEFAULT_FILE_BUDGETS,
      ...parsed,
      extension_max_lines: {
        ...(DEFAULT_FILE_BUDGETS.extension_max_lines ?? {}),
        ...(parsed.extension_max_lines ?? {}),
      },
      overrides: Array.isArray(parsed.overrides) ? parsed.overrides : [],
    } satisfies FileBudgetConfig;
  } catch (error) {
    warnings.push(`Failed to parse ${FILE_BUDGETS_RELATIVE_PATH}: ${toMessage(error)}`);
    return DEFAULT_FILE_BUDGETS;
  }
}

function shouldIncludeFile(relativePath: string, config: FileBudgetConfig) {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const extension = path.extname(normalizedPath).toLowerCase();
  const includeRoots = config.include_roots ?? DEFAULT_FILE_BUDGETS.include_roots ?? [];
  const extensions = config.extensions ?? DEFAULT_FILE_BUDGETS.extensions ?? [];
  const excludedParts = config.excluded_parts ?? DEFAULT_FILE_BUDGETS.excluded_parts ?? [];

  if (!extensions.includes(extension)) {
    return false;
  }

  if (!includeRoots.some((root) => normalizedPath === root || normalizedPath.startsWith(`${root}/`))) {
    return false;
  }

  return !excludedParts.some((part) => normalizedPath.includes(part));
}

function resolveBudget(relativePath: string, extension: string, config: FileBudgetConfig) {
  const override = (config.overrides ?? []).find((candidate) => normalizeString(candidate.path) === relativePath);
  if (override && typeof override.max_lines === "number") {
    return {
      budgetLimit: override.max_lines,
      reason: normalizeString(override.reason),
    };
  }

  return {
    budgetLimit: config.extension_max_lines?.[extension] ?? config.default_max_lines ?? DEFAULT_FILE_BUDGETS.default_max_lines ?? 1600,
    reason: undefined,
  };
}

async function detectLongFileFindings(repoRoot: string, warnings: string[]) {
  const config = await loadFileBudgets(repoRoot, warnings);
  const candidates: string[] = [];
  for (const root of config.include_roots ?? DEFAULT_FILE_BUDGETS.include_roots ?? []) {
    const absoluteRoot = joinRepoPath(repoRoot, root);
    if (fs.existsSync(absoluteRoot) && fs.statSync(absoluteRoot).isDirectory()) {
      walkFiles(absoluteRoot, candidates);
    }
  }

  const findings: LongFileFinding[] = [];
  for (const absolutePath of candidates) {
    const relativePath = path.relative(repoRoot, absolutePath).replace(/\\/g, "/");
    if (!shouldIncludeFile(relativePath, config)) {
      continue;
    }

    let source: string;
    try {
      source = await fsp.readFile(absolutePath, "utf-8");
    } catch {
      continue;
    }

    const extension = path.extname(relativePath).toLowerCase();
    const lineCount = source.split(/\r?\n/).length;
    const { budgetLimit, reason } = resolveBudget(relativePath, extension, config);
    if (lineCount <= budgetLimit) {
      continue;
    }

    findings.push({
      relativePath,
      lineCount,
      budgetLimit,
      excessLines: lineCount - budgetLimit,
      severity: classifySeverity(lineCount - budgetLimit),
      reason,
    });
  }

  return findings.sort((left, right) => {
    if (right.excessLines !== left.excessLines) {
      return right.excessLines - left.excessLines;
    }
    return left.relativePath.localeCompare(right.relativePath);
  });
}

function classifyIssueSuspectSeverity(type: string | undefined): HarnessAutomationSeverity {
  switch (type) {
    case "stale":
      return "high";
    case "duplicate":
      return "medium";
    case "open_check":
      return "low";
    default:
      return "medium";
  }
}

async function detectIssueScannerSuspects(repoRoot: string, warnings: string[]) {
  const absolutePath = joinRepoPath(repoRoot, ISSUE_SCANNER_RELATIVE_PATH);
  if (!fs.existsSync(absolutePath)) {
    warnings.push(`Missing ${ISSUE_SCANNER_RELATIVE_PATH}; issue cleanup suspects are unavailable.`);
    return [] as IssueScannerSuspect[];
  }

  try {
    // On Windows, `python3` is a Microsoft Store alias that does not work with
    // Node.js execFile; fall back to `python`.
    const pythonBin = process.platform === "win32" ? "python" : "python3";
    const { stdout } = await execFile(pythonBin, [absolutePath, "--suspects-only"], {
      cwd: repoRoot,
      maxBuffer: 8 * 1024 * 1024,
    });
    const trimmed = stdout.trim();
    if (!trimmed || trimmed === "No suspects found.") {
      return [] as IssueScannerSuspect[];
    }

    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      warnings.push(`Unexpected output from ${ISSUE_SCANNER_RELATIVE_PATH} --suspects-only; expected a JSON array.`);
      return [] as IssueScannerSuspect[];
    }
    return parsed.filter((candidate): candidate is IssueScannerSuspect => typeof candidate === "object" && candidate !== null);
  } catch (error) {
    warnings.push(`Failed to run ${ISSUE_SCANNER_RELATIVE_PATH} --suspects-only: ${toMessage(error)}`);
    return [] as IssueScannerSuspect[];
  }
}

function normalizeSourceType(value: unknown): HarnessAutomationSourceType | null {
  const normalized = normalizeString(value);
  switch (normalized) {
    case "finding":
    case "schedule":
    case "review-signal":
    case "external-event":
      return normalized;
    default:
      return null;
  }
}

function normalizeTargetType(value: unknown): HarnessAutomationTargetType | null {
  const normalized = normalizeString(value);
  switch (normalized) {
    case "specialist":
    case "workflow":
    case "background-task":
      return normalized;
    default:
      return null;
  }
}

function resolveRuntimeBinding(definition: AutomationDefinitionConfig) {
  return normalizeString(definition.runtime?.scheduleId)
    ?? normalizeString(definition.runtime?.scheduleName)
    ?? normalizeString(definition.name)
    ?? normalizeString(definition.id);
}

function matchRuntimeSchedule(definition: AutomationDefinitionConfig, schedules: Schedule[]) {
  const scheduleId = normalizeString(definition.runtime?.scheduleId);
  const scheduleName = normalizeString(definition.runtime?.scheduleName);
  return schedules.find((schedule) => {
    if (scheduleId && schedule.id === scheduleId) {
      return true;
    }
    if (scheduleName && schedule.name === scheduleName) {
      return true;
    }
    return false;
  });
}

function buildRecentRun(schedule: Schedule, automationId: string, automationName: string): HarnessAutomationRecentRun {
  return {
    automationId,
    automationName,
    sourceType: "schedule",
    runtimeBinding: schedule.name,
    status: schedule.enabled ? (schedule.nextRunAt ? "active" : "idle") : "paused",
    cronExpr: schedule.cronExpr,
    lastRunAt: toIsoString(schedule.lastRunAt),
    nextRunAt: toIsoString(schedule.nextRunAt),
    lastTaskId: normalizeString(schedule.lastTaskId),
  };
}

function buildPendingSignals(
  definition: AutomationDefinitionConfig,
  automationId: string,
  automationName: string,
  findings: LongFileFinding[],
  issueScannerSuspects: IssueScannerSuspect[],
) {
  const findingType = normalizeString(definition.source?.findingType);
  if (findingType === "issue-suspect") {
    const maxItems = normalizeNumber(definition.source?.maxItems) ?? issueScannerSuspects.length;
    const deferUntilCron = normalizeString(definition.source?.deferUntilCron);
    return issueScannerSuspects
      .slice(0, maxItems)
      .map((suspect, index) => {
        const primaryFile = normalizeString(suspect.file_a) ?? `suspect-${index + 1}.md`;
        const secondaryFile = normalizeString(suspect.file_b ?? undefined);
        const reason = normalizeString(suspect.reason) ?? "Issue scanner flagged this item for cleanup review.";
        const signalType = normalizeString(suspect.type) ?? "issue-suspect";
        return {
          id: `${automationId}:${primaryFile}:${index}`,
          automationId,
          automationName,
          signalType,
          title: primaryFile,
          summary: secondaryFile ? `${reason} Compare with ${secondaryFile}.` : reason,
          severity: classifyIssueSuspectSeverity(signalType),
          relativePath: path.posix.join("docs/issues", primaryFile),
          deferUntilCron,
        } satisfies HarnessAutomationPendingSignal;
      });
  }

  if (findingType && findingType !== "long-file") {
    return [];
  }

  const minLines = normalizeNumber(definition.source?.minLines);
  const maxItems = normalizeNumber(definition.source?.maxItems) ?? findings.length;
  const deferUntilCron = normalizeString(definition.source?.deferUntilCron);

  return findings
    .filter((finding) => (minLines ? finding.lineCount >= minLines : true))
    .slice(0, maxItems)
    .map((finding) => ({
      id: `${automationId}:${finding.relativePath}`,
      automationId,
      automationName,
      signalType: "long-file",
      title: path.basename(finding.relativePath),
      summary: `${finding.lineCount} lines vs budget ${finding.budgetLimit} (+${finding.excessLines})`,
      severity: finding.severity,
      relativePath: finding.relativePath,
      lineCount: finding.lineCount,
      budgetLimit: finding.budgetLimit,
      excessLines: finding.excessLines,
      deferUntilCron,
    } satisfies HarnessAutomationPendingSignal));
}

function computeDefinitionStatus(sourceType: HarnessAutomationSourceType, pendingCount: number, schedule: Schedule | undefined): HarnessAutomationRuntimeStatus {
  if (sourceType === "finding") {
    return pendingCount > 0 ? "pending" : "clear";
  }

  if (!schedule) {
    return "definition-only";
  }

  if (!schedule.enabled) {
    return "paused";
  }

  return schedule.nextRunAt ? "active" : "idle";
}

function normalizeDefinition(definition: AutomationDefinitionConfig, index: number, warnings: string[]) {
  const id = normalizeString(definition.id);
  const name = normalizeString(definition.name);
  const sourceType = normalizeSourceType(definition.source?.type);
  const targetType = normalizeTargetType(definition.target?.type);

  if (!id) {
    warnings.push(`Skipping automation definition at index ${index}: missing id.`);
    return null;
  }
  if (!sourceType) {
    warnings.push(`Skipping automation "${id}": unsupported source type "${String(definition.source?.type ?? "")}".`);
    return null;
  }
  if (!targetType) {
    warnings.push(`Skipping automation "${id}": unsupported target type "${String(definition.target?.type ?? "")}".`);
    return null;
  }

  return {
    id,
    name: name ?? id,
    description: normalizeString(definition.description) ?? "",
    sourceType,
    targetType,
  };
}

async function loadAutomationConfig(repoRoot: string, warnings: string[]) {
  const absolutePath = joinRepoPath(repoRoot, AUTOMATION_CONFIG_RELATIVE_PATH);
  if (!fs.existsSync(absolutePath)) {
    warnings.push(`No "${AUTOMATION_CONFIG_RELATIVE_PATH}" file found for this repository.`);
    return {
      configFile: null,
      definitions: [],
    };
  }

  try {
    const source = await fsp.readFile(absolutePath, "utf-8");
    const parsed = (yaml.load(source) ?? {}) as AutomationConfigFile;
    const definitions = Array.isArray(parsed.definitions) ? parsed.definitions : [];
    return {
      configFile: {
        relativePath: AUTOMATION_CONFIG_RELATIVE_PATH,
        source,
        schema: normalizeString(parsed.schema),
      },
      definitions,
    };
  } catch (error) {
    warnings.push(`Failed to load ${AUTOMATION_CONFIG_RELATIVE_PATH}: ${toMessage(error)}`);
    return {
      configFile: null,
      definitions: [],
    };
  }
}

export async function detectHarnessAutomations(
  repoRoot: string,
  options: DetectHarnessAutomationsOptions = {},
): Promise<HarnessAutomationResponse> {
  const warnings: string[] = [];
  const { configFile, definitions } = await loadAutomationConfig(repoRoot, warnings);
  const schedules = options.schedules ?? [];
  const findingDefinitions = definitions.filter((definition) => normalizeString(definition.source?.type) === "finding");
  const longFileFindings = findingDefinitions.some((definition) => {
    const findingType = normalizeString(definition.source?.findingType);
    return !findingType || findingType === "long-file";
  })
    ? await detectLongFileFindings(repoRoot, warnings)
    : [];
  const issueScannerSuspects = findingDefinitions.some((definition) => normalizeString(definition.source?.findingType) === "issue-suspect")
    ? await detectIssueScannerSuspects(repoRoot, warnings)
    : [];

  const summaries: HarnessAutomationDefinitionSummary[] = [];
  const pendingSignals: HarnessAutomationPendingSignal[] = [];
  const recentRuns: HarnessAutomationRecentRun[] = [];

  definitions.forEach((definition, index) => {
    const normalized = normalizeDefinition(definition, index, warnings);
    if (!normalized) {
      return;
    }

    const matchedSchedule = normalized.sourceType === "schedule"
      ? matchRuntimeSchedule(definition, schedules)
      : undefined;
    const definitionPendingSignals = normalized.sourceType === "finding"
      ? buildPendingSignals(definition, normalized.id, normalized.name, longFileFindings, issueScannerSuspects)
      : [];
    const runtimeStatus = computeDefinitionStatus(normalized.sourceType, definitionPendingSignals.length, matchedSchedule);
    const runtimeBinding = normalizeString(resolveRuntimeBinding(definition));

    summaries.push({
      id: normalized.id,
      name: normalized.name,
      description: normalized.description,
      sourceType: normalized.sourceType,
      sourceLabel: summarizeSource(definition.source, normalized.sourceType),
      targetType: normalized.targetType,
      targetLabel: summarizeTarget(definition.target, normalized.targetType),
      runtimeStatus,
      pendingCount: definitionPendingSignals.length,
      configPath: AUTOMATION_CONFIG_RELATIVE_PATH,
      runtimeBinding,
      cronExpr: normalizeString(definition.source?.cron) ?? matchedSchedule?.cronExpr,
      nextRunAt: toIsoString(matchedSchedule?.nextRunAt),
      lastRunAt: toIsoString(matchedSchedule?.lastRunAt),
    });

    pendingSignals.push(...definitionPendingSignals);
    if (matchedSchedule) {
      recentRuns.push(buildRecentRun(matchedSchedule, normalized.id, normalized.name));
    }
  });

  recentRuns.sort((left, right) => {
    const rightStamp = right.lastRunAt ?? right.nextRunAt ?? "";
    const leftStamp = left.lastRunAt ?? left.nextRunAt ?? "";
    return rightStamp.localeCompare(leftStamp);
  });

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    configFile,
    definitions: summaries,
    pendingSignals,
    recentRuns,
    warnings,
  };
}
