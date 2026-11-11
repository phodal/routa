/**
 * Workspace Agent Configuration
 *
 * Resolves model provider and parameters from environment variables or explicit overrides.
 * Uses Vercel AI SDK's provider abstraction to support multiple LLM backends.
 */

import type { LanguageModel } from "ai";
import {
  ATLASCLOUD_OPENAI_ENDPOINT,
  STANDARDCOMPUTE_DEFAULT_MODEL,
  STANDARDCOMPUTE_OPENAI_ENDPOINT,
  UBERLLM_OPENAI_ENDPOINT,
  hostedCredentialError,
  isTrustedUberllmAnthropicBase,
  nonEmpty,
  resolveHostedCredential,
  type EndpointPolicy,
  type ResolvedWorkspaceCredential,
} from "./provider-endpoint";

export type WorkspaceAgentProvider =
  | "anthropic"
  | "openai"
  | "zhipu"
  | "minimax"
  | "atlascloud"
  | "standardcompute"
  | "uberllm";

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
  /** Optional per-session API base URL override */
  baseUrl?: string;
  /** Optional per-session API key override */
  apiKey?: string;
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
 *   WORKSPACE_AGENT_PROVIDER  — "anthropic" | "openai" | "zhipu" | "minimax" | "atlascloud" | "standardcompute" | "uberllm"
 *   WORKSPACE_AGENT_MODEL     — model identifier
 *   WORKSPACE_AGENT_MAX_STEPS — max agentic loop steps
 */
export function resolveWorkspaceAgentConfig(
  overrides?: Partial<WorkspaceAgentConfig>,
): WorkspaceAgentConfig {
  const envProvider = nonEmpty(process.env.WORKSPACE_AGENT_PROVIDER) as WorkspaceAgentProvider | undefined;
  const envModel = nonEmpty(process.env.WORKSPACE_AGENT_MODEL);
  const envMaxSteps = process.env.WORKSPACE_AGENT_MAX_STEPS;
  const provider = overrides?.provider ?? envProvider ?? DEFAULTS.provider;
  const explicitModel = nonEmpty(overrides?.modelId) ?? envModel;
  const modelId = explicitModel
    ?? (provider === "standardcompute"
      ? STANDARDCOMPUTE_DEFAULT_MODEL
      : provider === "uberllm"
        ? ""
        : DEFAULTS.modelId);

  return {
    ...DEFAULTS,
    ...(envProvider && { provider: envProvider }),
    ...(envModel && { modelId: envModel }),
    ...(envMaxSteps && { maxSteps: parseInt(envMaxSteps, 10) }),
    ...overrides,
    provider,
    modelId,
  };
}

interface HostedOpenAiProvider {
  policy: EndpointPolicy;
  canonicalBaseUrl: string;
  envKeys: Array<string | undefined>;
  envBaseUrl?: string;
  missingKeyMessage: string;
}

function hostedOpenAiProvider(provider: WorkspaceAgentProvider): HostedOpenAiProvider | undefined {
  switch (provider) {
    case "atlascloud":
      return {
        policy: ATLASCLOUD_OPENAI_ENDPOINT,
        canonicalBaseUrl: "https://api.atlascloud.ai/v1",
        envKeys: [process.env.ATLASCLOUD_API_KEY, process.env.ATLAS_CLOUD_API_KEY],
        envBaseUrl: nonEmpty(process.env.ATLASCLOUD_API_BASE) ?? nonEmpty(process.env.ATLAS_CLOUD_API_BASE),
        missingKeyMessage: "Workspace agent (atlascloud) requires ATLASCLOUD_API_KEY",
      };
    case "standardcompute":
      return {
        policy: STANDARDCOMPUTE_OPENAI_ENDPOINT,
        canonicalBaseUrl: "https://api.stdcmpt.com/v1",
        envKeys: [process.env.STANDARDCOMPUTE_API_KEY],
        envBaseUrl: process.env.STANDARDCOMPUTE_API_BASE,
        missingKeyMessage: "Workspace agent (standardcompute) requires STANDARDCOMPUTE_API_KEY",
      };
    case "uberllm":
      return {
        policy: UBERLLM_OPENAI_ENDPOINT,
        canonicalBaseUrl: "https://api.uberllm.dev/v1",
        envKeys: [process.env.UBERLLM_API_KEY],
        envBaseUrl: process.env.UBERLLM_API_BASE,
        missingKeyMessage: "Workspace agent (uberllm) requires UBERLLM_API_KEY",
      };
    default:
      return undefined;
  }
}

