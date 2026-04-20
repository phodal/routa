"use client";

/**
 * useAcp - React hook for ACP client connection
 *
 * Manages BrowserAcpClient lifecycle and provides React state for:
 *   - Connection status
 *   - Session management (create, select)
 *   - Prompt sending
 *   - SSE update stream
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  BrowserAcpClient,
  AcpForkSessionResult,
  AcpLoadSessionResult,
  AcpNewSessionResult,
  AcpProviderInfo,
  AcpClientError,
  AcpAuthMethod,
  AcpSessionNotification,
  AcpConnectionIssue,
} from "../acp-client";
import {
  getDesktopApiBaseUrl,
  logRuntime,
  shouldSuppressTeardownError,
  toErrorMessage,
} from "../utils/diagnostics";
import {
  loadCustomAcpProviders,
  loadHiddenProviders,
  sortProviderIdsByPreference,
  type CustomAcpProvider,
} from "../utils/custom-acp-providers";
import { loadDockerOpencodeAuthJson } from "../components/settings-panel";
import type { McpServerProfile } from "@/core/mcp/mcp-server-profiles";

const ACP_SELECTED_PROVIDER_STORAGE_KEY = "routa.acp.selectedProvider";

const BUILTIN_PROVIDER_FALLBACKS: AcpProviderInfo[] = [
  {
    id: "claude",
    name: "Claude Code",
    description: "Anthropic Claude Code (native ACP support)",
    command: "claude",
    status: "checking",
    source: "static",
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "OpenCode AI coding agent",
    command: "opencode",
    status: "checking",
    source: "static",
  },
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI Codex CLI (via codex-acp wrapper)",
    command: "codex-acp",
    status: "checking",
    source: "static",
  },
];

export function formatAcpErrorForLog(err: unknown): unknown {
  if (err instanceof AcpClientError) {
    const data = err.data && typeof err.data === "object"
      ? err.data as Record<string, unknown>
      : undefined;
    const nestedErrorData = data?.errorData;
    return {
      name: err.name,
      message: err.message,
      code: err.code,
      authMethods: err.authMethods,
      agentInfo: err.agentInfo,
      sessionMayContinue: err.sessionMayContinue,
      data,
      errorData: nestedErrorData,
    };
  }
  return err;
}

/** Convert a custom ACP provider to AcpProviderInfo for the provider list. */
function toAcpProviderInfo(cp: CustomAcpProvider): AcpProviderInfo {
  return {
    id: cp.id,
    name: cp.name,
    description: cp.description ?? `Custom: ${[cp.command, ...cp.args].join(" ")}`,
    command: cp.command,
    status: "available",
    source: "static",
  };
}

