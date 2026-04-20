import { describe, expect, it } from "vitest";
import type { ExtendedTranslationDictionarySections } from "../types-extended";
import { enExtended } from "../locales/en-extended";

describe("types-extended", () => {
  it("requires the kanban runtime fitness keys exposed by the extended dictionary", () => {
    const kanban: ExtendedTranslationDictionarySections["kanban"] = enExtended.kanban;

    expect(kanban.fitnessLoadError).toBe("Failed to load runtime fitness status");
    expect(kanban.fitnessHardGate).toBe("Hard gate failed");
    expect(kanban.fitnessScoreBlocked).toBe("Score blocked");
  });
});
