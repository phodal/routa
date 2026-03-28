import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applySandboxPermissionConstraints,
  createRustSandbox,
  explainRustSandboxPolicy,
  explainSandboxPermissionConstraints,
} from "../permissions";
import type { CreateSandboxRequest, ResolvedSandboxPolicy, SandboxInfo } from "../types";

const originalEnv = { ...process.env };

function buildResolvedPolicy(): ResolvedSandboxPolicy {
  return {
    workspaceId: "ws-1",
    codebaseId: "cb-1",
    scopeRoot: "/repo",
    hostWorkdir: "/repo/src",
    containerWorkdir: "/workspace/src",
    networkMode: "none",
    envMode: "sanitized",
    mounts: [
      {
        hostPath: "/repo",
        containerPath: "/workspace",
        access: "readOnly",
        reason: "scopeRoot",
      },
    ],
    capabilities: [
      {
        capability: "workspaceRead",
        tier: "observation",
        enabled: true,
        reason: "Implicit workspace mount",
      },
    ],
    notes: ["Resolved from workspace context"],
  };
}

function buildSandboxInfo(): SandboxInfo {
  return {
    id: "sandbox-1",
    name: "routa-sandbox-1",
    status: "running",
    lang: "python",
    port: 18000,
    effectivePolicy: buildResolvedPolicy(),
    createdAt: "2026-03-28T00:00:00.000Z",
    lastActiveAt: "2026-03-28T00:00:00.000Z",
  };
}

describe("sandbox permissions API helpers", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ROUTA_SERVER_URL: "http://127.0.0.1:3210",
      ROUTA_INTERNAL_API_ORIGIN: "http://127.0.0.1:3000",
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns effectivePolicy from sandbox creation responses", async () => {
    const info = buildSandboxInfo();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(info), { status: 201 }));

    const request: CreateSandboxRequest = {
      lang: "python",
      policy: { workspaceId: "ws-1", capabilities: ["workspaceRead"] },
    };

    const result = await createRustSandbox(request);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3210/api/sandboxes",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.effectivePolicy?.workspaceId).toBe("ws-1");
    expect(result.effectivePolicy?.containerWorkdir).toBe("/workspace/src");
  });

  it("returns typed resolved policy from explain endpoints", async () => {
    const policy = buildResolvedPolicy();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ policy }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ policy }), { status: 200 }));

    const explained = await explainRustSandboxPolicy({
      lang: "python",
      policy: { workspaceId: "ws-1", capabilities: ["workspaceRead"] },
    });
    const mutated = await explainSandboxPermissionConstraints("sandbox-1", {
      readWritePaths: ["output"],
      capabilities: ["workspaceWrite"],
    });

    expect(explained.policy.scopeRoot).toBe("/repo");
    expect(mutated.policy.mounts[0].access).toBe("readOnly");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3210/api/sandboxes/explain",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:3000/api/sandboxes/sandbox-1/permissions/explain",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns updated sandbox info from permission apply responses", async () => {
    const info = buildSandboxInfo();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(info), { status: 200 }));

    const result = await applySandboxPermissionConstraints("sandbox-1", {
      capabilities: ["workspaceWrite"],
      readWritePaths: ["output"],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/sandboxes/sandbox-1/permissions/apply",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.effectivePolicy?.capabilities?.[0]?.capability).toBe("workspaceRead");
  });
});
