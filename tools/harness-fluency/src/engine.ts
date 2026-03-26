import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

import { glob } from "glob";
import { load as loadYaml } from "js-yaml";

import {
  CELL_PASS_THRESHOLD,
  DEFAULT_PROFILE,
  MAX_REGEX_INPUT_LENGTH,
  type CellResult,
  type CliOptions,
  type CriterionResult,
  type DetectorDefinition,
  DETERMINISTIC_PRIORITY,
  type DimensionResult,
  type EvaluateOptions,
  type FluencyCriterion,
  type HarnessFluencyReport,
  loadFluencyModel,
  parseArgs,
  type Recommendation,
  renderHelp,
  type ReportComparison,
} from "./model.js";

type EvaluationContext = {
  repoRoot: string;
  textCache: Map<string, Promise<string>>;
  jsonCache: Map<string, Promise<unknown>>;
  yamlCache: Map<string, Promise<unknown>>;
};

type CommandExecutionResult = {
  exitCode: number;
  output: string;
  timedOut: boolean;
};

type MutableCellAccumulator = {
  id: string;
  level: string;
  levelName: string;
  dimension: string;
  dimensionName: string;
  criteria: CriterionResult[];
};

const ALLOWED_COMMAND_EXECUTABLES = new Set([
  "cargo",
  "entrix",
  "git",
  "node",
  "npm",
  "npx",
  "pnpm",
  "python",
  "python3",
  "uv",
]);
const DEFAULT_GLOB_IGNORE: string[] = [
  "**/.git/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.pnpm-store/**",
  "**/.pytest_cache/**",
  "**/.ruff_cache/**",
  "**/.turbo/**",
  "**/.venv/**",
  "**/__pycache__/**",
  "**/build/**",
  "**/coverage/**",
  "**/dist/**",
  "**/node_modules/**",
  "**/target/**",
  "**/venv/**",
  "**/vendor/**",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildCellId(level: string, dimension: string): string {
  return `${dimension}:${level}`;
}

function toAbsolutePath(basePath: string, targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(basePath, targetPath);
}

function parseCommand(command: string): { executable: string; args: string[] } {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaping = false;

  const pushCurrent = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  };

  for (const char of command) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }

    current += char;
  }

  if (escaping || quote) {
    throw new Error("command contains unterminated escaping or quotes");
  }

  pushCurrent();
  if (tokens.length === 0) {
    throw new Error("command must not be empty");
  }

  return {
    executable: tokens[0],
    args: tokens.slice(1),
  };
}

function validateExecutable(executable: string): void {
  if (executable.includes("/") || executable.includes("\\")) {
    throw new Error(`command executable "${executable}" must be a bare allowlisted name`);
  }

  const commandName = path.basename(executable);
  if (!ALLOWED_COMMAND_EXECUTABLES.has(commandName)) {
    throw new Error(`command executable "${commandName}" is not allowed`);
  }
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

function testRegexAgainstText(pattern: string, flags: string, text: string): boolean {
  return new RegExp(pattern, flags).test(text.slice(0, MAX_REGEX_INPUT_LENGTH));
}

function lookupPath(source: unknown, spec: readonly (string | number)[]): unknown {
  let current = source;
  for (const segment of spec) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || current[segment] === undefined) {
        return undefined;
      }
      current = current[segment];
      continue;
    }

    if (!isRecord(current) && !Array.isArray(current)) {
      return undefined;
    }

    const value = (current as Record<string, unknown>)[segment];
    if (value === undefined) {
      return undefined;
    }
    current = value;
  }
  return current;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readStructuredFile<T>(
  cache: Map<string, Promise<T>>,
  targetPath: string,
  parser: (content: string) => T,
): Promise<T> {
  const cached = cache.get(targetPath);
  if (cached) {
    return cached;
  }

  const promise = readFile(targetPath, "utf8").then((content) => parser(content));
  cache.set(targetPath, promise);
  return promise;
}

async function readTextFile(context: EvaluationContext, relativePath: string): Promise<string> {
  const absolutePath = toAbsolutePath(context.repoRoot, relativePath);
  return readStructuredFile(context.textCache, absolutePath, (content) => content);
}

async function readJsonFile(context: EvaluationContext, relativePath: string): Promise<unknown> {
  const absolutePath = toAbsolutePath(context.repoRoot, relativePath);
  return readStructuredFile(context.jsonCache, absolutePath, (content) => JSON.parse(content));
}

