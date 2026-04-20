"use client";

import { useCallback, useState } from "react";
import { ProviderDropdown } from "./provider-dropdown";
import { ModelDropdown } from "./model-dropdown";
import { RepoPicker } from "../../repo-picker";
import type { SetupViewProps } from "../types";
import { Sparkles, ArrowRight } from "lucide-react";
import { WorkspaceSwitcher } from "../../workspace-switcher";


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
  onWorkspaceCreate,
  repoSelection,
  onRepoChange,
  agentRole,
  onAgentRoleChange,
}: SetupViewProps) {
  const [selectedModel, setSelectedModel] = useState("");

  const handleProviderChange = useCallback((providerId: string) => {
    setSelectedModel("");
    onProviderChange(providerId);
  }, [onProviderChange]);

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
        <div className="rounded-2xl border-2 border-blue-200 dark:border-blue-800/60 bg-white dark:bg-[#1a1f2e] shadow-sm overflow-hidden focus-within:border-blue-400 dark:focus-within:border-blue-600 transition-colors">
          <textarea
            value={setupInput}
            onChange={(e) => onSetupInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your task, question, or goal..."
            rows={4}
            className="w-full px-5 py-3.5 text-base text-slate-900 dark:text-slate-100 bg-transparent resize-none focus:outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 leading-relaxed"
            autoFocus
          />
          {/* Bottom toolbar */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/40 dark:bg-slate-900/20">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 dark:text-slate-500 mr-1">⌘↵</span>
              {providers.length > 0 && (
                <ProviderDropdown
                  providers={providers}
                  selectedProvider={selectedProvider}
                  onProviderChange={handleProviderChange}
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              开始
              <ArrowRight className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            </button>
          </div>
        </div>

        {/* Workspace + Repository */}
        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
              Workspace
            </label>
            <WorkspaceSwitcher
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onSelect={onWorkspaceChange}
              onCreate={onWorkspaceCreate}
              compact
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
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
      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-blue-500/20 to-blue-400/20">
        <Sparkles className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      </div>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">What would you like to work on?</h2>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Describe your task and choose your mode.</p>
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
      <label className="block text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
        Mode
      </label>
      <div className="grid grid-cols-2 gap-3">
        {/* Routa Card */}
        <button
          type="button"
          onClick={() => onAgentRoleChange?.("ROUTA")}
          className={`p-3.5 rounded-xl border-2 text-left transition-all duration-150 ${
            agentRole === "ROUTA"
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/25 shadow-sm"
              : "border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a1f2e] hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm"
          }`}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${
              agentRole === "ROUTA" ? "bg-blue-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
            }`}>R</div>
            <span className={`font-semibold text-sm ${agentRole === "ROUTA" ? "text-blue-700 dark:text-blue-300" : "text-slate-800 dark:text-slate-200"}`}>
              Routa
            </span>
            {agentRole === "ROUTA" && (
              <span className="ml-auto rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">推荐</span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            负责任务编排与规划。会生成执行规格（spec），并协调后续工作流。
          </p>
        </button>

        {/* CRATER Card */}
        <button
          type="button"
          onClick={() => onAgentRoleChange?.("CRAFTER")}
          className={`p-3.5 rounded-xl border-2 text-left transition-all duration-150 ${
            agentRole === "CRAFTER"
              ? "border-amber-500 bg-amber-50 dark:bg-amber-900/25 shadow-sm"
              : "border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a1f2e] hover:border-amber-300 dark:hover:border-amber-700 hover:shadow-sm"
          }`}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${
              agentRole === "CRAFTER" ? "bg-amber-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
            }`}>C</div>
            <span className={`font-semibold text-sm ${agentRole === "CRAFTER" ? "text-amber-700 dark:text-amber-300" : "text-slate-800 dark:text-slate-200"}`}>
              CRATER
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            专注于具体实现与代码生成。根据任务描述直接进行实现。
          </p>
        </button>
      </div>
    </div>
  );
}
