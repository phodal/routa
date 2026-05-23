import { describe, expect, it } from "vitest";
import { createTask, VerificationVerdict } from "../../models/task";
import { evaluateKanbanTransitionGates } from "../transition-gates";

function makeTask(overrides: Partial<ReturnType<typeof createTask>> = {}) {
  return {
    ...createTask({
      id: "task-1",
      title: "Gate task",
      objective: "Ship safely",
      workspaceId: "ws-1",
    }),
    ...overrides,
  };
}

describe("evaluateKanbanTransitionGates", () => {
  it("blocks missing checklist, human approval, and validator evidence by default", () => {
    const result = evaluateKanbanTransitionGates(makeTask(), {
      id: "release",
      name: "Release",
      automation: {
        enabled: true,
        requiredChecklist: ["login smoke"],
        requiredHumanApproval: true,
        validatorCommand: "npm test",
      },
    });

    expect(result.mode).toBe("blocking");
    expect(result.blocking).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "required_checklist",
      "required_human_approval",
      "validator_command",
    ]);
  });

  it("passes when checklist, approval, and validator evidence are present", () => {
    const result = evaluateKanbanTransitionGates(makeTask({
      verificationVerdict: VerificationVerdict.APPROVED,
      verificationCommands: ["npm test"],
      verificationReport: "- [x] login smoke\n\nnpm test passed",
    }), {
      id: "release",
      name: "Release",
      automation: {
        enabled: true,
        requiredChecklist: ["login smoke"],
        requiredHumanApproval: true,
        validatorCommand: "npm test",
      },
    });

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("does not use unrelated passing text as validator evidence", () => {
    const result = evaluateKanbanTransitionGates(makeTask({
      verificationVerdict: VerificationVerdict.APPROVED,
      verificationCommands: ["npm test"],
      verificationReport: "- [x] login smoke\n\nnpm test failed\nlint passed",
    }), {
      id: "release",
      name: "Release",
      automation: {
        enabled: true,
        requiredChecklist: ["login smoke"],
        requiredHumanApproval: true,
        validatorCommand: "npm test",
      },
    });

    expect(result.blocking).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toEqual(["validator_command"]);
  });

  it("skips transition gates when automation is disabled", () => {
    const result = evaluateKanbanTransitionGates(makeTask(), {
      id: "release",
      name: "Release",
      automation: {
        enabled: false,
        requiredChecklist: ["login smoke"],
        requiredHumanApproval: true,
        validatorCommand: "npm test",
      },
    });

    expect(result.passed).toBe(true);
    expect(result.blocking).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it("returns non-blocking issues in warning mode", () => {
    const result = evaluateKanbanTransitionGates(makeTask(), {
      id: "qa",
      name: "QA",
      automation: {
        enabled: true,
        gateMode: "warning",
        requiredHumanApproval: true,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.mode).toBe("warning");
    expect(result.blocking).toBe(false);
  });
});
