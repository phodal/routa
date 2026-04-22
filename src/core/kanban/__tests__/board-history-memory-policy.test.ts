import { describe, expect, it } from "vitest";
import {
  getDefaultKanbanHistoryMemoryPolicy,
  getKanbanHistoryMemoryPolicy,
  setKanbanHistoryMemoryPolicy,
  shouldInjectKanbanHistoryMemory,
} from "../board-history-memory-policy";

describe("board-history-memory-policy", () => {
  it("falls back to defaults for missing or invalid metadata", () => {
    expect(getKanbanHistoryMemoryPolicy(undefined, "board-1")).toEqual(
      getDefaultKanbanHistoryMemoryPolicy(),
    );
    expect(getKanbanHistoryMemoryPolicy({
      "kanbanHistoryMemoryPolicy:board-1": "{\"mode\":\"unknown\",\"minMatchedSessions\":-1}",
    }, "board-1")).toEqual({
      mode: "auto",
      minMatchedSessions: 0,
      minMatchedFiles: 3,
      minFeatureCandidates: 1,
      minConfidence: "medium",
    });
    expect(getKanbanHistoryMemoryPolicy({
      "kanbanHistoryMemoryPolicy:board-1": "not-json",
    }, "board-1")).toEqual(getDefaultKanbanHistoryMemoryPolicy());
  });

  it("stores and reads normalized history memory policy per board", () => {
    const metadata = setKanbanHistoryMemoryPolicy(
      { unrelated: "value" },
      "board-1",
      {
        mode: "force",
        minMatchedSessions: 3.9,
        minMatchedFiles: 4.2,
        minFeatureCandidates: 1.9,
        minConfidence: "high",
      },
    );

    expect(metadata.unrelated).toBe("value");
    expect(getKanbanHistoryMemoryPolicy(metadata, "board-1")).toEqual({
      mode: "force",
      minMatchedSessions: 3,
      minMatchedFiles: 4,
      minFeatureCandidates: 1,
      minConfidence: "high",
    });
    expect(getKanbanHistoryMemoryPolicy(metadata, "board-2")).toEqual(
      getDefaultKanbanHistoryMemoryPolicy(),
    );
  });

  it("evaluates auto/off/force injection rules", () => {
    const baseSignals = {
      featureCount: 1,
      matchedSessions: 2,
      matchedFiles: 3,
      confidence: "medium" as const,
    };

    expect(shouldInjectKanbanHistoryMemory({
      mode: "off",
      minMatchedSessions: 2,
      minMatchedFiles: 3,
      minFeatureCandidates: 1,
      minConfidence: "medium",
    }, baseSignals)).toBe(false);

    expect(shouldInjectKanbanHistoryMemory({
      mode: "force",
      minMatchedSessions: 10,
      minMatchedFiles: 10,
      minFeatureCandidates: 10,
      minConfidence: "high",
    }, {
      featureCount: 0,
      matchedSessions: 0,
      matchedFiles: 0,
      confidence: "low",
    })).toBe(true);

    expect(shouldInjectKanbanHistoryMemory(getDefaultKanbanHistoryMemoryPolicy(), baseSignals)).toBe(true);
    expect(shouldInjectKanbanHistoryMemory(getDefaultKanbanHistoryMemoryPolicy(), {
      ...baseSignals,
      matchedSessions: 1,
      matchedFiles: 2,
    })).toBe(false);
    expect(shouldInjectKanbanHistoryMemory(getDefaultKanbanHistoryMemoryPolicy(), {
      ...baseSignals,
      confidence: "low",
    })).toBe(false);
  });
});
