#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHANGE_TYPES = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];
const BREAKING_SECTION = "Breaking Changes";
const DEFAULT_SPECIALIST = "resources/specialists/release/changelog-summary.yaml";

const COMMIT_TYPE_MAP = {
  feat: "Added",
  fix: "Fixed",
  perf: "Changed",
  refactor: "Changed",
  docs: "Changed",
  style: "Changed",
  test: "Changed",
  chore: "Changed",
  ci: "Changed",
  build: "Changed",
  revert: "Changed",
};

const SUMMARY_TOPIC_RULES = [
  {
    id: "kanban",
    label: "Kanban and task delivery",
    pattern: /kanban|card|board|task[- ]scoped|task change|changes tab|worktree|review handoff|pull request|pr import|diff/i,
    outcome: "Kanban and task delivery changes make cards, reviews, PRs, diffs, and worktree-driven handoffs easier to inspect.",
  },
  {
    id: "sessions",
    label: "Sessions and agent runtime",
    pattern: /session|transcript|trace|acp|provider|runner|prompt|stream|claude|codex|opencode|a2a|agent/i,
    outcome: "Session and agent-runtime updates improve transcript recovery, provider behavior, streaming, and long-running agent execution.",
  },
  {
    id: "desktop",
    label: "Desktop and release",
    pattern: /desktop|tauri|macos|windows|linux|installer|bundle|release|publish|artifact|sign|notar|portable-pty|ci/i,
    outcome: "Desktop, CI, and release workflow changes improve packaging, optional signing, release verification, and cross-platform runtime behavior.",
  },
  {
    id: "harness",
    label: "Harness and architecture",
    pattern: /harness|fitness|fluency|architecture|arch|dsl|graph|playbook|evolution|learning|quality/i,
    outcome: "Harness and architecture work adds stronger repository analysis, fitness checks, generated playbooks, and evolution history.",
  },
  {
    id: "cli",
    label: "CLI and developer tooling",
    pattern: /cli|command|doctor|hook|pre-commit|pre-push|git|graph|java|skill|docx|pdf|office/i,
    outcome: "CLI and developer-tooling updates expand graph analysis, repository safety checks, skills, hooks, and diagnostics.",
  },
  {
    id: "security",
    label: "Security and dependency upkeep",
    pattern: /security|audit|vulnerabilit|cve|xss|csrf|ssrf|injection|auth|deps|bump|upgrade|pin/i,
    outcome: "Security, dependency, and maintenance commits refresh core packages, reduce audit noise, and document operational fixes.",
  },
];

function runGit(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.allowFailure ? "ignore" : "pipe"],
    ...options.execOptions,
  }).trim();
}

