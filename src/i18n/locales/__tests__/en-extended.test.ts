import { describe, expect, it } from "vitest";
import { enExtended } from "../en-extended";

describe("en-extended kanban runtime fitness copy", () => {
  it("includes the runtime fitness labels added for kanban status feedback", () => {
    expect(enExtended.kanban.fitnessLoadError).toBe("Failed to load runtime fitness status");
    expect(enExtended.kanban.fitnessHardGate).toBe("Hard gate failed");
    expect(enExtended.kanban.fitnessScoreBlocked).toBe("Score blocked");
  });
});
