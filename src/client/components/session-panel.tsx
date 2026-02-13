"use client";

import { useCallback, useEffect, useState } from "react";
import type { AcpProviderInfo } from "../acp-client";

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
  onCreate: (provider: string) => Promise<void>;
  providers: AcpProviderInfo[];
  selectedProvider: string;
  onChangeProvider: (provider: string) => void;
  refreshKey?: number;
}

export function SessionPanel({
  selectedSessionId,
  onSelect,
  onCreate,
  providers,
  selectedProvider,
  onChangeProvider,
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
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Sessions
          </h2>
          {sessions.length > 0 && (
            <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full">
              {sessions.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchSessions}
            disabled={loading}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
          >
            {loading ? "..." : "Refresh"}
          </button>
          <button
            onClick={() => onCreate(selectedProvider)}
            disabled={providers.length === 0}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            New
          </button>
        </div>
      </div>
      <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
          ACP Provider
        </label>
        <select
          value={selectedProvider}
          onChange={(e) => onChangeProvider(e.target.value)}
          disabled={providers.length === 0}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
        >
          {providers.length === 0 ? (
            <option value="opencode">No providers</option>
          ) : (
            providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id})
              </option>
            ))
          )}
        </select>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-56 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="px-5 py-6 text-center text-gray-400 dark:text-gray-500 text-sm">
            No sessions yet. Click “New” to create one.
          </div>
        ) : (
          sessions.map((s) => {
            const active = s.sessionId === selectedSessionId;
            return (
              <button
                key={s.sessionId}
                type="button"
                onClick={() => onSelect(s.sessionId)}
                className={`w-full text-left px-5 py-3 transition-colors ${
                  active
                    ? "bg-blue-50 dark:bg-blue-900/20"
                    : "hover:bg-gray-50 dark:hover:bg-gray-750"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {s.routaAgentId
                        ? `routa-session-${s.sessionId.slice(0, 8)}`
                        : s.sessionId.slice(0, 8)}
                    </div>
                    <div className="mt-1 text-xs text-gray-400 dark:text-gray-500 font-mono truncate">
                      {s.sessionId}
                    </div>
                    {s.provider && (
                      <div className="mt-1 text-[11px] text-blue-500 dark:text-blue-400">
                        {s.provider}
                      </div>
                    )}
                  </div>
                  <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                    ACTIVE
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

