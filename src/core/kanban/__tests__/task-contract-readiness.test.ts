import { describe, expect, it } from "vitest";

import { createTask } from "@/core/models/task";
import {
  buildTaskContractReadiness,
  buildTaskContractTransitionErrorFromRules,
  buildTaskContractUpdateErrorFromRules,
  countContractGateFailures,
  resolveCurrentOrNextContractGate,
} from "../task-contract-readiness";

describe("task contract readiness", () => {
  const validObjective = `Summary

\`\`\`yaml
story:
  version: 1
  language: en
  title: Valid story
  problem_statement: Users need a stable contract.
  user_value: Downstream lanes can trust the story.
  acceptance_criteria:
    - id: AC1
      text: Story parses cleanly.
      testable: true
    - id: AC2
      text: Contract includes the required schema.
      testable: true
  constraints_and_affected_areas:
    - src/app/page.tsx
  dependencies_and_sequencing:
    independent_story_check: pass
    depends_on: []
    unblock_condition: Ready now.
  out_of_scope:
    - unrelated work
  invest:
    independent:
      status: pass
      reason: No blocking prerequisite.
    negotiable:
      status: pass
      reason: Delivery details can still evolve.
    valuable:
      status: pass
      reason: Users get a reliable plan.
    estimable:
      status: pass
      reason: Scope is concrete.
    small:
      status: pass
      reason: One delivery slice.
    testable:
      status: pass
      reason: ACs are explicit.
\`\`\`
`;

  it("accepts a valid canonical story when the gate is enabled", () => {
    const task = createTask({
      id: "task-contract-ok",
      title: "Contract gate",
      objective: validObjective,
      workspaceId: "default",
    });

    const readiness = buildTaskContractReadiness(task, {
      requireCanonicalStory: true,
      loopBreakerThreshold: 2,
    });

    expect(readiness.checked).toBe(true);
    expect(readiness.ready).toBe(true);
    expect(readiness.issues).toEqual([]);
  });

  it("reports missing canonical YAML as a transition and update error", () => {
    const task = createTask({
      id: "task-contract-missing",
      title: "Missing contract",
      objective: "No canonical YAML yet",
      workspaceId: "default",
    });

    const rules = { requireCanonicalStory: true, loopBreakerThreshold: 2 };
    const readiness = buildTaskContractReadiness(task, rules);

    expect(readiness.ready).toBe(false);
    expect(buildTaskContractTransitionErrorFromRules(readiness, "Todo", rules)).toContain(
      'Cannot move task to "Todo": Canonical story YAML is missing.',
    );
    expect(buildTaskContractUpdateErrorFromRules(readiness, "Todo", rules)).toContain(
      "Cannot update card description: Canonical story YAML is missing.",
    );
  });

  it("resolves the current-or-next contract gate for backlog cards", () => {
    const gate = resolveCurrentOrNextContractGate([
      { id: "backlog", name: "Backlog", automation: { enabled: true } },
      {
        id: "todo",
        name: "Todo",
        automation: {
          enabled: true,
          contractRules: {
            requireCanonicalStory: true,
            loopBreakerThreshold: 2,
          },
        },
      },
    ], "backlog");

    expect(gate).toEqual({
      columnName: "Todo",
      rules: {
        requireCanonicalStory: true,
        loopBreakerThreshold: 2,
      },
    });
  });

  it("counts prior contract gate notes for loop breaking", () => {
    const task = createTask({
      id: "task-contract-loop",
      title: "Loop count",
      objective: validObjective,
      workspaceId: "default",
      comments: [
        {
          id: "note-1",
          body: 'Contract gate blocked: Cannot move task to "Todo": canonical story YAML is invalid.',
          createdAt: new Date().toISOString(),
        },
        {
          id: "note-2",
          body: "Normal progress note",
          createdAt: new Date().toISOString(),
          source: "update_card",
        },
      ],
    });

    expect(countContractGateFailures(task)).toBe(1);
  });
});
