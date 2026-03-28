import type {
  CreateSandboxRequest,
  ResolvedSandboxPolicy,
  SandboxInfo,
  SandboxPermissionConstraints,
  SandboxPolicyInput,
} from "./types";

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function getInternalApiOrigin(): string {
  const configuredOrigin = process.env.ROUTA_INTERNAL_API_ORIGIN
    ?? process.env.ROUTA_BASE_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  if (configuredOrigin) {
    return stripTrailingSlash(configuredOrigin);
  }

  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

export function getRustSandboxApiBaseUrl(): string | null {
  const configuredUrl = process.env.ROUTA_SERVER_URL?.trim();
  return configuredUrl ? stripTrailingSlash(configuredUrl) : null;
}

function buildRustSandboxApiUrl(path: string): string | null {
  const baseUrl = getRustSandboxApiBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

export async function proxyRustSandboxRequest(
  path: string,
  init?: RequestInit,
): Promise<Response | null> {
  const url = buildRustSandboxApiUrl(path);
  if (!url) {
    return null;
  }

  const requestInit: RequestInit = { ...init };
  if (!requestInit.cache) {
    requestInit.cache = "no-store";
  }

  return fetch(url, requestInit);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as
    | T
    | { error?: string }
    | null;

  if (!response.ok) {
    const errorMessage = payload && typeof payload === "object" && "error" in payload
      ? payload.error
      : undefined;
    throw new Error(errorMessage || `Sandbox API request failed with status ${response.status}`);
  }

  return payload as T;
}

export async function applySandboxPermissionConstraints(
  sandboxId: string,
  constraints: SandboxPermissionConstraints,
): Promise<SandboxInfo> {
  const response = await fetch(
    `${getInternalApiOrigin()}/api/sandboxes/${encodeURIComponent(sandboxId)}/permissions/apply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ constraints }),
    },
  );

  return parseJsonResponse<SandboxInfo>(response);
}

export async function createRustSandbox(
  request: CreateSandboxRequest,
): Promise<SandboxInfo> {
  const response = await proxyRustSandboxRequest("/api/sandboxes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response) {
    throw new Error("Rust sandbox API is not configured. Set ROUTA_SERVER_URL to create sandboxes.");
  }

  return parseJsonResponse<SandboxInfo>(response);
}

export async function explainRustSandboxPolicy(
  request: CreateSandboxRequest,
): Promise<{ policy: ResolvedSandboxPolicy }> {
  const response = await proxyRustSandboxRequest("/api/sandboxes/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response) {
    throw new Error("Rust sandbox API is not configured. Set ROUTA_SERVER_URL to explain sandbox policies.");
  }

  return parseJsonResponse<{ policy: ResolvedSandboxPolicy }>(response);
}

export async function createWorkspaceSessionSandbox(options: {
  workspaceId?: string;
  workdir?: string;
  policy?: SandboxPolicyInput;
}): Promise<SandboxInfo | null> {
  if (!getRustSandboxApiBaseUrl()) {
    return null;
  }

  const policy: SandboxPolicyInput = {
    workspaceId: options.workspaceId,
    workdir: options.workdir,
    trustWorkspaceConfig: true,
    capabilities: ["workspaceRead"],
    networkMode: "none",
    ...options.policy,
  };

  if (!policy.workspaceId && !policy.workdir) {
    return null;
  }

  return createRustSandbox({
    lang: "python",
    policy,
  });
}

export async function explainSandboxPermissionConstraints(
  sandboxId: string,
  constraints: SandboxPermissionConstraints,
): Promise<{ policy: ResolvedSandboxPolicy }> {
  const response = await fetch(
    `${getInternalApiOrigin()}/api/sandboxes/${encodeURIComponent(sandboxId)}/permissions/explain`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ constraints }),
    },
  );

  return parseJsonResponse<{ policy: ResolvedSandboxPolicy }>(response);
}

export async function proxyRustSandboxPermissionMutation(
  sandboxId: string,
  action: "apply" | "explain",
  constraints: SandboxPermissionConstraints,
): Promise<Response> {
  const response = await proxyRustSandboxRequest(
    `/api/sandboxes/${encodeURIComponent(sandboxId)}/permissions/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ constraints }),
    },
  );

  if (!response) {
    return Response.json(
      { error: "Rust sandbox API is not configured. Set ROUTA_SERVER_URL to enable permission mutation." },
      { status: 503 },
    );
  }

  return response;
}
