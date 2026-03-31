"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type {
  FitnessSpecSummary,
  GitHubActionsFlow,
  GitHubActionsFlowsResponse,
  HooksResponse,
  InstructionsResponse,
} from "@/client/hooks/use-harness-settings-data";

type HookPhase = "submodule" | "fitness" | "fitness-fast" | "review";

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
  releaseFlowCount: number;
};

type InstructionSummary = {
  fileName: string;
  fallbackUsed: boolean;
};

type LoopDetailSection = {
  title: string;
  items: string[];
};

type HarnessGovernanceLoopGraphProps = {
  repoPath?: string;
  selectedTier: TierValue;
  specsError: string | null;
  dimensionCount: number;
  planError: string | null;
  metricCount: number;
  hardGateCount: number;
  unsupportedMessage?: string | null;
  hooksData?: HooksResponse | null;
  hooksError?: string | null;
  workflowData?: GitHubActionsFlowsResponse | null;
  workflowError?: string | null;
  instructionsData?: InstructionsResponse | null;
  instructionsError?: string | null;
  fitnessFiles?: FitnessSpecSummary[];
  designDecisionNodeEnabled?: boolean;
  selectedNodeId?: string | null;
  onSelectedNodeChange?: (nodeId: string) => void;
  contextPanel?: ReactNode;
};

type LoopLayer = "internal" | "commit" | "external";
type LoopTone = "neutral" | "sky" | "emerald" | "amber" | "violet";

type LoopNodeData = {
  nodeId: string;
  layer: LoopLayer;
  title: string;
  tone: LoopTone;
  note?: string;
  active?: boolean;
  unavailableReason?: string;
  selected?: boolean;
  onSelect?: () => void;
  onNavigate?: (direction: "up" | "down" | "left" | "right") => void;
};

const LOOP_EDGE_COLORS = {
  neutral: "#64748b",
  internal: "#0ea5e9",
  commit: "#8b5cf6",
  external: "#f59e0b",
  feedback: "#059669",
} as const;

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
        border: "border-sky-300",
        badge: "border-sky-400 bg-sky-100 text-sky-800",
        fill: "bg-sky-100",
        fillActive: "bg-sky-200",
        shadow: "shadow-sky-200/80",
      };
    case "emerald":
      return {
        border: "border-emerald-300",
        badge: "border-emerald-400 bg-emerald-100 text-emerald-800",
        fill: "bg-emerald-100",
        fillActive: "bg-emerald-200",
        shadow: "shadow-emerald-200/80",
      };
    case "amber":
      return {
        border: "border-amber-300",
        badge: "border-amber-400 bg-amber-100 text-amber-800",
        fill: "bg-amber-100",
        fillActive: "bg-amber-200",
        shadow: "shadow-amber-200/80",
      };
    case "violet":
      return {
        border: "border-violet-300",
        badge: "border-violet-400 bg-violet-100 text-violet-800",
        fill: "bg-violet-100",
        fillActive: "bg-violet-200",
        shadow: "shadow-violet-200/80",
      };
    default:
      return {
        border: "border-desktop-border",
        badge: "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary",
        fill: "bg-desktop-bg-secondary",
        fillActive: "bg-desktop-bg-primary/96",
        shadow: "shadow-black/5",
      };
  }
}

function getLayerTone(layer: LoopLayer): LoopTone {
  return layer === "internal"
    ? "sky"
    : layer === "commit"
      ? "violet"
      : "amber";
}