async function readYamlFile(context: EvaluationContext, relativePath: string): Promise<unknown> {
  const absolutePath = toAbsolutePath(context.repoRoot, relativePath);
  return readStructuredFile(context.yamlCache, absolutePath, (content) => loadYaml(content));
}

async function collectGlobMatches(patterns: readonly string[], repoRoot: string, nodir: boolean): Promise<string[]> {
  const matches = new Set<string>();
  for (const patternText of patterns) {
    const found = await glob(patternText, {
      cwd: repoRoot,
      dot: true,
      ignore: DEFAULT_GLOB_IGNORE,
      nodir,
    });
    for (const match of found) {
      matches.add(match);
    }
  }

  return Array.from(matches).sort();
}

async function runCommand(command: string, repoRoot: string, timeoutMs: number): Promise<CommandExecutionResult> {
  const { executable, args } = parseCommand(command);
  validateExecutable(executable);

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: repoRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        output: output.trim(),
        timedOut,
      });
    });
  });
}

function buildCommandFailure(error: unknown): Pick<CriterionResult, "status" | "detail" | "evidence"> {
  return {
    status: "fail",
    detail: error instanceof Error ? error.message : String(error),
    evidence: [],
  };
}

async function evaluateDetector(
  detector: DetectorDefinition,
  context: EvaluationContext,
): Promise<Pick<CriterionResult, "status" | "detail" | "evidence">> {
  switch (detector.type) {
    case "file_exists": {
      const exists = await pathExists(toAbsolutePath(context.repoRoot, detector.path));
      return {
        status: exists ? "pass" : "fail",
        detail: exists ? `found ${detector.path}` : `missing ${detector.path}`,
        evidence: exists ? [detector.path] : [],
      };
    }
    case "file_contains_regex": {
      try {
        const content = await readTextFile(context, detector.path);
        const passed = testRegexAgainstText(detector.pattern, detector.flags, content);
        return {
          status: passed ? "pass" : "fail",
          detail: passed
            ? `content in ${detector.path} matched ${detector.pattern}`
            : `content in ${detector.path} did not match ${detector.pattern}`,
          evidence: passed ? [detector.path] : [],
        };
      } catch (error) {
        return {
          status: "fail",
          detail: `unable to read ${detector.path}: ${error instanceof Error ? error.message : String(error)}`,
          evidence: [],
        };
      }
    }
    case "any_of": {
      const failures: string[] = [];
      let skippedCount = 0;
      for (const nested of detector.detectors) {
        const result = await evaluateDetector(nested, context);
        if (result.status === "pass") {
          return {
            status: "pass",
            detail: `matched ${nested.type}: ${result.detail}`,
            evidence: result.evidence,
          };
        }

        if (result.status === "skipped") {
          skippedCount += 1;
        }
        failures.push(`${nested.type}: ${result.detail}`);
      }

      if (skippedCount === detector.detectors.length) {
        return {
          status: "skipped",
          detail: "all alternatives were skipped",
          evidence: [],
        };
      }

      return {
        status: "fail",
        detail: `all alternatives failed: ${failures.join(" | ")}`,
        evidence: [],
      };
    }
    case "any_file_exists": {
      const matched: string[] = [];
      for (const candidate of detector.paths) {
        if (await pathExists(toAbsolutePath(context.repoRoot, candidate))) {
          matched.push(candidate);
        }
      }
      return {
        status: matched.length > 0 ? "pass" : "fail",
        detail:
          matched.length > 0
            ? `found ${matched.join(", ")}`
            : `missing all candidates: ${detector.paths.join(", ")}`,
        evidence: matched,
      };
    }
    case "glob_count": {
      try {
        const matches = await collectGlobMatches(detector.patterns, context.repoRoot, false);

        return {
          status: matches.length >= detector.min ? "pass" : "fail",
          detail: `matched ${matches.length} paths (min ${detector.min})`,
          evidence: matches.slice(0, 10),
        };
      } catch (error) {
        return {
          status: "fail",
          detail: `glob failed: ${error instanceof Error ? error.message : String(error)}`,
          evidence: [],
        };
      }
    }
    case "glob_contains_regex": {
      try {
        const candidates = await collectGlobMatches(detector.patterns, context.repoRoot, true);
        const matched: string[] = [];
        for (const candidate of candidates) {
          const content = await readTextFile(context, candidate);
          if (testRegexAgainstText(detector.pattern, detector.flags, content)) {
            matched.push(candidate);
          }
          if (matched.length >= detector.minMatches) {
            break;
          }
        }

        return {
          status: matched.length >= detector.minMatches ? "pass" : "fail",
          detail: `regex matched ${matched.length} files (min ${detector.minMatches}) across ${candidates.length} candidates`,
          evidence: matched.slice(0, 10),
        };
      } catch (error) {
        return {
          status: "fail",
          detail: `glob regex failed: ${error instanceof Error ? error.message : String(error)}`,
          evidence: [],
        };
      }
    }
    case "json_path_exists": {
      try {
        const document = await readJsonFile(context, detector.path);
        const resolved = lookupPath(document, detector.jsonPath);
        return {
          status: resolved === undefined ? "fail" : "pass",
          detail:
            resolved === undefined
              ? `missing JSON path ${detector.jsonPath.join(".")} in ${detector.path}`
              : `found JSON path ${detector.jsonPath.join(".")} in ${detector.path}`,
          evidence: resolved === undefined ? [] : [detector.path],
        };
      } catch (error) {
        return {
          status: "fail",
          detail: `unable to read ${detector.path}: ${error instanceof Error ? error.message : String(error)}`,
          evidence: [],
        };
      }
    }
    case "yaml_path_exists": {
      try {
        const document = await readYamlFile(context, detector.path);
        const resolved = lookupPath(document, detector.yamlPath);
        return {
          status: resolved === undefined ? "fail" : "pass",
          detail:
            resolved === undefined
              ? `missing YAML path ${detector.yamlPath.join(".")} in ${detector.path}`
              : `found YAML path ${detector.yamlPath.join(".")} in ${detector.path}`,
          evidence: resolved === undefined ? [] : [detector.path],
        };
      } catch (error) {
        return {
          status: "fail",
          detail: `unable to read ${detector.path}: ${error instanceof Error ? error.message : String(error)}`,
          evidence: [],
        };
      }
    }
    case "command_exit_code": {
      let result: CommandExecutionResult;
      try {
        result = await runCommand(detector.command, context.repoRoot, detector.timeoutMs);
      } catch (error) {
        return buildCommandFailure(error);
      }

      return {
        status: result.exitCode === detector.expectedExitCode ? "pass" : "fail",
        detail: result.timedOut
          ? `command timed out after ${detector.timeoutMs}ms`
          : `exit code ${result.exitCode}, expected ${detector.expectedExitCode}`,
        evidence: result.output ? [result.output] : [],
      };
    }
    case "command_output_regex": {
      let result: CommandExecutionResult;
      try {
        result = await runCommand(detector.command, context.repoRoot, detector.timeoutMs);
      } catch (error) {
        return buildCommandFailure(error);
      }

      const passed =
        !result.timedOut &&
        result.exitCode === detector.expectedExitCode &&
        testRegexAgainstText(detector.pattern, detector.flags, result.output);
      return {
        status: passed ? "pass" : "fail",
        detail: result.timedOut
          ? `command timed out after ${detector.timeoutMs}ms`
          : passed
            ? `command output matched ${detector.pattern}`
            : `command output did not match ${detector.pattern}`,
        evidence: result.output ? [result.output] : [],
      };
    }
    case "manual_attestation":
      return {
        status: "skipped",
        detail: `manual attestation required: ${detector.prompt}`,
        evidence: [],
      };
    default:
      return {
        status: "fail",
        detail: `unsupported detector ${(detector as { type: string }).type}`,
        evidence: [],
      };
  }
}

