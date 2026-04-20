import { describe, expect, it } from "vitest";

import { buildIssueAnalysisPrompt } from "../../.github/scripts/issue-enricher-prompt";

const LABEL_TAXONOMY = {
  type: [
    { name: "bug" },
    { name: "enhancement" },
  ],
  area: [
    { name: "area:frontend" },
    { name: "area:devops" },
  ],
  complexity: [
    { name: "complexity:small" },
    { name: "complexity:medium" },
  ],
};

describe("issue enricher prompt", () => {
  it("includes repo-aware related PR file research instructions", () => {
    const prompt = buildIssueAnalysisPrompt({
      dryRun: true,
      issue: {
        number: 486,
        title: "Enhance Issue Enricher to fetch PR file changes for related issues",
        body: "Need historical PR file context for similar issues.",
        labels: ["enhancement", "area:devops"],
      },
      labelTaxonomy: LABEL_TAXONOMY,
      repo: "phodal/routa",
      syncContext: {
        syncedCount: 12,
        currentIssueFile: "docs/issues/2026-04-18-gh-486-enhance-issue-enricher.md",
      },
    });

    expect(prompt).toContain("## Related Issue PR Context");
    expect(prompt).toContain("gh issue view <issue-number> --repo phodal/routa --json number,title,url,closedByPullRequestsReferences");
    expect(prompt).toContain("gh api repos/phodal/routa/pulls/<pr-number>/files --paginate");
    expect(prompt).toContain("Related PR File Context");
    expect(prompt).toContain("fetch linked PR file changes and summarize them");
  });

  it("handles empty issue bodies without dropping PR context requirements", () => {
    const prompt = buildIssueAnalysisPrompt({
      dryRun: false,
      issue: {
        number: 487,
        title: "Follow-up",
        body: "",
        labels: [],
      },
      labelTaxonomy: LABEL_TAXONOMY,
      repo: "phodal/routa",
      syncContext: {
        syncedCount: 0,
      },
    });

    expect(prompt).toContain("(empty - user did not write a body)");
    expect(prompt).toContain('gh issue edit 487 --body "CONTENT"');
    expect(prompt).toContain("If a related issue has no linked PRs, say that explicitly.");
  });
});
