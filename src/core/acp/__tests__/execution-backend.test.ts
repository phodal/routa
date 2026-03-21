import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("execution-backend helpers", () => {
  const originalEnv = {
    ROUTA_ACP_RUNNER_URL: process.env.ROUTA_ACP_RUNNER_URL,
    ROUTA_INSTANCE_ID: process.env.ROUTA_INSTANCE_ID,
    ROUTA_ACP_SESSION_LEASE_SECONDS: process.env.ROUTA_ACP_SESSION_LEASE_SECONDS,
  };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.ROUTA_ACP_RUNNER_URL;
    delete process.env.ROUTA_INSTANCE_ID;
    delete process.env.ROUTA_ACP_SESSION_LEASE_SECONDS;
  });

  afterEach(() => {
    process.env.ROUTA_ACP_RUNNER_URL = originalEnv.ROUTA_ACP_RUNNER_URL;
    process.env.ROUTA_INSTANCE_ID = originalEnv.ROUTA_INSTANCE_ID;
    process.env.ROUTA_ACP_SESSION_LEASE_SECONDS = originalEnv.ROUTA_ACP_SESSION_LEASE_SECONDS;
  });

  it("uses runner mode only for CLI-backed providers when a runner URL is configured", async () => {
    process.env.ROUTA_ACP_RUNNER_URL = "http://runner.internal/";
    const mod = await import("../execution-backend");

    expect(mod.getAcpRunnerUrl()).toBe("http://runner.internal");
    expect(mod.shouldUseRunnerForProvider("opencode")).toBe(true);
    expect(mod.shouldUseRunnerForProvider("claude")).toBe(true);
    expect(mod.shouldUseRunnerForProvider("claude-code-sdk")).toBe(false);
    expect(mod.shouldUseRunnerForProvider("workspace-agent")).toBe(false);
  });

  it("builds embedded execution bindings with owner and lease metadata", async () => {
    process.env.ROUTA_INSTANCE_ID = "web-1";
    process.env.ROUTA_ACP_SESSION_LEASE_SECONDS = "60";
    const mod = await import("../execution-backend");

    const binding = mod.buildExecutionBinding("embedded");

    expect(binding.executionMode).toBe("embedded");
    expect(binding.ownerInstanceId).toBe("web-1");
    expect(binding.leaseExpiresAt).toBeTruthy();
  });
});