function tryGit(args) {
  try {
    const output = runGit(args, { allowFailure: true });
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function normalizeTag(value) {
  if (!value) return value;
  // Don't normalize special git refs like HEAD, main, etc.
  if (
    value === "HEAD"
    || !value.match(/^v?[0-9]+\.[0-9]+\.[0-9]+([-.][A-Za-z0-9.]+)?$/)
  ) {
    return value;
  }
  return value.startsWith("v") ? value : `v${value}`;
}

function parseArgs(argv) {
  const args = {
    ai: false,
    aiProvider: process.env.ROUTA_RELEASE_AI_PROVIDER || undefined,
    changelogOut: undefined,
    dryRunAi: false,
    from: undefined,
    help: false,
    out: undefined,
    promptOut: undefined,
    repo: "phodal/routa",
    summaryFile: undefined,
    to: "HEAD",
    version: undefined,
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

    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--ai") args.ai = true;
    else if (arg === "--dry-run-ai") args.dryRunAi = true;
    else if (arg === "--from") args.from = normalizeTag(readValue());
    else if (arg === "--to") args.to = normalizeTag(readValue());
    else if (arg === "--version") args.version = readValue().replace(/^v/, "");
    else if (arg === "--out") args.out = readValue();
    else if (arg === "--changelog-out") args.changelogOut = readValue();
    else if (arg === "--prompt-out") args.promptOut = readValue();
    else if (arg === "--summary-file") args.summaryFile = readValue();
    else if (arg === "--ai-provider") args.aiProvider = readValue();
    else if (arg === "--repo") args.repo = readValue();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.version && (!args.to || args.to === "HEAD")) {
    args.to = normalizeTag(args.version);
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  npm run release:changelog -- --from v0.2.5 --to v0.2.6
  npm run release:changelog -- --version 0.2.6 --out dist/release-notes.md
  npm run release:changelog -- --from v0.2.5 --to v0.2.6 --ai --ai-provider claude

Options:
  --from <tag>            Start tag. Defaults to the previous reachable tag.
  --to <tag|ref>          End tag/ref. Defaults to HEAD, or v<version>.
  --version <semver>      Release version used in title and tag selection.
  --out <path>            Write release notes markdown to this path.
  --changelog-out <path>  Write only the Keep a Changelog style technical section.
  --summary-file <path>   Insert a curated or AI-generated summary markdown section.
  --ai                    Run the release changelog summary specialist and insert its summary.
  --ai-provider <name>    ACP provider override for the specialist.
  --prompt-out <path>     Write the specialist input package for manual AI curation.
  --repo <owner/name>     GitHub repo for commit links. Defaults to phodal/routa.
`);
}

function resolveRange({ from, to }) {
  const resolvedTo = to ?? "HEAD";
  const resolvedFrom = from
    ?? tryGit(["describe", "--tags", "--abbrev=0", `${resolvedTo}^`])
    ?? tryGit(["describe", "--tags", "--abbrev=0"]);

  return {
    from: resolvedFrom,
    logRange: resolvedFrom ? `${resolvedFrom}..${resolvedTo}` : resolvedTo,
    to: resolvedTo,
  };
}

function parseCommitHeader(subject) {
  const match = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/);
  if (!match) {
    return {
      breaking: /BREAKING CHANGE|breaking/i.test(subject),
      description: subject,
      scope: undefined,
      type: "change",
    };
  }
  return {
    breaking: Boolean(match[3]),
    description: match[4],
    scope: match[2],
    type: match[1].toLowerCase(),
  };
}

function classifyCommit(commit) {
  const section = COMMIT_TYPE_MAP[commit.type] ?? "Changed";
  if (commit.breaking) return BREAKING_SECTION;
  if (/security|vulnerabilit|cve|xss|csrf|ssrf|injection|auth bypass/i.test(commit.description)) {
    return "Security";
  }
  return section;
}

function shouldIncludeCommit(commit) {
  return !/^chore:\s+release\s+v/i.test(commit.subject);
}

function readCommits(range) {
  const format = "%H%x1f%h%x1f%s%x1f%an%x1e";
  const output = runGit(["log", "--no-merges", `--format=${format}`, range.logRange]);
  return output
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, shortHash, subject, author] = entry.split("\x1f");
      const header = parseCommitHeader(subject);
      return {
        author,
        hash,
        shortHash,
        subject,
        ...header,
        section: classifyCommit(header),
      };
    })
    .filter(shouldIncludeCommit);
}

function readChangedFiles(range) {
  const output = tryGit(["diff", "--name-only", range.logRange]) ?? "";
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function readRefDate(ref) {
  return tryGit(["show", "-s", "--format=%cs", ref]) ?? new Date().toISOString().slice(0, 10);
}

function inferArea(commit) {
  if (commit.scope) return commit.scope;
  if (/tauri|desktop/i.test(commit.subject)) return "desktop";
  if (/rust|axum|server/i.test(commit.subject)) return "rust";
  if (/cli/i.test(commit.subject)) return "cli";
  if (/ui|workspace|session|kanban|team/i.test(commit.subject)) return "app";
  if (/release|publish|artifact/i.test(commit.subject)) return "release";
  return undefined;
}

function groupedCommits(commits) {
  const groups = Object.fromEntries([...CHANGE_TYPES, BREAKING_SECTION].map((section) => [section, []]));
  for (const commit of commits) {
    const target = groups[commit.section] ? commit.section : "Changed";
    groups[target].push(commit);
  }
  return groups;
}

function renderTechnicalChangelog(commits, repo) {
  const groups = groupedCommits(commits);
  const lines = ["## Technical Changelog", ""];
  for (const section of [BREAKING_SECTION, ...CHANGE_TYPES]) {
    const entries = groups[section];
    if (!entries || entries.length === 0) continue;
    lines.push(`### ${section}`, "");
    for (const commit of entries) {
      const area = inferArea(commit);
      const label = area ? `**${area}:** ` : "";
      const commitUrl = `https://github.com/${repo}/commit/${commit.hash}`;
      lines.push(`- ${label}${commit.description} ([${commit.shortHash}](${commitUrl}))`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function renderStandaloneChangelog({ commits, date, range, repo, version }) {
  const entryTitle = version ? `[v${version}]` : `[${range.to}]`;
  const body = renderTechnicalChangelog(commits, repo).replace(/^## Technical Changelog\n\n/, "");
  return [
    "# Changelog",
    "",
    `## ${entryTitle} - ${date}`,
    "",
    body,
    "",
    "### Metadata",
    "",
    `- Range: \`${range.from ?? "(repository start)"}..${range.to}\``,
    `- Commits: ${commits.length}`,
    "",
  ].join("\n");
}

function matchSummaryTopics(commits, changedFiles) {
  const corpus = [
    ...commits.map((commit) => `${commit.subject} ${commit.description} ${commit.scope ?? ""}`),
    ...changedFiles,
  ];
  return SUMMARY_TOPIC_RULES
    .map((rule) => ({
      ...rule,
      count: corpus.filter((entry) => rule.pattern.test(entry)).length,
    }))
    .filter((rule) => rule.count > 0)
    .sort((left, right) => right.count - left.count);
}

function renderUpgradeNotes(commits) {
  const breaking = commits.filter((commit) => commit.section === BREAKING_SECTION);
  const releaseRisk = commits.filter((commit) => /release|sign|notar|installer|package|publish|migration|database|schema/i.test(commit.subject));
  const lines = ["### Upgrade Notes", ""];
  if (breaking.length > 0) {
    lines.push(...breaking.slice(0, 5).map((commit) => `- Breaking: ${commit.description}.`));
  } else if (releaseRisk.length > 0) {
    lines.push(
      "- No breaking changes were identified from conventional commit markers.",
      "- Review release, installer, signing, package, migration, or schema-related technical changelog entries before publishing.",
    );
  } else {
    lines.push("- No breaking changes were identified from conventional commit markers.");
  }
  return lines;
}

function renderDeterministicSummary({ commits, changedFiles, range, version }) {
  const groups = groupedCommits(commits);
  const topics = matchSummaryTopics(commits, changedFiles).slice(0, 5);
  const fallbackHighlights = [...groups.Added, ...groups.Fixed, ...groups.Changed].slice(0, 5);
  const displayRange = `${range.from ?? "(repository start)"}..${range.to}`;
  const displayVersion = version ? `v${version}` : range.to;
  const lines = ["## Summary", ""];
  lines.push(
    `Routa Desktop ${displayVersion} includes ${commits.length} non-merge commits from \`${displayRange}\`.`,
    "",
    "### Highlights",
    "",
  );
  if (topics.length > 0) {
    for (const topic of topics) {
      lines.push(`- **${topic.label}:** ${topic.outcome}`);
    }
  } else if (fallbackHighlights.length > 0) {
    for (const commit of fallbackHighlights) {
      const area = inferArea(commit);
      lines.push(`- ${area ? `**${area}:** ` : ""}${commit.description}.`);
    }
  } else {
    lines.push("- No user-visible commit summaries were found for this range.");
  }
  if (changedFiles.length > 0) {
    const topLevel = [...new Set(changedFiles.map((file) => file.split("/")[0]))].slice(0, 8);
    lines.push("", `Changed top-level areas: ${topLevel.map((area) => `\`${area}\``).join(", ")}.`);
  }
  lines.push("", ...renderUpgradeNotes(commits));
  return lines.join("\n");
}

function readOptionalSummary(summaryFile) {
  if (!summaryFile) return null;
  const summary = fs.readFileSync(summaryFile, "utf8").trim();
  return summary.length > 0 ? `## Summary\n\n${summary}` : null;
}

function buildSpecialistPrompt({ commits, changedFiles, range, repo, version }) {
  return JSON.stringify({
    task: "Generate the AI-Powered Changelog Summary for a Routa Desktop GitHub draft release. Return strict JSON: {\"summaryMarkdown\":\"...\"}. The markdown must be concise, user-facing, and must not repeat the full technical changelog.",
    repository: repo,
    version,
    range,
    changedFiles: changedFiles.slice(0, 180),
    commits: commits.slice(0, 120).map((commit) => ({
      hash: commit.shortHash,
      subject: commit.subject,
      section: commit.section,
      area: inferArea(commit),
      author: commit.author,
    })),
    outputContract: {
      summaryMarkdown: "Markdown paragraphs and bullets only. Mention breaking changes/upgrade notes when commits imply them.",
    },
  }, null, 2);
}

function extractJsonObject(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("specialist output did not contain a JSON object");
  }
  return JSON.parse(output.slice(start, end + 1));
}

function runAiSummary(prompt, { aiProvider }) {
  const routaArgs = [
    "run",
    "-p",
    "routa-cli",
    "--",
    "specialist",
    "run",
    DEFAULT_SPECIALIST,
    "--json",
    "--prompt",
    prompt.slice(0, 30000),
  ];
  if (aiProvider) {
    routaArgs.push("--provider", aiProvider);
  }
  const result = spawnSync(process.env.ROUTA_RELEASE_RUNNER ?? "cargo", routaArgs, {
    encoding: "utf8",
    timeout: Number(process.env.ROUTA_RELEASE_AI_TIMEOUT_MS ?? 300000),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `specialist exited with ${result.status}`);
  }
  const parsed = extractJsonObject(result.stdout);
  if (typeof parsed.summaryMarkdown !== "string" || !parsed.summaryMarkdown.trim()) {
    throw new Error("specialist JSON did not include summaryMarkdown");
  }
  return `## Summary\n\n${parsed.summaryMarkdown.trim()}`;
}

function renderReleaseNotes({ aiSummary, changedFiles, commits, range, repo, version }) {
  const titleVersion = version ? ` v${version}` : ` ${range.to}`;
  const summary = aiSummary ?? renderDeterministicSummary({ commits, changedFiles, range, version });
  const lines = [
    `# Routa Desktop${titleVersion}`,
    "",
    summary,
    "",
    renderTechnicalChangelog(commits, repo),
    "",
    "## Install",
    "",
    "Download the desktop installer for your platform from the release assets.",
    "",
    "CLI install:",
    "- `npm install -g routa-cli`",
    "- `npx -p routa-cli routa --help`",
    "",
    "## Release Metadata",
    "",
    `- Range: \`${range.from ?? "(repository start)"}..${range.to}\``,
    `- Commits: ${commits.length}`,
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function generate(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return { output: "" };
  }

  const range = resolveRange(args);
  const commits = readCommits(range);
  const changedFiles = readChangedFiles(range);
  const date = readRefDate(range.to);
  const version = args.version ?? (args.to?.startsWith("v") ? args.to.slice(1) : undefined);
  const prompt = buildSpecialistPrompt({ commits, changedFiles, range, repo: args.repo, version });

  if (args.promptOut) {
    writeText(args.promptOut, `${prompt}\n`);
  }

  let aiSummary = readOptionalSummary(args.summaryFile);
  if (!aiSummary && args.ai) {
    if (args.dryRunAi) {
      const promptPath = path.join(os.tmpdir(), `routa-changelog-summary-${Date.now()}.json`);
      writeText(promptPath, `${prompt}\n`);
      console.error(`AI dry-run prompt written to ${promptPath}`);
    } else {
      aiSummary = runAiSummary(prompt, args);
    }
  }

  const output = renderReleaseNotes({
    aiSummary,
    changedFiles,
    commits,
    range,
    repo: args.repo,
    version,
  });

  if (args.out) {
    writeText(args.out, output);
  } else {
    process.stdout.write(output);
  }

  const changelog = renderStandaloneChangelog({
    commits,
    date,
    range,
    repo: args.repo,
    version,
  });
  if (args.changelogOut) {
    writeText(args.changelogOut, changelog);
  }
  return { changelog, output, prompt };
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  try {
    generate();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

export {
  buildSpecialistPrompt,
  classifyCommit,
  generate,
  groupedCommits,
  parseArgs,
  parseCommitHeader,
  renderReleaseNotes,
  renderStandaloneChangelog,
  renderTechnicalChangelog,
  shouldIncludeCommit,
};
