"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { TierValue } from "@/client/components/harness-execution-plan-flow";

type HookPhase = "submodule" | "fitness" | "fitness-fast" | "review";

type HookRuntimeProfileSummary = {
  name: string;
  phases: HookPhase[];
  metrics: Array<{ name: string }>;
  hooks: string[];
};

type HooksResponse = {
  hookFiles: Array<{ name: string }>;
  profiles: HookRuntimeProfileSummary[];
};

type GitHubActionsFlow = {
  id: string;
  name: string;
  event: string;
  jobs: Array<{ id: string }>;
};

type GitHubActionsFlowsResponse = {
  flows: GitHubActionsFlow[];
};

type HookSummary = {
  hookCount: number;
  profileCount: number;
  mappedMetricCount: number;
  phaseCount: number;
  phaseLabels: string[];
};

type WorkflowSummary = {
  flowCount: number;
  jobCount: number;
  remoteSignals: string[];
  hasRepairLoop: boolean;
};

type InstructionSummary = {
  fileName: string;
  fallbackUsed: boolean;
};

type SummaryState<T> = {
  data: T | null;
  error: string | null;
  loadedContextKey: string;
};

type HarnessGovernanceLoopGraphProps = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
  selectedTier: TierValue;
  specsLoading: boolean;
  specsError: string | null;
  fitnessFileCount: number;
  dimensionCount: number;
  planLoading: boolean;
  planError: string | null;
  metricCount: number;
  hardGateCount: number;
};

type LoopLayer = "internal" | "commit" | "external";
type LoopTone = "neutral" | "sky" | "emerald" | "amber" | "violet";

type LoopNodeData = {
  layer: LoopLayer;
  title: string;
  tone: LoopTone;
  note?: string;
  active?: boolean;
};

const PHASE_LABELS: Record<HookPhase, string> = {
  submodule: "submodule",
  fitness: "fitness",
  "fitness-fast": "fitness-fast",
  review: "review",
};

function getNodeToneClasses(tone: LoopTone) {
  switch (tone) {
    case "sky":
      return {
        border: "border-sky-200",
        badge: "border-sky-200 bg-sky-50 text-sky-700",
        shadow: "shadow-sky-100/80",
      };
    case "emerald":
      return {
        border: "border-emerald-200",
        badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
        shadow: "shadow-emerald-100/80",
      };
    case "amber":
      return {
        border: "border-amber-200",
        badge: "border-amber-200 bg-amber-50 text-amber-700",
        shadow: "shadow-amber-100/80",
      };
    case "violet":
      return {
        border: "border-violet-200",
        badge: "border-violet-200 bg-violet-50 text-violet-700",
        shadow: "shadow-violet-100/80",
      };
    default:
      return {
        border: "border-desktop-border",
        badge: "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary",
        shadow: "shadow-black/5",
      };
  }
}

