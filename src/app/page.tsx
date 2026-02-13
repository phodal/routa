"use client";

/**
 * Routa JS - Main Page
 *
 * Browser-based multi-agent coordinator with:
 *   - MCP Server for tool integration
 *   - ACP Agent for OpenCode-compatible sessions
 *   - Skill discovery and dynamic loading
 *   - Agent management (ROUTA/CRAFTER/GATE)
 */

import { useState, useCallback } from "react";
import { AgentPanel } from "@/client/components/agent-panel";
import { SkillPanel } from "@/client/components/skill-panel";
import { ChatPanel } from "@/client/components/chat-panel";
import { SessionPanel } from "@/client/components/session-panel";
import { useAcp } from "@/client/hooks/use-acp";

export default function HomePage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Routa
            </h1>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Multi-Agent Coordinator
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ProtocolBadge name="MCP" endpoint="/api/mcp" />
            <ProtocolBadge name="ACP" endpoint="/api/acp" />
            <ProtocolBadge name="Skills" endpoint="/api/skills" />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-8rem)]">
          {/* Left column: Sessions + Agents + Skills */}
          <div className="lg:col-span-1 space-y-6 overflow-y-auto">
            <SessionPanel
              selectedSessionId={activeSessionId}
              onSelect={handleSelectSession}
              onCreate={handleCreateSession}
              providers={acp.providers}
              selectedProvider={acp.selectedProvider}
              onChangeProvider={acp.setProvider}
              refreshKey={refreshKey}
            />
            <AgentPanel refreshKey={refreshKey} />
            <SkillPanel />
          </div>

          {/* Right column: Chat */}
          <div className="lg:col-span-2">
            <ChatPanel
              acp={acp}
              activeSessionId={activeSessionId}
              onEnsureSession={ensureSessionForChat}
            />
          </div>
        </div>
      </main>
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
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      {name}
      <span className="text-gray-400 dark:text-gray-500 font-mono">
        {endpoint}
      </span>
    </div>
  );
}
