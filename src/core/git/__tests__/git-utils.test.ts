import { beforeEach, describe, expect, it, vi } from "vitest";

const { gitExecMock } = vi.hoisted(() => ({
  gitExecMock: vi.fn(),
}));

vi.mock("@/core/platform", () => ({
  getServerBridge: () => ({
    env: {
      currentDir: () => "/workspace",
    },
    fs: {
      existsSync: vi.fn(() => false),
      readDirSync: vi.fn(() => []),
    },
  }),
}));

vi.mock("@/core/utils/safe-exec", () => ({
  gitExec: gitExecMock,
}));

const {
  getRepoChanges,
  getRepoFileDiff,
  invalidateRepoChangesCache,
  parseGitStatusPorcelain,
  isGitHubUrl,
  parseGitHubUrl,
  getRepoDeliveryStatus,
  getBranchStatus,
  listBranches,
  listRemoteBranches,
} = await import("../git-utils");

function formatGitArgs(args: string[]): string {
  return ["git", ...args].join(" ");
}

describe("parseGitStatusPorcelain", () => {
  beforeEach(() => {
    gitExecMock.mockReset();
  });

  it("preserves the first character of filenames in porcelain rows", () => {
    expect(parseGitStatusPorcelain(" M package-lock.json")).toEqual([
      { path: "package-lock.json", status: "modified", unstaged: true, unstagedStatus: "modified" },
    ]);
  });

  it("parses untracked files without rewriting their path", () => {
    expect(parseGitStatusPorcelain("?? package-lock.json")).toEqual([
      { path: "package-lock.json", status: "untracked", unstaged: true, unstagedStatus: "untracked" },
    ]);
  });

  it("parses renamed, copied, conflicted, and ignored entries", () => {
    expect(
      parseGitStatusPorcelain(
        "R  src/old.ts -> src/new.ts\nC  src/base.ts -> src/copied.ts\nUU src/conflict.ts\n!! dist/out.js\n",
      ),
    ).toEqual([
      { path: "src/new.ts", previousPath: "src/old.ts", status: "renamed", staged: true, stagedStatus: "renamed" },
      { path: "src/copied.ts", previousPath: "src/base.ts", status: "copied", staged: true, stagedStatus: "copied" },
      // Unmerged conflicts are never reported as staged.
      { path: "src/conflict.ts", status: "conflicted", unstaged: true, unstagedStatus: "conflicted" },
    ]);
  });

  it("marks index and worktree state separately (#570)", () => {
    expect(
      parseGitStatusPorcelain("M  staged.ts\n M unstaged.ts\nMD both.ts\nA  added.ts\n D gone.ts\nAA conflict.ts\n"),
    ).toEqual([
      { path: "staged.ts", status: "modified", staged: true, stagedStatus: "modified" },
      { path: "unstaged.ts", status: "modified", unstaged: true, unstagedStatus: "modified" },
      {
        path: "both.ts",
        status: "deleted",
        staged: true,
        unstaged: true,
        stagedStatus: "modified",
        unstagedStatus: "deleted",
      },
      { path: "added.ts", status: "added", staged: true, stagedStatus: "added" },
      { path: "gone.ts", status: "deleted", unstaged: true, unstagedStatus: "deleted" },
      { path: "conflict.ts", status: "conflicted", unstaged: true, unstagedStatus: "conflicted" },
    ]);
  });

  it("keeps the first file path intact when git status output starts with a leading space", () => {
    gitExecMock.mockImplementation((args: string[]) => {
      const command = formatGitArgs(args);
      if (command === "git rev-parse --abbrev-ref HEAD") return "main\n";
      if (command === "git status --porcelain -uall") return " M package-lock.json\n M package.json\n";
      if (command === "git rev-list --left-right --count HEAD...@{upstream}") {
        throw new Error("no upstream");
      }
      if (command === "git --no-pager diff --no-ext-diff --find-renames --find-copies --numstat") {
        return "";
      }
      if (command === "git --no-pager diff --no-ext-diff --find-renames --find-copies --cached --numstat") {
        return "";
      }
      if (command === "git --no-pager diff --no-ext-diff --find-renames --find-copies HEAD --numstat") {
        return "";
      }
      if (command === "git rev-parse --git-dir") return ".git\n";
      throw new Error(`Unexpected command: ${command}`);
    });

    expect(getRepoChanges("/tmp/repo").files.map((file) => file.path)).toEqual([
      "package-lock.json",
      "package.json",
    ]);
  });

  it("returns fresh status after invalidateRepoChangesCache (#570)", () => {
    let porcelain = " M a.ts\n";
    gitExecMock.mockImplementation((args: string[]) => {
      const command = formatGitArgs(args);
      if (command === "git rev-parse --abbrev-ref HEAD") return "main\n";
      if (command === "git status --porcelain -uall") return porcelain;
      if (command === "git rev-list --left-right --count HEAD...@{upstream}") {
        throw new Error("no upstream");
      }
      if (command.startsWith("git --no-pager diff")) return "";
      if (command === "git rev-parse --git-dir") return ".git\n";
      throw new Error(`Unexpected command: ${command}`);
    });

    const repo = "/tmp/repo-cache-570";
    expect(getRepoChanges(repo).files).toMatchObject([{ path: "a.ts", status: "modified", unstaged: true }]);

    porcelain = "M  a.ts\n";
    // Still within the cache window: stale result.
    expect(getRepoChanges(repo).files[0]?.staged).toBeUndefined();

    invalidateRepoChangesCache(repo);
    const fresh = getRepoChanges(repo).files;
    expect(fresh).toMatchObject([{ path: "a.ts", status: "modified", staged: true }]);
    expect(fresh[0]?.unstaged).toBeUndefined();
  });
});

