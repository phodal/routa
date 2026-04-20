import { describe, expect, it } from "vitest";

import {
  clearOnboardingState,
  hasSavedProviderConfiguration,
  ONBOARDING_COMPLETED_KEY,
  ONBOARDING_MODE_KEY,
  parseOnboardingMode,
} from "../utils/onboarding";

describe("onboarding helpers", () => {
  it("detects configured providers from role defaults", () => {
    expect(
      hasSavedProviderConfiguration(
        {
          ROUTA: { provider: "claude" },
        },
        {},
      ),
    ).toBe(true);
  });

  it("detects configured providers from connection settings", () => {
    expect(
      hasSavedProviderConfiguration(
        {},
        {
          opencode: { apiKey: "secret" },
        },
      ),
    ).toBe(true);
  });

  it("returns false when no provider settings are saved", () => {
    expect(hasSavedProviderConfiguration({}, {})).toBe(false);
  });

  it("treats docker auth json as explicit provider setup", () => {
    expect(
      hasSavedProviderConfiguration({}, {}, { dockerOpencodeAuthJson: "{\"zai\":{\"key\":\"secret\"}}" }),
    ).toBe(true);
  });

  it("treats custom providers as explicit provider setup", () => {
    expect(
      hasSavedProviderConfiguration({}, {}, { customProviderCount: 1 }),
    ).toBe(true);
  });

  it("treats runtime-detected providers as explicit provider setup", () => {
    expect(
      hasSavedProviderConfiguration({}, {}, { runtimeProviderCount: 2 }),
    ).toBe(true);
  });

  it("parses only supported onboarding modes", () => {
    expect(parseOnboardingMode("SESSION")).toBe("SESSION");
    expect(parseOnboardingMode("KANBAN")).toBe("KANBAN");
    expect(parseOnboardingMode("TEAM")).toBe("TEAM");
    expect(parseOnboardingMode("ROUTA")).toBe("KANBAN");
    expect(parseOnboardingMode("CRAFTER")).toBe("SESSION");
    expect(parseOnboardingMode("DEVELOPER")).toBeNull();
    expect(parseOnboardingMode(null)).toBeNull();
  });

  it("clears persisted onboarding state", () => {
    const storage = new Map<string, string>([
      [ONBOARDING_COMPLETED_KEY, "true"],
      [ONBOARDING_MODE_KEY, "SESSION"],
    ]);

    clearOnboardingState({
      get length() {
        return storage.size;
      },
      clear() {
        storage.clear();
      },
      getItem(key) {
        return storage.get(key) ?? null;
      },
      key(index) {
        return Array.from(storage.keys())[index] ?? null;
      },
      removeItem(key) {
        storage.delete(key);
      },
      setItem(key, value) {
        storage.set(key, value);
      },
    });

    expect(storage.has(ONBOARDING_COMPLETED_KEY)).toBe(false);
    expect(storage.has(ONBOARDING_MODE_KEY)).toBe(false);
  });
});
