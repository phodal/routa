import type { FitnessSpecSummary } from "@/client/hooks/use-harness-settings-data";
import type { PlanResponse } from "@/client/components/harness-execution-plan-flow";
import type { EntrixRunResponse } from "@/core/fitness/entrix-run-types";
import { buildCanvasSdkPromptSection } from "@/core/canvas/sdk-manifest";

function summarizeSpecFiles(specFiles: FitnessSpecSummary[]) {
  return specFiles.slice(0, 6).map((file) => ({
    name: file.name,
    relativePath: file.relativePath,
    kind: file.kind,
    language: file.language,
    dimension: file.dimension ?? null,
    metricCount: file.metricCount,
    weight: file.weight ?? null,
    thresholdPass: file.thresholdPass ?? null,
    thresholdWarn: file.thresholdWarn ?? null,
    metrics: file.metrics.slice(0, 4).map((metric) => ({
      name: metric.name,
      tier: metric.tier,
      gate: metric.gate,
      runner: metric.runner,
      hardGate: metric.hardGate,
    })),
  }));
}

function summarizeExecutionPlan(plan: PlanResponse | null) {
  if (!plan) {
    return null;
  }

  return {
    tier: plan.tier,
    scope: plan.scope,
    dimensionCount: plan.dimensionCount,
    metricCount: plan.metricCount,
    hardGateCount: plan.hardGateCount,
    dimensions: plan.dimensions.slice(0, 6).map((dimension) => ({
      name: dimension.name,
      weight: dimension.weight,
      thresholdPass: dimension.thresholdPass,
      thresholdWarn: dimension.thresholdWarn,
      sourceFile: dimension.sourceFile,
      metrics: dimension.metrics.slice(0, 4).map((metric) => ({
        name: metric.name,
        tier: metric.tier,
        gate: metric.gate,
        runner: metric.runner,
        hardGate: metric.hardGate,
        executionScope: metric.executionScope,
      })),
    })),
  };
}

function summarizeEntrixRun(run: EntrixRunResponse | null | undefined) {
  if (!run) {
    return null;
  }

  return {
    generatedAt: run.generatedAt,
    tier: run.tier,
    scope: run.scope,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    summary: run.summary,
    report: {
      finalScore: run.report.finalScore,
      hardGateBlocked: run.report.hardGateBlocked,
      scoreBlocked: run.report.scoreBlocked,
      dimensions: run.report.dimensions.slice(0, 6).map((dimension) => ({
        name: dimension.name,
        score: dimension.score,
        passed: dimension.passed,
        total: dimension.total,
        hardGateFailures: dimension.hardGateFailures,
        results: dimension.results.slice(0, 8).map((metric) => ({
          name: metric.name,
          state: metric.state,
          passed: metric.passed,
          hardGate: metric.hardGate,
          tier: metric.tier,
          durationMs: metric.durationMs,
          outputSnippet: metric.outputSnippet,
        })),
      })),
    },
  };
}

export function buildKanbanFitnessWorkbenchUserPrompt(input: {
  workspaceId: string;
  repoPath: string;
  repoLabel: string;
  branch?: string | null;
  entrixRun?: EntrixRunResponse | null;
  specFiles: FitnessSpecSummary[];
  plan: PlanResponse | null;
}): string {
  const entrixRun = summarizeEntrixRun(input.entrixRun);
  const context = {
    workspaceId: input.workspaceId,
    repoPath: input.repoPath,
    repoLabel: input.repoLabel,
    branch: input.branch ?? null,
    entrixRun,
    fitnessSpecs: summarizeSpecFiles(input.specFiles),
    executionPlan: summarizeExecutionPlan(input.plan),
  };

  return [
    "Create an Entrix Fitness canvas for a Kanban popup.",
    "This canvas is only the left-side preview pane. The real live session/process pane exists outside the canvas on the right, so do not render chat logs, terminals, or fake agent transcripts.",
    "Workflow:",
    "1. Read the `entrixRun` object first. It comes from a real `entrix run --tier fast --scope local --json` execution.",
    "2. Use `entrixRun.report` as the primary source of truth for scores, pass/fail state, counts, and problem areas.",
    "3. Use `fitnessSpecs` and `executionPlan` only as supplemental context for labels, grouping, and navigation.",
    "The layout must feel close to `/settings/harness?section=entrix-fitness`:",
    "- dense engineering workbench",
    "- source/file explorer area",
    "- detailed fitness file view",
    "- compact execution plan summary",
    "- repo/status badges at the top",
    "Popup constraints:",
    "- no outer app shell",
    "- no top navigation",
    "- no left global sidebar",
    "- no fake browser frame",
    "- designed to sit inside a modal around 1200x760",
    "- responsive down to narrow widths",
    "Visual direction:",
    "- serious engineering console",
    "- flat and minimal",
    "- no gradients, no emojis, no box shadows",
    "- avoid repeating identical cards everywhere",
    "- use accent color sparingly",
    "Data handling rules:",
    "- embed the provided data inline as constants",
    "- do not fetch anything",
    "- generate the UI from the provided entrix data below",
    "- do not invent demo fitness results; if a result is missing, render an explicit empty/pending state",
    "- `entrixRun.report` is the primary dataset",
    "- keep the layout grounded in the actual failing and passing metrics from `entrixRun.report`",
    "Context provenance:",
    "- `entrixRun`: parsed from a real `entrix run --tier fast --scope local --json` execution",
    "- `fitnessSpecs`: parsed directly from this repository's `docs/fitness` markdown/yaml files",
    "- `executionPlan`: derived from the same `docs/fitness` sources, matching the harness fitness planning view",
    "",
    "Structured context JSON:",
    JSON.stringify(context, null, 2),
    "",
    buildCanvasSdkPromptSection(),
  ].join("\n");
}
