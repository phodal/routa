"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "@/i18n";

type ReplayEvent = {
  sessionId?: string;
  eventId?: string;
  update?: Record<string, unknown>;
  [key: string]: unknown;
};

export function AcpReplayDebugPageClient() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const initialSessionId = searchParams.get("sessionId") ?? "";
  const initialLastEventId = searchParams.get("lastEventId") ?? "";
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [lastEventId, setLastEventId] = useState(initialLastEventId);
  const [history, setHistory] = useState<ReplayEvent[]>([]);
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [status, setStatus] = useState(initialSessionId ? "loading" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!sessionId) return;

    let closed = false;
    const controller = new AbortController();
    const query = new URLSearchParams({ sessionId });
    if (lastEventId) {
      query.set("lastEventId", lastEventId);
    }

    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/history`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!closed) {
          setHistory(Array.isArray(payload.history) ? payload.history : []);
        }
      })
      .catch((fetchError: unknown) => {
        if (!closed) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load history");
        }
      });

    const source = new EventSource(`/api/acp?${query.toString()}`);
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { params?: ReplayEvent };
        const nextEvent = payload.params;
        if (!nextEvent) return;
        setStatus("streaming");
        setEvents((current) => [...current, nextEvent]);
      } catch (parseError) {
        setError(parseError instanceof Error ? parseError.message : "Failed to parse SSE payload");
      }
    };
    source.onerror = () => {
      setStatus("error");
      setError("EventSource disconnected");
      source.close();
    };

    return () => {
      closed = true;
      controller.abort();
      source.close();
    };
  }, [sessionId, lastEventId, refreshKey]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextSessionId = sessionId.trim();
    const nextLastEventId = lastEventId.trim();
    const query = new URLSearchParams();
    if (nextSessionId) query.set("sessionId", nextSessionId);
    if (nextLastEventId) query.set("lastEventId", nextLastEventId);
    const nextUrl = query.toString()
      ? `${window.location.pathname}?${query.toString()}`
      : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
    setSessionId(nextSessionId);
    setLastEventId(nextLastEventId);
    setStatus(nextSessionId ? "loading" : "idle");
    setError(null);
    setEvents([]);
    setHistory([]);
    setRefreshKey((current) => current + 1);
  };

  return (
    <main style={{ padding: 24, fontFamily: "monospace" }}>
      <h1>{t.debug.acpReplayTitle}</h1>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, maxWidth: 720 }}>
        <label>
          {t.debug.sessionId}
          <input
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <label>
          {t.debug.lastEventId}
          <input
            value={lastEventId}
            onChange={(event) => setLastEventId(event.target.value)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <button type="submit" style={{ width: 160 }}>{t.debug.reconnect}</button>
      </form>

      <section style={{ marginTop: 24 }}>
        <p><strong>{t.debug.status}:</strong> {status}</p>
        {error ? <p><strong>{t.debug.error}:</strong> {error}</p> : null}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>{t.debug.historySnapshot}</h2>
        <pre>{JSON.stringify(history, null, 2)}</pre>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>{t.debug.replayEvents}</h2>
        <pre>{JSON.stringify(events, null, 2)}</pre>
      </section>
    </main>
  );
}
