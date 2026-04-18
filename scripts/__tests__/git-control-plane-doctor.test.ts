import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnSyncMock, existsSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
  default: {
    spawnSync: spawnSyncMock,
  },
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: existsSyncMock,
  },
}));

import {
  buildSessionStartDoctorOutput,
  formatGitControlPlaneDoctorReport,
  inspectGitControlPlane,
} from "../lib/git-control-plane-doctor.js";

function gitOk(stdout: string) {
  return {
    status: 0,
    stdout,
    stderr: "",
  };
}

function gitMissing(stderr = "") {
  return {
    status: 1,
    stdout: "",
    stderr,
  };
}

function installGitMock(values: {
  repoRoot?: string | null;
  hooksPath?: string | null;
  coreWorktree?: string | null;
  userName?: string | null;
  userEmail?: string | null;
}) {
  spawnSyncMock.mockImplementation((_command: string, args: string[]) => {
    const joined = args.join(" ");

    if (joined === "rev-parse --show-toplevel") {
      return values.repoRoot ? gitOk(`${values.repoRoot}\n`) : gitMissing("not a git repo");
    }

    if (joined === "config --local --get core.hooksPath") {
      return values.hooksPath ? gitOk(`${values.hooksPath}\n`) : gitMissing();
    }

    if (joined === "config --local --get core.worktree") {
      return values.coreWorktree ? gitOk(`${values.coreWorktree}\n`) : gitMissing();
    }

    if (joined === "config --local --get user.name") {
      return values.userName ? gitOk(`${values.userName}\n`) : gitMissing();
    }

    if (joined === "config --local --get user.email") {
      return values.userEmail ? gitOk(`${values.userEmail}\n`) : gitMissing();
    }

    throw new Error(`Unexpected git invocation: ${joined}`);
  });
}

describe("git control plane doctor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(true);
  });

  it("warns when local core.worktree is set", () => {
    installGitMock({
      repoRoot: "/repo",
      hooksPath: ".husky/_",
      coreWorktree: "/repo/.git/worktrees",
      userName: "Codex",
    });

    const report = inspectGitControlPlane("/repo");
    const hookOutput = buildSessionStartDoctorOutput(report);

    expect(report.status).toBe("warning");
    expect(report.localCoreWorktree).toBe("/repo/.git/worktrees");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unexpected-core-worktree",
        }),
        expect.objectContaining({
          code: "suspicious-local-user-name",
        }),
      ]),
    );
    expect(formatGitControlPlaneDoctorReport(report)).toContain("core.worktree is set");
    expect(hookOutput?.systemMessage).toContain("core.worktree");
  });

  it("reports ok when hooks and local git config are clean", () => {
    installGitMock({
      repoRoot: "/repo",
      hooksPath: ".husky/_",
    });

    const report = inspectGitControlPlane("/repo");

    expect(report.status).toBe("ok");
    expect(report.issues).toEqual([]);
    expect(report.localCoreWorktree).toBeNull();
    expect(buildSessionStartDoctorOutput(report)).toBeNull();
  });
});
