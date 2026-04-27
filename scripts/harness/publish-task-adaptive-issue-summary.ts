#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import * as githubIssuesModule from "@/core/kanban/github-issues";
import * as taskAdaptiveIssueSummaryModule from "@/core/harness/task-adaptive-issue-summary";

const githubIssues = githubIssuesModule as typeof import("@/core/kanban/github-issues");
const taskAdaptiveIssueSummary = taskAdaptiveIssueSummaryModule as typeof import("@/core/harness/task-adaptive-issue-summary");

const {
  createGitHubIssueComment,
  listGitHubIssueComments,
  resolveGitHubRepo,
  updateGitHubIssueComment,
} = githubIssues;
const {
  buildTaskAdaptiveIssueSummary,
  formatTaskAdaptiveIssueSummaryMarkdown,
  TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER,
} = taskAdaptiveIssueSummary;

type GitHubIssueComment = import("@/core/kanban/github-issues").GitHubIssueComment;
type BuildTaskAdaptiveIssueSummaryOptions = import("@/core/harness/task-adaptive-issue-summary").BuildTaskAdaptiveIssueSummaryOptions;
type TaskAdaptiveIssueSummary = import("@/core/harness/task-adaptive-issue-summary").TaskAdaptiveIssueSummary;

type Options = BuildTaskAdaptiveIssueSummaryOptions & {
  repoRoot: string;
  repo?: string;
  issueNumber?: number;
  publish: boolean;
  dryRun: boolean;
  json: boolean;
};

type PublishAction = "created" | "updated" | "would-create" | "would-update";

export interface PublishTaskAdaptiveIssueSummaryResult {
  summary: TaskAdaptiveIssueSummary;
  markdown: string;
  published?: {
    action: PublishAction;
    repo: string;
    issueNumber: number;
    commentId?: string;
    url?: string;
  };
}

interface PublishDeps {
  buildSummary: typeof buildTaskAdaptiveIssueSummary;
  formatMarkdown: typeof formatTaskAdaptiveIssueSummaryMarkdown;
  resolveRepo: typeof resolveGitHubRepo;
  listComments: typeof listGitHubIssueComments;
  createComment: typeof createGitHubIssueComment;
  updateComment: typeof updateGitHubIssueComment;
}

const defaultDeps: PublishDeps = {
  buildSummary: buildTaskAdaptiveIssueSummary,
  formatMarkdown: formatTaskAdaptiveIssueSummaryMarkdown,
  resolveRepo: resolveGitHubRepo,
  listComments: listGitHubIssueComments,
  createComment: createGitHubIssueComment,
  updateComment: updateGitHubIssueComment,
};

export { TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER };

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    repoRoot: process.cwd(),
    publish: false,
    dryRun: false,
    json: false,
    refresh: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--repo-root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--repo-root requires a value");
      }
      options.repoRoot = value;
      index += 1;
      continue;
    }

    if (arg === "--repo") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--repo requires a value");
      }
      options.repo = value;
      index += 1;
      continue;
    }

    if (arg === "--issue") {
      options.issueNumber = parsePositiveInteger(arg, argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--max-features") {
      options.maxFeatures = parsePositiveInteger(arg, argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--max-files") {
      options.maxFiles = parsePositiveInteger(arg, argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--publish") {
      options.publish = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--load-only") {
      options.refresh = false;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.publish && !options.issueNumber) {
    throw new Error("--publish requires --issue <number>");
  }

  return options;
}

function parsePositiveInteger(flag: string, value: string | undefined): number {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }

  return parsed;
}

function printHelp(): void {
  console.log(`
Publish a sanitized Task-Adaptive summary to a GitHub issue

Usage:
  node --import tsx scripts/harness/publish-task-adaptive-issue-summary.ts [options]

Options:
  --repo-root <path>      Repository root. Defaults to current working directory.
  --repo <owner/name>     Explicit GitHub repository. Defaults to the local origin remote.
  --issue <number>        GitHub issue number to update when --publish is set.
  --publish               Create or update the marked GitHub issue comment.
  --dry-run               Show what would be published without writing to GitHub.
  --json                  Print JSON instead of Markdown to stdout.
  --load-only             Reuse the existing friction profile snapshot instead of refreshing it.
  --max-features <n>      Limit the number of hotspot features in the report.
  --max-files <n>         Limit the number of hotspot files in the report.
  --help, -h              Show this help.

Examples:
  node --import tsx scripts/harness/publish-task-adaptive-issue-summary.ts
  node --import tsx scripts/harness/publish-task-adaptive-issue-summary.ts --json
  node --import tsx scripts/harness/publish-task-adaptive-issue-summary.ts --publish --issue 525
  node --import tsx scripts/harness/publish-task-adaptive-issue-summary.ts --publish --issue 525 --dry-run
`);
}

export function findMarkedIssueComment(
  comments: GitHubIssueComment[],
  marker: string = TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER,
): GitHubIssueComment | undefined {
  return comments.find((comment) => comment.body.includes(marker));
}

export async function run(
  options: Options,
  deps: PublishDeps = defaultDeps,
): Promise<PublishTaskAdaptiveIssueSummaryResult> {
  const summary = await deps.buildSummary(options.repoRoot, {
    refresh: options.refresh,
    maxFeatures: options.maxFeatures,
    maxFiles: options.maxFiles,
  });
  const markdown = deps.formatMarkdown(summary);
  const result: PublishTaskAdaptiveIssueSummaryResult = {
    summary,
    markdown,
  };

  if (!options.publish) {
    return result;
  }

  const repo = options.repo?.trim() || deps.resolveRepo(undefined, options.repoRoot);
  if (!repo) {
    throw new Error("Could not resolve a GitHub repository from --repo or the local origin remote.");
  }
  if (!options.issueNumber) {
    throw new Error("--publish requires --issue <number>");
  }

  const comments = await deps.listComments(repo, options.issueNumber);
  const existing = findMarkedIssueComment(comments);

  if (options.dryRun) {
    result.published = {
      action: existing ? "would-update" : "would-create",
      repo,
      issueNumber: options.issueNumber,
      commentId: existing?.id,
      url: existing?.url,
    };
    return result;
  }

  if (existing) {
    const updated = await deps.updateComment(repo, existing.id, markdown);
    result.published = {
      action: "updated",
      repo,
      issueNumber: options.issueNumber,
      commentId: updated.id,
      url: updated.url,
    };
    return result;
  }

  const created = await deps.createComment(repo, options.issueNumber, markdown);
  result.published = {
    action: "created",
    repo,
    issueNumber: options.issueNumber,
    commentId: created.id,
    url: created.url,
  };
  return result;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  const result = await run(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (!options.publish || options.dryRun) {
    if (result.published) {
      console.log(
        `${result.published.action} Task-Adaptive summary comment on ${result.published.repo}#${result.published.issueNumber}`,
      );
      console.log("");
    }
    console.log(result.markdown);
    return 0;
  }

  if (result.published) {
    console.log(
      `${result.published.action} Task-Adaptive summary comment on ${result.published.repo}#${result.published.issueNumber}`,
    );
    if (result.published.url) {
      console.log(result.published.url);
    }
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    },
  );
}
