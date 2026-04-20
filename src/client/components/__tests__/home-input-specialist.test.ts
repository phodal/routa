import { describe, expect, it } from "vitest";
import { resolveHomeInputSpecialistId } from "../home-input";

describe("resolveHomeInputSpecialistId", () => {
  it("uses a locked Team Run specialist without making it the normal-session fallback", () => {
    const userSelection = null;

    expect(resolveHomeInputSpecialistId({
      lockedSpecialistId: "team-agent-lead",
      allowCustomSpecialist: false,
      selectedSpecialistId: userSelection,
    })).toBe("team-agent-lead");

    expect(resolveHomeInputSpecialistId({
      lockedSpecialistId: undefined,
      allowCustomSpecialist: true,
      selectedSpecialistId: userSelection,
    })).toBeNull();
  });

  it("preserves a user-chosen specialist when custom specialists are allowed", () => {
    expect(resolveHomeInputSpecialistId({
      lockedSpecialistId: undefined,
      allowCustomSpecialist: true,
      selectedSpecialistId: "custom-reviewer",
    })).toBe("custom-reviewer");
  });
});
