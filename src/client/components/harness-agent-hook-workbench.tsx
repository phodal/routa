"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, useState, type Dispatch } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type { AgentHooksResponse } from "@/client/hooks/use-harness-settings-data";
import { useTranslation } from "@/i18n";
import {
  buildAgentHookFlow,
  buildAgentHookWorkbenchEntries,
  buildAgentHookConfigSource,
  getDefaultAgentHookEntry,
  groupAgentHookEntries,
  type AgentHookFlowNodeSpec,
  type AgentHookFlowNodeTone,
  type AgentHookWorkbenchEntry,
} from "./harness-agent-hook-workbench-model";

type AgentHookWorkbenchProps = {
  data: AgentHooksResponse;
  unsupportedMessage?: string | null;
  variant?: "full" | "compact";
  embedded?: boolean;
};

type WorkbenchState = {
  contextKey: string;
  selectedEvent: string;
};

type WorkbenchAction =
  | { type: "sync"; contextKey: string; events: string[]; defaultEvent: string }
  | { type: "select-event"; event: string };

type WorkbenchContextValue = {
  state: WorkbenchState;
  dispatch: Dispatch<WorkbenchAction>;
  activeEntry: AgentHookWorkbenchEntry | null;
  groupedEntries: ReturnType<typeof groupAgentHookEntries>;
  data: AgentHooksResponse;
  compactMode: boolean;
  embedded: boolean;
  t: ReturnType<typeof useTranslation>["t"];
};

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

function toneStyles(tone: AgentHookFlowNodeTone) {
  switch (tone) {
    case "success":
      return {
        border: "border-emerald-200",
        badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
        glow: "shadow-emerald-100/70",
        line: "#059669",
      };
    case "warning":
      return {
        border: "border-amber-200",
        badge: "border-amber-200 bg-amber-50 text-amber-800",
        glow: "shadow-amber-100/70",
        line: "#d97706",
      };
    case "danger":
      return {
        border: "border-red-200",
        badge: "border-red-200 bg-red-50 text-red-700",
        glow: "shadow-red-100/70",
        line: "#dc2626",
      };
    case "accent":
      return {
        border: "border-sky-200",
        badge: "border-sky-200 bg-sky-50 text-sky-700",
        glow: "shadow-sky-100/70",
        line: "#0284c7",
      };
    default:
      return {
        border: "border-desktop-border",
        badge: "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary",
        glow: "shadow-black/5",
        line: "#94a3b8",
      };
  }
}

function createInitialState(contextKey: string, defaultEvent: string): WorkbenchState {
  return {
    contextKey,
    selectedEvent: defaultEvent,
  };
}

function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case "sync": {
      const selectedStillExists = action.events.includes(state.selectedEvent);
      if (state.contextKey !== action.contextKey) {
        return createInitialState(action.contextKey, action.defaultEvent);
      }
      if (selectedStillExists) {
        return state;
      }
      return { ...state, selectedEvent: action.defaultEvent };
    }
    case "select-event":
      return { ...state, selectedEvent: action.event };
    default:
      return state;
  }
}

function useWorkbenchContext() {
  const context = useContext(WorkbenchContext);
  if (!context) {
    throw new Error("HarnessAgentHookWorkbench context is missing");
  }
  return context;
}

type FlowNodeData = AgentHookFlowNodeSpec;

