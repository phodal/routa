/**
 * Workspace Agent Configuration
 *
 * Resolves model provider and parameters from environment variables or explicit overrides.
 * Uses Vercel AI SDK's provider abstraction to support multiple LLM backends.
 */

import type { LanguageModel } from "ai";

export type WorkspaceAgentProvider = "anthropic" | "openai" | "zhipu" | "minimax";

export interface WorkspaceAgentConfig {
  /** Model identifier, e.g. "claude-sonnet-4-20250514" or "gpt-4o" */
  modelId: string;
  /** LLM provider */
  provider: WorkspaceAgentProvider;
  /** Max agentic loop steps (tool call rounds) */
  maxSteps: number;
  /** Per-step timeout in ms */
  stepTimeoutMs: number;
  /** Total session timeout in ms */
  totalTimeoutMs: number;
  /** Max tokens for generation */
  maxTokens: number;
}

const DEFAULTS: WorkspaceAgentConfig = {
  modelId: "claude-sonnet-4-20250514",
  provider: "anthropic",
  maxSteps: 12,
  stepTimeoutMs: 30_000,
  totalTimeoutMs: 300_000,
  maxTokens: 16_384,
};

/**
 * Resolve configuration from environment variables, merged with explicit overrides.
 *
 * Environment variables:
 *   WORKSPACE_AGENT_PROVIDER  — "anthropic" | "openai" | "zhipu" | "minimax"
 *   WORKSPACE_AGENT_MODEL     — model identifier
 *   WORKSPACE_AGENT_MAX_STEPS — max agentic loop steps
 */
export function resolveWorkspaceAgentConfig(
  overrides?: Partial<WorkspaceAgentConfig>,
): WorkspaceAgentConfig {
  const envProvider = process.env.WORKSPACE_AGENT_PROVIDER as WorkspaceAgentProvider | undefined;
  const envModel = process.env.WORKSPACE_AGENT_MODEL;
  const envMaxSteps = process.env.WORKSPACE_AGENT_MAX_STEPS;

  return {
    ...DEFAULTS,
    ...(envProvider && { provider: envProvider }),
    ...(envModel && { modelId: envModel }),
    ...(envMaxSteps && { maxSteps: parseInt(envMaxSteps, 10) }),
    ...overrides,
  };
}

/**
 * Create a Vercel AI SDK LanguageModel from config.
 * Dynamically imports the provider package to avoid bundling both when only one is used.
 */
export async function createLanguageModel(config: WorkspaceAgentConfig): Promise<LanguageModel> {
  switch (config.provider) {
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      let baseURL = process.env.ANTHROPIC_BASE_URL;
      // @ai-sdk/anthropic appends /messages to baseURL.
      // Third-party Anthropic-compatible endpoints (e.g. BigModel) need /v1/messages,
      // so append /v1 if the URL doesn't already end with it.
      if (baseURL && !baseURL.endsWith("/v1")) {
        baseURL = `${baseURL.replace(/\/+$/, "")}/v1`;
      }
      const provider = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN,
        ...(baseURL && { baseURL }),
      });
      return provider(config.modelId);
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const provider = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        ...(process.env.OPENAI_BASE_URL && { baseURL: process.env.OPENAI_BASE_URL }),
      });
      return provider(config.modelId);
    }
    case "zhipu": {
      const { createZhipu } = await import("zhipu-ai-provider");
      const provider = createZhipu({
        apiKey: process.env.ZHIPU_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN,
        ...(process.env.ZHIPU_BASE_URL && { baseURL: process.env.ZHIPU_BASE_URL }),
      });
      return provider(config.modelId);
    }
    case "minimax": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      // MiniMax uses Anthropic-compatible API. Default base URL is the overseas endpoint.
      // @ai-sdk/anthropic appends /messages to baseURL, so the configured URL must end with /v1.
      let baseURL = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/anthropic";
      if (!baseURL.endsWith("/v1")) {
        baseURL = `${baseURL.replace(/\/+$/, "")}/v1`;
      }
      const provider = createAnthropic({
        apiKey: process.env.MINIMAX_API_KEY,
        baseURL,
      });
      return provider(config.modelId);
    }
    default:
      throw new Error(`Unsupported workspace agent provider: ${config.provider}`);
  }
}
