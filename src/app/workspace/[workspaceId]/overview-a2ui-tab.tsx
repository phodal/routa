"use client";

import React, { useState } from "react";
import { useTranslation } from "@/i18n";
import { A2UIViewer } from "@/client/a2ui/renderer";
import {
  generateDashboardA2UI,
  generateTaskKanbanSurface,
  generateAgentMonitorSurface,
  generateTimelineSurface,
  generateWorkspaceSummarySurface,
  type DashboardData,
} from "@/client/a2ui/dashboard-generator";
import type { A2UIMessage } from "@/client/a2ui/types";
import { CodeEditor } from "@/client/components/codemirror";
import { DashboardCard, AgentRoleIcon, AgentStatusDot } from "./ui-components";
import type { NoteData } from "@/client/hooks/use-notes";
import type { SessionInfo, BackgroundTaskInfo, TaskInfo, TraceInfo } from "./types";
import { Columns2, LayoutGrid, Plus, X, CodeXml, Download, CircleUser, ChartColumn, Monitor } from "lucide-react";


interface OverviewA2UITabProps {
  workspace: { id: string; title: string; status: string };
  sessions: SessionInfo[];
  agents: Array<{ id: string; name: string; role: string; status: string }>;
  tasks: TaskInfo[];
  bgTasks: BackgroundTaskInfo[];
  codebases: Array<{ id: string; label?: string; repoPath: string; branch?: string; isDefault?: boolean }>;
  notes: NoteData[];
  traces: TraceInfo[];
  skills: Array<{ name: string }>;
  customSurfaces: A2UIMessage[];
  showSource: boolean;
  onToggleSource: () => void;
  onAction: (action: { name: string; surfaceId: string; context?: Record<string, unknown> }) => void;
  onAddCustomSurface: (messages: A2UIMessage[]) => void;
  onInstallAgent: () => void;
  onDeleteAllSessions: () => void;
  onNavigateSession: (sessionId: string) => void;
}

