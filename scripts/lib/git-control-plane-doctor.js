import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const EXPECTED_HOOKS_PATH = ".husky/_";
export const REQUIRED_HOOK_FILES = [
  "h",
  "pre-commit",
  "pre-push",
  "post-commit",
  "prepare-commit-msg",
  "commit-msg",
];
const SUSPICIOUS_LOCAL_IDENTITY_PATTERNS = {
  email: [/@example\.com$/i, /placeholder/i],
  name: [/^test$/i, /^codex$/i, /placeholder/i, /routa test/i],
};

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    exitCode: result.status ?? 1,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function readLocalGitConfig(repoRoot, key) {
  const result = runGit(["config", "--local", "--get", key], repoRoot);
  if (result.exitCode !== 0) {
    return null;
  }

  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

export function resolveGitRepoRoot(cwd = process.cwd()) {
  const result = runGit(["rev-parse", "--show-toplevel"], cwd);
  if (result.exitCode !== 0) {
    return null;
  }

  const repoRoot = result.stdout.trim();
  return repoRoot.length > 0 ? repoRoot : null;
}

function getMissingHookRuntimeFiles(repoRoot) {
  return REQUIRED_HOOK_FILES.filter((file) => {
    return !fs.existsSync(path.join(repoRoot, EXPECTED_HOOKS_PATH, file));
  });
}

function createIssue(code, message, severity = "warning", details = {}) {
  return {
    code,
    message,
    severity,
    ...details,
  };
}

function isSuspiciousLocalUserName(value) {
  if (!value) return false;
  return SUSPICIOUS_LOCAL_IDENTITY_PATTERNS.name.some((pattern) => pattern.test(value));
}

function isSuspiciousLocalUserEmail(value) {
  if (!value) return false;
  return SUSPICIOUS_LOCAL_IDENTITY_PATTERNS.email.some((pattern) => pattern.test(value));
}

export function inspectGitControlPlane(cwd = process.cwd()) {
  const repoRoot = resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    return {
      repoRoot: null,
      status: "skipped",
      issues: [],
      summary: "Not inside a git worktree.",
    };
  }

  const hooksPath = readLocalGitConfig(repoRoot, "core.hooksPath");
  const localCoreWorktree = readLocalGitConfig(repoRoot, "core.worktree");
  const localUserName = readLocalGitConfig(repoRoot, "user.name");
  const localUserEmail = readLocalGitConfig(repoRoot, "user.email");
  const missingHookRuntimeFiles = getMissingHookRuntimeFiles(repoRoot);
  const issues = [];

  if (missingHookRuntimeFiles.length > 0) {
    issues.push(
      createIssue(
        "missing-husky-runtime",
        `Husky runtime is missing or incomplete: missing ${missingHookRuntimeFiles.join(", ")} under ${EXPECTED_HOOKS_PATH}. Run \`npm run hooks:sync\`.`,
        "warning",
        { missingHookRuntimeFiles },
      ),
    );
  }

  if (hooksPath !== EXPECTED_HOOKS_PATH) {
    issues.push(
      createIssue(
        "hooks-path-drift",
        `core.hooksPath is ${hooksPath ?? "<unset>"} but this repo expects ${EXPECTED_HOOKS_PATH}. Run \`npm run hooks:sync\`.`,
        "warning",
        {
          currentHooksPath: hooksPath,
          expectedHooksPath: EXPECTED_HOOKS_PATH,
        },
      ),
    );
  }

  if (localCoreWorktree) {
    issues.push(
      createIssue(
        "unexpected-core-worktree",
        `Local git core.worktree is set to "${localCoreWorktree}". This repo expects core.worktree to stay unset in the primary checkout; unexpected values can make Git treat the wrong path as repo root.`,
        "warning",
        { localCoreWorktree },
      ),
    );
  }

  if (isSuspiciousLocalUserName(localUserName)) {
    issues.push(
      createIssue(
        "suspicious-local-user-name",
        `Local git user.name is the placeholder value "${localUserName}". Remove or replace it before committing.`,
        "warning",
        { localUserName },
      ),
    );
  }

  if (isSuspiciousLocalUserEmail(localUserEmail)) {
    issues.push(
      createIssue(
        "suspicious-local-user-email",
        `Local git user.email is the placeholder value "${localUserEmail}". Remove or replace it before committing.`,
        "warning",
        { localUserEmail },
      ),
    );
  }

  return {
    repoRoot,
    status: issues.length > 0 ? "warning" : "ok",
    summary:
      issues.length > 0
        ? "Git control-plane drift detected."
        : "Git control-plane configuration matches repo policy.",
    hooksPath,
    localCoreWorktree,
    expectedHooksPath: EXPECTED_HOOKS_PATH,
    localUserName,
    localUserEmail,
    missingHookRuntimeFiles,
    issues,
  };
}

export function formatGitControlPlaneDoctorReport(report) {
  if (report.status === "skipped") {
    return "[git:doctor] skipped: not inside a git worktree.";
  }

  if (report.issues.length === 0) {
    return `[git:doctor] ok: ${report.summary}`;
  }

  const lines = [`[git:doctor] warning: ${report.summary}`];
  for (const issue of report.issues) {
    lines.push(`- ${issue.message}`);
  }
  return lines.join("\n");
}

export function buildSessionStartDoctorOutput(report) {
  if (!report || report.issues.length === 0) {
    return null;
  }

  const hints = [];
  if (report.issues.some((issue) => issue.code === "hooks-path-drift")) {
    hints.push("repair hooksPath with `npm run hooks:sync`");
  }
  if (report.issues.some((issue) => issue.code === "missing-husky-runtime")) {
    hints.push("reinstall Husky runtime with `npm run hooks:sync`");
  }
  if (report.issues.some((issue) => issue.code === "unexpected-core-worktree")) {
    hints.push("remove the unexpected local core.worktree override before continuing");
  }
  if (
    report.issues.some((issue) =>
      issue.code === "suspicious-local-user-name" || issue.code === "suspicious-local-user-email",
    )
  ) {
    hints.push("clean local git user.name / user.email placeholders before committing");
  }

  const remediation = hints.length > 0 ? ` Recommended fix: ${hints.join("; ")}.` : "";
  return {
    systemMessage: `[git:doctor] ${report.summary}${remediation}`,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext:
        "Repository control-plane drift is treated as suspicious. Do not mutate .git/config or hook files manually; use npm run hooks:sync for hooksPath repair, keep core.worktree unset in the primary checkout, and avoid placeholder commit identity values.",
    },
  };
}
