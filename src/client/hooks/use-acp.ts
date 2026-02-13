"use client";

/**
 * useAcp - React hook for ACP client connection
 *
 * Manages the ACP connection lifecycle:
 *   - Initialize connection
 *   - Create/load sessions
 *   - Send prompts and receive streaming updates
 *   - Access coordination tools
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  BrowserAcpClient,
  AcpSessionUpdate,
  AcpNewSessionResult,
} from "../acp-client";

export interface UseAcpState {
  connected: boolean;
  sessionId: string | null;
  updates: AcpSessionUpdate[];
  loading: boolean;
  error: string | null;
}

export interface UseAcpActions {
  connect: () => Promise<void>;
  newSession: (cwd?: string) => Promise<AcpNewSessionResult | null>;
  prompt: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  disconnect: () => void;
}

export function useAcp(baseUrl: string = ""): UseAcpState & UseAcpActions {
  const clientRef = useRef<BrowserAcpClient | null>(null);
  const [state, setState] = useState<UseAcpState>({
    connected: false,
    sessionId: null,
    updates: [],
    loading: false,
    error: null,
  });

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
    };
  }, []);

  const connect = useCallback(async () => {
    try {
      setState((s) => ({ ...s, loading: true, error: null }));
      const client = new BrowserAcpClient(baseUrl);
      await client.initialize();

      client.onUpdate((update) => {
        setState((s) => ({
          ...s,
          updates: [...s.updates, update],
        }));
      });

      clientRef.current = client;
      setState((s) => ({ ...s, connected: true, loading: false }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Connection failed",
      }));
    }
  }, [baseUrl]);

  const newSession = useCallback(
    async (cwd?: string): Promise<AcpNewSessionResult | null> => {
      const client = clientRef.current;
      if (!client) return null;

      try {
        setState((s) => ({ ...s, loading: true, error: null, updates: [] }));
        const result = await client.newSession({ cwd });
        setState((s) => ({
          ...s,
          sessionId: result.sessionId,
          loading: false,
        }));
        return result;
      } catch (err) {
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "Session creation failed",
        }));
        return null;
      }
    },
    []
  );

  const prompt = useCallback(async (text: string) => {
    const client = clientRef.current;
    const sessionId = state.sessionId;
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
  }, [state.sessionId]);

  const cancel = useCallback(async () => {
    const client = clientRef.current;
    const sessionId = state.sessionId;
    if (!client || !sessionId) return;
    await client.cancel(sessionId);
  }, [state.sessionId]);

  const callTool = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      const client = clientRef.current;
      if (!client) throw new Error("Not connected");
      return client.callTool(name, args);
    },
    []
  );

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setState({
      connected: false,
      sessionId: null,
      updates: [],
      loading: false,
      error: null,
    });
  }, []);

  return {
    ...state,
    connect,
    newSession,
    prompt,
    cancel,
    callTool,
    disconnect,
  };
}
