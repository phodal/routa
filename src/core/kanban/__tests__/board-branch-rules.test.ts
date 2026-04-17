import { describe, expect, it } from "vitest";
import {
  getKanbanBranchRules,
  setKanbanBranchRules,
  normalizeBranchRules,
  DEFAULT_BRANCH_RULES,
} from "../board-branch-rules";

describe("board-branch-rules", () => {
  describe("normalizeBranchRules", () => {
    it("returns defaults when input is undefined", () => {
      const rules = normalizeBranchRules(undefined);
      expect(rules.lifecycle.autoCreatePullRequest).toBe(false);
      expect(rules.lifecycle.deleteBranchOnMerge).toBe(true);
      expect(rules.lifecycle.removeWorktreeOnMerge).toBe(true);
      expect(rules.lifecycle.rebaseDownstream).toBe(true);
    });

    it("preserves explicit autoCreatePullRequest true", () => {
      const rules = normalizeBranchRules({
        lifecycle: { autoCreatePullRequest: true },
      });
      expect(rules.lifecycle.autoCreatePullRequest).toBe(true);
    });

    it("preserves explicit autoCreatePullRequest false", () => {
      const rules = normalizeBranchRules({
        lifecycle: { autoCreatePullRequest: false },
      });
      expect(rules.lifecycle.autoCreatePullRequest).toBe(false);
    });

    it("defaults autoCreatePullRequest to false for non-boolean values", () => {
      const rules = normalizeBranchRules({
        lifecycle: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          autoCreatePullRequest: "yes" as any,
        },
      });
      expect(rules.lifecycle.autoCreatePullRequest).toBe(false);
    });
  });

  describe("getKanbanBranchRules / setKanbanBranchRules", () => {
    it("returns defaults when no rules are stored", () => {
      expect(getKanbanBranchRules(undefined, "board-1")).toEqual(DEFAULT_BRANCH_RULES);
      expect(getKanbanBranchRules({ unrelated: "value" }, "board-1")).toEqual(DEFAULT_BRANCH_RULES);
    });

    it("stores and reads autoCreatePullRequest", () => {
      const metadata = setKanbanBranchRules(
        { unrelated: "value" },
        "board-1",
        { lifecycle: { autoCreatePullRequest: true } },
      );

      const rules = getKanbanBranchRules(metadata, "board-1");
      expect(rules.lifecycle.autoCreatePullRequest).toBe(true);
    });

    it("preserves other lifecycle settings when updating autoCreatePullRequest", () => {
      const metadata = setKanbanBranchRules(
        {},
        "board-1",
        { lifecycle: { deleteBranchOnMerge: false, rebaseDownstream: false } },
      );

      const rules = getKanbanBranchRules(metadata, "board-1");
      expect(rules.lifecycle.deleteBranchOnMerge).toBe(false);
      expect(rules.lifecycle.rebaseDownstream).toBe(false);
      expect(rules.lifecycle.removeWorktreeOnMerge).toBe(true); // default
      expect(rules.lifecycle.autoCreatePullRequest).toBe(false); // default
    });

    it("handles corrupted JSON gracefully", () => {
      const metadata = {
        "kanbanBranchRules:board-1": "not valid json{{{",
      };
      expect(getKanbanBranchRules(metadata, "board-1")).toEqual(DEFAULT_BRANCH_RULES);
    });
  });
});