async function evaluateCriterion(
  criterion: FluencyCriterion,
  context: EvaluationContext,
): Promise<CriterionResult> {
  const detectorResult = await evaluateDetector(criterion.detector, context);
  return {
    id: criterion.id,
    level: criterion.level,
    dimension: criterion.dimension,
    weight: criterion.weight,
    critical: criterion.critical,
    status: detectorResult.status,
    detectorType: criterion.detector.type,
    detail: detectorResult.detail,
    evidence: detectorResult.evidence,
    whyItMatters: criterion.whyItMatters,
    recommendedAction: criterion.recommendedAction,
    evidenceHint: criterion.evidenceHint,
  };
}

function compareLevelIds(
  previousLevel: string,
  currentLevel: string,
  order: Map<string, number>,
): "same" | "up" | "down" {
  const previousIndex = order.get(previousLevel) ?? -1;
  const currentIndex = order.get(currentLevel) ?? -1;
  if (previousIndex === currentIndex) {
    return "same";
  }
  return currentIndex > previousIndex ? "up" : "down";
}

function collectRecommendations(criteria: readonly CriterionResult[]): Recommendation[] {
  const deduped = new Set<string>();

  return criteria
    .filter((criterion) => criterion.status === "fail")
    .sort((left, right) => {
      if (left.critical !== right.critical) {
        return left.critical ? -1 : 1;
      }
      if (left.weight !== right.weight) {
        return right.weight - left.weight;
      }
      const detectorDelta = DETERMINISTIC_PRIORITY[left.detectorType] - DETERMINISTIC_PRIORITY[right.detectorType];
      if (detectorDelta !== 0) {
        return detectorDelta;
      }
      return left.id.localeCompare(right.id);
    })
    .filter((criterion) => {
      if (deduped.has(criterion.recommendedAction)) {
        return false;
      }
      deduped.add(criterion.recommendedAction);
      return true;
    })
    .slice(0, 5)
    .map((criterion) => ({
      criterionId: criterion.id,
      action: criterion.recommendedAction,
      whyItMatters: criterion.whyItMatters,
      evidenceHint: criterion.evidenceHint,
      critical: criterion.critical,
      weight: criterion.weight,
    }));
}

