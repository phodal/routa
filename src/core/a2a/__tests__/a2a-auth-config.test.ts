import { afterEach, describe, expect, it } from "vitest";

import { resolveA2AAuthConfig } from "@/core/a2a/a2a-auth-config";

const A2A_AUTH_CONFIGS_ENV = "ROUTA_A2A_AUTH_CONFIGS";
const originalAuthConfigs = process.env[A2A_AUTH_CONFIGS_ENV];

function setAuthConfigs(value?: unknown): void {
  if (value === undefined) {
    delete process.env[A2A_AUTH_CONFIGS_ENV];
    return;
  }
  process.env[A2A_AUTH_CONFIGS_ENV] = typeof value === "string" ? value : JSON.stringify(value);
}

afterEach(() => {
  if (originalAuthConfigs === undefined) {
    delete process.env[A2A_AUTH_CONFIGS_ENV];
    return;
  }
  process.env[A2A_AUTH_CONFIGS_ENV] = originalAuthConfigs;
});

describe("resolveA2AAuthConfig", () => {
  it("returns undefined when auth config id is blank or missing", () => {
    setAuthConfigs();

    expect(resolveA2AAuthConfig()).toBeUndefined();
    expect(resolveA2AAuthConfig("   ")).toBeUndefined();
  });

  it("resolves direct header maps and wrapped header objects", () => {
    setAuthConfigs({
      github: {
        Authorization: "Bearer token",
        "X-Trace": "trace-123",
      },
      slack: {
        headers: {
          Authorization: "Bearer slack-token",
        },
      },
    });

    expect(resolveA2AAuthConfig(" github ")).toEqual({
      headers: {
        Authorization: "Bearer token",
        "X-Trace": "trace-123",
      },
    });
    expect(resolveA2AAuthConfig("slack")).toEqual({
      headers: {
        Authorization: "Bearer slack-token",
      },
    });
  });

  it("throws a helpful error when env JSON is invalid", () => {
    setAuthConfigs("{invalid json");

    expect(() => resolveA2AAuthConfig("github")).toThrow(
      /Invalid ROUTA_A2A_AUTH_CONFIGS JSON:/,
    );
  });

  it("rejects non-object root payloads", () => {
    setAuthConfigs([{ Authorization: "Bearer token" }]);

    expect(() => resolveA2AAuthConfig("github")).toThrow(
      /ROUTA_A2A_AUTH_CONFIGS must be a JSON object keyed by auth config id\./,
    );
  });

  it("rejects invalid config shapes", () => {
    setAuthConfigs({
      broken: {
        headers: {
          Authorization: 123,
        },
      },
    });

    expect(() => resolveA2AAuthConfig("broken")).toThrow(
      /ROUTA_A2A_AUTH_CONFIGS\.broken must be either a header map or an object with a string header map in "headers"\./,
    );
  });

  it("throws when the requested config id is not present", () => {
    setAuthConfigs({
      github: {
        Authorization: "Bearer token",
      },
    });

    expect(() => resolveA2AAuthConfig("missing")).toThrow(
      /A2A auth config "missing" was not found in ROUTA_A2A_AUTH_CONFIGS\./,
    );
  });
});
