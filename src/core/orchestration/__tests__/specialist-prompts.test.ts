import { describe, expect, it } from "vitest";
import { AgentRole, ModelTier } from "@/core/models/agent";
import { buildDelegationPrompt, type SpecialistConfig } from "../specialist-prompts";
import {
  buildTraceRunDigest,
  formatTracePreflightForCrafter,
  formatTraceStateForGate,
} from "@/core/trace";

const baseSpecialist = {
  id: "gate",
  name: "Verifier",
  role: AgentRole.GATE,
  defaultModelTier: ModelTier.SMART,
  systemPrompt: "system",
  roleReminder: "remember",
} satisfies SpecialistConfig;

describe("buildDelegationPrompt trace context", () => {
  it("keeps structured Gate trace-state inspectable in Additional Context", () => {
    const digest = buildTraceRunDigest([]);
    const prompt = buildDelegationPrompt({
      specialist: baseSpecialist,
      agentId: "agent-gate",
      taskId: "task-1",
      taskTitle: "Verify work",
      taskContent: "Task body",
      parentAgentId: "agent-parent",
      additionalContext: `human note\n\n${formatTraceStateForGate(digest)}`,
    });

    expect(prompt).toContain("**Additional Context:** human note");
    expect(prompt).toContain("## Trace State");
    expect(prompt).toContain("No readable trace records found");
    expect(prompt).toContain("No structured verification command was observed in trace.");
  });

  it("keeps Crafter trace preflight lighter than Gate trace-state", () => {
    const crafter = {
      ...baseSpecialist,
      id: "crafter",
      name: "Implementor",
      role: AgentRole.CRAFTER,
    } satisfies SpecialistConfig;
    const digest = buildTraceRunDigest([]);
    const prompt = buildDelegationPrompt({
      specialist: crafter,
      agentId: "agent-crafter",
      taskId: "task-1",
      taskTitle: "Implement work",
      taskContent: "Task body",
      parentAgentId: "agent-parent",
      additionalContext: formatTracePreflightForCrafter(digest),
    });

    expect(prompt).toContain("## Trace Preflight");
    expect(prompt).toContain("Trace availability");
    expect(prompt).not.toContain("## Trace State");
    expect(prompt).not.toContain("Observed verification commands");
  });
});
