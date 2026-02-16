"use client";

/**
 * AgentInstallPanel - ACP Agent Installation UI
 *
 * Displays a list of agents from the ACP Registry with:
 * - Search/filter functionality
 * - Install/Update/Uninstall buttons
 * - Version and distribution type info
 * - Runtime availability indicators (npx, uvx)
 *
 * In Tauri desktop mode, uses local installation via Tauri commands.
 * In web mode, uses server-side API routes.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { isTauriRuntime } from "@/client/utils/diagnostics";

// ─── Types ─────────────────────────────────────────────────────────────────

interface RegistryAgent {
  id: string;
  name: string;
  version: string;
  description: string;
  repository?: string;
  authors: string[];
  license: string;
  icon?: string;
}

interface AgentWithStatus {
  agent: RegistryAgent;
  installed: boolean;
  distributionTypes: ("npx" | "uvx" | "binary")[];
}

interface RegistryResponse {
  agents: AgentWithStatus[];
  platform: string | null;
  runtimeAvailability: {
    npx: boolean;
    uvx: boolean;
  };
}

// ─── Tauri Types (matching Rust types) ─────────────────────────────────────

interface TauriAcpRegistry {
  agents: TauriAcpAgentEntry[];
}

interface TauriAcpAgentEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  icon?: string;
  homepage?: string;
  repository?: string;
  authors?: string[];
  license?: string;
  distribution: TauriAcpDistribution;
}

interface TauriAcpDistribution {
  npx?: TauriNpxDistribution;
  uvx?: TauriUvxDistribution;
  binary?: Record<string, TauriBinaryInfo>;
}

interface TauriNpxDistribution {
  package: string;
  args?: string[];
  env?: Record<string, string>;
}

interface TauriUvxDistribution {
  package: string;
  args?: string[];
  env?: Record<string, string>;
}

interface TauriBinaryInfo {
  archive: string;
  cmd?: string;
  sha256?: string;
}

interface TauriInstalledAgentInfo {
  agentId: string;
  version: string;
  distType: "npx" | "uvx" | "binary";
  installedAt: string;
  binaryPath?: string;
  package?: string;
}

// ─── Tauri Invoke Helper ───────────────────────────────────────────────────

/**
 * Dynamically invoke a Tauri command using the global __TAURI__ object.
 * This avoids bundling @tauri-apps/api/core in web builds.
 * Uses the Window.__TAURI__ type from diagnostics.ts.
 */
