"use client";

/**
 * AgentPanel - displays and manages agents in the workspace.
 * Accepts a refreshKey prop to trigger external refresh (e.g., after session changes).
 *
 * Uses JSON-RPC via `useAgentsRpc` — routes through Tauri IPC in desktop
 * mode or HTTP `/api/rpc` in web mode.
 */

import { useState, useEffect } from "react";
import { useAgentsRpc } from "../hooks/use-agents-rpc";
import { Select } from "./select";
import { useTranslation } from "@/i18n";

interface AgentPanelProps {
  refreshKey?: number;
  workspaceId?: string;
}

export function AgentPanel({ refreshKey, workspaceId = "" }: AgentPanelProps) {
  const { agents, loading, fetchAgents, createAgent: createAgentRpc } =
    useAgentsRpc(workspaceId);
  const [newAgentName, setNewAgentName] = useState("");
  const { t } = useTranslation();
  const [newAgentRole, setNewAgentRole] = useState("CRAFTER");

  // Refresh when refreshKey changes
  useEffect(() => {
    if (refreshKey !== undefined) {
      fetchAgents();
    }
  }, [refreshKey, fetchAgents]);

  const createAgent = async () => {
    if (!newAgentName.trim()) return;
    await createAgentRpc({ name: newAgentName, role: newAgentRole });
    setNewAgentName("");
  };

  const roleColor: Record<string, string> = {
    ROUTA:
      "role-chip-routa",
    CRAFTER:
      "role-chip-crafter",
    GATE: "role-chip-gate",
  };

  const statusColor: Record<string, string> = {
    PENDING:
      "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
    ACTIVE:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
    COMPLETED:
      "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300",
    ERROR: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    CANCELLED:
      "bg-slate-200 text-slate-500 dark:bg-slate-600 dark:text-slate-400",
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t.agents.title}
          </h2>
          {agents.length > 0 && (
            <span className="px-2 py-0.5 text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-full">
              {agents.length}
            </span>
          )}
        </div>
        <button
          onClick={fetchAgents}
          disabled={loading}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
        >
          {loading ? "..." : t.common.refresh}
        </button>
      </div>

      {/* Create agent form */}
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex gap-2">
        <input
          type="text"
          value={newAgentName}
          onChange={(e) => setNewAgentName(e.target.value)}
          placeholder={t.agents.agentName}
          className="flex-1 px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-slate-400 dark:placeholder:text-slate-500"
          onKeyDown={(e) => e.key === "Enter" && createAgent()}
        />
        <Select
          value={newAgentRole}
          onChange={(e) => setNewAgentRole(e.target.value)}
          className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
        >
          <option value="ROUTA">ROUTA</option>
          <option value="CRAFTER">CRAFTER</option>
          <option value="GATE">GATE</option>
        </Select>
        <button
          onClick={createAgent}
          className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          {t.common.create}
        </button>
      </div>

      {/* Agent list */}
      <div className="divide-y divide-slate-100 dark:divide-slate-700 max-h-64 overflow-y-auto">
        {agents.length === 0 ? (
          <div className="px-5 py-6 text-center text-slate-400 dark:text-slate-500 text-sm">
            {t.agents.noAgents}
          </div>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.id}
              className="px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-slate-900 dark:text-slate-100">
                    {agent.name}
                  </span>
                  <span
                    className={`px-2 py-0.5 text-xs font-medium rounded-full ${roleColor[agent.role] ?? "bg-slate-100"}`}
                  >
                    {agent.role}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColor[agent.status] ?? "bg-slate-100"}`}
                >
                  {agent.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-400 dark:text-slate-500 font-mono truncate">
                {agent.id}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
