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
  AcpNewSessionResult,
  AcpProviderInfo,
  AcpClientError,
  AcpAuthMethod,
  AcpSessionNotification,
} from "../acp-client";
import {
  getDesktopApiBaseUrl,
  logRuntime,
  shouldSuppressTeardownError,
  toErrorMessage,
} from "../utils/diagnostics";
import { loadCustomAcpProviders, type CustomAcpProvider } from "../utils/custom-acp-providers";
import { loadDockerOpencodeAuthJson } from "../components/settings-panel";

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
    /** Custom API base URL override */
    baseUrl?: string,
    /** API key override */
      apiKey?: string,
      /** Git branch to scope the session to */
      branch?: string,
      /** MCP tool exposure for the session */
      toolMode?: "essential" | "full",
    ) => Promise<AcpNewSessionResult | null>;
  selectSession: (sessionId: string) => void;
  setProvider: (provider: string) => void;
  setMode: (modeId: string) => Promise<void>;
  prompt: (text: string, skillContext?: { skillName: string; skillContent: string }) => Promise<void>;
  respondToUserInput: (toolCallId: string, response: Record<string, unknown>) => Promise<void>;
  cancel: () => Promise<void>;
  disconnect: () => void;
  /** Clear auth error (e.g., when user dismisses the popup) */
  clearAuthError: () => void;
  /** Clear docker configuration error (e.g., when user dismisses the popup) */
  clearDockerConfigError: () => void;
  /** List models available for a provider (e.g. opencode) */
  listProviderModels: (provider: string) => Promise<string[]>;
}

export function useAcp(baseUrl: string = ""): UseAcpState & UseAcpActions {
  const clientRef = useRef<BrowserAcpClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const tearingDownRef = useRef(false);
  // Track if user manually cancelled the session (to suppress "process exited" errors)
  const userCancelledRef = useRef(false);

  const [state, setState] = useState<UseAcpState>({
    connected: false,
    sessionId: null,
    updates: [],
    providers: [],
    selectedProvider: "opencode",
    loading: false,
    error: null,
    authError: null,
    dockerConfigError: null,
  });

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
    try {
      setState((s) => ({ ...s, loading: true, error: null }));

      // In Tauri desktop static mode, use the embedded Rust server URL
      const effectiveBaseUrl = baseUrl || getDesktopApiBaseUrl();
      const client = new BrowserAcpClient(effectiveBaseUrl);

      await client.initialize();

      // Fast path: Load only local providers (instant, < 10ms)
      const localProviders = await client.listProviders(false, false);

      // Merge in user-defined custom ACP providers
      const customProviders = loadCustomAcpProviders().map(toAcpProviderInfo);
      const allLocalProviders = [...localProviders, ...customProviders];

      client.onUpdate((update) => {
        setState((s) => ({
          ...s,
          updates: [...s.updates, update],
        }));
      });

      clientRef.current = client;

      // Auto-select first available provider (claude-code-sdk in serverless, or first available)
      const firstAvailable = allLocalProviders.find((p) => p.status === "available");

      setState((s) => ({
        ...s,
        connected: true,
        providers: allLocalProviders,
        selectedProvider: firstAvailable?.id ?? s.selectedProvider,
        loading: false,
      }));

      // Background task 1: Check local provider status
      client.listProviders(true, false).then((checkedLocalProviders) => {
        if (tearingDownRef.current) return;
        // Only update local providers (source === 'static'), keep existing registry providers
        // Re-merge custom providers (they are always "available")
        const customProvs = loadCustomAcpProviders().map(toAcpProviderInfo);
        setState((s) => {
          const existingRegistry = s.providers.filter((p) => p.source === "registry");
          return {
            ...s,
            providers: [...checkedLocalProviders, ...customProvs, ...existingRegistry],
          };
        });
      }).catch((err) => {
        if (tearingDownRef.current || shouldSuppressTeardownError(err)) {
          return;
        }
        logRuntime("warn", "useAcp.connect", "Failed to check local provider status", err);
      });

      // Background task 2: Load registry providers (with timeout protection)
      // This runs in parallel and adds registry providers when ready
      // First, quickly load registry providers (without checking status)
      client.loadRegistryProviders().then((allProviders) => {
        if (tearingDownRef.current) return;
        // loadRegistryProviders returns ALL providers (local + registry)
        // Filter to get only registry providers to avoid duplicates
        const registryProviders = allProviders.filter((p) => p.source === "registry");
        if (registryProviders.length > 0) {
          setState((s) => {
            // Keep only local providers from current state, add new registry providers
            const localProviders = s.providers.filter((p) => p.source === "static");
            return {
              ...s,
              providers: [...localProviders, ...registryProviders],
            };
          });

          // Background task 3: Check registry provider availability (slower)
          // This updates the status from "checking" to "available" or "unavailable"
          client.listProviders(true, true).then((checkedAllProviders) => {
            if (tearingDownRef.current) return;
            const checkedRegistry = checkedAllProviders.filter((p) => p.source === "registry");
            if (checkedRegistry.length > 0) {
              setState((s) => {
                const localProviders = s.providers.filter((p) => p.source === "static");
                return {
                  ...s,
                  providers: [...localProviders, ...checkedRegistry],
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
      baseUrl?: string,
      apiKey?: string,
      branch?: string,
      toolMode?: "essential" | "full",
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
          model,
          idempotencyKey,
          specialistId,
          baseUrl,
          apiKey,
          customCommand: customProvider?.command,
          customArgs: customProvider?.args,
          authJson,
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

  const setProvider = useCallback((provider: string) => {
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

    sessionIdRef.current = sessionId;
    client.attachSession(sessionId);
    // Reset live updates when switching sessions.
    // Historical transcript hydration is owned by ChatPanel to avoid loading
    // the same history both into `updates` and into the chat transcript state.
    setState((s) => ({ ...s, sessionId, updates: [] }));
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
      logRuntime("error", "useAcp.prompt", "Failed to send prompt", err);
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

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    sessionIdRef.current = null;
    setState({
      connected: false,
      sessionId: null,
      updates: [],
      providers: [],
      selectedProvider: "opencode",
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

  return {
    ...state,
    connect,
    createSession,
    selectSession,
    setProvider,
    setMode,
    prompt,
    respondToUserInput,
    cancel,
    disconnect,
    clearAuthError,
    clearDockerConfigError,
    listProviderModels,
  };
}