function averageCellScores(
  modelDimensions: readonly { id: string }[],
  cellById: ReadonlyMap<string, CellResult>,
  levelId: string,
): number {
  return (
    modelDimensions.reduce((total, dimension) => {
      return total + (cellById.get(buildCellId(levelId, dimension.id))?.score ?? 0);
    }, 0) / modelDimensions.length
  );
}

function collectFailingCriteriaForLevel(
  modelDimensions: readonly { id: string }[],
  cellById: ReadonlyMap<string, CellResult>,
  levelId: string,
): CriterionResult[] {
  return modelDimensions.flatMap((dimension) => {
    const cell = cellById.get(buildCellId(levelId, dimension.id));
    if (!cell || cell.passed) {
      return [];
    }

    return cell.criteria.filter((criterion) => criterion.status === "fail");
  });
}

async function loadPreviousSnapshot(snapshotPath: string): Promise<HarnessFluencyReport | null> {
  if (!(await pathExists(snapshotPath))) {
    return null;
  }
  return JSON.parse(await readFile(snapshotPath, "utf8")) as HarnessFluencyReport;
}

function buildComparison(
  previousReport: HarnessFluencyReport,
  currentReport: HarnessFluencyReport,
  levelOrder: Map<string, number>,
): ReportComparison {
  const dimensionChanges = Object.values(currentReport.dimensions).map((dimension) => {
    const previousDimension = previousReport.dimensions[dimension.dimension];
    return {
      dimension: dimension.dimension,
      previousLevel: previousDimension?.level ?? "unknown",
      currentLevel: dimension.level,
      change: previousDimension
        ? compareLevelIds(previousDimension.level, dimension.level, levelOrder)
        : "up",
    };
  });

  const previousCriteria = new Map(previousReport.criteria.map((criterion) => [criterion.id, criterion.status]));
  const currentCriteria = new Map(currentReport.criteria.map((criterion) => [criterion.id, criterion.status]));
  const criteriaChanges = Array.from(new Set([...previousCriteria.keys(), ...currentCriteria.keys()]))
    .map((id) => ({
      id,
      previousStatus: previousCriteria.get(id) ?? null,
      currentStatus: currentCriteria.get(id) ?? null,
    }))
    .filter((entry) => entry.previousStatus !== entry.currentStatus)
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    previousGeneratedAt: previousReport.generatedAt,
    previousOverallLevel: previousReport.overallLevel,
    overallChange: compareLevelIds(previousReport.overallLevel, currentReport.overallLevel, levelOrder),
    dimensionChanges,
    criteriaChanges,
  };
}

function canCompareReports(previousReport: HarnessFluencyReport, currentReport: HarnessFluencyReport): boolean {
  return previousReport.modelVersion === currentReport.modelVersion && previousReport.profile === currentReport.profile;
}

