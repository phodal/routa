export const DEFENSE_WORKFLOW_FILE = "defense.yaml";
export const DEFENSE_WORKFLOW_NAME = "Defense";
export const DEFAULT_TARGET_BRANCH = "main";
export const DEFAULT_LOG_CHAR_LIMIT = 12000;

export interface WorkflowRunSummary {
  id: number;
  name: string;
  conclusion: string | null;
  headBranch: string;
  headSha: string;
  htmlUrl: string;
  event: string;
  displayTitle?: string;
}

export interface WorkflowJobSummary {
  id: number;
  name: string;
  conclusion: string | null;
  htmlUrl?: string;
}

export interface FailedJobContext {
  job: WorkflowJobSummary;
  validationCommands: string[];
  logExcerpt: string;
}

export interface RepairPromptInput {
  repo: string;
  targetRun: WorkflowRunSummary;
  failedJobs: FailedJobContext[];
}

const DEFENSE_JOB_COMMANDS: Record<string, string[]> = {
  "Gate: Fitness": [
    "entrix run --tier normal --scope ci --min-score 0 --output .artifacts/fitness-report.json",
  ],
  "Security: Dependency Scan": [
    "npm audit --audit-level=critical",
  ],
  "Security: Semgrep SAST": [
    "semgrep --config=p/security-audit --config=p/owasp-top-ten --severity=ERROR --error .",
  ],
  "Security: Trivy Scan": [
    "trivy fs --severity HIGH,CRITICAL --exit-code 0 .",
  ],
  "Security: Hadolint": ["hadolint Dockerfile"],
};

export function normalizeRunSummary(run: {
  id: number;
  name: string;
  conclusion: string | null;
  head_branch: string;
  head_sha: string;
  html_url: string;
  event: string;
  display_title?: string;
}): WorkflowRunSummary {
  return {
    id: run.id,
    name: run.name,
    conclusion: run.conclusion,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    htmlUrl: run.html_url,
    event: run.event,
    displayTitle: run.display_title,
  };
}

export function normalizeJobSummary(job: {
  id: number;
  name: string;
  conclusion: string | null;
  html_url?: string;
}): WorkflowJobSummary {
  return {
    id: job.id,
    name: job.name,
    conclusion: job.conclusion,
    htmlUrl: job.html_url,
  };
}

export function shouldAttemptRepair(run: WorkflowRunSummary | null): boolean {
  return run?.conclusion === "failure";
}

export function pickRepairCandidateRun(runs: WorkflowRunSummary[]): WorkflowRunSummary | null {
  if (runs.length === 0) {
    return null;
  }

  return shouldAttemptRepair(runs[0]) ? runs[0] : null;
}

export function pickFailedJobs(jobs: WorkflowJobSummary[]): WorkflowJobSummary[] {
  return jobs.filter((job) => job.conclusion === "failure");
}

export function validationCommandsForJob(jobName: string): string[] {
  return DEFENSE_JOB_COMMANDS[jobName] ?? [];
}

export function collectValidationCommands(jobNames: string[]): string[] {
  return Array.from(
    new Set(jobNames.flatMap((jobName) => validationCommandsForJob(jobName)))
  );
}

export function findUnmappedJobs(jobNames: string[]): string[] {
  return jobNames.filter((jobName) => validationCommandsForJob(jobName).length === 0);
}

export function trimLogExcerpt(log: string, limit = DEFAULT_LOG_CHAR_LIMIT): string {
  if (log.length <= limit) {
    return log;
  }

  const truncated = log.slice(-limit);
  return `[truncated to last ${limit} chars]\n${truncated}`;
}

export function buildRepairPrompt(input: RepairPromptInput): string {
  const failedJobSections = input.failedJobs.map(({ job, validationCommands, logExcerpt }) => {
    const commands = validationCommands.length > 0
      ? validationCommands.map((command) => `- \`${command}\``).join("\n")
      : "- (no mapped validation commands)";

    return [
      `## Failed Job: ${job.name}`,
      `- Job ID: ${job.id}`,
      `- Conclusion: ${job.conclusion ?? "unknown"}`,
      job.htmlUrl ? `- Job URL: ${job.htmlUrl}` : "",
      "### Validation Commands",
      commands,
      "### Log Excerpt",
      "```text",
      logExcerpt.trim() || "(empty log excerpt)",
      "```",
    ].filter(Boolean).join("\n");
  });

  return [
    `Repair the latest failed GitHub Actions run for workflow "${DEFENSE_WORKFLOW_NAME}" in repository ${input.repo}.`,
    "",
    "## Target Run",
    `- Run ID: ${input.targetRun.id}`,
    `- Workflow: ${input.targetRun.name}`,
    `- Branch: ${input.targetRun.headBranch}`,
    `- Commit: ${input.targetRun.headSha}`,
    `- Event: ${input.targetRun.event}`,
    `- URL: ${input.targetRun.htmlUrl}`,
    input.targetRun.displayTitle ? `- Title: ${input.targetRun.displayTitle}` : "",
    "",
    "## Requirements",
    "1. Diagnose the root cause using the failing job logs and the codebase.",
    "2. Make the smallest correct code change that fixes the failure.",
    "3. Re-run every listed validation command locally until they pass.",
    "4. Do not weaken the gates, skip tests, or paper over errors.",
    "5. Do not commit or push; the workflow will handle git operations after verification.",
    "6. If the failure is flaky or external, explain that clearly and avoid speculative code changes.",
    "",
    ...failedJobSections,
  ].filter(Boolean).join("\n");
}