export function OverviewA2UITab({
  workspace,
  sessions,
  agents,
  tasks,
  bgTasks,
  codebases,
  notes,
  traces,
  skills,
  customSurfaces,
  showSource,
  onToggleSource,
  onAction,
  onAddCustomSurface,
  onInstallAgent,
}: OverviewA2UITabProps) {
  const { t } = useTranslation();
  const [showJsonPanel, setShowJsonPanel] = useState(false);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [customJsonInput, setCustomJsonInput] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [sourceEditValue, setSourceEditValue] = useState<string>("");
  const [sourceApplyError, setSourceApplyError] = useState<string | null>(null);
  const [sourceIsOverridden, setSourceIsOverridden] = useState(false);

  const dashboardData: DashboardData = {
    workspace,
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      name: s.name,
      provider: s.provider,
      role: s.role,
      createdAt: s.createdAt,
    })),
    agents,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assignedTo: t.assignedTo,
      createdAt: t.createdAt,
    })),
    bgTasks: bgTasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      agentId: t.agentId,
      triggerSource: t.triggerSource,
      createdAt: t.createdAt,
    })),
    codebases,
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      metadata: n.metadata,
      updatedAt: n.updatedAt,
    })),
    traces: traces.map((t) => ({
      id: t.id,
      agentName: t.agentName,
      action: t.action,
      summary: t.summary,
      createdAt: t.createdAt,
    })),
  };

  const autoMessages = React.useMemo(
    () => [...generateDashboardA2UI(dashboardData), ...customSurfaces],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(dashboardData), customSurfaces]
  );

  const [messagesOverride, setMessagesOverride] = React.useState<A2UIMessage[] | null>(null);
  const a2uiMessages = messagesOverride ?? autoMessages;

  React.useEffect(() => {
    if (showSource && !sourceIsOverridden) {
      setSourceEditValue(JSON.stringify(autoMessages, null, 2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSource]);

  React.useEffect(() => {
    if (showSource && !sourceIsOverridden) {
      setSourceEditValue(JSON.stringify(autoMessages, null, 2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMessages]);

  const handleApplySource = () => {
    try {
      const parsed = JSON.parse(sourceEditValue);
      const messages: A2UIMessage[] = Array.isArray(parsed) ? parsed : [parsed];
      setMessagesOverride(messages);
      setSourceIsOverridden(true);
      setSourceApplyError(null);
    } catch (e) {
      setSourceApplyError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const handleResetSource = () => {
    setMessagesOverride(null);
    setSourceIsOverridden(false);
    setSourceEditValue(JSON.stringify(autoMessages, null, 2));
    setSourceApplyError(null);
  };

  const exportJson = () => {
    const json = JSON.stringify(a2uiMessages, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `a2ui-dashboard-${workspace.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = () => {
    try {
      const parsed = JSON.parse(customJsonInput);
      const messages: A2UIMessage[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const msg of messages) {
        if (!msg.version || msg.version !== "v0.10") {
          throw new Error('Each message must have version: "v0.10"');
        }
        if (!("createSurface" in msg || "updateComponents" in msg || "updateDataModel" in msg || "deleteSurface" in msg)) {
          throw new Error("Each message must contain one of: createSurface, updateComponents, updateDataModel, deleteSurface");
        }
      }
      onAddCustomSurface(messages);
      setCustomJsonInput("");
      setJsonError(null);
      setShowJsonPanel(false);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const sampleJson = `[
  {
    "version": "v0.10",
    "createSurface": {
      "surfaceId": "custom_widget",
      "catalogId": "https://a2ui.org/specification/v0_10/basic_catalog.json",
      "theme": { "agentDisplayName": "My Agent" }
    }
  },
  {
    "version": "v0.10",
    "updateComponents": {
      "surfaceId": "custom_widget",
      "components": [
        { "id": "root", "component": "Card", "child": "content" },
        { "id": "content", "component": "Column", "children": ["title", "body"] },
        { "id": "title", "component": "Text", "text": "Custom Widget", "variant": "h3" },
        { "id": "body", "component": "Text", "text": { "path": "/message" }, "variant": "body" }
      ]
    }
  },
  {
    "version": "v0.10",
    "updateDataModel": {
      "surfaceId": "custom_widget",
      "value": { "message": "This is a custom A2UI surface rendered in your dashboard!" }
    }
  }
]`;

  return (
    <div className="space-y-6">
      {/* ─── A2UI-Rendered Dashboard ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <A2UIViewer messages={a2uiMessages} onAction={onAction} />
        </div>

        <div className="space-y-6">
          <DashboardCard
            title={t.a2ui.agents}
            count={agents.length}
            emptyText={t.a2ui.noAgentsSpawned}
            action={
              <button
                onClick={onInstallAgent}
                className="text-[11px] text-amber-600 dark:text-amber-500 hover:text-amber-700 dark:hover:text-amber-400 transition-colors"
              >
                + {t.a2ui.install}
              </button>
            }
          >
            {agents.slice(0, 6).map((agent) => (
              <div key={agent.id} className="flex items-center gap-3 px-3.5 py-2 rounded-lg">
                <AgentRoleIcon role={agent.role} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-slate-700 dark:text-slate-300 truncate">{agent.name}</div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">{agent.role}</div>
                </div>
                <AgentStatusDot status={agent.status} />
              </div>
            ))}
          </DashboardCard>

          {skills.length > 0 && (
            <DashboardCard title={t.a2ui.skills} count={skills.length}>
              <div className="flex flex-wrap gap-1.5 px-3 py-2">
                {skills.slice(0, 12).map((sk) => (
                  <span
                    key={sk.name}
                    className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 dark:bg-[#191c28] text-[11px] font-medium text-slate-600 dark:text-slate-400 border border-slate-200/50 dark:border-[#252838]"
                  >
                    /{sk.name}
                  </span>
                ))}
              </div>
            </DashboardCard>
          )}
        </div>
      </div>

      {/* ─── A2UI Toolbar ─────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-200/40 dark:border-[#191c28]">
        <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-600">
          <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#191c28] font-mono">{t.a2ui.a2uiVersion}</span>
          <span>{a2uiMessages.length} {t.a2ui.messagesLabel}</span>
          <span>·</span>
          <span>{a2uiMessages.filter((m) => "createSurface" in m).length} {t.a2ui.surfacesLabel}</span>
          <span>·</span>
          <a
            href="https://a2ui.org/specification/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-500 hover:text-amber-600 transition-colors"
          >
            {t.a2ui.protocolDocs}
          </a>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { setShowTemplateGallery(!showTemplateGallery); setShowJsonPanel(false); }}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${showTemplateGallery
                ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#191c28]"
              }`}
          >
            <LayoutGrid className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            {t.a2ui.templates}
          </button>
          <button
            onClick={() => { setShowJsonPanel(!showJsonPanel); setShowTemplateGallery(false); }}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#191c28] transition-colors"
          >
            <Plus className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            {t.a2ui.importLabel}
          </button>
          <button
            onClick={exportJson}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#191c28] transition-colors"
          >
            <Download className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
            {t.a2ui.exportLabel}
          </button>
          <button
            onClick={onToggleSource}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${showSource
                ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
                : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#191c28]"
              }`}
          >
            <CodeXml className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            {t.a2ui.sourceLabel}
          </button>
        </div>
      </div>

      {/* ─── Template Gallery ─────────────────────────────────── */}
      {showTemplateGallery && (
        <div className="bg-white dark:bg-[#12141c] rounded-xl border border-slate-200/60 dark:border-[#1c1f2e] p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t.a2ui.surfaceTemplates}</h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{t.a2ui.addSurfaceDescription}</p>
            </div>
            <button
              onClick={() => setShowTemplateGallery(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              <X className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                id: "kanban",
                title: t.a2ui.taskBoard,
                description: t.a2ui.taskBoardDesc,
                icon: (
                  <Columns2 className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                ),
                accent: "text-blue-500 dark:text-blue-400",
                bg: "bg-blue-50 dark:bg-blue-900/20",
                generate: () => generateTaskKanbanSurface(dashboardData),
              },
              {
                id: "agents",
                title: t.a2ui.agentMonitor,
                description: t.a2ui.agentMonitorDesc,
                icon: (
                  <CircleUser className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                ),
                accent: "text-blue-500 dark:text-blue-400",
                bg: "bg-blue-50 dark:bg-blue-900/20",
                generate: () => generateAgentMonitorSurface(dashboardData.agents),
              },
              {
                id: "timeline",
                title: t.a2ui.timeline,
                description: t.a2ui.timelineDesc,
                icon: (
                  <Monitor className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                ),
                accent: "text-emerald-500 dark:text-emerald-400",
                bg: "bg-emerald-50 dark:bg-emerald-900/20",
                generate: () => generateTimelineSurface(dashboardData),
              },
              {
                id: "summary",
                title: t.a2ui.workspaceSummary,
                description: t.a2ui.workspaceSummaryDesc,
                icon: (
                  <ChartColumn className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                ),
                accent: "text-amber-500 dark:text-amber-400",
                bg: "bg-amber-50 dark:bg-amber-900/20",
                generate: () => generateWorkspaceSummarySurface(dashboardData),
              },
            ].map((tpl) => (
              <div
                key={tpl.id}
                className="group flex flex-col gap-3 p-3 rounded-lg border border-slate-200/60 dark:border-[#252838] bg-slate-50 dark:bg-[#0e1019] hover:border-slate-300 dark:hover:border-[#2e3248] transition-colors"
              >
                <div className={`w-9 h-9 rounded-lg ${tpl.bg} flex items-center justify-center ${tpl.accent}`}>
                  {tpl.icon}
                </div>
                <div className="flex-1">
                  <div className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">{tpl.title}</div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed mt-0.5">{tpl.description}</div>
                </div>
                <button
                  onClick={() => {
                    onAddCustomSurface(tpl.generate());
                    setShowTemplateGallery(false);
                  }}
                  className={`w-full py-1.5 rounded-md text-[11px] font-medium transition-colors border ${tpl.bg} ${tpl.accent} border-current/20 hover:opacity-80`}
                >
                  {t.a2ui.addSurface}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Source View ──────────────────────────────────────── */}
      {showSource && (
        <div className="bg-slate-50 dark:bg-[#0a0c12] rounded-xl border border-slate-200/60 dark:border-[#1c1f2e] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200/40 dark:border-[#191c28]">
            <div className="flex items-center gap-2">
              <h3 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{t.a2ui.protocolMessagesJson}</h3>
              {sourceIsOverridden && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                  {t.a2ui.overridden}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {sourceIsOverridden && (
                <button
                  onClick={handleResetSource}
                  className="px-2 py-1 rounded text-[10px] font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#191c28] transition-colors"
                >
                  {t.a2ui.reset}
                </button>
              )}
              <button
                onClick={handleApplySource}
                className="px-2.5 py-1 rounded-md text-[10px] font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors shadow-sm"
              >
                {t.a2ui.apply}
              </button>
            </div>
          </div>
          {sourceApplyError && (
            <div className="mx-4 mt-2 text-[11px] text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
              {sourceApplyError}
            </div>
          )}
          <CodeEditor
            value={sourceEditValue}
            language="json"
            onChange={setSourceEditValue}
            maxHeight="480px"
            className="border-0"
          />
        </div>
      )}

      {/* ─── Import Panel ─────────────────────────────────────── */}
      {showJsonPanel && (
        <div className="bg-white dark:bg-[#12141c] rounded-xl border border-slate-200/60 dark:border-[#1c1f2e] p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t.a2ui.importCustomSurface}</h3>
            <button
              onClick={() => { setShowJsonPanel(false); setJsonError(null); }}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              <X className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            </button>
          </div>
          <textarea
            value={customJsonInput}
            onChange={(e) => { setCustomJsonInput(e.target.value); setJsonError(null); }}
            placeholder={sampleJson}
            rows={10}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#252838] bg-slate-50 dark:bg-[#0e1019] text-[12px] text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 outline-none focus:ring-2 focus:ring-amber-500/30 resize-none font-mono leading-relaxed"
          />
          {jsonError && (
            <div className="mt-2 text-[11px] text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
              {jsonError}
            </div>
          )}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleImportJson}
              disabled={!customJsonInput.trim()}
              className="px-4 py-2 rounded-lg text-[12px] font-medium text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40 transition-colors shadow-sm"
            >
              {t.a2ui.renderSurface}
            </button>
            <button
              onClick={() => setCustomJsonInput(sampleJson)}
              className="px-3 py-2 rounded-lg text-[11px] font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
            >
              {t.a2ui.loadExample}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
