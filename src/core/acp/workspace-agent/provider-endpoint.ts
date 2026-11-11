/**
 * Trusted-endpoint binding for hosted workspace providers.
 *
 * A per-session base URL is caller-controlled. Server environment keys may be
 * attached only when the outbound URL is the provider's canonical HTTPS
 * endpoint, or the operator-configured base when the session does not replace
 * it with a different destination. Hostname substrings, suffixes, paths,
 * userinfo, and non-HTTPS schemes are not trusted.
 *
 * The desktop resolver in `crates/routa-core/src/acp/workspace_agent.rs` must
 * keep the same accept and reject decisions.
 */

import type { WorkspaceAgentProvider } from "./workspace-agent-config";

export type WorkspaceCredentialSource = "session" | "environment" | "missing";

export interface EndpointPolicy {
  hosts: readonly string[];
  /** Pathname without a trailing slash. "" means the origin root. */
  paths: readonly string[];
}

export interface ResolvedWorkspaceCredential {
  apiKey?: string;
  baseUrl: string;
  source: WorkspaceCredentialSource;
  /** Session supplied a base URL that must not receive an environment key. */
  untrustedSessionBase: boolean;
  /** The chosen URL is not a usable http(s) endpoint, or it carries userinfo. */
  unsafeBase: boolean;
}

export interface HostedCredentialInput {
  explicitApiKey?: string;
  explicitBaseUrl?: string;
  envApiKeys: Array<string | undefined>;
  envBaseUrl?: string;
  canonicalBaseUrl: string;
  policy: EndpointPolicy;
}

export const ATLASCLOUD_OPENAI_ENDPOINT: EndpointPolicy = {
  hosts: ["api.atlascloud.ai"],
  paths: ["/v1"],
};

export const STANDARDCOMPUTE_OPENAI_ENDPOINT: EndpointPolicy = {
  hosts: ["api.stdcmpt.com"],
  paths: ["/v1"],
};

export const UBERLLM_OPENAI_ENDPOINT: EndpointPolicy = {
  hosts: ["api.uberllm.dev"],
  paths: ["/v1"],
};

/** Anthropic SDK base. `https://api.uberllm.dev/v1` is also accepted before `/messages` is appended. */
export const UBERLLM_ANTHROPIC_ENDPOINT: EndpointPolicy = {
  hosts: ["api.uberllm.dev"],
  paths: ["", "/v1"],
};

/** Request id documented by Standard Compute for OpenAI-compatible smart routing. */
export const STANDARDCOMPUTE_DEFAULT_MODEL = "standardcompute";

const HOSTED_INFERENCE: Array<{ provider: WorkspaceAgentProvider; policy: EndpointPolicy }> = [
  { provider: "atlascloud", policy: ATLASCLOUD_OPENAI_ENDPOINT },
  { provider: "standardcompute", policy: STANDARDCOMPUTE_OPENAI_ENDPOINT },
  { provider: "uberllm", policy: UBERLLM_OPENAI_ENDPOINT },
];