function LoopNodeView({ data }: NodeProps<Node<LoopNodeData>>) {
  const tone = getNodeToneClasses(data.tone);
  const layerLabel: Record<LoopLayer, string> = {
    internal: "内部反馈环",
    commit: "提交反馈环",
    external: "外部反馈环",
  };

  return (
    <div className="relative">
      <Handle id="target-top" type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="target-right" type="target" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="target-bottom" type="target" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="target-left" type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="source-top" type="source" position={Position.Top} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="source-right" type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="source-bottom" type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="source-left" type="source" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <div className={`flex min-h-[96px] w-[168px] flex-col justify-between rounded-[24px] border px-4 py-3 shadow-sm ${
        data.active ? `bg-desktop-bg-primary/96 ${tone.border} ${tone.shadow}` : "border-slate-200 bg-slate-100/90 shadow-black/0"
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold tracking-[0.08em] text-desktop-text-secondary">{layerLabel[data.layer]}</div>
            <div className={`mt-1 text-[13px] font-semibold ${data.active ? "text-desktop-text-primary" : "text-slate-500"}`}>{data.title}</div>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${data.active ? tone.badge : "border-slate-200 bg-slate-50 text-slate-400"}`}>
            阶段
          </span>
        </div>
        {data.note ? (
          <div className={`mt-2 text-[10px] leading-4 ${data.active ? "text-desktop-text-secondary" : "text-slate-400"}`}>
            {data.note}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const nodeTypes = {
  governance: LoopNodeView,
};

function buildNode(
  id: string,
  x: number,
  y: number,
  data: LoopNodeData,
): Node<LoopNodeData> {
  return {
    id,
    type: "governance",
    position: { x, y },
    data,
    draggable: false,
    selectable: false,
  };
}

function buildEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle: string,
  targetHandle: string,
  label: string,
  color: string,
  dash?: string,
): Edge {
  return {
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: "smoothstep",
    animated: !dash,
    label,
    style: {
      stroke: color,
      strokeWidth: 1.8,
      ...(dash ? { strokeDasharray: dash } : {}),
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color,
    },
    labelStyle: {
      fontSize: 10,
      fill: "#475569",
      fontWeight: 500,
    },
    labelBgPadding: [8, 4],
    labelBgBorderRadius: 10,
    labelBgStyle: {
      fill: "rgba(255, 255, 255, 1)",
      fillOpacity: 1,
      stroke: "rgba(203, 213, 225, 1)",
    },
  };
}

function summarizeSignals(flows: GitHubActionsFlow[]) {
  const preferredSignals = ["workflow_dispatch", "push", "pull_request", "schedule"];
  const signalSet = new Set(
    flows
      .map((flow) => flow.event)
      .filter((event) => event.trim().length > 0),
  );

  const orderedSignals = preferredSignals.filter((signal) => signalSet.has(signal));
  const extraSignals = [...signalSet].filter((signal) => !preferredSignals.includes(signal));
  return [...orderedSignals, ...extraSignals].slice(0, 3);
}

function detectRepairLoop(flows: GitHubActionsFlow[]) {
  return flows.some((flow) => {
    const id = flow.id.toLowerCase();
    const name = flow.name.toLowerCase();
    return id === "ci-red-fixer" || name === "ci red fixer";
  });
}

function buildGraph(args: {
  hookSummary: HookSummary | null;
  instructionSummary: InstructionSummary | null;
  workflowSummary: WorkflowSummary | null;
  dimensionCount: number;
  metricCount: number;
}) {
  const {
    hookSummary,
    instructionSummary,
    workflowSummary,
    dimensionCount,
    metricCount,
  } = args;

  const nodes: Node<LoopNodeData>[] = [
    buildNode("thinking", 128, 96, {
      layer: "internal",
      title: "思考",
      tone: "neutral",
      note: "需求澄清 / 任务规划",
      active: false,
    }),
    buildNode("coding", 330, 96, {
      layer: "internal",
      title: "编码",
      tone: "sky",
      note: instructionSummary
        ? `受 ${instructionSummary.fileName} 规范约束`
        : "受开发规范约束",
      active: Boolean(instructionSummary),
    }),
    buildNode("build", 532, 96, {
      layer: "internal",
      title: "构建",
      tone: "sky",
      note: "本地集成 / 运行准备",
      active: false,
    }),
    buildNode("test", 734, 96, {
      layer: "internal",
      title: "测试",
      tone: "emerald",
      note: "本地验证 / 回归检查",
      active: dimensionCount > 0 || metricCount > 0,
    }),
    buildNode("lint", 128, 288, {
      layer: "commit",
      title: "Lint",
      tone: "emerald",
      note: "静态质量检查",
      active: dimensionCount > 0,
    }),
    buildNode("precommit", 330, 288, {
      layer: "commit",
      title: "预提交",
      tone: "sky",
      note: hookSummary
        ? `${hookSummary.hookCount} hooks / ${hookSummary.phaseCount} phases`
        : "本地门禁执行",
      active: Boolean(hookSummary),
    }),
    buildNode("review", 532, 288, {
      layer: "commit",
      title: "代码检视",
      tone: "emerald",
      note: "规则校验 + review",
      active: dimensionCount > 0,
    }),
    buildNode("commit", 734, 288, {
      layer: "commit",
      title: "提交",
      tone: "neutral",
      note: "进入远程流水线",
      active: false,
    }),
    buildNode("post-commit", 27, 480, {
      layer: "external",
      title: "提交后阶段",
      tone: "violet",
      note: workflowSummary
        ? `${workflowSummary.flowCount} workflows / ${workflowSummary.jobCount} jobs`
        : "远程 CI / 自动构建",
      active: Boolean(workflowSummary),
    }),
    buildNode("staging", 229, 480, {
      layer: "external",
      title: "预发环境",
      tone: "violet",
      note: "合并后验证 / 环境验收",
      active: false,
    }),
    buildNode("canary", 431, 480, {
      layer: "external",
      title: "金丝雀发布",
      tone: "amber",
      note: workflowSummary?.remoteSignals.length
        ? `信号：${workflowSummary.remoteSignals.join(" / ")}`
        : "小流量验证 / 渐进放量",
      active: Boolean(workflowSummary?.remoteSignals.length),
    }),
    buildNode("production", 633, 480, {
      layer: "external",
      title: "生产环境",
      tone: "amber",
      note: "真实流量交付与运行",
      active: false,
    }),
    buildNode("metrics", 835, 480, {
      layer: "external",
      title: "度量",
      tone: "emerald",
      note: "Evidence / Issues / 反馈信号",
      active: false,
    }),
  ];

  const edges: Edge[] = [
    buildEdge("thinking-coding", "thinking", "coding", "source-right", "target-left", "实现", "#64748b"),
    buildEdge("coding-build", "coding", "build", "source-right", "target-left", "集成", "#0ea5e9"),
    buildEdge("build-test", "build", "test", "source-right", "target-left", "验证", "#10b981"),

    buildEdge("lint-precommit", "lint", "precommit", "source-right", "target-left", "门禁", "#0ea5e9"),
    buildEdge("precommit-review", "precommit", "review", "source-right", "target-left", "送检", "#0ea5e9"),
    buildEdge("review-commit", "review", "commit", "source-right", "target-left", "提交", "#64748b"),

    buildEdge("post-commit-staging", "post-commit", "staging", "source-right", "target-left", "预发", "#8b5cf6"),
    buildEdge("staging-canary", "staging", "canary", "source-right", "target-left", "放量", "#f59e0b"),
    buildEdge("canary-production", "canary", "production", "source-right", "target-left", "生产", "#f59e0b"),
    buildEdge("production-metrics", "production", "metrics", "source-right", "target-left", "度量", "#059669"),

    buildEdge("test-lint", "test", "lint", "source-bottom", "target-top", "收敛", "#10b981", "6 4"),
    buildEdge("commit-post-commit", "commit", "post-commit", "source-bottom", "target-top", "触发", "#8b5cf6", "6 4"),
    buildEdge("metrics-thinking", "metrics", "thinking", "source-top", "target-bottom", "回流", "#059669", "6 4"),

    ...(workflowSummary?.hasRepairLoop
      ? [
        {
          id: "post-commit-self-heal",
          source: "post-commit",
          target: "post-commit",
          sourceHandle: "source-right",
          targetHandle: "target-top",
          type: "smoothstep",
          label: "自动修复重试",
          style: {
            stroke: "#7c3aed",
            strokeWidth: 1.8,
            strokeDasharray: "6 4",
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#7c3aed",
          },
          labelStyle: {
            fontSize: 10,
            fill: "#475569",
            fontWeight: 500,
          },
          labelBgPadding: [6, 3],
          labelBgBorderRadius: 8,
          labelBgStyle: {
            fill: "rgba(248, 250, 252, 0.92)",
            fillOpacity: 1,
            stroke: "rgba(203, 213, 225, 0.9)",
          },
        } satisfies Edge,
      ]
      : []),
  ];

  return { nodes, edges, minHeight: 690 };
}

export function HarnessGovernanceLoopGraph({
  workspaceId,
  codebaseId,
  repoPath,
  repoLabel,
  selectedTier,
  specsLoading,
  specsError,
  dimensionCount,
  planLoading,
  planError,
  metricCount,
}: HarnessGovernanceLoopGraphProps) {
  const hasContext = Boolean(workspaceId && codebaseId && repoPath);
  const contextKey = hasContext ? `${workspaceId}:${codebaseId}:${repoPath}` : "";
  const [hookState, setHookState] = useState<SummaryState<HookSummary>>({
    data: null,
    error: null,
    loadedContextKey: "",
  });
  const [workflowState, setWorkflowState] = useState<SummaryState<WorkflowSummary>>({
    data: null,
    error: null,
    loadedContextKey: "",
  });
  const [instructionsState, setInstructionsState] = useState<SummaryState<InstructionSummary>>({
    data: null,
    error: null,
    loadedContextKey: "",
  });

  useEffect(() => {
    if (!hasContext) {
      return;
    }

    let cancelled = false;
    const query = new URLSearchParams();
    query.set("workspaceId", workspaceId);
    if (codebaseId) {
      query.set("codebaseId", codebaseId);
    }
    if (repoPath) {
      query.set("repoPath", repoPath);
    }

    const queryString = query.toString();

    void fetch(`/api/harness/hooks?${queryString}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load hook runtime");
        }
        if (cancelled) {
          return;
        }
        const data = payload as HooksResponse;
        const uniquePhases = new Set(
          (data.profiles ?? []).flatMap((profile) => profile.phases ?? []),
        );
        const summary: HookSummary = {
          hookCount: data.hookFiles?.length ?? 0,
          profileCount: data.profiles?.length ?? 0,
          mappedMetricCount: (data.profiles ?? []).reduce((sum, profile) => sum + (profile.metrics?.length ?? 0), 0),
          phaseCount: uniquePhases.size,
          phaseLabels: [...uniquePhases].map((phase) => PHASE_LABELS[phase]).filter(Boolean),
        };
        setHookState({
          data: summary,
          error: null,
          loadedContextKey: contextKey,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setHookState({
          data: null,
          error: error instanceof Error ? error.message : String(error),
          loadedContextKey: contextKey,
        });
      });

    void fetch(`/api/harness/github-actions?${queryString}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load GitHub Actions workflows");
        }
        if (cancelled) {
          return;
        }
        const data = payload as GitHubActionsFlowsResponse;
        const flows = Array.isArray(data.flows) ? data.flows : [];
    const summary: WorkflowSummary = {
          flowCount: flows.length,
          jobCount: flows.reduce((sum, flow) => sum + (flow.jobs?.length ?? 0), 0),
          remoteSignals: summarizeSignals(flows),
          hasRepairLoop: detectRepairLoop(flows),
        };
        setWorkflowState({
          data: summary,
          error: null,
          loadedContextKey: contextKey,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setWorkflowState({
          data: null,
          error: error instanceof Error ? error.message : String(error),
          loadedContextKey: contextKey,
        });
      });

    void fetch(`/api/harness/instructions?${queryString}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load guidance document");
        }
        if (cancelled) {
          return;
        }
        setInstructionsState({
          data: {
            fileName: typeof payload?.fileName === "string" ? payload.fileName : "AGENTS.md",
            fallbackUsed: Boolean(payload?.fallbackUsed),
          },
          error: null,
          loadedContextKey: contextKey,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setInstructionsState({
          data: null,
          error: error instanceof Error ? error.message : String(error),
          loadedContextKey: contextKey,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [codebaseId, contextKey, hasContext, repoPath, workspaceId]);

  const hookSummary = hookState.loadedContextKey === contextKey ? hookState.data : null;
  const workflowSummary = workflowState.loadedContextKey === contextKey ? workflowState.data : null;
  const instructionSummary = instructionsState.loadedContextKey === contextKey ? instructionsState.data : null;

  const graph = useMemo(
    () => buildGraph({
      hookSummary,
      instructionSummary,
      workflowSummary,
      dimensionCount,
      metricCount,
    }),
    [hookSummary, instructionSummary, workflowSummary, dimensionCount, metricCount],
  );

  const graphIssues = [specsError, planError, hookState.error, workflowState.error, instructionsState.error].filter(Boolean);

  return (
    <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Governance loop</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">研发阶段流转与三层反馈闭环</h3>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
            {repoLabel}
          </span>
          <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-desktop-text-secondary">
            tier {selectedTier}
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
            layered feedback
          </span>
        </div>
      </div>

      {!hasContext ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Select a repository to render the governance loop.
        </div>
      ) : null}

      {hasContext && graphIssues.length > 0 ? (
        <div className="mt-4 space-y-2">
          {graphIssues.map((issue) => (
            <div key={issue} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] text-amber-800">
              {issue}
            </div>
          ))}
        </div>
      ) : null}

      {hasContext ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2 text-[10px] text-desktop-text-secondary">
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
              {hookSummary ? `${hookSummary.hookCount} hooks` : "loading hooks"}
            </span>
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
              {specsLoading || planLoading ? "loading fitness" : `${dimensionCount} dimensions`}
            </span>
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
              {planLoading ? "loading plan" : `${metricCount} metrics`}
            </span>
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1">
              {workflowSummary ? `${workflowSummary.flowCount} workflows` : "loading workflows"}
            </span>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-desktop-border bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))]">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-[104px] top-[52px] h-[168px] w-[842px] rounded-[36px] border border-emerald-300/70 bg-emerald-50/35" />
              <div className="absolute left-[104px] top-[244px] h-[168px] w-[842px] rounded-[36px] border border-sky-300/70 bg-sky-50/35" />
              <div className="absolute left-[20px] top-[436px] h-[168px] w-[1068px] rounded-[36px] border border-violet-300/65 bg-violet-50/35" />

              <div className="absolute left-[126px] top-[76px] max-w-[180px] text-left text-slate-600">
                <div className="text-[11px] font-semibold tracking-[0.06em]">内部反馈环</div>
              </div>

              <div className="absolute left-[126px] top-[268px] max-w-[180px] text-left text-slate-600">
                <div className="text-[11px] font-semibold tracking-[0.06em]">提交反馈环</div>
              </div>

              <div className="absolute left-[42px] top-[460px] max-w-[180px] text-left text-slate-600">
                <div className="text-[11px] font-semibold tracking-[0.06em]">外部反馈环</div>
              </div>
            </div>
            <div style={{ height: graph.minHeight }}>
              <ReactFlow
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={nodeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                zoomOnScroll={false}
                panOnDrag={false}
                minZoom={1}
                maxZoom={1}
                defaultViewport={{ x: 0, y: 0, zoom: 1 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#d7dee7" gap={20} size={1} />
              </ReactFlow>
            </div>
          </div>

        </div>
      ) : null}
    </section>
  );
}
