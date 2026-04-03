import { describe, expect, it } from "vitest";
import { deriveInvestValidationFromObjective } from "../invest-validation";

const CANONICAL_STORY_WITH_EXPLICIT_INVEST = `Story summary

\`\`\`yaml
story:
  version: 1
  language: en
  title: Automatic INVEST
  problem_statement: Teams need visible validation results.
  user_value: Reviewers can inspect story quality quickly.
  acceptance_criteria:
    - id: AC1
      text: Persist validation results.
      testable: true
  constraints_and_affected_areas:
    - src/app/api/tasks/route.ts
  dependencies_and_sequencing:
    independent_story_check: pass
    depends_on: []
    unblock_condition: none
  out_of_scope:
    - Specialist orchestration
  invest:
    independent:
      status: pass
      reason: No dependency is declared.
    negotiable:
      status: warning
      reason: Details can still be refined.
    valuable:
      status: pass
      reason: The quality signal is visible to reviewers.
    estimable:
      status: pass
      reason: Scope is narrow.
    small:
      status: pass
      reason: Delivery fits within one change set.
    testable:
      status: pass
      reason: API assertions can verify the snapshot.
\`\`\`
`;

const PLAIN_MARKDOWN_STORY = `## Summary
Validate stories automatically when they are created.

## Acceptance Criteria
- A new task gets an INVEST snapshot without requiring canonical YAML.
- Reviewers can see which principles are warnings or failures.

## Dependencies
- None. This can start now.
`;

describe("deriveInvestValidationFromObjective", () => {
  it("uses explicit canonical story invest checks when they exist", () => {
    const validation = deriveInvestValidationFromObjective(CANONICAL_STORY_WITH_EXPLICIT_INVEST);

    expect(validation).toMatchObject({
      overall: "warning",
      independent: { status: "pass" },
      negotiable: { status: "warning" },
      issues: ["Negotiable: Details can still be refined."],
    });
  });

  it("heuristically evaluates plain markdown stories without canonical yaml", () => {
    const validation = deriveInvestValidationFromObjective(PLAIN_MARKDOWN_STORY);

    expect(validation).toMatchObject({
      overall: "warning",
      independent: { status: "pass" },
      negotiable: { status: "warning" },
      testable: { status: "pass" },
    });
    expect(validation?.validatedAt).toEqual(expect.any(String));
    expect(validation?.issues).toContain(
      "Negotiable: Story is actionable, but negotiability still depends on team discussion.",
    );
  });

  it("fails independence when blocking prerequisites are declared", () => {
    const validation = deriveInvestValidationFromObjective(`## Summary
Ship a follow-up only after another task lands.

## Acceptance Criteria
- Feature is enabled in the UI.

## Dependencies
- Blocked by issue #200 landing first.
`);

    expect(validation).toMatchObject({
      overall: "fail",
      independent: { status: "fail" },
    });
    expect(validation?.issues).toContain(
      "Independent: Blocking or prerequisite work is still declared.",
    );
  });
});
