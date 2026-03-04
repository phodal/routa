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
  AcpSessionNotification,
  AcpNewSessionResult,
  AcpProviderInfo,
  AcpClientError,
  AcpAuthMethod,
} from "../acp-client";
import {
  getDesktopApiBaseUrl,
  desktopAwareFetch,
  logRuntime,
  toErrorMessage,
} from "../utils/diagnostics";

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
  ) => Promise<AcpNewSessionResult | null>;
  selectSession: (sessionId: string) => void;
  setProvider: (provider: string) => void;
  setMode: (modeId: string) => Promise<void>;
  prompt: (text: string, skillContext?: { skillName: string; skillContent: string }) => Promise<void>;
  cancel: () => Promise<void>;
  disconnect: () => void;
  /** Clear auth error (e.g., when user dismisses the popup) */
  clearAuthError: () => void;
  /** List models available for a provider (e.g. opencode) */
  listProviderModels: (provider: string) => Promise<string[]>;
}

export function useAcp(baseUrl: string = ""): UseAcpState & UseAcpActions {
  const clientRef = useRef<BrowserAcpClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const [state, setState] = useState<UseAcpState>({
    connected: false,
    sessionId: null,
    updates: [],
    providers: [],
    selectedProvider: "opencode",
    loading: false,
    error: null,
    authError: null,
  });

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
    };
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

      client.onUpdate((update) => {
        setState((s) => ({
          ...s,
          updates: [...s.updates, update],
        }));
      });

      clientRef.current = client;

      // Auto-select first available provider (claude-code-sdk in serverless, or first available)
      const firstAvailable = localProviders.find((p) => p.status === "available");

      setState((s) => ({
        ...s,
        connected: true,
        providers: localProviders,
        selectedProvider: firstAvailable?.id ?? s.selectedProvider,
        loading: false,
      }));

      // Background task 1: Check local provider status
      client.listProviders(true, false).then((checkedLocalProviders) => {
        // Only update local providers (source === 'static'), keep existing registry providers
        setState((s) => {
          const existingRegistry = s.providers.filter((p) => p.source === "registry");
          return {
            ...s,
            providers: [...checkedLocalProviders, ...existingRegistry],
          };
        });
      }).catch((err) => {
        logRuntime("warn", "useAcp.connect", "Failed to check local provider status", err);
      });

      // Background task 2: Load registry providers (with timeout protection)
      // This runs in parallel and adds registry providers when ready
      // First, quickly load registry providers (without checking status)
      client.loadRegistryProviders().then((allProviders) => {
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
            logRuntime("info", "useAcp.connect", "Failed to check registry provider status", err);
          });
        }
      }).catch((err) => {
        // Registry load failed (timeout or network error) - not critical
        logRuntime("info", "useAcp.connect", "Registry providers unavailable (network/timeout)", err);
      });
    } catch (err) {
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
    ): Promise<AcpNewSessionResult | null> => {
      const client = clientRef.current;
      if (!client) return null;
      try {
        setState((s) => ({ ...s, loading: true, error: null, authError: null, updates: [] }));
        const activeProvider = provider ?? state.selectedProvider;
        const result = await client.newSession({
          cwd,
          branch,
          provider: activeProvider,
          modeId,
          role,
          mcpServers: [],
          workspaceId,
          model,
          idempotencyKey,
          specialistId,
          baseUrl,
          apiKey,
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

        setState((s) => ({
          ...s,
          loading: false,
          error: toErrorMessage(err) || "Session creation failed",
        }));
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
    // Reset updates first, then restore history from server
    setState((s) => ({ ...s, sessionId, updates: [] }));

    // Restore message history so the chat panel shows previous messages
    desktopAwareFetch(`/api/sessions/${sessionId}/history?consolidated=true`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const history: AcpSessionNotification[] = data?.history ?? [];
        if (history.length > 0) {
          setState((s) => ({ ...s, updates: history }));
        }
      })
      .catch((err) => {
        logRuntime("warn", "useAcp.selectSession", "Failed to restore session history", err);
      });
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
      logRuntime("error", "useAcp.prompt", "Failed to send prompt", err);
      setState((s) => ({
        ...s,
        loading: false,
        error: toErrorMessage(err) || "Prompt failed",
      }));
    }
  }, []);

  const cancel = useCallback(async () => {
    const client = clientRef.current;
    const sessionId = sessionIdRef.current;
    if (!client || !sessionId) return;
    await client.cancel(sessionId);
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
    cancel,
    disconnect,
    clearAuthError,
    listProviderModels,
  };
}
