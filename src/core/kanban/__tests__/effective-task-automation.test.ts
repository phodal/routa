import { describe, expect, it } from "vitest";
import { resolveEffectiveTaskAutomation, resolveKanbanAutomationStep } from "../effective-task-automation";

describe("resolveEffectiveTaskAutomation", () => {
  it("falls back to the current lane automation when the card has no override", () => {
    const resolved = resolveEffectiveTaskAutomation(
      {
        columnId: "backlog",
      },
      [
        {
          id: "backlog",
          automation: {
            enabled: true,
            steps: [{
              id: "refine",
              providerId: "claude",
              role: "ROUTA",
              specialistId: "backlog-refiner",
              specialistName: "Backlog Refiner",
            }],
          },
        },
      ],
    );

    expect(resolved.canRun).toBe(true);
    expect(resolved.source).toBe("lane");
    expect(resolved.providerId).toBe("claude");
    expect(resolved.providerSource).toBe("lane");
    expect(resolved.role).toBe("ROUTA");
    expect(resolved.specialistId).toBe("backlog-refiner");
    expect(resolved.specialistName).toBe("Backlog Refiner");
    expect(resolved.steps).toHaveLength(1);
    expect(resolved.stepIndex).toBe(0);
    expect(resolved.step?.id).toBe("refine");
  });

  it("prefers explicit card overrides over lane defaults", () => {
    const resolved = resolveEffectiveTaskAutomation(
      {
        columnId: "backlog",
        assignedProvider: "codex",
        assignedRole: "DEVELOPER",
        assignedSpecialistId: "implementor",
        assignedSpecialistName: "Implementor",
      },
      [
        {
          id: "backlog",
          automation: {
            enabled: true,
            providerId: "claude",
            role: "ROUTA",
            specialistId: "backlog-refiner",
            specialistName: "Backlog Refiner",
          },
        },
      ],
    );

    expect(resolved.canRun).toBe(true);
    expect(resolved.source).toBe("card");
    expect(resolved.providerId).toBe("codex");
    expect(resolved.providerSource).toBe("card");
    expect(resolved.role).toBe("DEVELOPER");
    expect(resolved.specialistId).toBe("implementor");
    expect(resolved.specialistName).toBe("Implementor");
  });

  it("returns no runnable automation when neither the card nor lane is configured", () => {
    const resolved = resolveEffectiveTaskAutomation(
      {
        columnId: "backlog",
      },
      [
        {
          id: "backlog",
          automation: {
            enabled: false,
            providerId: "claude",
          },
        },
      ],
    );

    expect(resolved.canRun).toBe(false);
    expect(resolved.source).toBe("none");
    expect(resolved.providerId).toBeUndefined();
    expect(resolved.providerSource).toBe("none");
    expect(resolved.role).toBeUndefined();
  });

  it("uses the board auto provider before falling back to specialist defaults", () => {
    const resolveSpecialist = (id: string) => id === "kanban-dev-executor"
      ? {
        name: "Kanban Dev Executor",
        role: "CRAFTER",
        defaultProvider: "claude",
      }
      : undefined;

    const resolved = resolveEffectiveTaskAutomation(
      {
        columnId: "dev",
      },
      [
        {
          id: "dev",
          automation: {
            enabled: true,
            steps: [{
              id: "implement",
              specialistId: "kanban-dev-executor",
            }],
          },
        },
      ],
      resolveSpecialist,
      { autoProviderId: "codex" },
    );

    expect(resolved.providerId).toBe("codex");
    expect(resolved.providerSource).toBe("auto");
    expect(resolved.role).toBe("CRAFTER");
    expect(resolved.specialistName).toBe("Kanban Dev Executor");
    expect(resolved.step).toMatchObject({
      providerId: "codex",
      providerSource: "auto",
      role: "CRAFTER",
      specialistName: "Kanban Dev Executor",
    });
  });

  it("inherits provider and role defaults from the selected specialist when no auto provider exists", () => {
    const resolved = resolveEffectiveTaskAutomation(
      {
        columnId: "dev",
      },
      [
        {
          id: "dev",
          automation: {
            enabled: true,
            steps: [{
              id: "implement",
              specialistId: "kanban-dev-executor",
            }],
          },
        },
      ],
      (id) => id === "kanban-dev-executor"
        ? {
          name: "Kanban Dev Executor",
          role: "CRAFTER",
          defaultProvider: "claude",
        }
        : undefined,
    );

    expect(resolved.providerId).toBe("claude");
    expect(resolved.providerSource).toBe("specialist");
    expect(resolved.role).toBe("CRAFTER");
    expect(resolved.specialistName).toBe("Kanban Dev Executor");
  });

  it("does not treat lane-resolved assignments as explicit card overrides", () => {
    const resolved = resolveEffectiveTaskAutomation(
      {
        columnId: "backlog",
        assignedProvider: "codex",
        assignedRole: "ROUTA",
        assignedSpecialistId: "backlog-refiner",
        assignedSpecialistName: "Backlog Refiner",
      },
      [
        {
          id: "backlog",
          automation: {
            enabled: true,
            steps: [{
              id: "refine",
              role: "ROUTA",
              specialistId: "backlog-refiner",
              specialistName: "Backlog Refiner",
            }],
          },
        },
      ],
      (id) => id === "backlog-refiner"
        ? {
          name: "Backlog Refiner",
          role: "ROUTA",
          defaultProvider: "claude",
        }
        : undefined,
      { autoProviderId: "codex" },
    );

    expect(resolved.source).toBe("lane");
    expect(resolved.providerId).toBe("codex");
    expect(resolved.providerSource).toBe("auto");
    expect(resolved.role).toBe("ROUTA");
    expect(resolved.specialistId).toBe("backlog-refiner");
  });

  it("resolves a single step with specialist execution defaults", () => {
    const resolved = resolveKanbanAutomationStep(
      {
        id: "review",
        specialistId: "review-guard",
      },
      (id) => id === "review-guard"
        ? {
          name: "Review Guard",
          role: "GATE",
          defaultProvider: "codex",
        }
        : undefined,
    );

    expect(resolved).toMatchObject({
      id: "review",
      specialistId: "review-guard",
      specialistName: "Review Guard",
      role: "GATE",
      providerId: "codex",
      providerSource: "specialist",
    });
  });

  it("downgrades legacy A2A-only lane steps to ACP during normalization", () => {
    const resolved = resolveEffectiveTaskAutomation(
      {
        columnId: "review",
      },
      [
        {
          id: "review",
          automation: {
            enabled: true,
            steps: [{
              id: "remote-review",
              transport: "a2a",
              agentCardUrl: "https://agents.example.com/reviewer/agent-card.json",
              skillId: "review",
            }],
          },
        },
      ],
    );

    expect(resolved.canRun).toBe(true);
    expect(resolved.transport).toBe("acp");
    expect(resolved.step).toMatchObject({
      id: "remote-review",
      transport: "acp",
      agentCardUrl: "https://agents.example.com/reviewer/agent-card.json",
      skillId: "review",
    });
  });

  describe("fallback agent chain", () => {
    it("appends fallback agents as additional steps when card has override", () => {
      const resolved = resolveEffectiveTaskAutomation(
        {
          columnId: "dev",
          assignedProvider: "claude",
          assignedRole: "DEVELOPER",
          fallbackAgentChain: [
            { providerId: "codex", role: "DEVELOPER" },
            { providerId: "gemini", role: "DEVELOPER", specialistId: "impl" },
          ],
          enableAutomaticFallback: true,
        },
        [
          {
            id: "dev",
            automation: {
              enabled: true,
              providerId: "default",
              role: "DEVELOPER",
            },
          },
        ],
      );

      expect(resolved.canRun).toBe(true);
      expect(resolved.source).toBe("card");
      expect(resolved.steps).toHaveLength(3);
      expect(resolved.steps[0].id).toBe("card-override");
      expect(resolved.steps[0].providerId).toBe("claude");
      expect(resolved.steps[1].id).toBe("fallback-1");
      expect(resolved.steps[1].providerId).toBe("codex");
      expect(resolved.steps[2].id).toBe("fallback-2");
      expect(resolved.steps[2].providerId).toBe("gemini");
      expect(resolved.steps[2].specialistId).toBe("impl");
    });

    it("does not append fallback steps when there is no card override", () => {
      const resolved = resolveEffectiveTaskAutomation(
        {
          columnId: "dev",
          fallbackAgentChain: [
            { providerId: "codex", role: "DEVELOPER" },
          ],
          enableAutomaticFallback: true,
        },
        [
          {
            id: "dev",
            automation: {
              enabled: true,
              providerId: "claude",
              role: "DEVELOPER",
            },
          },
        ],
      );

      expect(resolved.source).toBe("lane");
      expect(resolved.steps).toHaveLength(1);
      expect(resolved.steps[0].providerId).toBe("claude");
    });

    it("works with empty fallback chain", () => {
      const resolved = resolveEffectiveTaskAutomation(
        {
          columnId: "dev",
          assignedProvider: "claude",
          fallbackAgentChain: [],
          enableAutomaticFallback: true,
        },
        [
          {
            id: "dev",
            automation: {
              enabled: true,
              providerId: "default",
              role: "DEVELOPER",
            },
          },
        ],
      );

      expect(resolved.source).toBe("card");
      expect(resolved.steps).toHaveLength(1);
      expect(resolved.steps[0].id).toBe("card-override");
    });

    it("does not append fallback steps when automatic fallback is disabled", () => {
      const resolved = resolveEffectiveTaskAutomation(
        {
          columnId: "dev",
          assignedProvider: "claude",
          assignedRole: "DEVELOPER",
          fallbackAgentChain: [{ providerId: "codex", role: "DEVELOPER" }],
          enableAutomaticFallback: false,
        },
        [
          {
            id: "dev",
            automation: {
              enabled: true,
              providerId: "default",
              role: "DEVELOPER",
            },
          },
        ],
      );

      expect(resolved.source).toBe("card");
      expect(resolved.steps).toHaveLength(1);
      expect(resolved.steps[0].id).toBe("card-override");
    });
  });
});