export function resolveHostedOpenAiCredential(config: WorkspaceAgentConfig): ResolvedWorkspaceCredential | undefined {
  const hosted = hostedOpenAiProvider(config.provider);
  if (!hosted) return undefined;
  return resolveHostedCredential({
    explicitApiKey: config.apiKey,
    explicitBaseUrl: config.baseUrl,
    envApiKeys: hosted.envKeys,
    envBaseUrl: hosted.envBaseUrl,
    canonicalBaseUrl: hosted.canonicalBaseUrl,
    policy: hosted.policy,
  });
}

export function assertHostedOpenAiCredential(config: WorkspaceAgentConfig): void {
  const hosted = hostedOpenAiProvider(config.provider);
  const resolved = resolveHostedOpenAiCredential(config);
  if (!hosted || !resolved) return;
  const error = hostedCredentialError(config.provider, hosted.missingKeyMessage, resolved);
  if (error) throw new Error(error);
}

export const UBERLLM_EXPLICIT_MODEL_ERROR =
  "Workspace agent (uberllm) requires an explicit model id. Set WORKSPACE_AGENT_MODEL or the session model.";

export function normalizeAnthropicBaseUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return normalizedBaseUrl.endsWith("/v1") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
}

/**
 * Create a Vercel AI SDK LanguageModel from config.
 * Dynamically imports the provider package to avoid bundling both when only one is used.
 */
export async function createLanguageModel(config: WorkspaceAgentConfig): Promise<LanguageModel> {
  switch (config.provider) {
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const requestedBase = config.baseUrl ?? process.env.ANTHROPIC_BASE_URL;
      let baseURL = requestedBase;
      // @ai-sdk/anthropic appends /messages to baseURL.
      // Third-party Anthropic-compatible endpoints (e.g. BigModel) need /v1/messages,
      // so append /v1 if the URL doesn't already end with it.
      if (baseURL) {
        baseURL = normalizeAnthropicBaseUrl(baseURL);
      }
      const sessionKey = nonEmpty(config.apiKey);
      const anthropicKey = nonEmpty(process.env.ANTHROPIC_API_KEY) ?? nonEmpty(process.env.ANTHROPIC_AUTH_TOKEN);
      // UBERLLM_API_KEY is not an Anthropic credential. It is used only when the
      // Anthropic base is the documented UberLLM host and no Anthropic key was set.
      const uberllmKey = !sessionKey && !anthropicKey && isTrustedUberllmAnthropicBase(requestedBase)
        ? nonEmpty(process.env.UBERLLM_API_KEY)
        : undefined;
      const provider = createAnthropic({
        apiKey: sessionKey ?? anthropicKey ?? uberllmKey,
        ...(baseURL && { baseURL }),
      });
      return provider(config.modelId);
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const provider = createOpenAI({
        apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
        ...((config.baseUrl ?? process.env.OPENAI_BASE_URL) && {
          baseURL: config.baseUrl ?? process.env.OPENAI_BASE_URL,
        }),
      });
      return provider(config.modelId);
    }
    case "atlascloud":
    case "standardcompute":
    case "uberllm": {
      const hosted = hostedOpenAiProvider(config.provider);
      const resolved = resolveHostedOpenAiCredential(config);
      if (!hosted || !resolved) {
        throw new Error(`Unsupported workspace agent provider: ${config.provider}`);
      }
      const error = hostedCredentialError(config.provider, hosted.missingKeyMessage, resolved);
      if (error || !resolved.apiKey) {
        throw new Error(error ?? hosted.missingKeyMessage);
      }
      if (config.provider === "uberllm" && !nonEmpty(config.modelId)) {
        throw new Error(UBERLLM_EXPLICIT_MODEL_ERROR);
      }
      const { createOpenAI } = await import("@ai-sdk/openai");
      const provider = createOpenAI({
        apiKey: resolved.apiKey,
        baseURL: resolved.baseUrl,
      });
      return provider(config.modelId);
    }
    case "zhipu": {
      const { createZhipu } = await import("zhipu-ai-provider");
      const provider = createZhipu({
        apiKey: config.apiKey ?? process.env.ZHIPU_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN,
        ...((config.baseUrl ?? process.env.ZHIPU_BASE_URL) && {
          baseURL: config.baseUrl ?? process.env.ZHIPU_BASE_URL,
        }),
      });
      return provider(config.modelId);
    }
    case "minimax": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      // MiniMax uses Anthropic-compatible API. Default base URL is the overseas endpoint.
      // @ai-sdk/anthropic appends /messages to baseURL, so the configured URL must end with /v1.
      let baseURL = config.baseUrl ?? process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/anthropic";
      baseURL = normalizeAnthropicBaseUrl(baseURL);
      const provider = createAnthropic({
        apiKey: config.apiKey ?? process.env.MINIMAX_API_KEY,
        baseURL,
      });
      return provider(config.modelId);
    }
    default:
      throw new Error(`Unsupported workspace agent provider: ${config.provider}`);
  }
}