describe("getRepoFileDiff staged side (#570)", () => {
  beforeEach(() => {
    gitExecMock.mockReset();
    gitExecMock.mockImplementation((args: string[]) => {
      const command = formatGitArgs(args);
      if (command.includes(" --cached ")) return "INDEX PATCH\n+a\n";
      if (command.includes(" HEAD ")) return "HEAD PATCH\n";
      if (command.startsWith("git --no-pager diff")) return "WORKTREE PATCH\n+b\n";
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it("prefers the working-tree patch by default", () => {
    expect(getRepoFileDiff("/tmp/repo", { path: "a.ts", status: "modified" }).patch).toContain("WORKTREE");
  });

  it("passes the rename source in the pathspec", () => {
    getRepoFileDiff("/tmp/repo", { path: "new.ts", previousPath: "old.ts", status: "renamed" }, { staged: true });
    expect(gitExecMock.mock.calls[0][0]).toEqual(
      expect.arrayContaining(["--cached", "--", "old.ts", "new.ts"]),
    );
  });

  it("returns the index patch for the staged row", () => {
    expect(
      getRepoFileDiff("/tmp/repo", { path: "a.ts", status: "modified" }, { staged: true }).patch,
    ).toContain("INDEX");
  });
});

describe("GitHub URL parsing", () => {
  it("detects GitHub URLs and owner/repo shorthand", () => {
    expect(isGitHubUrl("https://github.com/phodal/routa-js")).toBe(true);
    expect(isGitHubUrl("git@github.com:phodal/routa-js.git")).toBe(true);
    expect(isGitHubUrl("phodal/routa-js")).toBe(true);
    expect(isGitHubUrl("C:\\repos\\routa-js")).toBe(false);
  });

  it("parses multiple GitHub URL formats", () => {
    expect(parseGitHubUrl("https://github.com/phodal/routa-js.git")).toEqual({
      owner: "phodal",
      repo: "routa-js",
    });
    expect(parseGitHubUrl("git@github.com:phodal/routa-js.git")).toEqual({
      owner: "phodal",
      repo: "routa-js",
    });
    expect(parseGitHubUrl("phodal/routa-js")).toEqual({
      owner: "phodal",
      repo: "routa-js",
    });
    expect(parseGitHubUrl("/tmp/repo")).toBeNull();
  });
});

describe("delivery and branch status helpers", () => {
  beforeEach(() => {
    gitExecMock.mockReset();
  });

  it("computes delivery status for a clean GitHub-backed branch", () => {
    gitExecMock.mockImplementation((args: string[]) => {
      const command = formatGitArgs(args);
      if (command === "git rev-parse --abbrev-ref HEAD") return "feature/login\n";
      if (command === "git status --porcelain -uall") return "";
      if (command === "git rev-list --left-right --count HEAD...@{upstream}") return "2 0\n";
      if (command === "git remote get-url origin") return "https://github.com/phodal/routa-js.git\n";
      if (command === "git rev-parse --verify origin/main") return "abc123\n";
      if (command === "git rev-list --count origin/main..HEAD") return "3\n";
      if (command === "git rev-parse --git-dir") return ".git\n";
      if (command === "git rev-parse --is-bare-repository") return "false\n";
      throw new Error(`Unexpected command: ${command}`);
    });

    expect(
      getRepoDeliveryStatus("/tmp/repo", {
        baseBranch: "main",
      }),
    ).toEqual(
      expect.objectContaining({
        branch: "feature/login",
        baseBranch: "main",
        baseRef: "origin/main",
        commitsSinceBase: 3,
        hasCommitsSinceBase: true,
        hasUncommittedChanges: false,
        isGitHubRepo: true,
        canCreatePullRequest: true,
      }),
    );
  });

  it("computes branch ahead/behind status and uncommitted changes", () => {
    gitExecMock.mockImplementation((args: string[]) => {
      const command = formatGitArgs(args);
      if (command === "git rev-list --left-right --count feature/login...origin/feature/login") {
        return "4 1\n";
      }
      if (command === "git rev-parse --git-dir") return ".git\n";
      if (command === "git rev-parse --is-bare-repository") return "false\n";
      if (command === "git status --porcelain -uall") return " M src/app.ts\n";
      throw new Error(`Unexpected command: ${command}`);
    });

    expect(getBranchStatus("/tmp/repo", "feature/login")).toEqual({
      ahead: 4,
      behind: 1,
      hasUncommittedChanges: true,
    });
  });

  it("preserves apostrophes in local branch names", () => {
    gitExecMock.mockImplementation((args: string[]) => {
      const command = formatGitArgs(args);
      if (command === "git branch --format=%(refname:short)") {
        return "main\nuser's-branch\n";
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    expect(listBranches("/tmp/repo")).toEqual(["main", "user's-branch"]);
    expect(gitExecMock).toHaveBeenCalledWith(["branch", "--format=%(refname:short)"], { cwd: "/tmp/repo" });
  });

  it("preserves apostrophes in remote branch names", () => {
    gitExecMock.mockImplementation((args: string[]) => {
      const command = formatGitArgs(args);
      if (command === "git branch -r --format=%(refname:short)") {
        return "origin/main\norigin/user's-branch\n";
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    expect(listRemoteBranches("/tmp/repo")).toEqual(["main", "user's-branch"]);
    expect(gitExecMock).toHaveBeenCalledWith(["branch", "-r", "--format=%(refname:short)"], { cwd: "/tmp/repo" });
  });
});
