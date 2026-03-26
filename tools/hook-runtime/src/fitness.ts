import { HookMetric } from "./metrics.js";
import { runCommand, tailOutput, type CommandOutputEvent } from "./process.js";

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
  outputTail: string;
};

export function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function evaluateMetric(metric: HookMetric, exitCode: number, output: string): boolean {
  if (exitCode !== 0) {
    return false;
  }

  if (!metric.pattern) {
    return true;
  }

  const matcher = new RegExp(metric.pattern, "i");
  return matcher.test(output);
}

function splitOutputLines(rawOutput: string): string[] {
  return rawOutput
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractFailureContext(rawOutput: string): string {
  const lines = splitOutputLines(rawOutput);
  if (lines.length === 0) {
    return "";
  }

  const failureHints =
    /error|failed|fail|fatal|exception|assert|panic|timed out|timeout|not found|invalid|denied|refused|permission/i;

  const hinted = lines.filter((line) => failureHints.test(line));
  const linesToShow = hinted.length > 0 ? hinted : lines;
  const tail = tailOutput(linesToShow.join("\n"), 1500).trim();
  return tail.length > 0 ? tail : tailOutput(lines.join("\n"), 1500).trim();
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
  return failures.map((failure) => ({
    name: failure.metric.name,
    sourceFile: failure.metric.sourceFile,
    command: failure.metric.command,
    durationMs: failure.durationMs,
    outputTail: extractFailureContext(failure.output),
  }));
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
    if (failure.outputTail) {
      console.log("  failure context:");
      for (const line of failure.outputTail.split("\n")) {
        console.log(`    ${line}`);
      }
    } else {
      console.log("  failure context: unavailable");
    }
    console.log("");
  }
}
