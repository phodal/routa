import { describe, expect, it } from "vitest";
import type { TranslationDictionary } from "../types";
import en from "../locales/en";

describe("translation dictionary types", () => {
  it("includes the spec board relationship keys exposed by the base dictionary", () => {
    const specBoard: TranslationDictionary["specBoard"] = en.specBoard;

    expect(specBoard.status).toBe("Status");
    expect(specBoard.githubLinked).toBe("GitHub linked");
    expect(specBoard.connectedIssues).toBe("Connected issues");
    expect(specBoard.families).toBe("Families");
    expect(specBoard.sameFamily).toBe("Same Family");
    expect(specBoard.featureFootprint).toBe("Feature Footprint");
    expect(specBoard.expandBranch).toBe("Expand branch");
    expect(specBoard.collapseBranch).toBe("Collapse branch");
    expect(specBoard.issueLinks).toBe("Issue Links");
    expect(specBoard.linkedFrom).toBe("Linked From");
    expect(specBoard.noLinkedIssues).toBe("No linked issues recorded.");
    expect(specBoard.noBacklinks).toBe("No other issues point here yet.");
    expect(specBoard.noSurfaceHits).toBe("No matched product surfaces yet.");
    expect(specBoard.selectIssue).toBe("Select an issue");
    expect(specBoard.selectIssueBody).toContain("GitHub tracker");
  });
});
