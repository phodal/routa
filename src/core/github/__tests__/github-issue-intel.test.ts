import { describe, expect, it } from "vitest";
import { findDuplicateCandidates, type GitHubIssueRecord } from "../github-issue-intel";

describe("findDuplicateCandidates", () => {
  it("returns similar issues ranked by score", () => {
    const issues: GitHubIssueRecord[] = [
      {
        number: 11,
        title: "Kanban column automation does not trigger session",
        body: "Moving cards to In Progress should create an ACP session but nothing happens.",
        state: "OPEN",
        url: "https://github.com/phodal/routa/issues/11",
      },
      {
        number: 12,
        title: "UI alignment issue in settings panel",
        body: "Minor css spacing problem",
        state: "OPEN",
        url: "https://github.com/phodal/routa/issues/12",
      },
      {
        number: 13,
        title: "Kanban automation session creation missing after card move",
        body: "When card moves into automation column, no workflow session starts.",
        state: "CLOSED",
        url: "https://github.com/phodal/routa/issues/13",
      },
    ];

    const candidates = findDuplicateCandidates(
      {
        number: 200,
        title: "Card move to automation column fails to create session",
        body: "Expected ACP session trigger after moving kanban card.",
      },
      issues,
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].number === 11 || candidates[0].number === 13).toBe(true);
    expect(candidates.some((c) => c.number === 11)).toBe(true);
    expect(candidates.some((c) => c.number === 13)).toBe(true);
    expect(candidates.some((c) => c.number === 12)).toBe(false);
  });
});
