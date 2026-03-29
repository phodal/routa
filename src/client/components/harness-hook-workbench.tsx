"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type { HooksResponse } from "@/client/hooks/use-harness-settings-data";
import {
  buildHookFlow,
  buildHookWorkbenchEntries,
  buildRuntimeProfileSource,
  formatPhaseLabel,
  getDefaultWorkbenchHook,
  groupHookEntries,
  type HookFlowNodeSpec,
  type HookFlowNodeTone,
  type HookWorkbenchEntry,
} from "./harness-hook-workbench-model";

type PreviewMode = "dry-run" | "live";
type InspectorTab = "basic" | "inputs" | "tasks" | "script";
type ScriptTab = "runtime" | "raw" | "review";

type PhasePreview = {
  phase: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  reason?: string;
  message?: string;
  metrics?: string[];
  index?: number;
  total?: number;
};

type MetricPreview = {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  exitCode?: number;
  command?: string;
  sourceFile?: string;
  outputTail?: string;
};

type HookPreviewResponse = {
  generatedAt: string;
  repoRoot: string;
  profile: string;
  mode: PreviewMode;
  ok: boolean;
  exitCode: number;
  command: string[];
  phaseResults: PhasePreview[];
  metricResults: MetricPreview[];
  eventSample: Record<string, unknown>[];
  stderr: string;
};

type HookWorkbenchProps = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
  data: HooksResponse;
  unsupportedMessage?: string | null;
  variant?: "full" | "compact";
};

type WorkbenchState = {
  contextKey: string;
  selectedHookName: string;
  inspectorTab: InspectorTab;
  scriptTab: ScriptTab;
  runMode: PreviewMode;
  runningHookName: string | null;
  runError: string | null;
  previewHistory: Record<string, HookPreviewResponse[]>;
};

type WorkbenchAction =
  | { type: "sync"; contextKey: string; hookNames: string[]; defaultHookName: string }
  | { type: "select-hook"; hookName: string }
  | { type: "select-tab"; tab: InspectorTab }
  | { type: "select-script-tab"; tab: ScriptTab }
  | { type: "set-run-mode"; mode: PreviewMode }
  | { type: "run-start"; hookName: string }
  | { type: "run-success"; hookName: string; result: HookPreviewResponse }
  | { type: "run-error"; message: string };

type WorkbenchContextValue = {
  state: WorkbenchState;
  dispatch: Dispatch<WorkbenchAction>;
  activeEntry: HookWorkbenchEntry | null;
  groupedEntries: ReturnType<typeof groupHookEntries>;
  data: HooksResponse;
  repoLabel: string;
  compactMode: boolean;
  previewResult: HookPreviewResponse | null;
  onRunPreview: () => void;
};

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

function toneStyles(tone: HookFlowNodeTone) {
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

function createInitialState(contextKey: string, defaultHookName: string): WorkbenchState {
  return {
    contextKey,
    selectedHookName: defaultHookName,
    inspectorTab: "basic",
    scriptTab: "runtime",
    runMode: "dry-run",
    runningHookName: null,
    runError: null,
    previewHistory: {},
  };
}

function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case "sync": {
      const selectedStillExists = action.hookNames.includes(state.selectedHookName);
      if (state.contextKey !== action.contextKey) {
        return createInitialState(action.contextKey, action.defaultHookName);
      }
      if (selectedStillExists) {
        return state;
      }
      return {
        ...state,
        selectedHookName: action.defaultHookName,
      };
    }
    case "select-hook":
      return {
        ...state,
        selectedHookName: action.hookName,
        runError: null,
      };
    case "select-tab":
      return {
        ...state,
        inspectorTab: action.tab,
      };
    case "select-script-tab":
      return {
        ...state,
        scriptTab: action.tab,
      };
    case "set-run-mode":
      return {
        ...state,
        runMode: action.mode,
      };
    case "run-start":
      return {
        ...state,
        runningHookName: action.hookName,
        runError: null,
      };
    case "run-success":
      return {
        ...state,
        runningHookName: null,
        runError: null,
        previewHistory: {
          ...state.previewHistory,
          [action.hookName]: [action.result, ...(state.previewHistory[action.hookName] ?? [])].slice(0, 5),
        },
      };
    case "run-error":
      return {
        ...state,
        runningHookName: null,
        runError: action.message,
      };
    default:
      return state;
  }
}

