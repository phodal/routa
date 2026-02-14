"use client";

/**
 * Routa JS - Main Page
 *
 * Full-screen layout:
 *   - Top bar: Logo, Agent selector, protocol badges
 *   - Left sidebar: Provider selector, Sessions, Skills
 *   - Right area: Chat panel
 */

import { useState, useCallback, useEffect } from "react";
import { SkillPanel } from "@/client/components/skill-panel";
import { ChatPanel } from "@/client/components/chat-panel";
import { SessionPanel } from "@/client/components/session-panel";
import { useAcp } from "@/client/hooks/use-acp";
import { useSkills } from "@/client/hooks/use-skills";
import type { RepoSelection } from "@/client/components/repo-picker";

type AgentRole = "CRAFTER" | "ROUTA" | "GATE";

export default function HomePage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentRole>("CRAFTER");
  const [showAgentToast, setShowAgentToast] = useState(false);
  const [repoSelection, setRepoSelection] = useState<RepoSelection | null>(null);
  const acp = useAcp();
  const skillsHook = useSkills();

  // Auto-connect on mount so providers are loaded immediately
  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const cwd = repoSelection?.path ?? undefined;
      const result = await acp.createSession(cwd, provider);
      if (result?.sessionId) {
        setActiveSessionId(result.sessionId);
        bumpRefresh();
      }
    },
    [acp, ensureConnected, bumpRefresh, repoSelection]
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

  const ensureSessionForChat = useCallback(async (cwd?: string, provider?: string, modeId?: string): Promise<string | null> => {
    await ensureConnected();
    if (activeSessionId) return activeSessionId;
    const result = await acp.createSession(cwd, provider ?? acp.selectedProvider, modeId);
    if (result?.sessionId) {
      setActiveSessionId(result.sessionId);
      bumpRefresh();
      return result.sessionId;
    }
    return null;
  }, [acp, activeSessionId, ensureConnected, bumpRefresh]);

  const handleLoadSkill = useCallback(async (name: string): Promise<string | null> => {
    const skill = await skillsHook.loadSkill(name);
    return skill?.content ?? null;
  }, [skillsHook]);

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
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Provider
              </label>
              {acp.providers.length > 0 && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {acp.providers.filter((p) => p.status === "available").length}/{acp.providers.length} installed
                </span>
              )}
            </div>

            {/* Provider list */}
            <div className="max-h-44 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] divide-y divide-gray-50 dark:divide-gray-800">
              {acp.providers.length === 0 ? (
                <div className="px-3 py-3 text-xs text-gray-400 text-center">
                  Connecting...
                </div>
              ) : (
                acp.providers.map((p) => {
                  const isAvailable = p.status === "available";
                  const isSelected = p.id === acp.selectedProvider;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => acp.setProvider(p.id)}
                      className={`w-full text-left px-2.5 py-2 flex items-center gap-2 transition-colors ${
                        isSelected
                          ? "bg-blue-50 dark:bg-blue-900/20"
                          : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      } ${!isAvailable ? "opacity-50" : ""}`}
                    >
                      {/* Status dot */}
                      <span
                        className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                          isAvailable ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
                        }`}
                      />
                      {/* Name + description */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-medium truncate ${isSelected ? "text-blue-700 dark:text-blue-300" : "text-gray-900 dark:text-gray-100"}`}>
                            {p.name}
                          </span>
                          <span className="text-[9px] text-gray-400 dark:text-gray-500 font-mono truncate">
                            {p.command}
                          </span>
                        </div>
                      </div>
                      {/* Status badge */}
                      <span
                        className={`shrink-0 px-1.5 py-0.5 text-[9px] font-medium rounded ${
                          isAvailable
                            ? "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
                        }`}
                      >
                        {isAvailable ? "Ready" : "Not found"}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {/* Serverless limitation warning */}
            {acp.providers.length > 0 && acp.providers.filter((p) => p.status === "available").length === 0 && (
              <div className="mt-2 px-2.5 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <div className="flex items-start gap-1.5">
                  <span className="text-amber-600 dark:text-amber-400 text-xs">⚠️</span>
                  <div className="flex-1 text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
                    <p className="font-medium mb-1">CLI tools unavailable on Vercel</p>
                    <p className="text-amber-600 dark:text-amber-400">
                      Serverless platforms cannot run CLI processes.
                      Deploy to a VPS or use API-based providers instead.
                    </p>
                  </div>
                </div>
              </div>
            )}

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
            skills={skillsHook.skills}
            onLoadSkill={handleLoadSkill}
            repoSelection={repoSelection}
            onRepoChange={setRepoSelection}
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
