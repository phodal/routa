import { describe, expect, it } from "vitest";

import {
  filterValidatedFindings,
  isTestFile,
  validateReviewFinding,
  type RawReviewFinding,
} from "../multi-phase-review";

function finding(partial: Partial<RawReviewFinding>): RawReviewFinding {
  return {
    file: "src/app/api/review/route.ts",
    line: 10,
    category: "logic",
    severity: "WARNING",
    rawConfidence: 7,
    description: "Potential null dereference when parsing response payload",
    suggestion: "Guard payload before dereferencing nested fields",
    ...partial,
  };
}

describe("isTestFile", () => {
  it("detects common test file patterns", () => {
    expect(isTestFile("src/foo/__tests__/a.test.ts")).toBe(true);
    expect(isTestFile("e2e/specs/login.spec.ts")).toBe(true);
    expect(isTestFile("src/a/b/c.test.tsx")).toBe(true);
    expect(isTestFile("src/core/logic.ts")).toBe(false);
  });
});

describe("validateReviewFinding", () => {
  it("rejects validation-only issues in test files", () => {
    const result = validateReviewFinding(
      finding({
        file: "src/core/__tests__/validator.test.ts",
        category: "input validation",
        description: "missing input validation in test",
      }),
    );

    expect(result.verdict).toBe("REJECT");
    expect(result.validatedConfidence).toBe(3);
  });

  it("rejects style/lint covered findings", () => {
    const result = validateReviewFinding(
      finding({
        category: "style formatting",
        description: "inconsistent spacing",
      }),
      { linterCoveredCategories: ["formatting"] },
    );

    expect(result.verdict).toBe("REJECT");
    expect(result.reasoning).toContain("linting");
  });

  it("rejects framework-handled findings when no concrete unsafe usage", () => {
    const result = validateReviewFinding(
      finding({
        category: "security",
        description: "possible xss in react output rendering",
        suggestion: "react should escape this by default",
      }),
    );

    expect(result.verdict).toBe("REJECT");
  });

  it("keeps dangerous React finding when dangerouslySetInnerHTML is explicitly mentioned", () => {
    const result = validateReviewFinding(
      finding({
        category: "security",
        rawConfidence: 8,
        concreteEvidence: true,
        description: "User content flows into dangerouslySetInnerHTML without sanitization.",
        suggestion: "sanitize content before dangerouslySetInnerHTML.",
      }),
    );

    expect(result.verdict).toBe("KEEP");
    expect(result.validatedConfidence).toBe(10);
  });

  it("rejects TODO/FIXME/HACK marker findings", () => {
    const result = validateReviewFinding(
      finding({
        category: "maintainability",
        description: "TODO marker found in prod code",
      }),
    );

    expect(result.verdict).toBe("REJECT");
    expect(result.validatedConfidence).toBe(2);
  });

  it("rejects missing logging findings", () => {
    const result = validateReviewFinding(
      finding({
        category: "observability",
        description: "missing audit trail when deleting workspace",
      }),
    );

    expect(result.verdict).toBe("REJECT");
  });

  it("reduces speculative findings below threshold", () => {
    const result = validateReviewFinding(
      finding({
        rawConfidence: 8,
        description: "This might be a possible issue and could potentially fail.",
      }),
    );

    expect(result.verdict).toBe("REJECT");
    expect(result.validatedConfidence).toBe(5);
  });

  it("keeps concrete high-confidence findings", () => {
    const result = validateReviewFinding(
      finding({
        rawConfidence: 7,
        concreteEvidence: true,
      }),
    );

    expect(result.verdict).toBe("KEEP");
    expect(result.validatedConfidence).toBe(9);
  });

  it("clamps confidence to lower bound", () => {
    const result = validateReviewFinding(
      finding({
        rawConfidence: 0,
        description: "theoretical and speculative",
      }),
    );

    expect(result.validatedConfidence).toBe(1);
  });

  it("clamps confidence to upper bound", () => {
    const result = validateReviewFinding(
      finding({
        rawConfidence: 10,
        concreteEvidence: true,
      }),
    );

    expect(result.validatedConfidence).toBe(10);
  });
});

describe("filterValidatedFindings", () => {
  it("returns only KEEP findings", () => {
    const findings: RawReviewFinding[] = [
      finding({ rawConfidence: 8, concreteEvidence: true }),
      finding({ category: "style", description: "formatting mismatch" }),
      finding({ rawConfidence: 6, description: "possible issue maybe" }),
    ];

    const result = filterValidatedFindings(findings);

    expect(result).toHaveLength(1);
    expect(result[0]?.verdict).toBe("KEEP");
  });
});
