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

import { AgentPanel } from "@/client/components/agent-panel";
import { SkillPanel } from "@/client/components/skill-panel";
import { ChatPanel } from "@/client/components/chat-panel";

export default function HomePage() {
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
          {/* Left column: Agents + Skills */}
          <div className="lg:col-span-1 space-y-6 overflow-y-auto">
            <AgentPanel />
            <SkillPanel />
          </div>

          {/* Right column: Chat */}
          <div className="lg:col-span-2">
            <ChatPanel />
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
