"use client";

import { useCallback, useEffect, useState } from "react";

export interface SessionInfo {
  sessionId: string;
  cwd: string;
  workspaceId: string;
  routaAgentId?: string;
  provider?: string;
  createdAt: string;
}

interface SessionPanelProps {
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  refreshKey?: number;
}

export function SessionPanel({
  selectedSessionId,
  onSelect,
  refreshKey,
}: SessionPanelProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/sessions", { cache: "no-store" });
      const data = await res.json();
      setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
    } catch (e) {
      console.error("Failed to fetch sessions", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions, refreshKey]);

  return (
    <div>
      {/* Section header */}
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Sessions
          </span>
          {sessions.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-full">
              {sessions.length}
            </span>
          )}
        </div>
        <button
          onClick={fetchSessions}
          disabled={loading}
          className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50 transition-colors"
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {/* Session list */}
      <div className="px-1.5">
        {sessions.length === 0 ? (
          <div className="px-3 py-4 text-center text-gray-400 dark:text-gray-500 text-xs">
            No sessions yet. Select a provider and create one.
          </div>
        ) : (
          sessions.map((s) => {
            const active = s.sessionId === selectedSessionId;
            return (
              <button
                key={s.sessionId}
                type="button"
                onClick={() => onSelect(s.sessionId)}
                className={`w-full text-left px-2.5 py-2 mb-0.5 rounded-md transition-colors ${
                  active
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-300"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">
                      {s.routaAgentId
                        ? `routa-${s.sessionId.slice(0, 8)}`
                        : s.sessionId.slice(0, 8)}
                    </div>
                    {s.provider && (
                      <div className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                        {s.provider}
                      </div>
                    )}
                  </div>
                  <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${active ? "bg-blue-500" : "bg-green-500"}`} />
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
