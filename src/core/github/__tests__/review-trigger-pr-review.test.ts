import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzePullRequestReviewTriggers,
  buildAutomatedReviewComment,
  buildPullRequestDiffStats,
  filterReviewTriggerFiles,
} from "@/core/github/review-trigger-pr-review";
import type { ReviewTriggerReport } from "@/core/harness/review-triggers";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("review-trigger-pr-review", () => {
  it("filters unsupported pull request file statuses before computing diff stats", () => {
    const files = filterReviewTriggerFiles([
      { filename: "src/core/acp/session.ts", status: "modified", additions: 12, deletions: 3 },
      { filename: "docs/README.md", status: "removed", additions: 0, deletions: 8 },
    ]);

    expect(files.map((file) => file.filename)).toEqual(["src/core/acp/session.ts"]);
    expect(buildPullRequestDiffStats(files)).toEqual({
      fileCount: 1,
      addedLines: 12,
      deletedLines: 3,
    });
  });

  it("builds a default review request when no trigger report is available", () => {
    const comment = buildAutomatedReviewComment({ report: null });

    expect(comment).toContain("@augment review");
    expect(comment).toContain("Standard review request.");
    expect(comment).toContain("high-confidence findings only");
  });

  it("builds a trigger-aware review request with policy context", () => {
    const report: ReviewTriggerReport = {
      blocked: false,
      humanReviewRequired: false,
      advisoryOnly: false,
      stagedReviewRequired: true,
      base: "main",
      changedFiles: [
        "src/app/api/review/route.ts",
        "crates/routa-server/src/api/review.rs",
      ],
      diffStats: {
        fileCount: 2,
        addedLines: 120,
        deletedLines: 20,
      },
      triggers: [
        {
          name: "cross_boundary_change_web_rust",
          severity: "medium",
          action: "staged",
          confidenceThreshold: 8,
          fallbackAction: "require_human_review",
          specialistId: null,
          provider: null,
          model: null,
          context: ["graph_review_context"],
          reviewLayers: [],
          reasons: [
            "changed boundary 'web': src/app/api/review/route.ts",
            "changed boundary 'rust': crates/routa-server/src/api/review.rs",
          ],
        },
      ],
    };

    const comment = buildAutomatedReviewComment({
      report,
      configRelativePath: "docs/fitness/review-triggers.yaml",
    });

    expect(comment).toContain("Repository review-trigger guidance matched this PR");
    expect(comment).toContain("staged AI review applies here");
    expect(comment).toContain("cross-boundary behavior, API parity, and integration fallout");
    expect(comment).toContain("graph impact and transitive callers/callees");
    expect(comment).toContain("confidence 8");
  });

  it("analyzes pull request files against repository review triggers", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "routa-pr-review-"));
    tempDirs.push(repoRoot);

    fs.mkdirSync(path.join(repoRoot, "docs", "fitness"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "docs", "fitness", "review-triggers.yaml"), [
      "review_triggers:",
      "  - name: high_risk_directory_change",
      "    type: changed_paths",
      "    severity: high",
      "    action: staged",
      "    confidence_threshold: 8",
      "    fallback_action: require_human_review",
      "    paths:",
      "      - src/core/acp/**",
      "  - name: oversized_change",
      "    type: diff_size",
      "    severity: medium",
      "    action: advisory",
      "    max_files: 1",
    ].join("\n"));

    const analysis = await analyzePullRequestReviewTriggers({
      repoRoot,
      baseRef: "main",
      files: [
        { filename: "src/core/acp/session.ts", status: "modified", additions: 12, deletions: 1 },
        { filename: "README.md", status: "removed", additions: 0, deletions: 4 },
      ],
    });

    expect(analysis.configRelativePath).toBe("docs/fitness/review-triggers.yaml");
    expect(analysis.report?.changedFiles).toEqual(["src/core/acp/session.ts"]);
    expect(analysis.report?.diffStats.fileCount).toBe(1);
    expect(analysis.report?.triggers.map((trigger) => trigger.name)).toEqual([
      "high_risk_directory_change",
    ]);
  });
});
