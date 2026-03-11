"use client";

import { useCallback, useEffect, useState } from "react";
import { ProviderDropdown } from "./provider-dropdown";
import { ModelDropdown } from "./model-dropdown";
import { RepoPicker } from "../../repo-picker";
import type { SetupViewProps } from "../types";

export function SetupView({
  setupInput,
  onSetupInputChange,
  onStartSession,
  connected,
  providers,
  selectedProvider,
  onProviderChange,
  onFetchModels,
  workspaces,
  activeWorkspaceId,
  onWorkspaceChange,
  repoSelection,
  onRepoChange,
  agentRole,
  onAgentRoleChange,
}: SetupViewProps) {
  const [selectedModel, setSelectedModel] = useState("");

  // Reset model when provider changes
  useEffect(() => {
    setSelectedModel("");
  }, [selectedProvider]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onStartSession();
    }
  }, [onStartSession]);

  const handleFetchModels = useCallback(() => {
    return onFetchModels(selectedProvider);
  }, [onFetchModels, selectedProvider]);

  const supportsModelSelection = selectedProvider === "opencode" || selectedProvider === "gemini";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-5 py-6 flex flex-col gap-4">
        {/* Header */}
        <SetupHeader />

        {/* Input */}
        <div className="rounded-2xl border-2 border-indigo-200 dark:border-indigo-800/60 bg-white dark:bg-[#1a1f2e] shadow-sm overflow-hidden focus-within:border-indigo-400 dark:focus-within:border-indigo-600 transition-colors">
          <textarea
            value={setupInput}
            onChange={(e) => onSetupInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your task, question, or goal..."
            rows={4}
            className="w-full px-5 py-3.5 text-base text-gray-900 dark:text-gray-100 bg-transparent resize-none focus:outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500 leading-relaxed"
            autoFocus
          />
          {/* Bottom toolbar */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 dark:border-gray-800/60 bg-gray-50/40 dark:bg-gray-900/20">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-gray-400 dark:text-gray-500 mr-1">⌘↵</span>
              {providers.length > 0 && (
                <ProviderDropdown
                  providers={providers}
                  selectedProvider={selectedProvider}
                  onProviderChange={onProviderChange}
                />
              )}
            </div>
            {supportsModelSelection && (
              <ModelDropdown
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                onFetchModels={handleFetchModels}
              />
            )}
            <button
              onClick={onStartSession}
              disabled={!setupInput.trim() || !connected}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              开始
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </button>
          </div>
        </div>

        {/* Workspace + Repository */}
        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">
              Workspace
            </label>
            <select
              value={activeWorkspaceId ?? ""}
              onChange={(e) => onWorkspaceChange(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              {workspaces.length > 0 ? (
                workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>{ws.title}</option>
                ))
              ) : (
                <option value="">No workspaces</option>
              )}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">
              Repository
            </label>
            <RepoPicker value={repoSelection} onChange={onRepoChange} />
          </div>
        </div>

        {/* Agent Selection */}
        <AgentRoleSelector agentRole={agentRole} onAgentRoleChange={onAgentRoleChange} />
      </div>
    </div>
  );
}

function SetupHeader() {
  return (
    <div className="text-center">
      <div className="w-10 h-10 mx-auto mb-2 rounded-xl bg-linear-to-br from-indigo-500/20 to-blue-500/20 flex items-center justify-center">
        <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">What would you like to work on?</h2>
      <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">Describe your task and choose your mode.</p>
    </div>
  );
}

interface AgentRoleSelectorProps {
  agentRole?: string;
  onAgentRoleChange?: (role: string) => void;
}

function AgentRoleSelector({ agentRole, onAgentRoleChange }: AgentRoleSelectorProps) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">
        Mode
      </label>
      <div className="grid grid-cols-2 gap-3">
        {/* Routa Card */}
        <button
          type="button"
          onClick={() => onAgentRoleChange?.("ROUTA")}
          className={`p-3.5 rounded-xl border-2 text-left transition-all duration-150 ${
            agentRole === "ROUTA"
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/25 shadow-sm"
              : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1a1f2e] hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-sm"
          }`}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${
              agentRole === "ROUTA" ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
            }`}>R</div>
            <span className={`font-semibold text-sm ${agentRole === "ROUTA" ? "text-indigo-700 dark:text-indigo-300" : "text-gray-800 dark:text-gray-200"}`}>
              Routa
            </span>
            {agentRole === "ROUTA" && (
              <span className="ml-auto text-[10px] font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full">推荐</span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            负责任务编排与规划。会生成执行规格（spec），并协调后续工作流。
          </p>
        </button>

        {/* CRATER Card */}
        <button
          type="button"
          onClick={() => onAgentRoleChange?.("CRAFTER")}
          className={`p-3.5 rounded-xl border-2 text-left transition-all duration-150 ${
            agentRole === "CRAFTER"
              ? "border-violet-500 bg-violet-50 dark:bg-violet-900/25 shadow-sm"
              : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1a1f2e] hover:border-violet-300 dark:hover:border-violet-700 hover:shadow-sm"
          }`}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${
              agentRole === "CRAFTER" ? "bg-violet-600 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
            }`}>C</div>
            <span className={`font-semibold text-sm ${agentRole === "CRAFTER" ? "text-violet-700 dark:text-violet-300" : "text-gray-800 dark:text-gray-200"}`}>
              CRATER
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            专注于具体实现与代码生成。根据任务描述直接进行实现。
          </p>
        </button>
      </div>
    </div>
  );
}