function sortProvidersByPreference(providers: AcpProviderInfo[]): AcpProviderInfo[] {
  const orderedIds = sortProviderIdsByPreference(providers.map((provider) => provider.id));
  const orderMap = new Map(orderedIds.map((providerId, index) => [providerId, index]));

  return [...providers].sort((left, right) => {
    const leftIndex = orderMap.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = orderMap.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

function getInitialProviderFallbacks(): AcpProviderInfo[] {
  const disabledProviders = loadHiddenProviders();
  const customProviders = loadCustomAcpProviders().map(toAcpProviderInfo);

  return sortProvidersByPreference(
    [...BUILTIN_PROVIDER_FALLBACKS, ...customProviders].filter(
      (provider) => !disabledProviders.includes(provider.id)
    )
  );
}

export function loadSelectedAcpProvider(): string {
  if (typeof window === "undefined" || !window.localStorage) {
    return "opencode";
  }
  try {
    const stored = window.localStorage.getItem(ACP_SELECTED_PROVIDER_STORAGE_KEY)?.trim();
    return stored || "opencode";
  } catch {
    return "opencode";
  }
}

export function saveSelectedAcpProvider(provider: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const normalized = provider.trim();
    if (!normalized) {
      window.localStorage.removeItem(ACP_SELECTED_PROVIDER_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ACP_SELECTED_PROVIDER_STORAGE_KEY, normalized);
  } catch {
    // Ignore storage failures so ACP selection still works in-memory.
  }
}

function formatConnectionIssue(issue: AcpConnectionIssue): string {
  if (issue.status === 409) {
    return issue.message;
  }
  return issue.message || "Session stream disconnected";
}

/**
 * Authentication error info for display in UI.
 */
export interface AuthErrorInfo {
  message: string;
  authMethods: AcpAuthMethod[];
  agentInfo?: { name: string; version: string };
}

export interface UseAcpState {
  connected: boolean;
  sessionId: string | null;
  updates: AcpSessionNotification[];
  providers: AcpProviderInfo[];
  selectedProvider: string;
  loading: boolean;
  error: string | null;
  /** Authentication error with methods to authenticate */
  authError: AuthErrorInfo | null;
  /** Docker OpenCode configuration error (shows config popup) */
  dockerConfigError: string | null;
}

export interface UseAcpActions {
  connect: () => Promise<void>;
  createSession: (
    cwd?: string,
    provider?: string,
    modeId?: string,
    role?: string,
      workspaceId?: string,
      model?: string,
      /** Idempotency key to prevent duplicate session creation */
      idempotencyKey?: string,
    /** Specialist ID for per-specialist model configuration */
    specialistId?: string,
    /** Specialist locale for per-specialist resource loading */
    specialistLocale?: string,
    /** Custom API base URL override */
    baseUrl?: string,
    /** API key override */
      apiKey?: string,
      /** Git branch to scope the session to */
      branch?: string,
      /** MCP tool exposure for the session */
      toolMode?: "essential" | "full",
      /** Optional allowlist for provider-native tools such as Bash/Read/Edit */
      allowedNativeTools?: string[],
      /** Optional logical MCP profile, such as kanban-planning */
      mcpProfile?: McpServerProfile,
      /** Optional session-scoped system prompt injected before the first user turn */
      systemPrompt?: string,
      /** Allow unattended permission approvals for automation sessions. */
      autoApprovePermissions?: boolean,
    ) => Promise<AcpNewSessionResult | null>;
  resumeSession: (
    sessionId: string,
    cwd?: string,
    options?: { throwOnError?: boolean },
  ) => Promise<AcpLoadSessionResult | null>;
  forkSession: (
    sessionId: string,
    name?: string,
  ) => Promise<AcpForkSessionResult | null>;
  selectSession: (sessionId: string) => void;
  setProvider: (provider: string) => void;
  setMode: (modeId: string) => Promise<void>;
  prompt: (text: string, skillContext?: { skillName: string; skillContent: string }) => Promise<void>;
  promptSession: (
    sessionId: string,
    text: string,
    skillContext?: { skillName: string; skillContent: string },
  ) => Promise<void>;
  respondToUserInput: (toolCallId: string, response: Record<string, unknown>) => Promise<void>;
  respondToUserInputForSession: (
    sessionId: string,
    toolCallId: string,
    response: Record<string, unknown>,
  ) => Promise<void>;
  cancel: () => Promise<void>;
  disconnect: () => void;
  /** Clear auth error (e.g., when user dismisses the popup) */
  clearAuthError: () => void;
  /** Clear docker configuration error (e.g., when user dismisses the popup) */
  clearDockerConfigError: () => void;
  /** List models available for a provider (e.g. opencode) */
  listProviderModels: (provider: string) => Promise<string[]>;
  /** Write data to a terminal in the current session */
  writeTerminal: (terminalId: string, data: string) => Promise<void>;
  /** Resize a terminal in the current session */
  resizeTerminal: (terminalId: string, cols: number, rows: number) => Promise<void>;
}

export function useAcp(baseUrl: string = ""): UseAcpState & UseAcpActions {
  const clientRef = useRef<BrowserAcpClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const tearingDownRef = useRef(false);
  const connectingRef = useRef(false);
  // Track if user manually cancelled the session (to suppress "process exited" errors)
  const userCancelledRef = useRef(false);

  const [state, setState] = useState<UseAcpState>(() => ({
    connected: false,
    sessionId: null,
    updates: [],
    providers: getInitialProviderFallbacks(),
    // Always use SSR-safe default; useEffect below hydrates from localStorage
    selectedProvider: "opencode",
    loading: false,
    error: null,
    authError: null,
    dockerConfigError: null,
  }));

  // Hydrate selectedProvider from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    const persisted = loadSelectedAcpProvider();
    if (persisted !== "opencode") {
      setState((s) => ({ ...s, selectedProvider: persisted }));
    }
  }, []);
  // Clean up on unmount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const markTearingDown = () => {
        tearingDownRef.current = true;
      };
      window.addEventListener("pagehide", markTearingDown);
      window.addEventListener("beforeunload", markTearingDown);

      return () => {
        tearingDownRef.current = true;
        window.removeEventListener("pagehide", markTearingDown);
        window.removeEventListener("beforeunload", markTearingDown);
        clientRef.current?.disconnect();
      };
    }

    return () => {
      tearingDownRef.current = true;
      clientRef.current?.disconnect();
    };
  }, []);

  const shouldSuppressPromptError = useCallback((err: unknown): boolean => {
    if (tearingDownRef.current) return true;
    const message = toErrorMessage(err) || "";

    // Suppress "process exited" errors when user manually cancelled
    if (userCancelledRef.current && message.includes("process exited")) {
      userCancelledRef.current = false; // Reset for next prompt
      return true;
    }

    return message.includes("Failed to fetch") &&
      typeof document !== "undefined" &&
      document.visibilityState === "hidden";
  }, []);

  /** Connect (initialize only). Session creation is explicit. */
  const connect = useCallback(async () => {
    if (clientRef.current || connectingRef.current) {
      return;
    }

    try {
      connectingRef.current = true;
      setState((s) => ({ ...s, loading: true, error: null }));

      // In Tauri desktop static mode, use the embedded Rust server URL
      const effectiveBaseUrl = baseUrl || getDesktopApiBaseUrl();
      const client = new BrowserAcpClient(effectiveBaseUrl);

      await client.initialize();

      // Check local providers immediately for accurate status display
      // This ensures status indicators show correct colors on first render
      const localProviders = await client.listProviders(true, false);

      // Merge in user-defined custom ACP providers
      const customProviders = loadCustomAcpProviders().map(toAcpProviderInfo);

      // Filter out disabled providers
      const disabledProviders = loadHiddenProviders();
      const providers = sortProvidersByPreference(
        [...localProviders, ...customProviders].filter(
          (p) => !disabledProviders.includes(p.id)
        )
      );

      client.onUpdate((update) => {
        setState((s) => ({
          ...s,
          updates: [...s.updates, update],
          error: null,
        }));
      });
      client.onConnectionIssue((issue) => {
        if (tearingDownRef.current) return;
        logRuntime("warn", "useAcp.sse", "Session stream issue", issue);
        const isRecoverableOwnershipConflict = issue.status === 409 && issue.retryable;
        setState((s) => ({
          ...s,
          error: isRecoverableOwnershipConflict ? null : formatConnectionIssue(issue),
        }));
      });

      clientRef.current = client;

      const firstAvailable = providers.find((p) => p.status === "available");
      setState((s) => ({
        ...(function () {
          const persistedProvider = loadSelectedAcpProvider();
          const preferredProvider = providers.find((provider) =>
            provider.id === persistedProvider && provider.status !== "unavailable"
          )?.id;
          const nextSelectedProvider = preferredProvider ?? firstAvailable?.id ?? s.selectedProvider;
          saveSelectedAcpProvider(nextSelectedProvider);
          return {
            ...s,
            connected: true,
            providers,
            selectedProvider: nextSelectedProvider,
            loading: false,
          };
        })(),
      }));

      // Background task: Load registry providers (with timeout protection)
      // This runs in parallel and adds registry providers when ready
      client.loadRegistryProviders().then((allProviders) => {
        if (tearingDownRef.current) return;
        // loadRegistryProviders returns ALL providers (local + registry)
        // Filter to get only registry providers to avoid duplicates
        const disabledProvs = loadHiddenProviders();
        const registryProviders = sortProvidersByPreference(
          allProviders
            .filter((p) => p.source === "registry")
            .filter((p) => !disabledProvs.includes(p.id))
        );
        if (registryProviders.length > 0) {
          setState((s) => {
            // Keep only local providers from current state, add new registry providers
            const localProviders = s.providers.filter((p) => p.source === "static");
            return {
              ...s,
              providers: sortProvidersByPreference([...localProviders, ...registryProviders]),
            };
          });

          // Background task 3: Check registry provider availability (slower)
          // This updates the status from "checking" to "available" or "unavailable"
          client.listProviders(true, true).then((checkedAllProviders) => {
            if (tearingDownRef.current) return;
            const disabledProvs = loadHiddenProviders();
            const checkedRegistry = sortProvidersByPreference(
              checkedAllProviders
                .filter((p) => p.source === "registry")
                .filter((p) => !disabledProvs.includes(p.id))
            );
            if (checkedRegistry.length > 0) {
              setState((s) => {
                const localProviders = s.providers.filter((p) => p.source === "static");
                return {
                  ...s,
                  providers: sortProvidersByPreference([...localProviders, ...checkedRegistry]),
                };
              });
            }
          }).catch((err) => {
            if (tearingDownRef.current || shouldSuppressTeardownError(err)) {
              return;
            }
            logRuntime("info", "useAcp.connect", "Failed to check registry provider status", err);
          });
        }
      }).catch((err) => {
        if (tearingDownRef.current || shouldSuppressTeardownError(err)) {
          return;
        }
        // Registry load failed (timeout or network error) - not critical
        logRuntime("info", "useAcp.connect", "Registry providers unavailable (network/timeout)", err);
      });
    } catch (err) {
      if (tearingDownRef.current || shouldSuppressTeardownError(err)) {
        setState((s) => ({ ...s, loading: false }));
        return;
      }
      logRuntime("error", "useAcp.connect", "Failed to connect ACP client", err);
      setState((s) => ({
        ...s,
        loading: false,
        error: toErrorMessage(err) || "Connection failed",
      }));
    } finally {
      connectingRef.current = false;
    }
  }, [baseUrl]);

  /** Clear auth error (e.g., when user dismisses the popup) */
  const clearAuthError = useCallback(() => {
    setState((s) => ({ ...s, authError: null }));
  }, []);

  const clearDockerConfigError = useCallback(() => {
    setState((s) => ({ ...s, dockerConfigError: null }));
  }, []);

  const createSession = useCallback(
    async (
      cwd?: string,
      provider?: string,
      modeId?: string,
      role?: string,
      workspaceId?: string,
      model?: string,
      idempotencyKey?: string,
      specialistId?: string,
      specialistLocale?: string,
      baseUrl?: string,
      apiKey?: string,
      branch?: string,
      toolMode?: "essential" | "full",
      allowedNativeTools?: string[],
      mcpProfile?: McpServerProfile,
      systemPrompt?: string,
      autoApprovePermissions?: boolean,
    ): Promise<AcpNewSessionResult | null> => {
      const client = clientRef.current;
      if (!client) return null;
      try {
        setState((s) => ({ ...s, loading: true, error: null, authError: null, updates: [] }));
        const activeProvider = provider ?? state.selectedProvider;

        // Look up custom provider inline config if the selected provider is custom
        const customProvider = loadCustomAcpProviders().find((cp) => cp.id === activeProvider);

        // For docker-opencode provider, load auth.json from localStorage
        const authJson = activeProvider === "docker-opencode" ? loadDockerOpencodeAuthJson() : undefined;

        const result = await client.newSession({
          cwd,
          branch,
          provider: activeProvider,
          modeId,
          role,
          mcpServers: [],
          workspaceId,
          toolMode,
          allowedNativeTools,
          mcpProfile,
          model,
          idempotencyKey,
          specialistId,
          specialistLocale,
          systemPrompt,
          baseUrl,
          apiKey,
          customCommand: customProvider?.command,
          customArgs: customProvider?.args,
          authJson,
          autoApprovePermissions,
        });
        sessionIdRef.current = result.sessionId;
        setState((s) => ({
          ...s,
          sessionId: result.sessionId,
          selectedProvider: result.provider ?? activeProvider,
          loading: false,
        }));
        return result;
      } catch (err) {
        logRuntime("error", "useAcp.createSession", "Failed to create ACP session", err);

        // Check if this is an auth error with authMethods
        if (err instanceof AcpClientError && err.authMethods && err.authMethods.length > 0) {
          setState((s) => ({
            ...s,
            loading: false,
            error: null,
            authError: {
              message: err.message,
              authMethods: err.authMethods!,
              agentInfo: err.agentInfo,
            },
          }));
          return null;
        }

        const errorMsg = toErrorMessage(err) || "Session creation failed";
        // Docker session errors show as a config popup (not inline error)
        if ((provider ?? state.selectedProvider) === "docker-opencode") {
          setState((s) => ({
            ...s,
            loading: false,
            dockerConfigError: errorMsg,
          }));
        } else {
          setState((s) => ({
            ...s,
            loading: false,
            error: errorMsg,
          }));
        }
        return null;
      }
    },
    [state.selectedProvider]
  );

  const resumeSession = useCallback(async (
    targetSessionId: string,
    cwd?: string,
    options?: { throwOnError?: boolean },
  ): Promise<AcpLoadSessionResult | null> => {
    const client = clientRef.current;
    if (!client || !targetSessionId) return null;

    try {
      setState((s) => ({ ...s, loading: true, error: null, authError: null, updates: [] }));
      const result = await client.loadSession({
        sessionId: targetSessionId,
        cwd,
      });
      sessionIdRef.current = targetSessionId;
      setState((s) => ({
        ...s,
        sessionId: targetSessionId,
        selectedProvider: result.provider ?? s.selectedProvider,
        loading: false,
      }));
      return result;
    } catch (err) {
      logRuntime("error", "useAcp.resumeSession", "Failed to resume ACP session", formatAcpErrorForLog(err));
      setState((s) => ({
        ...s,
        loading: false,
        error: options?.throwOnError
          ? null
          : toErrorMessage(err) || "Session resume failed",
      }));
      if (options?.throwOnError) {
        throw err;
      }
      return null;
    }
  }, []);

  const forkSession = useCallback(async (
    targetSessionId: string,
    name?: string,
  ): Promise<AcpForkSessionResult | null> => {
    const client = clientRef.current;
    if (!client || !targetSessionId) return null;

    try {
      return await client.forkSession({
        sessionId: targetSessionId,
        name,
      });
    } catch (err) {
      logRuntime("error", "useAcp.forkSession", "Failed to fork session", formatAcpErrorForLog(err));
      setState((s) => ({
        ...s,
        error: toErrorMessage(err) || "Session fork failed",
      }));
      return null;
    }
  }, []);

  const setProvider = useCallback((provider: string) => {
    saveSelectedAcpProvider(provider);
    setState((s) => ({ ...s, selectedProvider: provider }));
  }, []);

  const setMode = useCallback(async (modeId: string): Promise<void> => {
    const client = clientRef.current;
    const sessionId = sessionIdRef.current;
    if (!client || !sessionId || !modeId) return;

    try {
      await client.setMode(sessionId, modeId);
    } catch (err) {
      logRuntime("warn", "useAcp.setMode", "Failed to set mode", err);
      setState((s) => ({
        ...s,
        error: toErrorMessage(err) || "Failed to set mode",
      }));
    }
  }, []);

  const selectSession = useCallback((sessionId: string) => {
    const client = clientRef.current;
    if (!client) return;
    // Skip if sessionId is a placeholder (static export mode)
    if (sessionId === "__placeholder__") return;
    if (sessionIdRef.current === sessionId) {
      setState((s) => ({ ...s, sessionId, error: null }));
      return;
    }

    sessionIdRef.current = sessionId;
    client.attachSession(sessionId);
    // Reset live updates when switching sessions.
    // Historical transcript hydration is owned by ChatPanel to avoid loading
    // the same history both into `updates` and into the chat transcript state.
    setState((s) => ({ ...s, sessionId, updates: [], error: null }));
  }, []);

  /** Send a prompt to current session (content streams over SSE). */
  const prompt = useCallback(async (
    text: string,
    skillContext?: { skillName: string; skillContent: string },
  ): Promise<void> => {
    const client = clientRef.current;
    const sessionId = sessionIdRef.current;
    if (!client || !sessionId) return;

    try {
      setState((s) => ({ ...s, loading: true, error: null }));
      await client.prompt(sessionId, text, skillContext);
      setState((s) => ({ ...s, loading: false }));
    } catch (err) {
      if (shouldSuppressPromptError(err)) {
        logRuntime("info", "useAcp.prompt", "Ignoring prompt fetch interruption during page teardown", err);
        setState((s) => ({ ...s, loading: false }));
        return;
      }
      logRuntime("error", "useAcp.prompt", "Failed to send prompt", formatAcpErrorForLog(err));
      setState((s) => ({
        ...s,
        loading: false,
        error: toErrorMessage(err) || "Prompt failed",
      }));
    }
  }, [shouldSuppressPromptError]);

  const promptSession = useCallback(async (
    sessionId: string,
    text: string,
    skillContext?: { skillName: string; skillContent: string },
  ): Promise<void> => {
    const client = clientRef.current;
    if (!client || !sessionId) return;

    try {
      setState((s) => ({ ...s, loading: true, error: null }));
      sessionIdRef.current = sessionId;
      await client.prompt(sessionId, text, skillContext);
      setState((s) => ({ ...s, sessionId, loading: false }));
    } catch (err) {
      if (shouldSuppressPromptError(err)) {
        logRuntime("info", "useAcp.promptSession", "Ignoring prompt fetch interruption during page teardown", err);
        setState((s) => ({ ...s, loading: false }));
        return;
      }
      logRuntime("error", "useAcp.promptSession", "Failed to send prompt", formatAcpErrorForLog(err));
      setState((s) => ({
        ...s,
        loading: false,
        error: toErrorMessage(err) || "Prompt failed",
      }));
    }
  }, [shouldSuppressPromptError]);

  const cancel = useCallback(async () => {
    const client = clientRef.current;
    const sessionId = sessionIdRef.current;
    if (!client || !sessionId) return;
    // Mark as user-initiated cancellation to suppress "process exited" errors
    userCancelledRef.current = true;
    await client.cancel(sessionId);
  }, []);

  const respondToUserInput = useCallback(async (
    toolCallId: string,
    response: Record<string, unknown>,
  ): Promise<void> => {
    const client = clientRef.current;
    const sessionId = sessionIdRef.current;
    if (!client || !sessionId) return;

    try {
      await client.respondToUserInput(sessionId, toolCallId, response);
    } catch (err) {
      logRuntime("error", "useAcp.respondToUserInput", "Failed to send AskUserQuestion response", err);
      setState((s) => ({
        ...s,
        error: toErrorMessage(err) || "Failed to submit question response",
      }));
      throw err;
    }
  }, []);

  const respondToUserInputForSession = useCallback(async (
    targetSessionId: string,
    toolCallId: string,
    response: Record<string, unknown>,
  ): Promise<void> => {
    const client = clientRef.current;
    if (!client || !targetSessionId) return;

    try {
      await client.respondToUserInput(targetSessionId, toolCallId, response);
    } catch (err) {
      logRuntime("error", "useAcp.respondToUserInputForSession", "Failed to send AskUserQuestion response", err);
      setState((s) => ({
        ...s,
        error: toErrorMessage(err) || "Failed to submit question response",
      }));
      throw err;
    }
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    sessionIdRef.current = null;
    setState({
      connected: false,
      sessionId: null,
      updates: [],
      providers: [],
      selectedProvider: loadSelectedAcpProvider(),
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
    });
  }, []);

  const listProviderModels = useCallback(async (provider: string): Promise<string[]> => {
    const client = clientRef.current;
    if (!client) return [];
    try {
      return await client.listProviderModels(provider);
    } catch {
      return [];
    }
  }, []);

  const writeTerminal = useCallback(async (terminalId: string, data: string): Promise<void> => {
    const client = clientRef.current;
    const sessionId = sessionIdRef.current;
    if (!client || !sessionId) return;
    await client.writeTerminal(sessionId, terminalId, data);
  }, []);

  const resizeTerminal = useCallback(async (terminalId: string, cols: number, rows: number): Promise<void> => {
    const client = clientRef.current;
    const sessionId = sessionIdRef.current;
    if (!client || !sessionId) return;
    await client.resizeTerminal(sessionId, terminalId, cols, rows);
  }, []);

  return {
    ...state,
    connect,
    createSession,
    resumeSession,
    forkSession,
    selectSession,
    setProvider,
    setMode,
    prompt,
    promptSession,
    respondToUserInput,
    respondToUserInputForSession,
    cancel,
    disconnect,
    clearAuthError,
    clearDockerConfigError,
    listProviderModels,
    writeTerminal,
    resizeTerminal,
  };
}
