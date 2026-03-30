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
  selectedNodeId?: string;
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
  selected?: boolean;
  onSelect?: () => void;
  onNavigate?: (direction: "up" | "down" | "left" | "right") => void;
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
    commit: "推送反馈环",
    external: "外部反馈环",
  };
  const interactive = typeof data.onSelect === "function";
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
        aria-label={`${layerLabel[data.layer]} ${data.title}${data.note ? `，${data.note}` : ""}`}
        disabled={!interactive}
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
        className={`flex min-h-[96px] w-[168px] flex-col justify-between rounded-[24px] border px-4 py-3 text-left shadow-sm transition ${
          interactive ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-desktop-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white" : "cursor-not-allowed"
        } ${
          data.active ? `bg-desktop-bg-primary/96 ${tone.border} ${tone.shadow}` : "border-slate-200 bg-slate-100/90 shadow-black/0"
        } ${selectedClasses}`}
      >
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
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
}) {
  const {
    hookSummary,
    instructionSummary,
    workflowSummary,
    metricCount,
    hardGateCount,
    selectedNodeId,
    onSelectNode,
  } = args;

  const selectableNodeIds = new Set(["thinking", "build", "test", "precommit", "review", "post-commit", "release"]);

  const navigationGraph: Record<string, Partial<Record<"up" | "down" | "left" | "right", string>>> = {
    thinking: { right: "build" },
    build: { left: "thinking", right: "test", down: "review" },
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
      tone: "neutral",
      note: "Spec / 需求边界",
      active: true,
      ...buildSelectionState("thinking", true),
    }),
    buildNode("coding", col2X, internalRowY, {
      nodeId: "coding",
      layer: "internal",
      title: "设计决策",
      tone: "sky",
      note: "ADR / 设计取舍",
      active: false,
      ...buildSelectionState("coding", false),
    }),
    buildNode("build", col3X, internalRowY, {
      nodeId: "build",
      layer: "internal",
      title: "编码实现",
      tone: "sky",
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
      tone: "emerald",
      note: "测试 / 回归 / smoke",
      active: true,
      ...buildSelectionState("test", true),
    }),
    buildNode("precommit", col4X, commitRowY, {
      nodeId: "precommit",
      layer: "commit",
      title: "变更门禁",
      tone: "sky",
      note: metricCount > 0
        ? `${metricCount} metrics / ${hardGateCount} hard gates`
        : hookSummary
          ? `pre-push / ${hookSummary.phaseCount} phases`
          : "pre-push / execution plan",
      active: true,
      ...buildSelectionState("precommit", true),
    }),
    buildNode("review", col3X, commitRowY, {
      nodeId: "review",
      layer: "commit",
      title: "代码评审",
      tone: "emerald",
      note: "规则策略 / 人工 review",
      active: true,
      ...buildSelectionState("review", true),
    }),
    buildNode("commit", col2X, commitRowY, {
      nodeId: "commit",
      layer: "commit",
      title: "主干集成",
      tone: "neutral",
      note: "merge / trunk",
      active: false,
      ...buildSelectionState("commit", false),
    }),
    buildNode("post-commit", col1X, commitRowY, {
      nodeId: "post-commit",
      layer: "commit",
      title: "持续交付",
      tone: "violet",
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
      tone: "amber",
      note: workflowSummary && workflowSummary.releaseFlowCount > 0
        ? `${workflowSummary.releaseFlowCount} release flows`
        : "artifact / release",
      active: Boolean(workflowSummary && workflowSummary.releaseFlowCount > 0),
      ...buildSelectionState("release", true),
    }),
    buildNode("staging", col2X, externalRowY, {
      nodeId: "staging",
      layer: "external",
      title: "预生产验证",
      tone: "violet",
      note: "预发验收 / smoke",
      active: false,
      ...buildSelectionState("staging", false),
    }),
    buildNode("production", col3X, externalRowY, {
      nodeId: "production",
      layer: "external",
      title: "生产运行",
      tone: "amber",
      note: "真实流量 / 运行状态",
      active: false,
      ...buildSelectionState("production", false),
    }),
    buildNode("metrics", col4X, externalRowY, {
      nodeId: "metrics",
      layer: "external",
      title: "监控演进",
      tone: "emerald",
      note: "监控 / 反馈闭环",
      active: false,
      ...buildSelectionState("metrics", false),
    }),
  ];

  const edges: Edge[] = [
    buildEdge("thinking-coding", "thinking", "coding", "source-right", "target-left", "澄清", "#64748b"),
    buildEdge("coding-build", "coding", "build", "source-right", "target-left", "实现", "#0ea5e9"),
    buildEdge("build-test", "build", "test", "source-right", "target-left", "验证", "#10b981"),

    buildEdge("precommit-review", "precommit", "review", "source-left", "target-right", "送审", "#0ea5e9"),
    buildEdge("review-commit", "review", "commit", "source-left", "target-right", "集成", "#64748b"),
    buildEdge("commit-post-commit", "commit", "post-commit", "source-left", "target-right", "交付", "#8b5cf6"),

    buildEdge("release-staging", "release", "staging", "source-right", "target-left", "预发", "#8b5cf6"),
    buildEdge("staging-production", "staging", "production", "source-right", "target-left", "上线", "#f59e0b"),
    buildEdge("production-metrics", "production", "metrics", "source-right", "target-left", "演进", "#059669"),

    buildEdge("test-precommit", "test", "precommit", "source-bottom", "target-top", "", "#0ea5e9", "6 4"),
    buildEdge("post-commit-release", "post-commit", "release", "source-bottom", "target-top", "", "#8b5cf6", "6 4"),
    {
      id: "metrics-thinking",
      source: "metrics",
      target: "thinking",
      sourceHandle: "source-left",
      targetHandle: "target-left",
      type: "simplebezier",
      style: {
        stroke: "#059669",
        strokeWidth: 1.8,
        strokeDasharray: "6 4",
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#059669",
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

  return { nodes, edges, minHeight: 592 };
}

function buildDetailSections(args: {
  selectedNodeId: string;
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
        { title: "Related surface", items: ["Execution plan", "Hook system panel"] },
      ] satisfies LoopDetailSection[];
    case "post-commit":
      return [
        { title: "Actions", items: workflowNames.length ? workflowNames.slice(0, 8) : ["当前页未发现 action"] },
        { title: "Jobs", items: workflowJobs.length ? workflowJobs.slice(0, 8) : ["当前页未发现 job"] },
        { title: "Related surface", items: ["GitHub Actions flow panel", "External feedback loop"] },
      ] satisfies LoopDetailSection[];
    case "release":
      return [
        { title: "Release handoff", items: workflowNames.length ? workflowNames.slice(0, 6) : ["当前页未发现 release workflow"] },
        { title: "Evidence", items: ["GitHub Actions release flows", "artifact / bundle / publish", "workflow_dispatch / tags"] },
        { title: "Related surface", items: ["GitHub Actions flow panel", "Release category"] },
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
    default:
      return [
        { title: "Current page signals", items: ["亮色节点可点击，灰色节点表示当前没有对应 panel", "点击 `编码实现`、`本地验证`、`变更门禁`、`代码评审`、`持续交付` 或 `制品发布` 查看上下文"] },
        { title: "Connected panels", items: ["Instruction file", "Execution plan", "Review triggers", "GitHub Actions flow", "Repo signals"] },
      ] satisfies LoopDetailSection[];
  }
}

export function HarnessGovernanceLoopGraph({
  repoPath,
  selectedTier,
  specsError,
  dimensionCount,
  planError,
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
  const activeSelectedNodeId = selectedNodeId ?? internalSelectedNodeId;
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
      selectedNodeId: activeSelectedNodeId,
      onSelectNode: (nodeId) => {
        if (onSelectedNodeChange) {
          onSelectedNodeChange(nodeId);
          return;
        }
        setInternalSelectedNodeId(nodeId);
      },
    }),
    [activeSelectedNodeId, hardGateCount, hookSummary, instructionSummary, metricCount, onSelectedNodeChange, workflowSummary],
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
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-[14px] right-[14px] top-[38px] h-[164px] rounded-[40px] border border-emerald-300/70 bg-emerald-50/35" />
                <div className="absolute left-[14px] right-[14px] top-[208px] h-[164px] rounded-[40px] border border-sky-300/70 bg-sky-50/35" />
                <div className="absolute left-[14px] right-[14px] top-[380px] h-[164px] rounded-[40px] border border-violet-300/65 bg-violet-50/35" />

                <div className="absolute left-[42px] top-[54px] max-w-[180px] text-left text-slate-600">
                  <div className="text-[11px] font-semibold tracking-[0.06em]">内部反馈环</div>
                </div>

                <div className="absolute left-[42px] top-[220px] max-w-[180px] text-left text-slate-600">
                  <div className="text-[11px] font-semibold tracking-[0.06em]">推送反馈环</div>
                </div>

                <div className="absolute left-[42px] top-[392px] max-w-[180px] text-left text-slate-600">
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