async function persistSnapshot(report: HarnessFluencyReport, snapshotPath: string): Promise<void> {
  await mkdir(path.dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function evaluateHarnessFluency(options: EvaluateOptions): Promise<HarnessFluencyReport> {
  const repoRoot = path.resolve(options.repoRoot);
  const model = await loadFluencyModel(path.resolve(options.modelPath));
  const levelOrder = new Map(model.levels.map((level, index) => [level.id, index]));
  const levelById = new Map(model.levels.map((level) => [level.id, level]));
  const dimensionById = new Map(model.dimensions.map((dimension) => [dimension.id, dimension]));

  const previousSnapshot = options.compareLast ? await loadPreviousSnapshot(path.resolve(options.snapshotPath)) : null;
  const context: EvaluationContext = { repoRoot, textCache: new Map(), jsonCache: new Map(), yamlCache: new Map() };
  const criteriaResults = await Promise.all(model.criteria.map((criterion) => evaluateCriterion(criterion, context)));

  const cellAccumulators = new Map<string, MutableCellAccumulator>();
  for (const criterionResult of criteriaResults) {
    const level = levelById.get(criterionResult.level);
    const dimension = dimensionById.get(criterionResult.dimension);
    if (!level || !dimension) {
      throw new Error(`unknown cell reference for ${criterionResult.id}`);
    }

    const cellId = buildCellId(criterionResult.level, criterionResult.dimension);
    const accumulator = cellAccumulators.get(cellId) ?? {
      id: cellId,
      level: criterionResult.level,
      levelName: level.name,
      dimension: criterionResult.dimension,
      dimensionName: dimension.name,
      criteria: [],
    };
    accumulator.criteria.push(criterionResult);
    cellAccumulators.set(cellId, accumulator);
  }

  const cells: CellResult[] = [];
  for (const level of model.levels) {
    for (const dimension of model.dimensions) {
      const accumulator = cellAccumulators.get(buildCellId(level.id, dimension.id));
      if (!accumulator) {
        throw new Error(`missing accumulated cell ${dimension.id}:${level.id}`);
      }

      const applicableWeight = accumulator.criteria.reduce(
        (total, criterion) => total + (criterion.status === "skipped" ? 0 : criterion.weight),
        0,
      );
      const passedWeight = accumulator.criteria.reduce(
        (total, criterion) => total + (criterion.status === "pass" ? criterion.weight : 0),
        0,
      );
      const score = applicableWeight === 0 ? 0 : passedWeight / applicableWeight;

      cells.push({
        id: accumulator.id,
        level: level.id,
        levelName: level.name,
        dimension: dimension.id,
        dimensionName: dimension.name,
        score,
        passed: applicableWeight > 0 && score >= CELL_PASS_THRESHOLD,
        passedWeight,
        applicableWeight,
        criteria: accumulator.criteria.sort((left, right) => left.id.localeCompare(right.id)),
      });
    }
  }

  const cellById = new Map(cells.map((cell) => [cell.id, cell]));
  const dimensions: Record<string, DimensionResult> = {};
  for (const dimension of model.dimensions) {
    let achievedIndex = -1;
    for (let index = 0; index < model.levels.length; index += 1) {
      const cell = cellById.get(buildCellId(model.levels[index].id, dimension.id));
      if (!cell?.passed) {
        break;
      }
      achievedIndex = index;
    }

    const resolvedIndex = Math.max(achievedIndex, 0);
    const currentLevel = model.levels[resolvedIndex];
    const nextLevel = model.levels[resolvedIndex + 1] ?? null;
    dimensions[dimension.id] = {
      dimension: dimension.id,
      name: dimension.name,
      level: currentLevel.id,
      levelName: currentLevel.name,
      levelIndex: resolvedIndex,
      score: cellById.get(buildCellId(currentLevel.id, dimension.id))?.score ?? 0,
      nextLevel: nextLevel?.id ?? null,
      nextLevelName: nextLevel?.name ?? null,
      nextLevelProgress: nextLevel
        ? cellById.get(buildCellId(nextLevel.id, dimension.id))?.score ?? null
        : null,
    };
  }

  const overallLevelIndex = Math.min(...Object.values(dimensions).map((dimension) => dimension.levelIndex));
  const overallLevel = model.levels[overallLevelIndex];
  const nextLevel = model.levels[overallLevelIndex + 1] ?? null;
  const currentLevelReadiness = averageCellScores(model.dimensions, cellById, overallLevel.id);
  const currentLevelDebt = collectFailingCriteriaForLevel(model.dimensions, cellById, overallLevel.id);
  const nextLevelReadiness =
    nextLevel === null || currentLevelDebt.length > 0 ? null : averageCellScores(model.dimensions, cellById, nextLevel.id);
  const blockingTargetLevel = currentLevelDebt.length > 0 ? overallLevel : nextLevel;
  const blockingCriteria =
    blockingTargetLevel === null
      ? []
      : blockingTargetLevel.id === overallLevel.id
        ? currentLevelDebt
        : collectFailingCriteriaForLevel(model.dimensions, cellById, blockingTargetLevel.id);

  const report: HarnessFluencyReport = {
    modelVersion: model.version,
    modelPath: path.resolve(options.modelPath),
    profile: options.profile ?? DEFAULT_PROFILE,
    repoRoot,
    generatedAt: new Date().toISOString(),
    snapshotPath: path.resolve(options.snapshotPath),
    overallLevel: overallLevel.id,
    overallLevelName: overallLevel.name,
    currentLevelReadiness,
    nextLevel: nextLevel?.id ?? null,
    nextLevelName: nextLevel?.name ?? null,
    nextLevelReadiness,
    blockingTargetLevel: blockingTargetLevel?.id ?? null,
    blockingTargetLevelName: blockingTargetLevel?.name ?? null,
    dimensions,
    cells,
    criteria: criteriaResults.sort((left, right) => left.id.localeCompare(right.id)),
    blockingCriteria: blockingCriteria.sort((left, right) => left.id.localeCompare(right.id)),
    recommendations: collectRecommendations(blockingCriteria),
    comparison: null,
  };

  if (previousSnapshot && canCompareReports(previousSnapshot, report)) {
    report.comparison = buildComparison(previousSnapshot, report, levelOrder);
  }
  if (options.save) {
    await persistSnapshot(report, path.resolve(options.snapshotPath));
  }

  return report;
}

export function formatTextReport(report: HarnessFluencyReport): string {
  const nextLevelReadinessLine =
    report.nextLevelName && report.nextLevelReadiness === null && report.blockingTargetLevel === report.overallLevel
      ? `Next Level Readiness: Blocked until ${report.overallLevelName} is stable`
      : `Next Level Readiness: ${formatPercent(report.nextLevelReadiness)}`;
  const blockingHeader = report.blockingTargetLevelName
    ? report.blockingTargetLevel === report.overallLevel
      ? `Blocking Gaps To Stabilize ${report.blockingTargetLevelName}:`
      : `Blocking Gaps To ${report.blockingTargetLevelName}:`
    : "Blocking Gaps: none";
  const lines = [
    "HARNESS FLUENCY REPORT",
    "",
    `Repository: ${report.repoRoot}`,
    `Profile: ${report.profile}`,
    `Model Version: ${report.modelVersion}`,
    `Overall Level: ${report.overallLevelName}`,
    `Current Level Readiness: ${formatPercent(report.currentLevelReadiness)}`,
    `Next Level: ${report.nextLevelName ?? "Reached top level"}`,
    nextLevelReadinessLine,
    "",
    "Dimensions:",
  ];

  for (const dimension of Object.values(report.dimensions).sort((left, right) => left.name.localeCompare(right.name))) {
    lines.push(`- ${dimension.name}: ${dimension.levelName} (${formatPercent(dimension.score)})`);
  }

  lines.push("", blockingHeader);
  if (report.blockingTargetLevelName) {
    if (report.blockingCriteria.length === 0) {
      lines.push("- None");
    } else {
      for (const criterion of report.blockingCriteria) {
        lines.push(`- ${criterion.id} — ${criterion.evidenceHint}`);
      }
    }
  }

  lines.push("", "Recommended Next Actions:");
  if (report.recommendations.length === 0) {
    lines.push("- None");
  } else {
    for (const recommendation of report.recommendations) {
      lines.push(`- ${recommendation.action}`);
    }
  }

  if (report.comparison) {
    lines.push(
      "",
      "Comparison To Last Snapshot:",
      `- Overall: ${report.comparison.overallChange} (${report.comparison.previousOverallLevel} -> ${report.overallLevel})`,
      `- Dimensions changed: ${report.comparison.dimensionChanges.filter((entry) => entry.change !== "same").length}`,
      `- Criteria changed: ${report.comparison.criteriaChanges.length}`,
    );
  }

  lines.push("", `Snapshot: ${report.snapshotPath}`);
  return lines.join("\n");
}

export async function runCli(
  argv: readonly string[],
): Promise<{ options: CliOptions; report: HarnessFluencyReport | null }> {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(renderHelp());
    return { options, report: null };
  }

  const report = await evaluateHarnessFluency({
    repoRoot: options.repoRoot,
    modelPath: options.modelPath,
    profile: options.profile,
    snapshotPath: options.snapshotPath,
    compareLast: options.compareLast,
    save: options.save,
  });

  console.log(options.format === "json" ? JSON.stringify(report, null, 2) : formatTextReport(report));
  return { options, report };
}
