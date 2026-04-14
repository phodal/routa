"use client";

import { useCallback, useEffect, useRef } from "react";
import { getDesktopApiBaseUrl } from "../utils/diagnostics";
import { resolveApiPath } from "../config/backend";

interface UseKanbanEventsOptions {
  workspaceId: string;
  codebaseId?: string | null;
  onInvalidate: () => void;
}

export function useKanbanEvents({ workspaceId, codebaseId, onInvalidate }: UseKanbanEventsOptions): void {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tearingDownRef = useRef(false);
  const hasConnectedOnceRef = useRef(false);
  const onInvalidateRef = useRef(onInvalidate);
  const connectSseRef = useRef<() => void>(() => {});

  useEffect(() => {
    onInvalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const base = getDesktopApiBaseUrl();
    const searchParams = new URLSearchParams({
      workspaceId,
    });
    if (codebaseId) {
      searchParams.set("codebaseId", codebaseId);
    }
    const es = new EventSource(
      resolveApiPath(`api/kanban/events?${searchParams.toString()}`, base),
    );
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type?: string };
        if (data.type === "connected") {
          if (hasConnectedOnceRef.current) {
            onInvalidateRef.current();
          } else {
            hasConnectedOnceRef.current = true;
          }
          return;
        }
        if (data.type === "kanban:changed" || data.type === "fitness:changed") {
          onInvalidateRef.current();
        }
      } catch {
        // Ignore malformed payloads.
      }
    };

    es.onerror = () => {
      if (tearingDownRef.current || document.visibilityState === "hidden") {
        es.close();
        eventSourceRef.current = null;
        return;
      }
      es.close();
      eventSourceRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => connectSseRef.current(), 3000);
    };
  }, [codebaseId, workspaceId]);

  useEffect(() => {
    connectSseRef.current = connectSSE;
  }, [connectSSE]);

  useEffect(() => {
    if (workspaceId === "__placeholder__") return;

    tearingDownRef.current = false;
    hasConnectedOnceRef.current = false;
    connectSSE();

    return () => {
      tearingDownRef.current = true;
      hasConnectedOnceRef.current = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [codebaseId, connectSSE, workspaceId]);
}