function useWorkbenchContext() {
  const context = useContext(WorkbenchContext);
  if (!context) {
    throw new Error("HarnessHookWorkbench context is missing");
  }
  return context;
}

type FlowNodeData = HookFlowNodeSpec;

function FlowNodeView({ data }: NodeProps<Node<FlowNodeData>>) {
  const tone = toneStyles(data.tone);
  const widthClass = data.kind === "hook" ? "w-[300px]" : data.kind === "task" ? "w-[284px]" : "w-[276px]";
  const heightClass = data.kind === "task" ? "min-h-[124px]" : "min-h-[132px]";
  return (
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
  );
}

const flowNodeTypes = {
  workbench: FlowNodeView,
};

function HookLifecycleRail() {
  const { activeEntry, compactMode, dispatch, groupedEntries } = useWorkbenchContext();

  return (
    <aside className={`rounded-[28px] border border-desktop-border bg-[radial-gradient(circle_at_top,#ffffff,rgba(255,255,255,0.78)_24%,rgba(240,246,255,0.82)_100%)] p-4 shadow-sm ${compactMode ? "" : "2xl:sticky 2xl:top-4 2xl:self-start"}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-secondary">Lifecycle</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">Git hook map</h3>
        </div>
        <div className="rounded-full border border-desktop-border bg-white/80 px-2.5 py-1 text-[10px] text-desktop-text-secondary">
          {groupedEntries.reduce((sum, group) => sum + group.entries.length, 0)} hooks
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {groupedEntries.map((group) => (
          <section key={group.group}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold text-desktop-text-primary">{group.label}</div>
                <div className="text-[10px] text-desktop-text-secondary">{group.description}</div>
              </div>
              <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
                {group.entries.length}
              </div>
            </div>

            <div className="mt-2.5 space-y-2">
              {group.entries.map((entry) => {
                const selected = activeEntry?.name === entry.name;
                return (
                  <button
                    key={entry.name}
                    type="button"
                    onClick={() => {
                      dispatch({ type: "select-hook", hookName: entry.name });
                    }}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                      selected
                        ? "border-sky-300 bg-sky-50/80 shadow-sm"
                        : entry.enabled
                          ? "border-desktop-border bg-white/85 hover:bg-desktop-bg-primary"
                          : "border-desktop-border bg-desktop-bg-primary/55 hover:bg-desktop-bg-primary/80"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-desktop-text-primary">{entry.name}</div>
                        <div className="mt-1 text-[10px] text-desktop-text-secondary">
                          {entry.channelLabel} · {entry.blockingLabel} · {entry.bypassabilityLabel}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${
                        entry.enabled
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : entry.configured
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary"
                      }`}>
                        {entry.enabled ? "enabled" : entry.configured ? "partial" : "missing"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
                        {entry.stats.taskCount} tasks
                      </span>
                      <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
                        {entry.phases.length} phases
                      </span>
                      {entry.stats.reviewGate ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">
                          review gate
                        </span>
                      ) : null}
                    </div>
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

function HookFlowCanvas() {
  const { activeEntry, compactMode } = useWorkbenchContext();

  const flow = useMemo(() => {
    if (!activeEntry) {
      return { nodes: [], edges: [] };
    }

    const { nodes, edges } = buildHookFlow(activeEntry);
    const positionedNodes = nodes.map<Node<FlowNodeData>>((node) => ({
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
    return { nodes: positionedNodes, edges: positionedEdges };
  }, [activeEntry]);

  const flowHeight = useMemo(() => {
    const taskCount = Math.max(activeEntry?.tasks.length ?? 0, 1);
    return Math.max(compactMode ? 440 : 520, 180 + taskCount * 154);
  }, [activeEntry?.tasks.length, compactMode]);

  return (
    <section className="rounded-[28px] border border-desktop-border bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(243,247,255,0.92))] p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-secondary">Pipeline</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">Hook → Task → Output</h3>
          <div className="mt-1 text-[11px] text-desktop-text-secondary">
            {activeEntry
              ? `${activeEntry.lifecycleLabel} lifecycle · ${activeEntry.hint}`
              : "Select a hook to inspect its flow topology."}
          </div>
        </div>
        {activeEntry ? (
          <div className="flex flex-wrap gap-2 text-[10px]">
            <span className="rounded-full border border-desktop-border bg-white/80 px-2.5 py-1 text-desktop-text-secondary">
              {activeEntry.channelLabel}
            </span>
            <span className="rounded-full border border-desktop-border bg-white/80 px-2.5 py-1 text-desktop-text-secondary">
              {activeEntry.stats.taskCount} tasks
            </span>
            <span className="rounded-full border border-desktop-border bg-white/80 px-2.5 py-1 text-desktop-text-secondary">
              {activeEntry.stats.hardGateCount} hard gates
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
          No hook selected.
        </div>
      )}
    </section>
  );
}

function HookInspector() {
  const { activeEntry, data, dispatch, state } = useWorkbenchContext();

  const tabs: Array<{ id: InspectorTab; label: string }> = [
    { id: "basic", label: "Basic" },
    { id: "inputs", label: "Inputs" },
    { id: "tasks", label: "Tasks" },
    { id: "script", label: "Source" },
  ];

  const previewSource = useMemo(() => {
    if (!activeEntry) {
      return { code: "", language: "text" as const };
    }
    if (state.scriptTab === "raw") {
      return {
        code: activeEntry.hookFile?.source ?? "# No raw hook file found",
        language: "shell" as const,
      };
    }
    if (state.scriptTab === "review") {
      return {
        code: data.reviewTriggerFile?.source ?? "# No review trigger file found",
        language: "yaml" as const,
      };
    }
    return {
      code: buildRuntimeProfileSource(activeEntry) || "# No runtime profile bound to this hook",
      language: "yaml" as const,
    };
  }, [activeEntry, data.reviewTriggerFile?.source, state.scriptTab]);

  if (!activeEntry) {
    return (
      <section className="rounded-[28px] border border-desktop-border bg-desktop-bg-primary/70 p-4 shadow-sm">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-secondary">Inspector</div>
        <div className="mt-3 rounded-2xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-6 text-[12px] text-desktop-text-secondary">
          No hook selected.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-desktop-border bg-desktop-bg-primary/70 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-secondary">Inspector</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">{activeEntry.name}</h3>
          <div className="mt-1 text-[11px] text-desktop-text-secondary">
            {activeEntry.channelLabel} · {activeEntry.blockingLabel} · {activeEntry.bypassabilityLabel}
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] ${
          activeEntry.enabled
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary"
        }`}>
          {activeEntry.mode}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              dispatch({ type: "select-tab", tab: tab.id });
            }}
            className={`rounded-full border px-3 py-1 text-[10px] font-medium transition ${
              state.inspectorTab === tab.id
                ? "border-sky-300 bg-sky-50 text-sky-700"
                : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {state.inspectorTab === "basic" ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Lifecycle", activeEntry.lifecycleDescription],
              ["Run side", activeEntry.channelLabel],
              ["Blocking", activeEntry.blockingLabel],
              ["CWD", activeEntry.cwdLabel],
              ["Bypass", activeEntry.bypassabilityLabel],
              ["Source path", activeEntry.hookFile?.relativePath ?? "No hook file"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">{label}</div>
                <div className="mt-1 text-[12px] leading-5 text-desktop-text-primary">{value}</div>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/85 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Command</div>
            <div className="mt-1 break-all font-mono text-[11px] text-desktop-text-primary">
              {activeEntry.hookFile?.triggerCommand ?? "No command detected"}
            </div>
            <div className="mt-2 text-[11px] text-desktop-text-secondary">
              {activeEntry.hint}
            </div>
          </div>
          {activeEntry.phases.length ? (
            <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/85 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Runtime phases</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {activeEntry.phases.map((phase) => (
                  <span key={phase} className={`rounded-full border px-2.5 py-1 text-[10px] ${
                    phase === "review"
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary"
                  }`}>
                    {formatPhaseLabel(phase)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {state.inspectorTab === "inputs" ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/85 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Argv template</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {activeEntry.argvTemplate.length ? activeEntry.argvTemplate.map((value) => (
                <span key={value} className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] font-mono text-desktop-text-secondary">
                  {value}
                </span>
              )) : (
                <span className="text-[11px] text-desktop-text-secondary">No argv payload.</span>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/85 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">stdin template</div>
            <div className="mt-1 font-mono text-[11px] text-desktop-text-primary">
              {activeEntry.stdinTemplate ?? "No stdin payload."}
            </div>
          </div>
          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/85 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Environment</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {activeEntry.envKeys.map((key) => (
                <span key={key} className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] font-mono text-desktop-text-secondary">
                  {key}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {state.inspectorTab === "tasks" ? (
        <div className="mt-4 space-y-3">
          {activeEntry.tasks.length ? activeEntry.tasks.map((task) => (
            <div key={task.id} className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/85 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-desktop-text-primary">{task.name}</div>
                  {task.command ? (
                    <div className="mt-1 break-all font-mono text-[11px] text-desktop-text-secondary">{task.command}</div>
                  ) : null}
                  {task.description ? (
                    <div className="mt-2 text-[11px] leading-5 text-desktop-text-secondary">{task.description}</div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 text-[10px]">
                  <span className={`rounded-full border px-2.5 py-1 ${
                    task.resolved
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}>
                    {task.resolved ? "resolved" : "unresolved"}
                  </span>
                  <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                    {task.fileScope}
                  </span>
                  {task.hardGate ? (
                    <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">
                      hard gate
                    </span>
                  ) : null}
                </div>
              </div>
              {task.sourceFile ? (
                <div className="mt-3 font-mono text-[10px] text-desktop-text-secondary">{task.sourceFile}</div>
              ) : null}
            </div>
          )) : (
            <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/85 px-4 py-5 text-[12px] text-desktop-text-secondary">
              This hook does not expose runtime metrics yet. Use the raw script tab to inspect the executable logic.
            </div>
          )}
        </div>
      ) : null}

      {state.inspectorTab === "script" ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {[
              { id: "runtime", label: "Runtime manifest" },
              { id: "raw", label: "Raw hook" },
              { id: "review", label: "Review triggers" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  dispatch({ type: "select-script-tab", tab: tab.id as ScriptTab });
                }}
                className={`rounded-full border px-3 py-1 text-[10px] font-medium transition ${
                  state.scriptTab === tab.id
                    ? "border-sky-300 bg-sky-50 text-sky-700"
                    : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <CodeViewer
            code={previewSource.code}
            language={previewSource.language}
            showHeader={false}
            maxHeight="420px"
            className="rounded-2xl"
          />
        </div>
      ) : null}
    </section>
  );
}

function HookRunConsole() {
  const { activeEntry, compactMode, onRunPreview, previewResult, repoLabel, state, dispatch } = useWorkbenchContext();

  const lastDurationMs = useMemo(() => {
    if (!previewResult) {
      return 0;
    }
    const phaseDuration = previewResult.phaseResults.reduce((sum, phase) => sum + phase.durationMs, 0);
    const metricDuration = previewResult.metricResults.reduce((sum, metric) => sum + (metric.durationMs ?? 0), 0);
    return Math.max(phaseDuration, metricDuration);
  }, [previewResult]);

  return (
    <section className="rounded-[28px] border border-desktop-border bg-[linear-gradient(180deg,rgba(251,253,255,0.95),rgba(244,247,252,0.92))] p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-secondary">Observability</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">Run console</h3>
          <div className="mt-1 text-[11px] text-desktop-text-secondary">
            {activeEntry?.runtimeProfile
              ? "调用现有 preview route，展示 phase / metric 执行结果与 stderr。"
              : "只有 runtime-profile hook 支持当前预览执行。"}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "set-run-mode", mode: "dry-run" });
            }}
            className={`rounded-full border px-3 py-1 text-[10px] font-medium ${
              state.runMode === "dry-run"
                ? "border-sky-300 bg-sky-50 text-sky-700"
                : "border-desktop-border bg-white text-desktop-text-secondary"
            }`}
          >
            Dry run
          </button>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "set-run-mode", mode: "live" });
            }}
            className={`rounded-full border px-3 py-1 text-[10px] font-medium ${
              state.runMode === "live"
                ? "border-sky-300 bg-sky-50 text-sky-700"
                : "border-desktop-border bg-white text-desktop-text-secondary"
            }`}
          >
            Live
          </button>
          <button
            type="button"
            disabled={!activeEntry?.runtimeProfile || state.runningHookName === activeEntry.name}
            onClick={onRunPreview}
            className={`rounded-full border px-3 py-1 text-[10px] font-medium transition ${
              !activeEntry?.runtimeProfile
                ? "cursor-not-allowed border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary/60"
                : "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
            }`}
          >
            {state.runningHookName === activeEntry?.name ? "Running..." : "Run preview"}
          </button>
        </div>
      </div>

      <div className={`mt-4 grid gap-4 ${compactMode ? "grid-cols-1" : "xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]"}`}>
        <div className="space-y-4">
          <div className="rounded-2xl border border-desktop-border bg-white/85 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Simulated input</div>
                <div className="mt-1 text-[12px] font-semibold text-desktop-text-primary">{activeEntry?.name ?? "No hook selected"}</div>
              </div>
              <div className="flex flex-wrap gap-2 text-[10px]">
                <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                  {repoLabel}
                </span>
                <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                  {activeEntry?.cwdLabel ?? "cwd"}
                </span>
                <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                  {state.runMode}
                </span>
              </div>
            </div>

            {activeEntry ? (
              <div className="mt-3 space-y-3 text-[11px] text-desktop-text-secondary">
                <div>
                  <div className="font-semibold uppercase tracking-[0.14em] text-[10px]">argv</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {activeEntry.argvTemplate.length ? activeEntry.argvTemplate.map((value) => (
                      <span key={value} className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5 font-mono text-[10px]">
                        {value}
                      </span>
                    )) : "No argv payload"}
                  </div>
                </div>
                <div>
                  <div className="font-semibold uppercase tracking-[0.14em] text-[10px]">stdin</div>
                  <div className="mt-1 rounded-xl border border-desktop-border bg-desktop-bg-primary px-3 py-2 font-mono text-[10px] text-desktop-text-primary">
                    {activeEntry.stdinTemplate ?? "No stdin payload"}
                  </div>
                </div>
                <div>
                  <div className="font-semibold uppercase tracking-[0.14em] text-[10px]">env</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {activeEntry.envKeys.map((value) => (
                      <span key={value} className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5 font-mono text-[10px]">
                        {value}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-desktop-border bg-white/85 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Run summary</div>
                <div className="mt-1 text-[12px] font-semibold text-desktop-text-primary">
                  {previewResult ? previewResult.profile : "No preview yet"}
                </div>
              </div>
              {previewResult ? (
                <div className="flex flex-wrap gap-2 text-[10px]">
                  <span className={`rounded-full border px-2.5 py-1 ${
                    previewResult.ok
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-red-200 bg-red-50 text-red-700"
                  }`}>
                    exit {previewResult.exitCode}
                  </span>
                  <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
                    {lastDurationMs} ms
                  </span>
                </div>
              ) : null}
            </div>

            {state.runError ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-[11px] text-red-700">
                {state.runError}
              </div>
            ) : null}

            {!previewResult && !state.runError ? (
              <div className="mt-3 rounded-xl border border-desktop-border bg-desktop-bg-primary px-3 py-3 text-[11px] text-desktop-text-secondary">
                Run preview to inspect phase results, metrics, stderr, and the generated command.
              </div>
            ) : null}

            {previewResult ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary px-3 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Command</div>
                  <div className="mt-1 break-all font-mono text-[11px] text-desktop-text-primary">
                    {previewResult.command.join(" ")}
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Phase log</div>
                    <div className="mt-2 space-y-2">
                      {previewResult.phaseResults.length ? previewResult.phaseResults.map((phase) => (
                        <div key={`${phase.phase}:${phase.index ?? 0}`} className="rounded-lg border border-desktop-border bg-white px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[11px] font-semibold text-desktop-text-primary">{phase.phase}</div>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${
                              phase.status === "passed"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : phase.status === "failed"
                                  ? "border-red-200 bg-red-50 text-red-700"
                                  : "border-amber-200 bg-amber-50 text-amber-800"
                            }`}>
                              {phase.status}
                            </span>
                          </div>
                          <div className="mt-1 text-[10px] text-desktop-text-secondary">
                            {phase.durationMs} ms{phase.message ? ` · ${phase.message}` : ""}{phase.reason ? ` · ${phase.reason}` : ""}
                          </div>
                        </div>
                      )) : (
                        <div className="text-[11px] text-desktop-text-secondary">No phase events.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Metric log</div>
                    <div className="mt-2 space-y-2">
                      {previewResult.metricResults.length ? previewResult.metricResults.map((metric) => (
                        <div key={`${metric.name}:${metric.command ?? metric.status}`} className="rounded-lg border border-desktop-border bg-white px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[11px] font-semibold text-desktop-text-primary">{metric.name}</div>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${
                              metric.status === "passed"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : metric.status === "failed"
                                  ? "border-red-200 bg-red-50 text-red-700"
                                  : "border-amber-200 bg-amber-50 text-amber-800"
                            }`}>
                              {metric.status}
                            </span>
                          </div>
                          <div className="mt-1 text-[10px] text-desktop-text-secondary">
                            {typeof metric.exitCode === "number" ? `exit ${metric.exitCode}` : "no exit code"}
                            {typeof metric.durationMs === "number" ? ` · ${metric.durationMs} ms` : ""}
                          </div>
                          {metric.outputTail ? (
                            <div className="mt-2 rounded-lg border border-desktop-border bg-desktop-bg-primary px-2.5 py-2 font-mono text-[10px] text-desktop-text-primary">
                              {metric.outputTail}
                            </div>
                          ) : null}
                        </div>
                      )) : (
                        <div className="text-[11px] text-desktop-text-secondary">No metric events.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-desktop-border bg-white/85 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Event sample</div>
              <div className="mt-1 text-[12px] font-semibold text-desktop-text-primary">stderr + jsonl tail</div>
            </div>
            {previewResult ? (
              <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                {previewResult.eventSample.length} events
              </span>
            ) : null}
          </div>
          <div className="mt-3 space-y-3">
            <CodeViewer
              code={previewResult?.stderr || "# stderr is empty"}
              language="text"
              showHeader={false}
              maxHeight="180px"
              className="rounded-2xl"
            />
            <CodeViewer
              code={previewResult ? JSON.stringify(previewResult.eventSample, null, 2) : "[]"}
              language="json"
              showHeader={false}
              maxHeight="420px"
              className="rounded-2xl"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function HarnessHookWorkbench({
  workspaceId,
  codebaseId,
  repoPath,
  repoLabel,
  data,
  unsupportedMessage,
  variant = "full",
}: HookWorkbenchProps) {
  const entries = useMemo(() => buildHookWorkbenchEntries(data), [data]);
  const groupedEntries = useMemo(() => groupHookEntries(entries), [entries]);
  const defaultHook = useMemo(() => getDefaultWorkbenchHook(entries), [entries]);
  const contextKey = `${workspaceId}:${codebaseId ?? "repo-only"}:${repoPath ?? "unknown"}`;
  const [state, dispatch] = useReducer(
    workbenchReducer,
    createInitialState(contextKey, defaultHook?.name ?? ""),
  );

  useEffect(() => {
    dispatch({
      type: "sync",
      contextKey,
      hookNames: entries.map((entry) => entry.name),
      defaultHookName: defaultHook?.name ?? "",
    });
  }, [contextKey, defaultHook?.name, entries]);

  const activeEntry = useMemo(
    () => entries.find((entry) => entry.name === state.selectedHookName) ?? defaultHook ?? null,
    [defaultHook, entries, state.selectedHookName],
  );
  const previewResult = activeEntry ? state.previewHistory[activeEntry.name]?.[0] ?? null : null;
  const compactMode = variant === "compact";

  const onRunPreview = async () => {
    if (!activeEntry?.runtimeProfile || !workspaceId || !repoPath) {
      return;
    }

    dispatch({ type: "run-start", hookName: activeEntry.name });
    try {
      const query = new URLSearchParams();
      query.set("workspaceId", workspaceId);
      if (codebaseId) {
        query.set("codebaseId", codebaseId);
      }
      query.set("repoPath", repoPath);
      query.set("profile", activeEntry.runtimeProfile.name);
      query.set("mode", state.runMode);

      const response = await fetch(`/api/harness/hooks/preview?${query.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to run hook preview");
      }

      dispatch({
        type: "run-success",
        hookName: activeEntry.name,
        result: payload as HookPreviewResponse,
      });
    } catch (error) {
      dispatch({
        type: "run-error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const contextValue: WorkbenchContextValue = {
    state,
    dispatch,
    activeEntry,
    groupedEntries,
    data,
    repoLabel,
    compactMode,
    previewResult,
    onRunPreview,
  };

  return (
    <WorkbenchContext.Provider value={contextValue}>
      <section className={compactMode
        ? "rounded-[30px] border border-desktop-border bg-[linear-gradient(180deg,rgba(251,253,255,0.95),rgba(241,246,255,0.92))] p-4"
        : "rounded-[30px] border border-desktop-border bg-[linear-gradient(180deg,rgba(251,253,255,0.98),rgba(238,244,255,0.94))] p-5 shadow-sm"}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-secondary">Hook workbench</div>
            <h2 className="mt-1 text-[18px] font-semibold text-desktop-text-primary">Declarative Git hook console</h2>
            <div className="mt-1 max-w-3xl text-[12px] leading-5 text-desktop-text-secondary">
              用生命周期导航、流程画布、配置检查器和运行观测台重新组织当前仓库的 hook 数据。
              真相源仍然来自 `.husky`、`docs/fitness/runtime/hooks.yaml` 和 `docs/fitness/review-triggers.yaml`。
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-[10px]">
            <span className="rounded-full border border-desktop-border bg-white/80 px-2.5 py-1 text-desktop-text-secondary">
              {repoLabel}
            </span>
            <span className="rounded-full border border-desktop-border bg-white/80 px-2.5 py-1 text-desktop-text-secondary">
              {entries.filter((entry) => entry.enabled).length} enabled
            </span>
            <span className="rounded-full border border-desktop-border bg-white/80 px-2.5 py-1 text-desktop-text-secondary">
              {data.profiles.length} runtime profiles
            </span>
            <span className="rounded-full border border-desktop-border bg-white/80 px-2.5 py-1 text-desktop-text-secondary">
              {data.reviewTriggerFile?.ruleCount ?? 0} review rules
            </span>
          </div>
        </div>

        {unsupportedMessage ? (
          <HarnessUnsupportedState className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-[11px] text-amber-800" />
        ) : null}

        {!unsupportedMessage && data.warnings.length ? (
          <div className="mt-4 grid gap-2">
            {data.warnings.map((warning) => (
              <div key={warning} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-800">
                {warning}
              </div>
            ))}
          </div>
        ) : null}

        {!unsupportedMessage && entries.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-6 text-[12px] text-desktop-text-secondary">
            No hook metadata found for the selected repository.
          </div>
        ) : null}

        {!unsupportedMessage && entries.length > 0 ? (
          <div className={`mt-5 grid gap-4 ${compactMode ? "grid-cols-1" : "2xl:grid-cols-[280px_minmax(0,1fr)_360px]"}`}>
            <HookLifecycleRail />
            <HookFlowCanvas />
            <HookInspector />
            <div className={compactMode ? "" : "2xl:col-span-3"}>
              <HookRunConsole />
            </div>
          </div>
        ) : null}
      </section>
    </WorkbenchContext.Provider>
  );
}
