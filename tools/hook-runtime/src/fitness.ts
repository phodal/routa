import { HookMetric } from "./metrics.js";
import { runCommand, type CommandOutputEvent } from "./process.js";

export type MetricExecution = {
  durationMs: number;
  exitCode: number;
  metric: HookMetric;
  output: string;
  passed: boolean;
};

export type MetricRunOptions = {
  onOutput?: (event: CommandOutputEvent) => void;
};

export type MetricFailureSummary = {
  name: string;
  sourceFile: string;
  command: string;
  durationMs: number;
  focusLine: string;
  outputTail: string;
};

export function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`, "g");
const ANSI_RESET = "\u001B[0m";
const ANSI_RED = "\u001B[31m";
const ANSI_DIM = "\u001B[2m";
const ANSI_CYAN = "\u001B[36m";

function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_PATTERN, "");
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

function colorize(stream: NodeJS.WriteStream | undefined, color: string, text: string): string {
  if (!shouldUseColor(stream)) {
    return text;
  }

  return `${color}${text}${ANSI_RESET}`;
}

function evaluateMetric(metric: HookMetric, exitCode: number, output: string): boolean {
  // Exit code is the primary indicator of success/failure
  if (exitCode !== 0) {
    return false;
  }

  // If exit code is 0, the command succeeded
  if (!metric.pattern) {
    return true;
  }

  // For test runners (vitest, cargo test, etc.), exit code is authoritative
  // Pattern matching is advisory only - stderr noise (React act() warnings,
  // debug logs) should not fail the metric when tests actually passed
  const isTestMetric = metric.name.endsWith("_test_pass");
  if (isTestMetric) {
    // Trust the exit code for test metrics - test runners are reliable
    return true;
  }

  // For other metrics, pattern must match to confirm success
  const matcher = new RegExp(metric.pattern, "i");
  return matcher.test(stripAnsi(output));
}

function splitOutputLines(rawOutput: string): string[] {
  return rawOutput
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean);
}

function trimLinesToCharBudget(lines: string[], maxChars: number): string {
  if (lines.length === 0) {
    return "";
  }

  const selected: string[] = [];
  let totalChars = 0;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const nextSize = totalChars + line.length + (selected.length > 0 ? 1 : 0);
    if (selected.length > 0 && nextSize > maxChars) {
      break;
    }
    selected.unshift(line);
    totalChars = nextSize;
  }

  return selected.join("\n");
}

function isVitestBoundaryLine(line: string): boolean {
  return /^(stdout|stderr)\s+\|/.test(line)
    || /^(Test Files|Tests|Start at|Duration)\b/.test(line)
    || /^[\u2500-\u257f]+$/.test(line)
    || /^[\u00d7\u2713\u25b6\u203a]\s/.test(line);
}

function isLikelyTestNameLine(line: string): boolean {
  if (/^(stdout|stderr)\s+\|/.test(line)) {
    return false;
  }
  return /(?:^|\s|\|)[\w./-]+\.test\.[cm]?[jt]sx?\s*>/.test(line);
}

function isLikelyFailureDetailLine(line: string): boolean {
  if (/\b0 errors?\b/i.test(line)) {
    return false;
  }
  return /^AssertionError\b/.test(line)
    || /^TypeError\b/.test(line)
    || /^ReferenceError\b/.test(line)
    || /^Error:\s/.test(line)
    || /^\[[^\]]+\]\s.*\b(?:Error|failed|fail|timeout|denied|refused)\b/i.test(line)
    || /^at\s.+:\d+:\d+\)?$/.test(line)
    || /^Caused by:/i.test(line)
    || /^Expected:/i.test(line)
    || /^Received:/i.test(line)
    || /^-\s*Expected/i.test(line)
    || /^\+\s*Received/i.test(line);
}

function isPathOnlyLine(line: string): boolean {
  return /^(?:\/|\.{1,2}\/|[A-Za-z]:\\).+\.[A-Za-z0-9]+$/.test(line);
}

function isProblemSummaryLine(line: string): boolean {
  return /^[\u2716\u00d7]\s+\d+\s+problem/.test(line);
}

function isDiagnosticDetailLine(line: string): boolean {
  return /^\d+:\d+\s+error\b/i.test(line)
    || /^\d+:\d+\s+warning\b/i.test(line)
    || /^error\b/i.test(line)
    || /^warning\b/i.test(line);
}

function collectVitestFailureBlock(lines: string[], startIndex: number): string[] {
  const block: string[] = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (index > startIndex && /^FAIL\s+/.test(line)) {
      break;
    }
    if (index > startIndex && isVitestBoundaryLine(line)) {
      break;
    }
    if (/^[\u2500-\u257f]+$/.test(line)) {
      continue;
    }
    block.push(line);
  }

  return block;
}

function extractLikelyTestFailureContext(lines: string[]): string[] {
  for (let index = 0; index < lines.length; index += 1) {
    if (!isLikelyTestNameLine(lines[index])) {
      continue;
    }

    const block = [lines[index]];
    let sawFailureDetail = false;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (isVitestBoundaryLine(line) || (isLikelyTestNameLine(line) && block.length > 0)) {
        break;
      }
      if (!isLikelyFailureDetailLine(line)) {
        if (sawFailureDetail) {
          break;
        }
        continue;
      }
      sawFailureDetail = true;
      block.push(line);
    }

    if (sawFailureDetail) {
      return block;
    }
  }

  return [];
}

function extractDiagnosticContext(lines: string[]): string[] {
  for (let index = 0; index < lines.length; index += 1) {
    if (!isPathOnlyLine(lines[index])) {
      continue;
    }
    const block = [lines[index]];
    let sawDetail = false;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (isPathOnlyLine(line) && sawDetail) {
        break;
      }
      if (isProblemSummaryLine(line)) {
        block.push(line);
        break;
      }
      if (!isDiagnosticDetailLine(line) && !sawDetail) {
        continue;
      }
      if (!isDiagnosticDetailLine(line) && sawDetail) {
        break;
      }
      sawDetail = true;
      block.push(line);
    }

    if (sawDetail) {
      return block;
    }
  }

  return [];
}

function extractVitestFailureContext(lines: string[]): string[] {
  const failedTestHeaderIndices = lines
    .map((line, index) => (/^FAIL\s+/.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (failedTestHeaderIndices.length > 0) {
    return failedTestHeaderIndices
      .flatMap((index) => collectVitestFailureBlock(lines, index))
      .filter((line) => !/^(stdout|stderr)\s+\|/.test(line));
  }

  const failedSummaryIndex = lines.findIndex((line) => /^Failed Tests\s+\d+/.test(line));
  if (failedSummaryIndex === -1) {
    return [];
  }

  const vitestFailureLines: string[] = [];
  for (let index = failedSummaryIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^(Test Files|Tests|Start at|Duration)\b/.test(line)) {
      break;
    }
    if (isVitestBoundaryLine(line) || /^(stdout|stderr)\s+\|/.test(line)) {
      continue;
    }
    vitestFailureLines.push(line);
  }

  return vitestFailureLines.filter((line) => line.length > 0);
}

function extractFailureContext(rawOutput: string): string {
  const lines = splitOutputLines(rawOutput);
  if (lines.length === 0) {
    return "";
  }

  const vitestFailureContext = extractVitestFailureContext(lines);
  if (vitestFailureContext.length > 0) {
    return trimLinesToCharBudget(vitestFailureContext, 2500).trim();
  }

  const likelyTestFailureContext = extractLikelyTestFailureContext(lines);
  if (likelyTestFailureContext.length > 0) {
    return trimLinesToCharBudget(likelyTestFailureContext, 2500).trim();
  }

  const diagnosticContext = extractDiagnosticContext(lines);
  if (diagnosticContext.length > 0) {
    return trimLinesToCharBudget(diagnosticContext, 2500).trim();
  }

  const failureHints =
    /\b(?:error|failed|fail|fatal|exception|assert|panic|invalid|denied|refused|permission)\b|timed out|timeout|not found/i;

  const hinted = lines.filter((line) => failureHints.test(line));
  const linesToShow = hinted.length > 0 ? hinted : lines;
  const tail = trimLinesToCharBudget(linesToShow, 1500).trim();
  return tail.length > 0 ? tail : trimLinesToCharBudget(lines, 1500).trim();
}

function normalizeFocusLine(line: string): string {
  return line
    .replace(/^FAIL\s+/, "")
    .replace(/^(stdout|stderr)\s+\|\s*/, "")
    .replace(/^\|\s*/, "")
    .trim();
}

function extractFailureFocusLine(outputTail: string): string {
  const lines = outputTail
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return "";
  }

  const failLine = lines.find((line) => /^FAIL\s+/.test(line));
  if (failLine) {
    return normalizeFocusLine(failLine);
  }

  const diagnosticPath = lines.find((line) => isPathOnlyLine(line));
  if (diagnosticPath) {
    return diagnosticPath;
  }

  const likelyTestLine = lines.find((line) => isLikelyTestNameLine(line));
  if (likelyTestLine) {
    return normalizeFocusLine(likelyTestLine);
  }

  return lines[0];
}

function emphasizeFailureLine(line: string): string {
  if (isPathOnlyLine(line)) {
    return colorize(process.stdout, ANSI_CYAN, line);
  }
  if (/^FAIL\s+/.test(line) || isLikelyTestNameLine(line) || isLikelyFailureDetailLine(line) || isDiagnosticDetailLine(line)) {
    return colorize(process.stdout, ANSI_RED, line);
  }
  if (isProblemSummaryLine(line)) {
    return colorize(process.stdout, ANSI_DIM, line);
  }
  return line;
}

export async function runMetric(
  metric: HookMetric,
  options: MetricRunOptions = {},
): Promise<MetricExecution> {
  const result = await runCommand(metric.command, {
    stream: false,
    onOutput: options.onOutput,
  });
  const passed = evaluateMetric(metric, result.exitCode, result.output);

  return {
    metric,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    passed,
    output: result.output,
  };
}

export function summarizeFailures(results: MetricExecution[]): MetricFailureSummary[] {
  const failures = results.filter((result) => !result.passed);
  return failures.map((failure) => {
    const outputTail = extractFailureContext(failure.output);
    return {
      name: failure.metric.name,
      sourceFile: failure.metric.sourceFile,
      command: failure.metric.command,
      durationMs: failure.durationMs,
      outputTail,
      focusLine: extractFailureFocusLine(outputTail),
    };
  });
}

export function printFailureSummary(results: MetricExecution[]): void {
  const failures = summarizeFailures(results);
  if (failures.length === 0) {
    return;
  }

  console.log("===============================================================");
  console.log("Pre-push fitness checks failed");
  console.log("===============================================================");
  console.log("");

  for (const failure of failures) {
    console.log(`- ${failure.name} (${formatDuration(failure.durationMs)})`);
    console.log(`  source: ${failure.sourceFile}`);
    console.log(`  cmd: ${failure.command}`);
    if (failure.focusLine) {
      console.log(`  failed target: ${colorize(process.stdout, ANSI_RED, failure.focusLine)}`);
    }
    if (failure.outputTail) {
      console.log("  failed test excerpt:");
      for (const line of failure.outputTail.split("\n")) {
        console.log(`    ${emphasizeFailureLine(line)}`);
      }
    } else {
      console.log("  failed test excerpt: unavailable");
    }
    console.log("");
  }
}
