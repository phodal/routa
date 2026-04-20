import { describe, expect, it } from "vitest";
import en from "../en";

describe("en spec board copy", () => {
  it("includes the spec relationship labels used by the workspace spec page", () => {
    expect(en.specBoard.description).toContain("Local issue memory");
    expect(en.specBoard.status).toBe("Status");
    expect(en.specBoard.githubLinked).toBe("GitHub linked");
    expect(en.specBoard.connectedIssues).toBe("Connected issues");
    expect(en.specBoard.families).toBe("Families");
    expect(en.specBoard.featureFootprint).toBe("Feature Footprint");
    expect(en.specBoard.expandBranch).toBe("Expand branch");
    expect(en.specBoard.issueLinks).toBe("Issue Links");
    expect(en.specBoard.linkedFrom).toBe("Linked From");
    expect(en.specBoard.noLinkedIssues).toBe("No linked issues recorded.");
    expect(en.specBoard.noBacklinks).toBe("No other issues point here yet.");
  });
});
