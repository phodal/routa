import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveModelFromEnvVarTier } from "../provider-registry";

describe("resolveModelFromEnvVarTier", () => {
  const originalEnv: Record<string, string | undefined> = {};

  function backupEnv(keys: string[]) {
    for (const key of keys) {
      originalEnv[key] = process.env[key];
    }
  }

  function restoreEnv(keys: string[]) {
    for (const key of keys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }

  const ALL_KEYS = [
    "ANTHROPIC_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
  ];

  beforeEach(() => backupEnv(ALL_KEYS));
  afterEach(() => restoreEnv(ALL_KEYS));

  it("returns undefined when no env vars are set", () => {
    for (const key of ALL_KEYS) delete process.env[key];
    expect(resolveModelFromEnvVarTier("fast", "claudeCodeSdk")).toBeUndefined();
    expect(resolveModelFromEnvVarTier("balanced", "claudeCodeSdk")).toBeUndefined();
    expect(resolveModelFromEnvVarTier("smart", "claudeCodeSdk")).toBeUndefined();
  });

  it("returns tier-specific env var value when set", () => {
    for (const key of ALL_KEYS) delete process.env[key];
    process.env.ANTHROPIC_SMALL_FAST_MODEL = "glm-4.5-air";
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = "glm-5-turbo";
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = "glm-5.1";

    expect(resolveModelFromEnvVarTier("fast", "claudeCodeSdk")).toBe("glm-4.5-air");
    expect(resolveModelFromEnvVarTier("balanced", "claudeCodeSdk")).toBe("glm-5-turbo");
    expect(resolveModelFromEnvVarTier("smart", "claudeCodeSdk")).toBe("glm-5.1");
  });

  it("falls back to ANTHROPIC_MODEL when tier-specific var is not set", () => {
    for (const key of ALL_KEYS) delete process.env[key];
    process.env.ANTHROPIC_MODEL = "glm-5.1";

    expect(resolveModelFromEnvVarTier("fast", "claudeCodeSdk")).toBe("glm-5.1");
    expect(resolveModelFromEnvVarTier("balanced", "claudeCodeSdk")).toBe("glm-5.1");
    expect(resolveModelFromEnvVarTier("smart", "claudeCodeSdk")).toBe("glm-5.1");
  });

  it("prefers tier-specific var over ANTHROPIC_MODEL", () => {
    for (const key of ALL_KEYS) delete process.env[key];
    process.env.ANTHROPIC_MODEL = "glm-5.1";
    process.env.ANTHROPIC_SMALL_FAST_MODEL = "glm-4.5-air";

    expect(resolveModelFromEnvVarTier("fast", "claudeCodeSdk")).toBe("glm-4.5-air");
    expect(resolveModelFromEnvVarTier("smart", "claudeCodeSdk")).toBe("glm-5.1");
  });

  it("skips env var resolution for opencode provider", () => {
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = "glm-5.1";
    expect(resolveModelFromEnvVarTier("smart", "opencode")).toBeUndefined();
  });

  it("works for claude provider key", () => {
    for (const key of ALL_KEYS) delete process.env[key];
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = "glm-5.1";
    expect(resolveModelFromEnvVarTier("smart", "claude")).toBe("glm-5.1");
  });
});
