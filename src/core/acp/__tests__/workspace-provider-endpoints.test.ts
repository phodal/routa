/**
 * Credential binding and model routing for hosted workspace providers.
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { WorkspaceAgentAdapter } from "../workspace-agent/workspace-agent-adapter";
import {
  UBERLLM_EXPLICIT_MODEL_ERROR,
  createLanguageModel,
  resolveWorkspaceAgentConfig,
} from "../workspace-agent/workspace-agent-config";
import {
  inferWorkspaceAgentProvider,
  resolveHostedCredential,
  type EndpointPolicy,
} from "../workspace-agent/provider-endpoint";

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn((modelId: string) => ({ modelId }))),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn((modelId: string) => ({ modelId }))),
}));

const ENV_SENTINEL = "SENTINEL_ENV_KEY_DO_NOT_LEAK";
const SESSION_KEY = "session-key-explicit";

const SPOOFED_URLS = [
  "https://attacker.example/api.stdcmpt.com/v1",
  "https://attacker.example/api.uberllm.dev/v1",
  "https://attacker.example/api.atlascloud.ai/v1",
  "https://api.stdcmpt.com.evil.com/v1",
  "https://api.uberllm.dev.evil.com/v1",
  "https://api.atlascloud.ai.evil.com/v1",
  "https://notapi.stdcmpt.com/v1",
  "https://prefix.api.stdcmpt.com/v1",
  "https://api.stdcmpt.com/v1/extra",
  "https://api.stdcmpt.com//v1",
  "https://api.stdcmpt.com/V1",
  "http://api.stdcmpt.com/v1",
  "https://api.stdcmpt.com:444/v1",
  "https://user:pass@api.stdcmpt.com/v1",
  "https://api.stdcmpt.com@evil.com/v1",
  "https://evil.com@api.stdcmpt.com/v1",
  "https://api.stdcmpt.com\\@evil.com/v1",
  "https://api.stdcmpt.com%2eevil.com/v1",
  "https://evil.com/api.uberllm.dev/v1",
  "https://api.uberllm.dev/v1/chat/completions",
  "javascript:https://api.stdcmpt.com/v1",
];

const atlasPolicy: EndpointPolicy = { hosts: ["api.atlascloud.ai"], paths: ["/v1"] };

function withEnv(values: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  const restore = () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = run();
    if (result && typeof (result as Promise<void>).finally === "function") {
      return (result as Promise<void>).finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

describe("inferWorkspaceAgentProvider", () => {
  it("recognizes only the canonical hosted endpoints", () => {
    expect(inferWorkspaceAgentProvider("https://api.atlascloud.ai/v1")).toBe("atlascloud");
    expect(inferWorkspaceAgentProvider(`https://${"api.stdcmpt.com".toUpperCase()}/v1/`)).toBe("standardcompute");
    expect(inferWorkspaceAgentProvider("https://api.stdcmpt.com./v1")).toBe("standardcompute");
    expect(inferWorkspaceAgentProvider("https://api.uberllm.dev/v1")).toBe("uberllm");
    expect(inferWorkspaceAgentProvider("https://api.uberllm.dev")).toBeUndefined();
    expect(inferWorkspaceAgentProvider("https://api.uberllm.dev/")).toBeUndefined();
    expect(inferWorkspaceAgentProvider("https://api.openai.com/v1")).toBe("openai");
  });

  it.each(SPOOFED_URLS)("does not treat %s as a hosted provider", (url) => {
    expect(inferWorkspaceAgentProvider(url)).not.toBe("atlascloud");
    expect(inferWorkspaceAgentProvider(url)).not.toBe("standardcompute");
    expect(inferWorkspaceAgentProvider(url)).not.toBe("uberllm");
  });
});

describe("resolveHostedCredential", () => {
  it("uses the environment key only for the canonical endpoint and strips a smuggled query", () => {
    const resolved = resolveHostedCredential({
      explicitBaseUrl: "https://api.atlascloud.ai/v1?redirect=https://evil.example",
      envApiKeys: [ENV_SENTINEL],
      canonicalBaseUrl: "https://api.atlascloud.ai/v1",
      policy: atlasPolicy,
    });
    expect(resolved.source).toBe("environment");
    expect(resolved.apiKey).toBe(ENV_SENTINEL);
    expect(resolved.baseUrl).toBe("https://api.atlascloud.ai/v1");
  });

  it("keeps an explicit session key on a custom URL and does not substitute the environment key", () => {
    const resolved = resolveHostedCredential({
      explicitApiKey: SESSION_KEY,
      explicitBaseUrl: "https://proxy.example/v1",
      envApiKeys: [ENV_SENTINEL],
      canonicalBaseUrl: "https://api.atlascloud.ai/v1",
      policy: atlasPolicy,
    });
    expect(resolved.source).toBe("session");
    expect(resolved.apiKey).toBe(SESSION_KEY);
    expect(resolved.baseUrl).toBe("https://proxy.example/v1");
  });

  it("refuses the environment key for an untrusted session URL even when the provider is explicit", () => {
    const resolved = resolveHostedCredential({
      explicitBaseUrl: "https://api.stdcmpt.com.evil.com/v1",
      envApiKeys: [ENV_SENTINEL],
      envBaseUrl: "https://gateway.internal/v1",
      canonicalBaseUrl: "https://api.stdcmpt.com/v1",
      policy: { hosts: ["api.stdcmpt.com"], paths: ["/v1"] },
    });
    expect(resolved.source).toBe("missing");
    expect(resolved.apiKey).toBeUndefined();
    expect(resolved.untrustedSessionBase).toBe(true);
  });

  it("allows the operator base only when the session does not replace that destination", () => {
    const policy = { hosts: ["api.stdcmpt.com"], paths: ["/v1"] };
    const operator = resolveHostedCredential({
      envApiKeys: [ENV_SENTINEL],
      envBaseUrl: "https://gateway.internal/v1",
      canonicalBaseUrl: "https://api.stdcmpt.com/v1",
      policy,
    });
    expect(operator.source).toBe("environment");
    expect(operator.baseUrl).toBe("https://gateway.internal/v1");

    const matchingSession = resolveHostedCredential({
      explicitBaseUrl: "https://gateway.internal/v1?injected=1",
      envApiKeys: [ENV_SENTINEL],
      envBaseUrl: "https://gateway.internal/v1",
      canonicalBaseUrl: "https://api.stdcmpt.com/v1",
      policy,
    });
    expect(matchingSession.baseUrl).toBe("https://gateway.internal/v1");
    expect(matchingSession.apiKey).toBe(ENV_SENTINEL);
  });

  it("does not attach either key to a URL with userinfo", () => {
    const resolved = resolveHostedCredential({
      explicitApiKey: SESSION_KEY,
      explicitBaseUrl: "https://api.stdcmpt.com@evil.com/v1",
      envApiKeys: [ENV_SENTINEL],
      canonicalBaseUrl: "https://api.stdcmpt.com/v1",
      policy: { hosts: ["api.stdcmpt.com"], paths: ["/v1"] },
    });
    expect(resolved.apiKey).toBeUndefined();
    expect(resolved.unsafeBase).toBe(true);
  });
});

describe("workspace provider model routing", () => {
  it("uses the documented Standard Compute router id when no model was set", () => {
    const config = resolveWorkspaceAgentConfig({ provider: "standardcompute" });
    expect(config.modelId).toBe("standardcompute");
    expect(config.modelId).not.toBe("claude-sonnet-4-20250514");
  });

  it("preserves an explicit model on Standard Compute", () => {
    const config = resolveWorkspaceAgentConfig({
      provider: "standardcompute",
      modelId: "deepseek/deepseek-v4-pro",
    });
    expect(config.modelId).toBe("deepseek/deepseek-v4-pro");
  });

  it("does not assign another provider's default model to UberLLM", () => {
    const config = resolveWorkspaceAgentConfig({ provider: "uberllm" });
    expect(config.modelId).toBe("");
    expect(config.provider).toBe("uberllm");
  });

  it("keeps the Anthropic default off Standard Compute and UberLLM", () => {
    expect(resolveWorkspaceAgentConfig().modelId).toBe("claude-sonnet-4-20250514");
    expect(resolveWorkspaceAgentConfig({ provider: "atlascloud" }).modelId).toBe("claude-sonnet-4-20250514");
  });
});

describe("WorkspaceAgentAdapter hosted credentials", () => {
  beforeEach(() => {
    vi.mocked(createOpenAI).mockClear();
  });

  it("rejects Standard Compute and UberLLM when no key is available", async () => {
    await withEnv({
      STANDARDCOMPUTE_API_KEY: undefined,
      UBERLLM_API_KEY: undefined,
      WORKSPACE_AGENT_MODEL: undefined,
    }, async () => {
      const standard = new WorkspaceAgentAdapter("/tmp", vi.fn(), {
        config: { provider: "standardcompute", baseUrl: "https://api.stdcmpt.com/v1" },
      });
      await expect(standard.connect()).rejects.toThrow(
        "Workspace agent (standardcompute) requires STANDARDCOMPUTE_API_KEY",
      );

      const uber = new WorkspaceAgentAdapter("/tmp", vi.fn(), {
        config: { provider: "uberllm", modelId: "deepseek/deepseek-v4-flash", baseUrl: "https://api.uberllm.dev/v1" },
      });
      await expect(uber.connect()).rejects.toThrow(
        "Workspace agent (uberllm) requires UBERLLM_API_KEY",
      );
    });
  });

  it("rejects an environment key paired with an untrusted session URL", async () => {
    await withEnv({ STANDARDCOMPUTE_API_KEY: ENV_SENTINEL }, async () => {
      const adapter = new WorkspaceAgentAdapter("/tmp", vi.fn(), {
        config: {
          provider: "standardcompute",
          baseUrl: "https://evil.example/api.stdcmpt.com/v1",
        },
      });
      await expect(adapter.connect()).rejects.toThrow(/untrusted base URL/);
      await expect(adapter.connect()).rejects.not.toThrow(new RegExp(ENV_SENTINEL));
    });
  });

  it("connects a canonical environment key and an explicit custom key", async () => {
    await withEnv({ ATLASCLOUD_API_KEY: ENV_SENTINEL, ATLAS_CLOUD_API_KEY: undefined }, async () => {
      const trusted = new WorkspaceAgentAdapter("/tmp", vi.fn(), {
        config: { provider: "atlascloud", baseUrl: "https://api.atlascloud.ai/v1" },
      });
      await expect(trusted.connect()).resolves.toBeUndefined();

      const custom = new WorkspaceAgentAdapter("/tmp", vi.fn(), {
        config: {
          provider: "atlascloud",
          baseUrl: "https://proxy.example/v1",
          apiKey: SESSION_KEY,
        },
      });
      await expect(custom.connect()).resolves.toBeUndefined();
    });
  });

  it("requires an explicit UberLLM model even when a key is present", async () => {
    await withEnv({ UBERLLM_API_KEY: ENV_SENTINEL, WORKSPACE_AGENT_MODEL: undefined }, async () => {
      const adapter = new WorkspaceAgentAdapter("/tmp", vi.fn(), {
        config: { provider: "uberllm", baseUrl: "https://api.uberllm.dev/v1" },
      });
      await expect(adapter.connect()).rejects.toThrow(UBERLLM_EXPLICIT_MODEL_ERROR);
    });
  });

  it("uses UBERLLM_API_KEY for the Anthropic path only on the trusted UberLLM host", async () => {
    await withEnv({
      UBERLLM_API_KEY: ENV_SENTINEL,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
    }, async () => {
      const trusted = new WorkspaceAgentAdapter("/tmp", vi.fn(), {
        config: { provider: "anthropic", baseUrl: "https://api.uberllm.dev" },
      });
      await expect(trusted.connect()).resolves.toBeUndefined();

      const untrusted = new WorkspaceAgentAdapter("/tmp", vi.fn(), {
        config: { provider: "anthropic", baseUrl: "https://evil.example" },
      });
      await expect(untrusted.connect()).rejects.toThrow(
        "Workspace agent (anthropic) requires ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN",
      );
    });
  });
});

describe("createLanguageModel credential routing", () => {
  beforeEach(() => {
    vi.mocked(createOpenAI).mockClear();
    vi.mocked(createAnthropic).mockClear();
  });

  it("sends the Standard Compute router model and environment key only to the canonical base", async () => {
    await withEnv({ STANDARDCOMPUTE_API_KEY: ENV_SENTINEL }, async () => {
      await createLanguageModel(resolveWorkspaceAgentConfig({
        provider: "standardcompute",
        baseUrl: "https://api.stdcmpt.com/v1/",
      }));
      expect(createOpenAI).toHaveBeenCalledWith({
        apiKey: ENV_SENTINEL,
        baseURL: "https://api.stdcmpt.com/v1",
      });
      const factory = vi.mocked(createOpenAI).mock.results[0]?.value as (modelId: string) => unknown;
      expect(factory).toHaveBeenCalledWith("standardcompute");
    });
  });

  it("does not construct an OpenAI client with the server key for a spoofed URL", async () => {
    await withEnv({ UBERLLM_API_KEY: ENV_SENTINEL }, async () => {
      await expect(createLanguageModel(resolveWorkspaceAgentConfig({
        provider: "uberllm",
        modelId: "deepseek/deepseek-v4-flash",
        baseUrl: "https://api.uberllm.dev.evil.com/v1",
      }))).rejects.toThrow(/untrusted base URL/);
      expect(createOpenAI).not.toHaveBeenCalled();
    });
  });

  it("sends an explicit session key to the caller URL", async () => {
    await withEnv({ STANDARDCOMPUTE_API_KEY: ENV_SENTINEL }, async () => {
      await createLanguageModel(resolveWorkspaceAgentConfig({
        provider: "standardcompute",
        modelId: "StandardCompute",
        baseUrl: "https://proxy.example/v1",
        apiKey: SESSION_KEY,
      }));
      expect(createOpenAI).toHaveBeenCalledWith({
        apiKey: SESSION_KEY,
        baseURL: "https://proxy.example/v1",
      });
      const factory = vi.mocked(createOpenAI).mock.results[0]?.value as (modelId: string) => unknown;
      expect(factory).toHaveBeenCalledWith("StandardCompute");
    });
  });

  it("does not pass UBERLLM_API_KEY to an untrusted Anthropic base", async () => {
    await withEnv({
      UBERLLM_API_KEY: ENV_SENTINEL,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
    }, async () => {
      await createLanguageModel(resolveWorkspaceAgentConfig({
        provider: "anthropic",
        baseUrl: "https://evil.example",
      }));
      expect(createAnthropic).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: undefined,
        baseURL: "https://evil.example/v1",
      }));

      vi.mocked(createAnthropic).mockClear();
      await createLanguageModel(resolveWorkspaceAgentConfig({
        provider: "anthropic",
        modelId: "deepseek/deepseek-v4-flash",
        baseUrl: "https://api.uberllm.dev",
      }));
      expect(createAnthropic).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: ENV_SENTINEL,
        baseURL: "https://api.uberllm.dev/v1",
      }));
    });
  });
});
