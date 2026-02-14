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
} from "../acp-client";

export interface UseAcpState {
  connected: boolean;
  sessionId: string | null;
  updates: AcpSessionNotification[];
  providers: AcpProviderInfo[];
  selectedProvider: string;
  loading: boolean;
  error: string | null;
}

export interface UseAcpActions {
  connect: () => Promise<void>;
  createSession: (
    cwd?: string,
    provider?: string,
    modeId?: string
  ) => Promise<AcpNewSessionResult | null>;
  selectSession: (sessionId: string) => void;
  setProvider: (provider: string) => void;
  setMode: (modeId: string) => Promise<void>;
  prompt: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  disconnect: () => void;
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

      const client = new BrowserAcpClient(baseUrl);

      await client.initialize();
      const providers = await client.listProviders();

      client.onUpdate((update) => {
        setState((s) => ({
          ...s,
          updates: [...s.updates, update],
        }));
      });

      clientRef.current = client;

      setState((s) => ({
        ...s,
        connected: true,
        providers,
        loading: false,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Connection failed",
      }));
    }
  }, [baseUrl]);

  const createSession = useCallback(
    async (
      cwd?: string,
      provider?: string,
      modeId?: string
    ): Promise<AcpNewSessionResult | null> => {
      const client = clientRef.current;
      if (!client) return null;
      try {
        setState((s) => ({ ...s, loading: true, error: null, updates: [] }));
        const activeProvider = provider ?? state.selectedProvider;
        const result = await client.newSession({
          cwd,
          provider: activeProvider,
          modeId,
          mcpServers: [],
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
        setState((s) => ({
          ...s,
          loading: false,
          error:
            err instanceof Error ? err.message : "Session creation failed",
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
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : "Failed to set mode",
      }));
    }
  }, []);

  const selectSession = useCallback((sessionId: string) => {
    const client = clientRef.current;
    if (!client) return;
    sessionIdRef.current = sessionId;
    client.attachSession(sessionId);
    setState((s) => ({ ...s, sessionId, updates: [] }));
  }, []);

  /** Send a prompt to current session (content streams over SSE). */
  const prompt = useCallback(async (text: string): Promise<void> => {
    const client = clientRef.current;
    const sessionId = sessionIdRef.current;
    if (!client || !sessionId) return;

    try {
      setState((s) => ({ ...s, loading: true, error: null }));
      await client.prompt(sessionId, text);
      setState((s) => ({ ...s, loading: false }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Prompt failed",
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
    });
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
  };
}
