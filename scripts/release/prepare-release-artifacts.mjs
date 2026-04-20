#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

function printUsage() {
  console.log(`Usage:
  node scripts/release/prepare-release-artifacts.mjs <version> [options]

Options:
  --from <tag>           Start tag for changelog generation.
  --to <tag|ref>         End ref/tag. Defaults to HEAD commit.
  --summary-file <path>  Curated markdown summary passed to generate-changelog.
  --ai                   Run the changelog specialist for summary generation.
  --ai-provider <name>   ACP provider override used with --ai.
  -h, --help             Show this help.

Outputs:
  - dist/release/release-notes.md
  - dist/release/CHANGELOG.generated.md
  - dist/release/changelog-summary-prompt.json
  - docs/releases/v<version>-release-notes.md
  - docs/releases/v<version>-changelog.md`);
}

function parseArgs(argv) {
  const args = {
    ai: false,
    aiProvider: "",
    from: "",
    summaryFile: "",
    to: "",
    version: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else if (arg === "--from") {
      args.from = readValue();
    } else if (arg === "--to") {
      args.to = readValue();
    } else if (arg === "--summary-file") {
      args.summaryFile = readValue();
    } else if (arg === "--ai") {
      args.ai = true;
    } else if (arg === "--ai-provider") {
      args.aiProvider = readValue();
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!args.version) {
      args.version = arg;
    } else {
      throw new Error("Only one version argument is allowed");
    }
  }

  return args;
}

function normalizeGitRef(ref) {
  if (!ref) return "";
  if (ref.match(/^v?[0-9]+\.[0-9]+\.[0-9]+([-.][A-Za-z0-9.]+)?$/)) {
    return `v${ref.replace(/^v/, "")}`;
  }
  return ref;
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version.replace(/^v/, "").trim();

  if (!version) {
    printUsage();
    throw new Error("Version is required");
  }

  const fromRef = normalizeGitRef(args.from);
  const toRef = normalizeGitRef(args.to) || runGit(["rev-parse", "HEAD"]);

  const docsNotesPath = path.join(repoRoot, "docs", "releases", `v${version}-release-notes.md`);
  const docsChangelogPath = path.join(repoRoot, "docs", "releases", `v${version}-changelog.md`);
  const distDir = path.join(repoRoot, "dist", "release");
  const distNotesPath = path.join(distDir, "release-notes.md");
  const distChangelogPath = path.join(distDir, "CHANGELOG.generated.md");
  const promptPath = path.join(distDir, "changelog-summary-prompt.json");

  await mkdir(distDir, { recursive: true });
  await mkdir(path.dirname(docsNotesPath), { recursive: true });

  console.log(`==> Syncing version to ${version}`);
  execFileSync("node", ["scripts/release/sync-release-version.mjs", "--version", version], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  const changelogArgs = [
    "scripts/release/generate-changelog.mjs",
    "--version", version,
    "--to", toRef,
    "--out", distNotesPath,
    "--changelog-out", distChangelogPath,
    "--prompt-out", promptPath,
  ];

  if (fromRef) {
    changelogArgs.push("--from", fromRef);
  }
  if (args.summaryFile) {
    changelogArgs.push("--summary-file", args.summaryFile);
  }
  if (args.ai) {
    changelogArgs.push("--ai");
  }
  if (args.aiProvider) {
    changelogArgs.push("--ai-provider", args.aiProvider);
  }

  console.log("==> Generating release notes preview");
  execFileSync("node", changelogArgs, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  await cp(distNotesPath, docsNotesPath);
  await cp(distChangelogPath, docsChangelogPath);

  console.log("");
  console.log(`Prepared release artifacts for v${version}:`);
  console.log(`  - ${path.relative(repoRoot, docsNotesPath)}`);
  console.log(`  - ${path.relative(repoRoot, docsChangelogPath)}`);
  console.log(`  - ${path.relative(repoRoot, distNotesPath)}`);
  console.log(`  - ${path.relative(repoRoot, distChangelogPath)}`);
  console.log(`  - ${path.relative(repoRoot, promptPath)}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Review git diff and refine ${path.relative(repoRoot, docsNotesPath)} if you want a more editorial blog post.`);
  console.log("  2. Run validation for the changed surfaces.");
  console.log(`  3. Commit, tag v${version}, and push or dispatch the release workflow.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
