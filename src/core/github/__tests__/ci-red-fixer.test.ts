import { describe, it, expect } from "vitest";
import {
  buildRepairPrompt,
  collectValidationCommands,
  findUnmappedJobs,
  normalizeJobSummary,
  normalizeRunSummary,
  pickFailedJobs,
  pickRepairCandidateRun,
  trimLogExcerpt,
} from "@/core/github/ci-red-fixer";

describe("ci-red-fixer helpers", () => {
  it("only repairs when the latest completed run failed", () => {
    const failedRun = normalizeRunSummary({
      id: 101,
      name: "Defense",
      conclusion: "failure",
      head_branch: "main",
      head_sha: "abc123",
      html_url: "https://example.test/run/101",
      event: "push",
    });

    const successfulRun = normalizeRunSummary({
      id: 102,
      name: "Defense",
      conclusion: "success",
      head_branch: "main",
      head_sha: "def456",
      html_url: "https://example.test/run/102",
      event: "push",
    });

    expect(pickRepairCandidateRun([failedRun])).toEqual(failedRun);
    expect(pickRepairCandidateRun([successfulRun])).toBeNull();
  });

  it("maps failed Defense jobs to validation commands", () => {
    const failedJobs = pickFailedJobs([
      normalizeJobSummary({ id: 1, name: "Gate: Fitness", conclusion: "failure" }),
      normalizeJobSummary({ id: 2, name: "Security: Dependency Scan", conclusion: "failure" }),
      normalizeJobSummary({ id: 3, name: "Fitness Report", conclusion: "success" }),
    ]);

    expect(failedJobs.map((job) => job.name)).toEqual([
      "Gate: Fitness",
      "Security: Dependency Scan",
    ]);

    expect(collectValidationCommands(failedJobs.map((job) => job.name))).toEqual([
      "entrix run --tier normal --scope ci --min-score 0 --output .artifacts/fitness-report.json",
      "npm audit --audit-level=critical",
    ]);
  });

  it("flags unmapped jobs to keep automation conservative", () => {
    expect(findUnmappedJobs(["Gate: Fitness", "Some New Gate"])).toEqual([
      "Some New Gate",
    ]);
  });

  it("keeps the tail of long logs", () => {
    expect(trimLogExcerpt("abcdef", 4)).toBe("[truncated to last 4 chars]\ncdef");
    expect(trimLogExcerpt("abcd", 10)).toBe("abcd");
  });

  it("builds a repair prompt with run and job context", () => {
    const prompt = buildRepairPrompt({
      repo: "owner/repo",
      targetRun: normalizeRunSummary({
        id: 201,
        name: "Defense",
        conclusion: "failure",
        head_branch: "main",
        head_sha: "deadbeef",
        html_url: "https://example.test/run/201",
        event: "push",
        display_title: "fix: broken lint",
      }),
      failedJobs: [
        {
          job: normalizeJobSummary({
            id: 301,
            name: "Gate: Fitness",
            conclusion: "failure",
            html_url: "https://example.test/job/301",
          }),
          validationCommands: ["entrix run --tier normal --scope ci --min-score 0 --output .artifacts/fitness-report.json"],
          logExcerpt: "ESLint found 1 error",
        },
      ],
    });

    expect(prompt).toContain('workflow "Defense"');
    expect(prompt).toContain("Run ID: 201");
    expect(prompt).toContain("Failed Job: Gate: Fitness");
    expect(prompt).toContain("`entrix run --tier normal --scope ci --min-score 0 --output .artifacts/fitness-report.json`");
    expect(prompt).toContain("ESLint found 1 error");
  });
});
