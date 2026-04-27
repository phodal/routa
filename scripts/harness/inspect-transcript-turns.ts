#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { inspectTranscriptTurns } from "../../src/core/harness/transcript-sessions";

type Options = {
  repoRoot: string;
  sessionIds: string[];
  filePaths: string[];
  featureId?: string;
  maxUserPrompts?: number;
  maxSignals?: number;
};

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    repoRoot: process.cwd(),
    sessionIds: [],
    filePaths: [],
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

    if (arg === "--session-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--session-id requires a value");
      }
      options.sessionIds.push(value);
      index += 1;
      continue;
    }

    if (arg === "--file") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--file requires a value");
      }
      options.filePaths.push(value);
      index += 1;
      continue;
    }

    if (arg === "--feature-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--feature-id requires a value");
      }
      options.featureId = value;
      index += 1;
      continue;
    }

    if (arg === "--max-user-prompts") {
      const value = parsePositiveInteger(arg, argv[index + 1]);
      options.maxUserPrompts = value;
      index += 1;
      continue;
    }

    if (arg === "--max-signals") {
      const value = parsePositiveInteger(arg, argv[index + 1]);
      options.maxSignals = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  options.sessionIds = [...new Set(options.sessionIds.map((value) => value.trim()).filter(Boolean))];
  options.filePaths = [...new Set(options.filePaths.map((value) => value.trim()).filter(Boolean))];

  if (options.sessionIds.length === 0) {
    throw new Error("At least one --session-id is required");
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
Inspect transcript turns

Usage:
  node --import tsx scripts/harness/inspect-transcript-turns.ts --session-id <id> [options]

Options:
  --repo-root <path>         Repository root to match against. Defaults to current working directory.
  --session-id <id>          Session ID to inspect. Repeat for multiple sessions.
  --file <path>              Focus file path. Repeat for multiple files.
  --feature-id <id>          Optional feature ID used for feature mention and scope-drift detection.
  --max-user-prompts <n>     Limit recovered user prompts per session.
  --max-signals <n>          Limit relevant and failed signals per session.
  --help, -h                 Show this help.

Examples:
  node --import tsx scripts/harness/inspect-transcript-turns.ts \\
    --session-id 019da5f2-e28c-7361-8978-11dfde7f2c4f \\
    --file src/app/workspace/[workspaceId]/feature-explorer/__tests__/feature-explorer-page-client.test.tsx \\
    --feature-id feature-explorer
`);
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const options = parseArgs(argv);
  const result = inspectTranscriptTurns(options.repoRoot, {
    sessionIds: options.sessionIds,
    filePaths: options.filePaths,
    featureId: options.featureId,
    maxUserPrompts: options.maxUserPrompts,
    maxSignals: options.maxSignals,
  });

  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