function FlowNodeView({ data }: NodeProps<Node<FlowNodeData>>) {
  const tone = toneStyles(data.tone);
  const widthClass = data.kind === "hook" ? "w-[300px]" : "w-[276px]";
  const heightClass = data.kind === "hook" ? "min-h-[132px]" : "min-h-[120px]";

  return (
    <div className="relative">
      <Handle id="left" type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="right" type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <div className={`${widthClass} ${heightClass} rounded-2xl border bg-desktop-bg-primary/95 px-4 py-3 shadow-sm ${tone.border} ${tone.glow}`}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">{data.kind}</div>
        <div className="mt-1 text-[15px] font-semibold leading-6 text-desktop-text-primary">{data.title}</div>
        {data.subtitle ? (
          <div className="mt-1 text-[12px] leading-5 text-desktop-text-secondary">{data.subtitle}</div>
        ) : null}
        {data.chips?.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.chips.map((chip) => (
              <span key={`${data.id}:${chip}`} className={`rounded-full border px-2 py-0.5 text-[10px] ${tone.badge}`}>
                {chip}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const flowNodeTypes = {
  workbench: FlowNodeView,
};

function AgentHookLifecycleRail() {
  const { t, activeEntry, dispatch, groupedEntries } = useWorkbenchContext();

  return (
    <aside className="rounded-[28px] border border-desktop-border bg-[radial-gradient(circle_at_top,#ffffff,rgba(255,255,255,0.78)_24%,rgba(240,246,255,0.82)_100%)] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-secondary">{t.harness.agentHookWorkbench.lifecycle}</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">{t.harness.agentHook.hookMap}</h3>
        </div>
        <div className="rounded-full border border-desktop-border bg-white/80 px-2.5 py-1 text-[10px] text-desktop-text-secondary">
          {groupedEntries.reduce((sum, group) => sum + group.entries.length, 0)} {t.harness.agentHookWorkbench.events}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {groupedEntries.map((group) => (
          <section key={group.group}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold text-desktop-text-primary">{group.label}</div>
              <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
                {group.entries.length}
              </div>
            </div>

            <div className="mt-1.5 space-y-1.5">
              {group.entries.map((entry) => {
                const selected = activeEntry?.event === entry.event;
                return (
                  <button
                    key={entry.event}
                    type="button"
                    onClick={() => dispatch({ type: "select-event", event: entry.event })}
                    className={`w-full rounded-xl border px-2.5 py-2 text-left transition ${
                      selected
                        ? "border-sky-300 bg-sky-50/80 shadow-sm"
                        : "border-desktop-border bg-white/85 hover:bg-desktop-bg-primary"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-[11px] font-semibold text-desktop-text-primary">{entry.event}</div>
                      <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${
                        entry.stats.hookCount > 0
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-100 text-slate-500"
                      }`}>
                        {entry.stats.hookCount > 0 ? `${entry.stats.hookCount}` : "–"}
                      </span>
                    </div>
                    {entry.stats.hookCount > 0 && entry.stats.blockingCount > 0 ? (
                      <div className="mt-1 flex gap-1">
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
                          {entry.stats.blockingCount} blocking
                        </span>
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}

function AgentHookFlowCanvas() {
  const { t, activeEntry, compactMode } = useWorkbenchContext();
  const flowHeight = compactMode ? 440 : 680;

  const flow = useMemo(() => {
    if (!activeEntry) {
      return { nodes: [], edges: [] };
    }

    const { nodes, edges } = buildAgentHookFlow(activeEntry);
    const positionedNodes: Node[] = nodes.map((node) => ({
      id: node.id,
      type: "workbench",
      position: {
        x: node.column === 0 ? 24 : node.column === 1 ? 388 : 752,
        y: 24 + node.row * 154,
      },
      draggable: false,
      selectable: false,
      data: node,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }));
    const positionedEdges = edges.map<Edge>((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: edge.tone === "accent",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: toneStyles(edge.tone).line,
      },
      style: {
        stroke: toneStyles(edge.tone).line,
        strokeWidth: edge.tone === "accent" ? 1.8 : 1.5,
      },
    }));
    const maxNodeY = positionedNodes.reduce((max, node) => Math.max(max, node.position.y), 0);
    if (maxNodeY < flowHeight - 220) {
      positionedNodes.push({
        id: `viewport-anchor:${activeEntry.event}`,
        position: { x: 520, y: flowHeight - 120 },
        data: { label: "" },
        draggable: false,
        selectable: false,
        connectable: false,
        style: {
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
        },
      });
    }

    return { nodes: positionedNodes, edges: positionedEdges };
  }, [activeEntry, flowHeight]);

  return (
    <section className="rounded-[28px] border border-desktop-border bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(243,247,255,0.92))] p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-secondary">{t.harness.agentHookWorkbench.pipeline}</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">{t.harness.agentHookWorkbench.eventHookOutcome}</h3>
          <div className="mt-1 text-[11px] text-desktop-text-secondary">
            {activeEntry
              ? `${activeEntry.lifecycleLabel} lifecycle · ${activeEntry.hint}`
              : t.harness.agentHookWorkbench.selectEventToInspect}
          </div>
        </div>
        {activeEntry ? (
          <div className="flex flex-wrap gap-2 text-[10px]">
            <span className="rounded-full border border-desktop-border bg-white/80 px-2.5 py-1 text-desktop-text-secondary">
              {activeEntry.lifecycleLabel}
            </span>
            <span className="rounded-full border border-desktop-border bg-white/80 px-2.5 py-1 text-desktop-text-secondary">
              {activeEntry.stats.hookCount} hooks
            </span>
            <span className="rounded-full border border-desktop-border bg-white/80 px-2.5 py-1 text-desktop-text-secondary">
              {activeEntry.stats.blockingCount} blocking
            </span>
          </div>
        ) : null}
      </div>

      {activeEntry ? (
        <div className="mt-4 overflow-hidden rounded-3xl border border-desktop-border bg-white/75" style={{ height: flowHeight }}>
          <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={flowNodeTypes}
            fitView
            fitViewOptions={{ padding: 0.14 }}
            minZoom={0.6}
            maxZoom={1.2}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag
            zoomOnScroll={false}
          >
            <Background color="#dbe4f0" gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-desktop-border bg-white/80 px-4 py-8 text-[12px] text-desktop-text-secondary">
          {t.harness.agentHookWorkbench.noEventSelected}
        </div>
      )}
    </section>
  );
}

function AgentHookInspector() {
  const { t, activeEntry, data } = useWorkbenchContext();
  const [activeTab, setActiveTab] = useState<"basic" | "source">("basic");

  const configSource = useMemo(() => {
    if (!activeEntry) return "";
    return buildAgentHookConfigSource(activeEntry);
  }, [activeEntry]);

  return (
    <aside className="rounded-[28px] border border-desktop-border bg-[radial-gradient(circle_at_top,#ffffff,rgba(255,255,255,0.78)_24%,rgba(240,246,255,0.82)_100%)] p-4 shadow-sm">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-secondary">{t.harness.agentHookWorkbench.inspector}</div>
        <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">
          {activeEntry?.event ?? t.harness.agentHookWorkbench.eventDetails}
        </h3>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap gap-1 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-1">
          {[
            { id: "basic", label: "Basic" },
            { id: "source", label: "Source" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as "basic" | "source")}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-medium transition ${
                activeTab === tab.id
                  ? "border border-sky-200 bg-sky-50 text-sky-700"
                  : "border border-transparent text-desktop-text-secondary hover:bg-desktop-bg-secondary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {data.warnings.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">{t.harness.agentHookWorkbench.warnings}</div>
            <ul className="mt-1 space-y-1">
              {data.warnings.map((warning) => (
                <li key={warning} className="text-[11px] text-amber-700">• {warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {activeTab === "basic" && activeEntry ? (
          <div className="space-y-2">
            <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3 text-[11px] text-desktop-text-secondary">
              <div>Lifecycle: <span className="font-medium text-desktop-text-primary">{activeEntry.lifecycleLabel}</span></div>
              <div className="mt-1">Can block: <span className="font-medium text-desktop-text-primary">{activeEntry.canBlock ? "yes" : "no"}</span></div>
              <div className="mt-1">Hint: {activeEntry.hint}</div>
              <div className="mt-1">Description: {activeEntry.lifecycleDescription}</div>
            </div>

            <div>
              <div className="text-[12px] font-semibold text-desktop-text-primary">Hooks</div>
              {activeEntry.hooks.length === 0 ? (
                <div className="mt-2 rounded-lg border border-desktop-border bg-desktop-bg-primary/70 p-2.5 text-[11px] text-desktop-text-secondary">
                  {t.harness.agentHookWorkbench.noHooksConfigured}
                </div>
              ) : (
                <ul className="mt-2 divide-y divide-desktop-border rounded-xl border border-desktop-border bg-desktop-bg-primary/80">
                  {activeEntry.hooks.map((hook, index) => (
                    <li key={`${hook.event}:${index}`} className="px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold text-desktop-text-primary">
                            {hook.description || `${hook.type} ${t.harness.agentHookWorkbench.hook}`}
                          </div>
                          {hook.matcher ? (
                            <div className="mt-0.5 text-[10px] text-desktop-text-secondary">
                              matcher: <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">{hook.matcher}</code>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          {hook.blocking ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">{t.harness.agentHookWorkbench.blocking}</span>
                          ) : null}
                          <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
                            {hook.type}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 space-y-0.5 text-[10px] text-desktop-text-secondary">
                        {hook.command ? <div>command: <code className="break-all rounded bg-slate-100 px-1 py-0.5">{hook.command}</code></div> : null}
                        {hook.url ? <div>url: <code className="rounded bg-slate-100 px-1 py-0.5">{hook.url}</code></div> : null}
                        {hook.prompt ? <div>prompt: <code className="rounded bg-slate-100 px-1 py-0.5">{hook.prompt}</code></div> : null}
                        <div>timeout: {hook.timeout}s</div>
                        {hook.source ? (
                          <div>source: <span className="font-medium text-sky-600">{hook.source}</span></div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === "source" && activeEntry && configSource ? (
          <div className="overflow-hidden rounded-xl border border-desktop-border">
            <CodeViewer
              code={configSource}
              language="yaml"
              maxHeight="320px"
              showHeader={false}
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export function HarnessAgentHookWorkbench({
  data,
  unsupportedMessage,
  variant = "full",
  embedded = false,
}: AgentHookWorkbenchProps) {
  const { t } = useTranslation();
  const compactMode = variant === "compact";
  const entries = useMemo(() => buildAgentHookWorkbenchEntries(data), [data]);
  const groupedEntries = useMemo(() => groupAgentHookEntries(entries), [entries]);
  const defaultEntry = useMemo(() => getDefaultAgentHookEntry(entries), [entries]);
  const contextKey = data.generatedAt ?? "";

  const [state, dispatch] = useReducer(
    workbenchReducer,
    createInitialState(contextKey, defaultEntry?.event ?? ""),
  );

  useEffect(() => {
    dispatch({
      type: "sync",
      contextKey,
      events: entries.map((entry) => entry.event),
      defaultEvent: defaultEntry?.event ?? "",
    });
  }, [contextKey, defaultEntry?.event, entries]);

  const activeEntry = useMemo(
    () => entries.find((entry) => entry.event === state.selectedEvent) ?? null,
    [entries, state.selectedEvent],
  );

  const contextValue = useMemo<WorkbenchContextValue>(() => ({
    state,
    dispatch,
    activeEntry,
    groupedEntries,
    data,
    compactMode,
    embedded,
  }), [activeEntry, compactMode, data, embedded, groupedEntries, state]);

  if (unsupportedMessage) {
    return <HarnessUnsupportedState />;
  }

  return (
    <WorkbenchContext.Provider value={contextValue}>
      <section className={embedded ? "space-y-0" : "rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-3 shadow-sm"}>
        {!embedded ? (
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">{t.harness.agentHookWorkbench.hookSystems}</div>
              <h3 className="mt-0.5 text-sm font-semibold text-desktop-text-primary">{t.harness.agentHookWorkbench.workbenchTitle}</h3>
            </div>
            <div className="flex gap-2">
              <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                {entries.reduce((sum, entry) => sum + entry.stats.hookCount, 0)} hooks
              </span>
              <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                {entries.filter((entry) => entry.stats.hookCount > 0).length} / {entries.length} {t.harness.agentHookWorkbench.events}
              </span>
            </div>
          </div>
        ) : null}

        <div
          className={`grid gap-3 ${
            compactMode
              ? "xl:grid-cols-[240px_minmax(0,1fr)]"
              : "xl:grid-cols-[240px_minmax(0,1fr)_320px] 2xl:grid-cols-[240px_minmax(0,1fr)_360px]"
          }`}
        >
          <AgentHookLifecycleRail />
          <AgentHookFlowCanvas />
          <AgentHookInspector key={activeEntry?.event ?? "__no_event__"} />
        </div>
      </section>
    </WorkbenchContext.Provider>
  );
}
