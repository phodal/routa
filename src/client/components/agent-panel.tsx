"use client";

/**
 * AgentPanel - displays and manages agents in the workspace
 */

import { useState, useEffect, useCallback } from "react";

interface AgentInfo {
  id: string;
  name: string;
  role: string;
  status: string;
  parentId?: string;
}

export function AgentPanel() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentRole, setNewAgentRole] = useState("CRAFTER");

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/agents");
      const data = await res.json();
      setAgents(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch agents:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const createAgent = async () => {
    if (!newAgentName.trim()) return;
    try {
      await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newAgentName, role: newAgentRole }),
      });
      setNewAgentName("");
      fetchAgents();
    } catch (err) {
      console.error("Failed to create agent:", err);
    }
  };

  const roleColor: Record<string, string> = {
    ROUTA: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    CRAFTER: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    GATE: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  };

  const statusColor: Record<string, string> = {
    PENDING: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
    ACTIVE: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    COMPLETED: "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300",
    ERROR: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    CANCELLED: "bg-gray-200 text-gray-500 dark:bg-gray-600 dark:text-gray-400",
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Agents
        </h2>
        <button
          onClick={fetchAgents}
          disabled={loading}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Create agent form */}
      <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex gap-2">
        <input
          type="text"
          value={newAgentName}
          onChange={(e) => setNewAgentName(e.target.value)}
          placeholder="Agent name..."
          className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          onKeyDown={(e) => e.key === "Enter" && createAgent()}
        />
        <select
          value={newAgentRole}
          onChange={(e) => setNewAgentRole(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        >
          <option value="ROUTA">ROUTA</option>
          <option value="CRAFTER">CRAFTER</option>
          <option value="GATE">GATE</option>
        </select>
        <button
          onClick={createAgent}
          className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          Create
        </button>
      </div>

      {/* Agent list */}
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {agents.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 dark:text-gray-500 text-sm">
            No agents yet. Create one to get started.
          </div>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.id}
              className="px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                    {agent.name}
                  </span>
                  <span
                    className={`px-2 py-0.5 text-xs font-medium rounded-full ${roleColor[agent.role] ?? "bg-gray-100"}`}
                  >
                    {agent.role}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColor[agent.status] ?? "bg-gray-100"}`}
                >
                  {agent.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-400 dark:text-gray-500 font-mono">
                {agent.id}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