async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoke = (window as any).__TAURI__?.core?.invoke;
  if (!invoke) {
    throw new Error("Tauri invoke not available - not running in Tauri environment");
  }
  return invoke(command, args) as Promise<T>;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function AgentInstallPanel() {
  const [agents, setAgents] = useState<AgentWithStatus[]>([]);
  const [platform, setPlatform] = useState<string | null>(null);
  const [runtimeAvailability, setRuntimeAvailability] = useState({ npx: false, uvx: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [installingAgents, setInstallingAgents] = useState<Set<string>>(new Set());
  const isTauri = useRef(isTauriRuntime());

  // Convert Tauri registry to frontend format
  const convertTauriRegistry = useCallback(
    (registry: TauriAcpRegistry, installedAgents: TauriInstalledAgentInfo[]): AgentWithStatus[] => {
      const installedMap = new Map(installedAgents.map((a) => [a.agentId, a]));
      return registry.agents.map((agent) => {
        // Determine distribution types from the new structure
        const distTypes: ("npx" | "uvx" | "binary")[] = [];
        if (agent.distribution.npx) distTypes.push("npx");
        if (agent.distribution.uvx) distTypes.push("uvx");
        if (agent.distribution.binary) distTypes.push("binary");

        return {
          agent: {
            id: agent.id,
            name: agent.name,
            version: agent.version || "latest",
            description: agent.description,
            repository: agent.repository,
            authors: agent.authors ?? [],
            license: agent.license ?? "",
            icon: agent.icon,
          },
          installed: installedMap.has(agent.id),
          distributionTypes: distTypes,
        };
      });
    },
    []
  );

  // Fetch registry data (Tauri or Web)
  const fetchAgents = useCallback(
    async (refresh = false) => {
      try {
        setLoading(true);
        setError(null);

        if (isTauri.current) {
          // Tauri: Use local commands
          const registry = await tauriInvoke<TauriAcpRegistry>("fetch_acp_registry");
          const installedAgents = await tauriInvoke<TauriInstalledAgentInfo[]>("get_installed_agents");
          const converted = convertTauriRegistry(registry, installedAgents);
          setAgents(converted);
          // Detect platform from navigator
          const ua = navigator.userAgent;
          if (ua.includes("Mac")) setPlatform("darwin");
          else if (ua.includes("Win")) setPlatform("windows");
          else setPlatform("linux");
          // In Tauri, we assume npx/uvx are available (can be enhanced later)
          setRuntimeAvailability({ npx: true, uvx: true });
        } else {
          // Web: Use API routes
          const url = refresh ? "/api/acp/registry?refresh=true" : "/api/acp/registry";
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Failed to fetch registry: ${res.status}`);
          const data: RegistryResponse = await res.json();
          setAgents(data.agents);
          setPlatform(data.platform);
          setRuntimeAvailability(data.runtimeAvailability);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load agents");
      } finally {
        setLoading(false);
      }
    },
    [convertTauriRegistry]
  );

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Filter agents by search query
  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return agents;
    const q = searchQuery.toLowerCase();
    return agents.filter(
      (a) =>
        a.agent.name.toLowerCase().includes(q) ||
        a.agent.id.toLowerCase().includes(q) ||
        a.agent.description.toLowerCase().includes(q)
    );
  }, [agents, searchQuery]);

  // Install agent (Tauri or Web)
  const handleInstall = useCallback(
    async (agentId: string, _distType?: string) => {
      setInstallingAgents((prev) => new Set(prev).add(agentId));
      try {
        if (isTauri.current) {
          // Tauri: Install locally
          await tauriInvoke<TauriInstalledAgentInfo>("install_acp_agent", { agentId });
        } else {
          // Web: Use API route
          const res = await fetch("/api/acp/install", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId, distributionType: _distType }),
          });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Installation failed");
          }
        }
        await fetchAgents();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Installation failed");
      } finally {
        setInstallingAgents((prev) => {
          const next = new Set(prev);
          next.delete(agentId);
          return next;
        });
      }
    },
    [fetchAgents]
  );

  // Uninstall agent (Tauri or Web)
  const handleUninstall = useCallback(
    async (agentId: string) => {
      setInstallingAgents((prev) => new Set(prev).add(agentId));
      try {
        if (isTauri.current) {
          // Tauri: Uninstall locally
          await tauriInvoke<void>("uninstall_acp_agent", { agentId });
        } else {
          // Web: Use API route
          const res = await fetch("/api/acp/install", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId }),
          });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Uninstallation failed");
          }
        }
        await fetchAgents();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Uninstallation failed");
      } finally {
        setInstallingAgents((prev) => {
          const next = new Set(prev);
          next.delete(agentId);
          return next;
        });
      }
    },
    [fetchAgents]
  );

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#0f1117]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AgentIcon className="w-5 h-5 text-indigo-500" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              ACP Agents
            </h2>
            {agents.length > 0 && (
              <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 rounded-full">
                {agents.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <RuntimeBadges npx={runtimeAvailability.npx} uvx={runtimeAvailability.uvx} />
            <button
              onClick={() => fetchAgents(true)}
              disabled={loading}
              className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Agent List */}
      <div className="flex-1 overflow-y-auto px-5 py-3">
        {loading && agents.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            Loading agents from registry...
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            {searchQuery ? "No agents match your search" : "No agents available"}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredAgents.map(({ agent, installed, distributionTypes }) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                installed={installed}
                distributionTypes={distributionTypes}
                installing={installingAgents.has(agent.id)}
                runtimeAvailability={runtimeAvailability}
                onInstall={handleInstall}
                onUninstall={handleUninstall}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400">
        Platform: {platform ?? "unknown"} • Registry: cdn.agentclientprotocol.com
      </div>
    </div>
  );
}


// ─── AgentCard Component ───────────────────────────────────────────────────

interface AgentCardProps {
  agent: RegistryAgent;
  installed: boolean;
  distributionTypes: ("npx" | "uvx" | "binary")[];
  installing: boolean;
  runtimeAvailability: { npx: boolean; uvx: boolean };
  onInstall: (agentId: string, distType?: string) => void;
  onUninstall: (agentId: string) => void;
}

function AgentCard({
  agent,
  installed,
  distributionTypes,
  installing,
  runtimeAvailability,
  onInstall,
  onUninstall,
}: AgentCardProps) {
  // Determine best available distribution type
  const availableDistType = useMemo(() => {
    if (distributionTypes.includes("npx") && runtimeAvailability.npx) return "npx";
    if (distributionTypes.includes("uvx") && runtimeAvailability.uvx) return "uvx";
    if (distributionTypes.includes("binary")) return "binary";
    return null;
  }, [distributionTypes, runtimeAvailability]);

  const canInstall = availableDistType !== null;

  return (
    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
          {agent.icon ? (
            <img src={agent.icon} alt="" className="w-6 h-6" />
          ) : (
            agent.name.charAt(0).toUpperCase()
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {agent.name}
            </h3>
            <span className="px-1.5 py-0.5 text-[10px] font-mono text-gray-500 bg-gray-100 dark:bg-gray-700 rounded">
              v{agent.version}
            </span>
            {installed && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded">
                Installed
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">
            {agent.description}
          </p>
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            <span>{agent.authors.join(", ")}</span>
            <span>•</span>
            <span>{agent.license}</span>
            <span>•</span>
            <div className="flex gap-1">
              {distributionTypes.map((dt) => (
                <span
                  key={dt}
                  className={`px-1 py-0.5 rounded ${
                    (dt === "npx" && runtimeAvailability.npx) ||
                    (dt === "uvx" && runtimeAvailability.uvx) ||
                    dt === "binary"
                      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-400 line-through"
                  }`}
                >
                  {dt}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {installed ? (
            <button
              onClick={() => onUninstall(agent.id)}
              disabled={installing}
              className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
            >
              {installing ? "..." : "Uninstall"}
            </button>
          ) : (
            <button
              onClick={() => onInstall(agent.id, availableDistType ?? undefined)}
              disabled={installing || !canInstall}
              className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {installing ? "Installing..." : canInstall ? "Install" : "Unavailable"}
            </button>
          )}
          {agent.repository && (
            <a
              href={agent.repository}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title="View repository"
            >
              <GithubIcon className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helper Components ─────────────────────────────────────────────────────

function RuntimeBadges({ npx, uvx }: { npx: boolean; uvx: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className={`px-1.5 py-0.5 rounded ${npx ? "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400" : "bg-gray-100 dark:bg-gray-700 text-gray-400"}`}>
        npx {npx ? "✓" : "✗"}
      </span>
      <span className={`px-1.5 py-0.5 rounded ${uvx ? "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400" : "bg-gray-100 dark:bg-gray-700 text-gray-400"}`}>
        uvx {uvx ? "✓" : "✗"}
      </span>
    </div>
  );
}

function AgentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611l-.628.105a9.002 9.002 0 01-2.507.175m0 0a9.002 9.002 0 01-2.507-.175l-.628-.105c-1.717-.293-2.299-2.379-1.067-3.611L14.25 15.3" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

