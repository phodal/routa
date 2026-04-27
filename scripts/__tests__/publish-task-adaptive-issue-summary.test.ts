import { describe, expect, it, vi } from "vitest";

import {
  parseArgs,
  run,
  TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER,
} from "../harness/publish-task-adaptive-issue-summary";

describe("publish-task-adaptive-issue-summary", () => {
  it("parses publish-oriented flags", () => {
    expect(parseArgs([
      "--repo-root", "/repo",
      "--repo", "phodal/routa",
      "--issue", "525",
      "--publish",
      "--dry-run",
      "--json",
      "--load-only",
      "--max-features", "6",
      "--max-files", "10",
    ])).toEqual({
      repoRoot: "/repo",
      repo: "phodal/routa",
      issueNumber: 525,
      publish: true,
      dryRun: true,
      json: true,
      refresh: false,
      maxFeatures: 6,
      maxFiles: 10,
    });
  });

  it("requires an issue number when publishing", () => {
    expect(() => parseArgs(["--publish"])).toThrow("--publish requires --issue <number>");
  });

  it("creates a marked comment when none exists", async () => {
    const buildSummary = vi.fn().mockResolvedValue({
      generatedAt: "2026-04-22T16:00:00.000Z",
      source: "refreshed",
      repo: {
        root: "/repo",
        githubRepo: "phodal/routa",
        branch: "main",
        commit: "abc1234",
      },
      thresholds: {
        minFileSessions: 2,
        minFeatureSessions: 2,
      },
      counts: {
        featureProfiles: 1,
        fileProfiles: 1,
      },
      topFailureCategories: [],
      topFeatures: [],
      recommendedFollowUpFiles: [],
      topFiles: [],
      warnings: [],
    });
    const formatMarkdown = vi.fn().mockReturnValue(`${TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER}\nsummary\n`);
    const listComments = vi.fn().mockResolvedValue([]);
    const createComment = vi.fn().mockResolvedValue({
      id: "comment-1",
      url: "https://github.com/phodal/routa/issues/525#issuecomment-1",
    });
    const updateComment = vi.fn();

    const result = await run({
      repoRoot: "/repo",
      repo: "phodal/routa",
      issueNumber: 525,
      publish: true,
      dryRun: false,
      json: false,
      refresh: true,
    }, {
      buildSummary,
      formatMarkdown,
      resolveRepo: vi.fn(),
      listComments,
      createComment,
      updateComment,
    });

    expect(createComment).toHaveBeenCalledWith("phodal/routa", 525, `${TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER}\nsummary\n`);
    expect(updateComment).not.toHaveBeenCalled();
    expect(result.published).toEqual({
      action: "created",
      repo: "phodal/routa",
      issueNumber: 525,
      commentId: "comment-1",
      url: "https://github.com/phodal/routa/issues/525#issuecomment-1",
    });
  });

  it("updates the existing marked comment instead of creating a duplicate", async () => {
    const buildSummary = vi.fn().mockResolvedValue({
      generatedAt: "2026-04-22T16:00:00.000Z",
      source: "cached",
      repo: {
        root: "/repo",
        githubRepo: "phodal/routa",
        branch: "main",
        commit: "abc1234",
      },
      thresholds: {
        minFileSessions: 2,
        minFeatureSessions: 2,
      },
      counts: {
        featureProfiles: 1,
        fileProfiles: 1,
      },
      topFailureCategories: [],
      topFeatures: [],
      recommendedFollowUpFiles: [],
      topFiles: [],
      warnings: [],
    });
    const formatMarkdown = vi.fn().mockReturnValue(`${TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER}\nupdated\n`);
    const listComments = vi.fn().mockResolvedValue([
      {
        id: "comment-2",
        body: `${TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER}\nold\n`,
        url: "https://github.com/phodal/routa/issues/525#issuecomment-2",
      },
    ]);
    const createComment = vi.fn();
    const updateComment = vi.fn().mockResolvedValue({
      id: "comment-2",
      url: "https://github.com/phodal/routa/issues/525#issuecomment-2",
    });

    const result = await run({
      repoRoot: "/repo",
      repo: "phodal/routa",
      issueNumber: 525,
      publish: true,
      dryRun: false,
      json: false,
      refresh: false,
    }, {
      buildSummary,
      formatMarkdown,
      resolveRepo: vi.fn(),
      listComments,
      createComment,
      updateComment,
    });

    expect(updateComment).toHaveBeenCalledWith("phodal/routa", "comment-2", `${TASK_ADAPTIVE_ISSUE_SUMMARY_MARKER}\nupdated\n`);
    expect(createComment).not.toHaveBeenCalled();
    expect(result.published?.action).toBe("updated");
  });
});
