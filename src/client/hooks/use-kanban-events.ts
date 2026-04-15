"use client";

import { useCallback, useEffect, useRef } from "react";
import { getDesktopApiBaseUrl } from "../utils/diagnostics";
import { resolveApiPath } from "../config/backend";

const FITNESS_INVALIDATE_THROTTLE_MS = 750;

interface UseKanbanEventsOptions {
  workspaceId: string;
  onInvalidate: () => void;
}

export function useKanbanEvents({ workspaceId, onInvalidate }: UseKanbanEventsOptions): void {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitnessInvalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFitnessInvalidateAtRef = useRef(0);
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
    const es = new EventSource(
      resolveApiPath(`api/kanban/events?workspaceId=${encodeURIComponent(workspaceId)}`, base),
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
        if (data.type === "kanban:changed") {
          onInvalidateRef.current();
          return;
        }
        if (data.type === "fitness:changed") {
          const now = Date.now();
          const elapsed = now - lastFitnessInvalidateAtRef.current;
          if (elapsed >= FITNESS_INVALIDATE_THROTTLE_MS) {
            lastFitnessInvalidateAtRef.current = now;
            onInvalidateRef.current();
            return;
          }
          if (fitnessInvalidateTimerRef.current) {
            return;
          }
          fitnessInvalidateTimerRef.current = setTimeout(() => {
            fitnessInvalidateTimerRef.current = null;
            lastFitnessInvalidateAtRef.current = Date.now();
            onInvalidateRef.current();
          }, FITNESS_INVALIDATE_THROTTLE_MS - elapsed);
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
  }, [workspaceId]);

  useEffect(() => {
    connectSseRef.current = connectSSE;
  }, [connectSSE]);

  useEffect(() => {
    if (workspaceId === "__placeholder__") return;

    tearingDownRef.current = false;
    hasConnectedOnceRef.current = false;
    lastFitnessInvalidateAtRef.current = 0;
    connectSSE();

    return () => {
      tearingDownRef.current = true;
      hasConnectedOnceRef.current = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (fitnessInvalidateTimerRef.current) {
        clearTimeout(fitnessInvalidateTimerRef.current);
        fitnessInvalidateTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connectSSE, workspaceId]);
}