function LoopNodeView({ data }: NodeProps<Node<LoopNodeData>>) {
  const tone = getNodeToneClasses(data.tone);
  const layerLabel: Record<LoopLayer, string> = {
    internal: "内部反馈环",
    commit: "推送反馈环",
    external: "外部反馈环",
  };
  const interactive = typeof data.onSelect === "function";
  const unavailable = !interactive && Boolean(data.unavailableReason);
  const unavailableReasonId = data.unavailableReason ? `governance-unavailable-reason-${data.nodeId}` : undefined;
  const selectedClasses = data.selected
    ? "ring-2 ring-desktop-accent/70 ring-offset-2 ring-offset-white"
    : "";

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
      <button
        type="button"
        data-governance-node-id={data.nodeId}
        aria-pressed={data.selected}
        aria-disabled={!interactive}
        aria-label={`${layerLabel[data.layer]} ${data.title}${data.note ? `, ${data.note}` : ""}`}
        aria-describedby={unavailableReasonId}
        onClick={(event) => {
          if (!interactive) {
            return;
          }
          event.stopPropagation();
          data.onSelect?.();
        }}
        onKeyDown={(event) => {
          if (!interactive) {
            return;
          }
          const keyToDirection = {
            ArrowUp: "up",
            ArrowDown: "down",
            ArrowLeft: "left",
            ArrowRight: "right",
          } as const;
          const direction = keyToDirection[event.key as keyof typeof keyToDirection];
          if (!direction) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          data.onNavigate?.(direction);
        }}
        className={`flex h-[132px] w-[168px] flex-col justify-between rounded-[24px] border px-4 py-3 text-left shadow-sm transition ${
          interactive ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-desktop-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white" : "cursor-not-allowed"
        } ${
          data.active ? `${tone.fillActive} ${tone.border} ${tone.shadow}` : `${tone.fill} ${tone.border} shadow-black/0`
        } ${selectedClasses}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold tracking-[0.08em] text-desktop-text-secondary">{layerLabel[data.layer]}</div>
            <div
              className={`mt-1 max-w-[122px] truncate text-[13px] font-semibold ${data.active ? "text-desktop-text-primary" : "text-slate-500"}`}
              title={data.title}
            >
              {data.title}
            </div>
          </div>
          <span className={`shrink-0 whitespace-nowrap rounded-full border px-1.5 py-[1px] text-[9px] font-medium leading-none ${data.active ? tone.badge : "border-slate-200 bg-slate-50 text-slate-400"}`}>
            {unavailable ? "未接入" : "阶段"}
          </span>
        </div>
        {data.note ? (
          <div
            className={`mt-2 min-h-[16px] max-w-[168px] truncate text-[10px] leading-4 ${data.active ? "text-desktop-text-secondary" : "text-slate-400"}`}
            title={data.note}
          >
            {data.note}
          </div>
        ) : null}
        {data.unavailableReason ? (
          <div
            id={unavailableReasonId}
            className="mt-2 min-h-[16px] max-w-[168px] rounded-xl border border-dashed border-slate-200 bg-white/70 px-2.5 py-2 text-[10px] leading-4 text-slate-500 truncate"
            title={data.unavailableReason}
          >
            {data.unavailableReason}
          </div>
        ) : null}
      </button>
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

function detectReleaseWorkflows(flows: GitHubActionsFlow[]) {
  const releaseKeywords = ["release", "publish", "deploy"];
  return flows.filter((flow) => {
    const id = flow.id.toLowerCase();
    const name = flow.name.toLowerCase();
    return releaseKeywords.some((keyword) => id.includes(keyword) || name.includes(keyword));
  }).length;
}

function buildGraph(args: {
  hookSummary: HookSummary | null;
  instructionSummary: InstructionSummary | null;
  workflowSummary: WorkflowSummary | null;
  metricCount: number;
  hardGateCount: number;
  designDecisionNodeEnabled?: boolean;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const {
    hookSummary,
    instructionSummary,
    workflowSummary,
    metricCount,
    hardGateCount,
    designDecisionNodeEnabled,
    selectedNodeId,
    onSelectNode,
  } = args;

  const hasCodingNode = Boolean(designDecisionNodeEnabled);
  const selectableNodeIds = new Set([
    "thinking",
    ...(hasCodingNode ? ["coding"] : []),
    "build",
    "test",
    "precommit",
    "review",
    "post-commit",
    "release",
  ]);

  const navigationGraph: Record<string, Partial<Record<"up" | "down" | "left" | "right", string>>> = {
    thinking: { right: hasCodingNode ? "coding" : "build" },
    ...(hasCodingNode ? {
      coding: { left: "thinking", right: "build" },
    } : {}),
    build: { left: hasCodingNode ? "coding" : "thinking", right: "test", down: "review" },
    test: { left: "build", down: "precommit" },
    precommit: { up: "test", left: "review" },
    review: { up: "build", right: "precommit", left: "post-commit" },
    "post-commit": { right: "review", down: "release" },
    release: { up: "post-commit" },
  };
  const handleNavigate = (currentNodeId: string, direction: "up" | "down" | "left" | "right") => {
    const nextNodeId = navigationGraph[currentNodeId]?.[direction];
    if (!nextNodeId || !selectableNodeIds.has(nextNodeId)) {
      return;
    }
    onSelectNode(nextNodeId);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        const nextButton = document.querySelector<HTMLButtonElement>(`[data-governance-node-id="${nextNodeId}"]`);
        nextButton?.focus();
      });
    }
  };
  const buildSelectionState = (nodeId: string, enabled: boolean) => {
    if (!enabled) {
      return {
        selected: false,
      };
    }

    return {
      selected: selectedNodeId === nodeId,
      onSelect: () => {
        onSelectNode(nodeId);
      },
      onNavigate: (direction: "up" | "down" | "left" | "right") => {
        handleNavigate(nodeId, direction);
      },
    };
  };
  const commitRowY = 268;
  const internalRowY = 86;
  const col1X = 128;
  const col2X = 330;
  const col3X = 532;
  const col4X = 734;
  const externalRowY = 482;

  const nodes: Node<LoopNodeData>[] = [
    buildNode("thinking", col1X, internalRowY, {
      nodeId: "thinking",
      layer: "internal",
      title: "需求定义",
      tone: getLayerTone("internal"),
      note: "Spec / 需求边界",
      active: true,
      ...buildSelectionState("thinking", true),
    }),
    buildNode("coding", col2X, internalRowY, {
      nodeId: "coding",
      layer: "internal",
      title: "设计决策",
      tone: getLayerTone("internal"),
      note: "ADR / 设计取舍",
      active: hasCodingNode,
      unavailableReason: hasCodingNode
        ? undefined
        : "暂未接入 ADR / 设计决策来源（docs/ARCHITECTURE.md 或 docs/adr）",
      ...buildSelectionState("coding", hasCodingNode),
    }),
    buildNode("build", col3X, internalRowY, {
      nodeId: "build",
      layer: "internal",
      title: "编码实现",
      tone: getLayerTone("internal"),
      note: instructionSummary
        ? `受 ${instructionSummary.fileName} 规范约束`
        : "代码实现 / 约束执行",
      active: true,
      ...buildSelectionState("build", true),
    }),
    buildNode("test", col4X, internalRowY, {
      nodeId: "test",
      layer: "internal",
      title: "本地验证",
      tone: getLayerTone("internal"),
      note: "测试 / 回归 / smoke",
      active: true,
      ...buildSelectionState("test", true),
    }),
    buildNode("precommit", col4X, commitRowY, {
      nodeId: "precommit",
      layer: "commit",
      title: "变更门禁",
      tone: getLayerTone("commit"),
      note: metricCount > 0
        ? `${metricCount} metrics / ${hardGateCount} hard gates`
        : hookSummary
          ? `pre-push / ${hookSummary.phaseCount} phases`
          : "pre-push / Entrix Fitness",
      active: true,
      ...buildSelectionState("precommit", true),
    }),
    buildNode("review", col3X, commitRowY, {
      nodeId: "review",
      layer: "commit",
      title: "代码评审",
      tone: getLayerTone("commit"),
      note: "规则策略 / 人工 review",
      active: true,
      ...buildSelectionState("review", true),
    }),
    buildNode("commit", col2X, commitRowY, {
      nodeId: "commit",
      layer: "commit",
      title: "主干集成",
      tone: getLayerTone("commit"),
      note: "merge / trunk",
      active: false,
      unavailableReason: "暂未接入 trunk merge / 主干集成信号，当前没有对应上下文面板。",
      ...buildSelectionState("commit", false),
    }),
    buildNode("post-commit", col1X, commitRowY, {
      nodeId: "post-commit",
      layer: "commit",
      title: "持续交付",
      tone: getLayerTone("commit"),
      note: workflowSummary
        ? `${workflowSummary.flowCount} flows / ${workflowSummary.jobCount} jobs`
        : "CI/CD / 自动交付",
      active: true,
      ...buildSelectionState("post-commit", true),
    }),
    buildNode("release", col1X, externalRowY, {
      nodeId: "release",
      layer: "external",
      title: "制品发布",
      tone: getLayerTone("external"),
      note: workflowSummary && workflowSummary.releaseFlowCount > 0
        ? `${workflowSummary.releaseFlowCount} release flows`
        : "artifact / release",
      active: Boolean(workflowSummary && workflowSummary.releaseFlowCount > 0),
      unavailableReason: workflowSummary && workflowSummary.releaseFlowCount > 0
        ? undefined
        : "仓库未检测到 release / publish workflow，暂时无法进入发布上下文。",
      ...buildSelectionState("release", Boolean(workflowSummary && workflowSummary.releaseFlowCount > 0)),
    }),
    buildNode("staging", col2X, externalRowY, {
      nodeId: "staging",
      layer: "external",
      title: "预生产验证",
      tone: getLayerTone("external"),
      note: "预发验收 / smoke",
      active: false,
      unavailableReason: "暂未接入 staging / 预发验证信号，当前没有可展示的验证面板。",
      ...buildSelectionState("staging", false),
    }),
    buildNode("production", col3X, externalRowY, {
      nodeId: "production",
      layer: "external",
      title: "生产运行",
      tone: getLayerTone("external"),
      note: "真实流量 / 运行状态",
      active: false,
      unavailableReason: "暂未接入 production runtime / 真实流量信号，当前没有运行时上下文。",
      ...buildSelectionState("production", false),
    }),
    buildNode("metrics", col4X, externalRowY, {
      nodeId: "metrics",
      layer: "external",
      title: "监控演进",
      tone: getLayerTone("external"),
      note: "监控 / 反馈闭环",
      active: false,
      unavailableReason: "暂未接入 observability / 反馈闭环信号，当前没有监控与回流数据。",
      ...buildSelectionState("metrics", false),
    }),
  ];

  const edges: Edge[] = [
    buildEdge("thinking-coding", "thinking", "coding", "source-right", "target-left", "澄清", LOOP_EDGE_COLORS.neutral),
    buildEdge("coding-build", "coding", "build", "source-right", "target-left", "实现", LOOP_EDGE_COLORS.internal),
    buildEdge("build-test", "build", "test", "source-right", "target-left", "验证", LOOP_EDGE_COLORS.internal),

    buildEdge("precommit-review", "precommit", "review", "source-left", "target-right", "送审", LOOP_EDGE_COLORS.internal),
    buildEdge("review-commit", "review", "commit", "source-left", "target-right", "集成", LOOP_EDGE_COLORS.neutral),
    buildEdge("commit-post-commit", "commit", "post-commit", "source-left", "target-right", "交付", LOOP_EDGE_COLORS.commit),

    buildEdge("release-staging", "release", "staging", "source-right", "target-left", "预发", LOOP_EDGE_COLORS.commit),
    buildEdge("staging-production", "staging", "production", "source-right", "target-left", "上线", LOOP_EDGE_COLORS.external),
    buildEdge("production-metrics", "production", "metrics", "source-right", "target-left", "演进", LOOP_EDGE_COLORS.feedback),

    buildEdge("test-precommit", "test", "precommit", "source-bottom", "target-top", "", LOOP_EDGE_COLORS.internal, "6 4"),
    buildEdge("post-commit-release", "post-commit", "release", "source-bottom", "target-top", "", LOOP_EDGE_COLORS.commit, "6 4"),
    {
      id: "metrics-thinking",
      source: "metrics",
      target: "thinking",
      sourceHandle: "source-left",
      targetHandle: "target-left",
      type: "simplebezier",
      style: {
        stroke: LOOP_EDGE_COLORS.feedback,
        strokeWidth: 1.8,
        strokeDasharray: "6 4",
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: LOOP_EDGE_COLORS.feedback,
      },
    } satisfies Edge,

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
            stroke: LOOP_EDGE_COLORS.commit,
            strokeWidth: 1.8,
            strokeDasharray: "6 4",
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: LOOP_EDGE_COLORS.commit,
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

  return { nodes, edges, minHeight: 592 };
}

function buildDetailSections(args: {
  selectedNodeId: string | null;
  hooksData: HooksResponse | null;
  workflowData: GitHubActionsFlowsResponse | null;
  instructionSummary: InstructionSummary | null;
  fitnessFiles: FitnessSpecSummary[];
  dimensionCount: number;
  metricCount: number;
  hardGateCount: number;
  selectedTier: TierValue;
}) {
  const {
    selectedNodeId,
    hooksData,
    workflowData,
    instructionSummary,
    fitnessFiles,
    dimensionCount,
    metricCount,
    hardGateCount,
    selectedTier,
  } = args;

  const uniquePhases = [...new Set((hooksData?.profiles ?? []).flatMap((profile) => profile.phases ?? []))];
  const workflowNames = (workflowData?.flows ?? []).map((flow) => flow.name);
  const workflowJobs = (workflowData?.flows ?? []).flatMap((flow) => flow.jobs?.map((job) => `${flow.name}: ${job.id}`) ?? []);
  const dimensionFiles = fitnessFiles
    .filter((file) => file.kind === "dimension")
    .map((file) => file.dimension ?? file.name);
  const primaryRuleFiles = fitnessFiles
    .filter((file) => file.kind === "rulebook" || file.kind === "manifest")
    .map((file) => file.name);

  switch (selectedNodeId) {
    case "precommit":
      return [
        { title: "Fitness", items: [`tier ${selectedTier}`, `${dimensionCount} dimensions`, `${metricCount} metrics`, `${hardGateCount} hard gates`] },
        { title: "Hook phases", items: uniquePhases.length ? uniquePhases : ["当前页未发现 phase"] },
        { title: "Related surface", items: ["Entrix Fitness", "Hook systems panel"] },
      ] satisfies LoopDetailSection[];
    case "post-commit":
      return [
        { title: "Actions", items: workflowNames.length ? workflowNames.slice(0, 8) : ["当前页未发现 action"] },
        { title: "Jobs", items: workflowJobs.length ? workflowJobs.slice(0, 8) : ["当前页未发现 job"] },
        { title: "Related surface", items: ["CI/CD panel", "External feedback loop"] },
      ] satisfies LoopDetailSection[];
    case "release":
      return [
        { title: "Release handoff", items: workflowNames.length ? workflowNames.slice(0, 6) : ["当前页未发现 release workflow"] },
        { title: "Evidence", items: ["GitHub Actions release flows", "artifact / bundle / publish", "workflow_dispatch / tags"] },
        { title: "Related surface", items: ["CI/CD panel", "Release category"] },
      ] satisfies LoopDetailSection[];
    case "review":
    case "test":
      return [
        { title: "Fitness", items: [`tier ${selectedTier}`, `${dimensionCount} dimensions`, `${metricCount} metrics`, `${hardGateCount} hard gates`] },
        { title: "Hook phases", items: uniquePhases.length ? uniquePhases : ["当前页未发现 phase"] },
        { title: "Dimension files", items: dimensionFiles.length ? dimensionFiles.slice(0, 6) : ["当前页未发现 dimension spec"] },
      ] satisfies LoopDetailSection[];
    case "build":
      return [
        { title: "Instruction source", items: [instructionSummary?.fileName ?? "AGENTS.md"] },
        { title: "Context", items: ["当前节点受 instructions 面板支撑"] },
        { title: "Rulebook", items: primaryRuleFiles.length ? primaryRuleFiles.slice(0, 4) : ["当前页未发现 rulebook / manifest"] },
      ] satisfies LoopDetailSection[];
    case "thinking":
      return [
        { title: "Spec Sources", items: ["Detects AI Coding spec tools and methodology frameworks"] },
        { title: "Frameworks", items: ["Kiro", "Qoder", "OpenSpec", "Spec Kit", "BMAD"] },
        { title: "Evidence model", items: ["artifacts-present", "installed-only", "archived", "legacy"] },
      ] satisfies LoopDetailSection[];
    case "coding":
      return [
        { title: "Design decision evidence", items: ["ADR / architecture decision files"] },
        { title: "Evidence locations", items: ["docs/ARCHITECTURE.md", "docs/adr/*.md"] },
        { title: "Related surface", items: ["Spec Sources panel", "Build / coding pipeline"] },
      ] satisfies LoopDetailSection[];
    default:
      return [
        { title: "Current page signals", items: ["Highlighted nodes are clickable. Unavailable nodes explain missing signals directly.", "Select a node (coding, local verification, change gate, review, delivery, release) to preview the matching context panel."] },
        { title: "Connected panels", items: ["Instruction file - CLAUDE.md", "Entrix Fitness", "Review triggers", "CI/CD", "Repo signals"] },
      ] satisfies LoopDetailSection[];
  }
}

export function HarnessGovernanceLoopGraph({
  repoPath,
  selectedTier,
  specsError,
  dimensionCount,
  planError,
  designDecisionNodeEnabled,
  metricCount,
  hardGateCount,
  unsupportedMessage,
  hooksData,
  hooksError,
  workflowData,
  workflowError,
  instructionsData,
  instructionsError,
  fitnessFiles = [],
  selectedNodeId,
  onSelectedNodeChange,
  contextPanel,
}: HarnessGovernanceLoopGraphProps) {
  const hasContext = Boolean(repoPath);
  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState("build");
  const activeSelectedNodeId = selectedNodeId !== undefined ? selectedNodeId : internalSelectedNodeId;
  const hookSummary = useMemo(() => {
    if (!hooksData) {
      return null;
    }
    const uniquePhases = new Set(
      (hooksData.profiles ?? []).flatMap((profile) => profile.phases ?? []).filter((phase): phase is HookPhase => phase in PHASE_LABELS),
    );
    return {
      hookCount: hooksData.hookFiles?.length ?? 0,
      profileCount: hooksData.profiles?.length ?? 0,
      mappedMetricCount: (hooksData.profiles ?? []).reduce((sum, profile) => sum + (profile.metrics?.length ?? 0), 0),
      phaseCount: uniquePhases.size,
      phaseLabels: [...uniquePhases].map((phase) => PHASE_LABELS[phase]).filter(Boolean),
    } satisfies HookSummary;
  }, [hooksData]);
  const workflowSummary = useMemo(() => {
    const flows = Array.isArray(workflowData?.flows) ? workflowData.flows : [];
    if (flows.length === 0) {
      return null;
    }
    return {
      flowCount: flows.length,
      jobCount: flows.reduce((sum, flow) => sum + (flow.jobs?.length ?? 0), 0),
      remoteSignals: summarizeSignals(flows),
      hasRepairLoop: detectRepairLoop(flows),
      releaseFlowCount: detectReleaseWorkflows(flows),
    } satisfies WorkflowSummary;
  }, [workflowData]);
  const instructionSummary = useMemo(() => {
    if (!instructionsData) {
      return null;
    }
    return {
      fileName: instructionsData.fileName,
      fallbackUsed: instructionsData.fallbackUsed,
    } satisfies InstructionSummary;
  }, [instructionsData]);

  const graph = useMemo(
    () => buildGraph({
      hookSummary,
      instructionSummary,
      workflowSummary,
      metricCount,
      hardGateCount,
      designDecisionNodeEnabled,
      selectedNodeId: activeSelectedNodeId,
      onSelectNode: (nodeId) => {
        if (onSelectedNodeChange) {
          onSelectedNodeChange(nodeId);
          return;
        }
        setInternalSelectedNodeId(nodeId);
      },
    }),
    [activeSelectedNodeId, designDecisionNodeEnabled, hardGateCount, hookSummary, instructionSummary, metricCount, onSelectedNodeChange, workflowSummary],
  );

  const graphIssues = [...new Set(
    [specsError, planError, hooksError, workflowError, instructionsError]
      .filter((issue): issue is string => Boolean(issue)),
  )];
  const detailSections = useMemo(
    () => buildDetailSections({
      selectedNodeId: activeSelectedNodeId,
      hooksData: hooksData ?? null,
      workflowData: workflowData ?? null,
      instructionSummary,
      fitnessFiles,
      dimensionCount,
      metricCount,
      hardGateCount,
      selectedTier,
    }),
    [activeSelectedNodeId, dimensionCount, fitnessFiles, hardGateCount, hooksData, instructionSummary, metricCount, selectedTier, workflowData],
  );

  return (
    <section className="space-y-0">
      {unsupportedMessage ? (
        <HarnessUnsupportedState />
      ) : null}

      {!hasContext && !unsupportedMessage ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Select a repository to render the governance loop.
        </div>
      ) : null}

      {hasContext && !unsupportedMessage && graphIssues.length > 0 ? (
        <div className="mt-4 space-y-2">
          {graphIssues.map((issue) => (
            <div key={issue} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] text-amber-800">
              {issue}
            </div>
          ))}
        </div>
      ) : null}

      {hasContext && !unsupportedMessage ? (
        <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="relative overflow-hidden rounded-2xl border border-desktop-border bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))]">
              <div className="pointer-events-none absolute right-3 top-2 z-10 rounded-xl border border-desktop-border bg-white/90 px-2.5 py-1.5 text-[10px] text-slate-700 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="shrink-0 text-desktop-text-secondary">Legend:</span>
                  <span className="flex items-center gap-1.5 text-[10px]"><span className="h-2.5 w-2.5 rounded-[3px] border border-sky-300 bg-sky-100" />Internal</span>
                  <span className="flex items-center gap-1.5 text-[10px]"><span className="h-2.5 w-2.5 rounded-[3px] border border-violet-300 bg-violet-100" />Push</span>
                  <span className="flex items-center gap-1.5 text-[10px]"><span className="h-2.5 w-2.5 rounded-[3px] border border-amber-300 bg-amber-100" />External</span>
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
                  minZoom={0.55}
                  maxZoom={1}
                  fitView
                  fitViewOptions={{ padding: 0.05, minZoom: 0.55, maxZoom: 1 }}
                  onNodeClick={(_event, node) => {
                    graph.nodes.find((graphNode) => graphNode.id === node.id)?.data.onSelect?.();
                  }}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background color="#d7dee7" gap={20} size={1} />
                </ReactFlow>
              </div>
            </div>

            <aside className="space-y-3">
              {contextPanel ? (
                <div>{contextPanel}</div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/70 px-3 py-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Node details</div>
                    <div className="mt-1 text-sm font-semibold text-desktop-text-primary">
                      {graph.nodes.find((node) => node.id === activeSelectedNodeId)?.data.title ?? "阶段详情"}
                    </div>
                  </div>
                  {detailSections.map((section: LoopDetailSection) => (
                    <div key={section.title} className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">{section.title}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {section.items.map((item: string) => (
                          <span key={item} className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[10px] text-desktop-text-primary">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </div>
      ) : null}
    </section>
  );
}