export function nonEmpty(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

function hasUserInfo(url: URL): boolean {
  return url.username !== "" || url.password !== "";
}

function normalizedHost(url: URL): string {
  const host = url.hostname.toLowerCase();
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

function normalizedPath(url: URL): string {
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path === "/" ? "" : path;
}

function defaultPort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}

export function isTrustedEndpoint(raw: string | undefined, policy: EndpointPolicy): boolean {
  const value = nonEmpty(raw);
  if (!value) return false;
  const url = parseUrl(value);
  if (!url) return false;
  if (url.protocol !== "https:") return false;
  if (hasUserInfo(url)) return false;
  if (url.port !== "" && url.port !== "443") return false;
  if (!policy.hosts.includes(normalizedHost(url))) return false;
  return policy.paths.includes(normalizedPath(url));
}

function sameDestination(left: string, right: string): boolean {
  const a = parseUrl(left);
  const b = parseUrl(right);
  if (!a || !b) return false;
  if (hasUserInfo(a) || hasUserInfo(b)) return false;
  if (!isHttpProtocol(a) || !isHttpProtocol(b)) return false;
  return a.protocol === b.protocol
    && normalizedHost(a) === normalizedHost(b)
    && defaultPort(a) === defaultPort(b)
    && normalizedPath(a) === normalizedPath(b);
}

function isHttpProtocol(url: URL): boolean {
  return url.protocol === "https:" || url.protocol === "http:";
}

/** Rebuild an explicit caller URL without userinfo or a fragment. */
function safeCallerUrl(raw: string): string | undefined {
  const url = parseUrl(raw);
  if (!url || !isHttpProtocol(url) || hasUserInfo(url) || !url.hostname) return undefined;
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${url.hostname}${port}${url.pathname}${url.search}`;
}

/** Canonical trusted base: https, exact host, exact path, no query or userinfo. */
function canonicalOutbound(raw: string): string | undefined {
  const url = parseUrl(raw);
  if (!url) return undefined;
  const path = normalizedPath(url);
  return `https://${normalizedHost(url)}${path}`;
}

export function inferHostedWorkspaceProvider(baseUrl?: string): WorkspaceAgentProvider | undefined {
  return HOSTED_INFERENCE.find((entry) => isTrustedEndpoint(baseUrl, entry.policy))?.provider;
}

/**
 * Provider selected from a model-alias base URL.
 * Hosted providers match the canonical endpoint only. Other providers keep
 * their existing substring hints for third-party compatible hosts.
 */
export function inferWorkspaceAgentProvider(baseUrl?: string): WorkspaceAgentProvider | undefined {
  const hosted = inferHostedWorkspaceProvider(baseUrl);
  if (hosted) return hosted;
  const normalized = baseUrl?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes("api.openai.com")) return "openai";
  if (normalized.includes("zhipu") || normalized.includes("bigmodel")) return "zhipu";
  if (normalized.includes("minimax")) return "minimax";
  if (normalized.includes("anthropic")) return "anthropic";
  return undefined;
}

export function isTrustedUberllmAnthropicBase(baseUrl?: string): boolean {
  return isTrustedEndpoint(baseUrl, UBERLLM_ANTHROPIC_ENDPOINT);
}

export function resolveHostedCredential(input: HostedCredentialInput): ResolvedWorkspaceCredential {
  const explicitKey = nonEmpty(input.explicitApiKey);
  const sessionBase = nonEmpty(input.explicitBaseUrl);
  const operatorBase = nonEmpty(input.envBaseUrl);
  const envKey = input.envApiKeys.map((key) => nonEmpty(key)).find((key) => key !== undefined);
  const chosen = sessionBase ?? operatorBase ?? input.canonicalBaseUrl;

  if (explicitKey) {
    const safe = safeCallerUrl(chosen);
    if (!safe) {
      return {
        baseUrl: chosen,
        source: "missing",
        untrustedSessionBase: false,
        unsafeBase: true,
      };
    }
    return {
      apiKey: explicitKey,
      baseUrl: safe,
      source: "session",
      untrustedSessionBase: false,
      unsafeBase: false,
    };
  }

  const trusted = isTrustedEndpoint(chosen, input.policy);
  const operatorAuthorized = Boolean(
    operatorBase
    && sameDestination(chosen, operatorBase)
    && safeCallerUrl(operatorBase)
    && (!sessionBase || sameDestination(sessionBase, operatorBase)),
  );

  if (envKey && (trusted || operatorAuthorized)) {
    const baseUrl = trusted
      ? canonicalOutbound(chosen) ?? input.canonicalBaseUrl
      : safeCallerUrl(operatorBase!) ?? operatorBase!;
    return {
      apiKey: envKey,
      baseUrl,
      source: "environment",
      untrustedSessionBase: false,
      unsafeBase: false,
    };
  }

  return {
    baseUrl: chosen,
    source: "missing",
    untrustedSessionBase: Boolean(sessionBase) && !trusted,
    unsafeBase: false,
  };
}

export function hostedCredentialError(
  provider: string,
  missingKeyMessage: string,
  resolved: ResolvedWorkspaceCredential,
): string | undefined {
  if (resolved.apiKey) return undefined;
  if (resolved.unsafeBase) {
    return `Workspace agent (${provider}) rejected an unsafe base URL`;
  }
  if (resolved.untrustedSessionBase) {
    return `Workspace agent (${provider}) requires a session apiKey for an untrusted base URL`;
  }
  return missingKeyMessage;
}
