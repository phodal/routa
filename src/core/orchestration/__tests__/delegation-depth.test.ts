import { describe, expect, it, vi } from "vitest";

import {
  MAX_DELEGATION_DEPTH,
  buildAgentMetadata,
  calculateChildDepth,
  checkDelegationDepth,
  createDelegationMetadata,
  getDelegationDepth,
} from "@/core/orchestration/delegation-depth";

function createAgentStore(result: unknown) {
  return {
    get: vi.fn().mockResolvedValue(result),
  };
}

describe("delegation-depth", () => {
  it("reads numeric and string delegation depth metadata", async () => {
    await expect(
      getDelegationDepth(
        createAgentStore({ metadata: { delegationDepth: 1 } }) as never,
        "agent-1",
      ),
    ).resolves.toBe(1);

    await expect(
      getDelegationDepth(
        createAgentStore({ metadata: { delegationDepth: "2" } }) as never,
        "agent-2",
      ),
    ).resolves.toBe(2);
  });

  it("defaults to zero when metadata is missing or invalid", async () => {
    await expect(
      getDelegationDepth(createAgentStore(undefined) as never, "agent-1"),
    ).resolves.toBe(0);

    await expect(
      getDelegationDepth(
        createAgentStore({ metadata: { delegationDepth: "not-a-number" } }) as never,
        "agent-2",
      ),
    ).resolves.toBe(0);
  });

  it("warns and returns zero when the store lookup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failingStore = {
      get: vi.fn().mockRejectedValue(new Error("boom")),
    };

    await expect(getDelegationDepth(failingStore as never, "agent-3")).resolves.toBe(0);
    expect(warn).toHaveBeenCalledOnce();

    warn.mockRestore();
  });

  it("blocks delegation once the maximum depth is reached", async () => {
    const result = await checkDelegationDepth(
      createAgentStore({ metadata: { delegationDepth: MAX_DELEGATION_DEPTH } }) as never,
      "agent-max",
    );

    expect(result).toEqual({
      allowed: false,
      currentDepth: MAX_DELEGATION_DEPTH,
      error:
        `Cannot create sub-agent: maximum delegation depth (${MAX_DELEGATION_DEPTH}) reached. ` +
        `You are at depth ${MAX_DELEGATION_DEPTH}. Please complete this task directly instead of delegating further.`,
    });
  });

  it("allows delegation below the maximum depth and builds child metadata", async () => {
    const result = await checkDelegationDepth(
      createAgentStore({ metadata: { delegationDepth: 1 } }) as never,
      "agent-parent",
    );

    expect(result).toEqual({
      allowed: true,
      currentDepth: 1,
    });
    expect(calculateChildDepth(1)).toBe(2);
    expect(createDelegationMetadata(2)).toEqual({
      delegationDepth: "2",
    });
    expect(
      buildAgentMetadata(2, "agent-parent", "gate", {
        priority: "high",
      }),
    ).toEqual({
      delegationDepth: "2",
      createdByAgentId: "agent-parent",
      specialist: "gate",
      priority: "high",
    });
  });
});
