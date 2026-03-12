import { describe, it, expect } from "vitest";
import {
  buildMaintainerIssueTriagePrompt,
  findDuplicateIssueCandidates,
  type GitHubIssueLite,
} from "../github-issue-maintainer";

function issue(input: Partial<GitHubIssueLite> & Pick<GitHubIssueLite, "number" | "title">): GitHubIssueLite {
  return {
    id: input.id ?? input.number,
    number: input.number,
    title: input.title,
    body: input.body ?? "",
    state: input.state ?? "open",
    labels: input.labels ?? [],
    assignees: input.assignees ?? [],
    user: input.user,
    htmlUrl: input.htmlUrl ?? `https://github.com/phodal/routa/issues/${input.number}`,
    createdAt: input.createdAt ?? "",
    updatedAt: input.updatedAt ?? "",
  };
}

describe("findDuplicateIssueCandidates", () => {
  it("ranks highly similar titles as duplicate candidates", () => {
    const candidates = findDuplicateIssueCandidates({
      currentIssue: {
        number: 128,
        title: "Add backend maintainer agent for issue duplicate analysis",
        body: "Need local sync and duplicate recommendations",
      },
      issues: [
        issue({ number: 99, title: "backend maintainer agent for duplicate analysis", body: "Local issue sync" }),
        issue({ number: 100, title: "UI polish for dashboard" }),
      ],
    });

    expect(candidates.length).toBe(1);
    expect(candidates[0]?.issueNumber).toBe(99);
    expect(candidates[0]?.score).toBeGreaterThan(0.5);
  });

  it("returns empty when there is no overlap", () => {
    const candidates = findDuplicateIssueCandidates({
      currentIssue: {
        number: 128,
        title: "Database migration rollback strategy",
        body: "",
      },
      issues: [
        issue({ number: 1, title: "Improve Kanban card drag animations" }),
      ],
    });

    expect(candidates).toEqual([]);
  });
});

describe("buildMaintainerIssueTriagePrompt", () => {
  it("includes duplicate candidates and mandatory checklist", () => {
    const prompt = buildMaintainerIssueTriagePrompt({
      issue: issue({ number: 128, title: "Need backend issue triage agent" }),
      snapshotSyncedAt: "2026-03-12T00:00:00.000Z",
      duplicateCandidates: [
        {
          issueNumber: 77,
          title: "Issue triage assistant",
          htmlUrl: "https://example.com/77",
          score: 0.81,
          reason: "title=0.80, body=0.85",
        },
      ],
    });

    expect(prompt).toContain("label `duplicated`");
    expect(prompt).toContain("#77 Issue triage assistant");
    expect(prompt).toContain("Periodic review note");
  });
});
