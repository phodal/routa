"use client";

/**
 * Routa JS - Main Page
 *
 * Full-screen layout:
 *   - Top bar: Logo, Agent selector, protocol badges
 *   - Left sidebar: Provider selector, Sessions, Skills
 *   - Right area: Chat panel
 */

import { useState, useCallback } from "react";
import { SkillPanel } from "@/client/components/skill-panel";
import { ChatPanel } from "@/client/components/chat-panel";
import { SessionPanel } from "@/client/components/session-panel";
import { useAcp } from "@/client/hooks/use-acp";

type AgentRole = "CRAFTER" | "ROUTA" | "GATE";

export default function HomePage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentRole>("CRAFTER");
  const [showAgentToast, setShowAgentToast] = useState(false);
  const acp = useAcp();

  const bumpRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const ensureConnected = useCallback(async () => {
    if (!acp.connected) {
      await acp.connect();
    }
  }, [acp]);

  const handleCreateSession = useCallback(
    async (provider: string) => {
      await ensureConnected();
      const result = await acp.createSession(undefined, provider);
      if (result?.sessionId) {
        setActiveSessionId(result.sessionId);
        bumpRefresh();
      }
    },
    [acp, ensureConnected, bumpRefresh]
  );

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      await ensureConnected();
      acp.selectSession(sessionId);
      setActiveSessionId(sessionId);
      bumpRefresh();
    },
    [acp, ensureConnected, bumpRefresh]
  );

  const ensureSessionForChat = useCallback(async (): Promise<string | null> => {
    await ensureConnected();
    if (activeSessionId) return activeSessionId;
    const result = await acp.createSession();
    if (result?.sessionId) {
      setActiveSessionId(result.sessionId);
      bumpRefresh();
      return result.sessionId;
    }
    return null;
  }, [acp, activeSessionId, ensureConnected, bumpRefresh]);

  const handleAgentChange = useCallback((role: AgentRole) => {
    if (role !== "CRAFTER") {
      setShowAgentToast(true);
      setTimeout(() => setShowAgentToast(false), 2500);
      return;
    }
    setSelectedAgent(role);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-[#0f1117]">
      {/* ─── Top Bar ──────────────────────────────────────────────── */}
      <header className="h-[52px] shrink-0 bg-white dark:bg-[#161922] border-b border-gray-200 dark:border-gray-800 flex items-center px-4 gap-4 z-10">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold">R</span>
          </div>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Routa
          </span>
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />

        {/* Agent selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Agent:</span>
          <div className="relative">
            <select
              value={selectedAgent}
              onChange={(e) => handleAgentChange(e.target.value as AgentRole)}
              className="appearance-none pl-3 pr-7 py-1 text-xs font-medium rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] text-gray-900 dark:text-gray-100 cursor-pointer focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="CRAFTER">CRAFTER</option>
              <option value="ROUTA">ROUTA</option>
              <option value="GATE">GATE</option>
            </select>
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            ACTIVE
          </span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Protocol badges */}
        <div className="flex items-center gap-2">
          <ProtocolBadge name="MCP" endpoint="/api/mcp" />
          <ProtocolBadge name="ACP" endpoint="/api/acp" />
        </div>

        {/* Connection status */}
        <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
        <button
          onClick={async () => {
            if (acp.connected) {
              acp.disconnect();
            } else {
              await acp.connect();
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            acp.connected
              ? "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30"
              : "text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${acp.connected ? "bg-green-500" : "bg-gray-400"}`} />
          {acp.connected ? "Connected" : "Disconnected"}
        </button>
      </header>

      {/* ─── Main Area ────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* ─── Left Sidebar ──────────────────────────────────────── */}
        <aside className="w-[300px] shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#13151d] flex flex-col overflow-hidden">
          {/* Provider + New Session */}
          <div className="p-3 border-b border-gray-100 dark:border-gray-800">
            <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
              Provider
            </label>
            <select
              value={acp.selectedProvider}
              onChange={(e) => acp.setProvider(e.target.value)}
              disabled={acp.providers.length === 0}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] text-gray-900 dark:text-gray-100 disabled:opacity-40 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              {acp.providers.length === 0 ? (
                <option value="">Connect to load providers...</option>
              ) : (
                acp.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              )}
            </select>
            <button
              onClick={() => handleCreateSession(acp.selectedProvider)}
              disabled={acp.providers.length === 0 || !acp.selectedProvider}
              className="mt-2 w-full px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + New Session
            </button>
          </div>

          {/* Sessions */}
          <div className="flex-1 overflow-y-auto">
            <SessionPanel
              selectedSessionId={activeSessionId}
              onSelect={handleSelectSession}
              refreshKey={refreshKey}
            />

            {/* Divider */}
            <div className="mx-3 my-1 border-t border-gray-100 dark:border-gray-800" />

            {/* Skills */}
            <SkillPanel />
          </div>
        </aside>

        {/* ─── Chat Area ──────────────────────────────────────────── */}
        <main className="flex-1 min-w-0">
          <ChatPanel
            acp={acp}
            activeSessionId={activeSessionId}
            onEnsureSession={ensureSessionForChat}
          />
        </main>
      </div>

      {/* ─── Agent Toast ──────────────────────────────────────────── */}
      {showAgentToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium shadow-lg animate-fade-in">
          Only CRAFTER is supported. Other agents coming soon.
        </div>
      )}
    </div>
  );
}

function ProtocolBadge({
  name,
  endpoint,
}: {
  name: string;
  endpoint: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-50 dark:bg-[#1e2130] text-[11px] font-medium text-gray-500 dark:text-gray-400">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      {name}
      <span className="text-gray-400 dark:text-gray-500 font-mono text-[10px]">
        {endpoint}
      </span>
    </div>
  );
}
