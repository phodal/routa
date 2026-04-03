"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslation, type TranslationDictionary } from "@/i18n";
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
        shadow: "",
      };
    case "emerald":
      return {
        border: "border-emerald-300",
        badge: "border-emerald-400 bg-emerald-100 text-emerald-800",
        fill: "bg-emerald-100",
        fillActive: "bg-emerald-200",
        shadow: "",
      };
    case "amber":
      return {
        border: "border-amber-300",
        badge: "border-amber-400 bg-amber-100 text-amber-800",
        fill: "bg-amber-100",
        fillActive: "bg-amber-200",
        shadow: "",
      };
    case "violet":
      return {
        border: "border-violet-300",
        badge: "border-violet-400 bg-violet-100 text-violet-800",
        fill: "bg-violet-100",
        fillActive: "bg-violet-200",
        shadow: "",
      };
    default:
      return {
        border: "border-desktop-border",
        badge: "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary",
        fill: "bg-desktop-bg-secondary",
        fillActive: "bg-desktop-bg-primary/96",
        shadow: "",
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
  const { t } = useTranslation();
  const tone = getNodeToneClasses(data.tone);
  const layerLabel: Record<LoopLayer, string> = {
    internal: t.harness.governanceLoop.graph.nodeLayers.internal,
    commit: t.harness.governanceLoop.graph.nodeLayers.commit,
    external: t.harness.governanceLoop.graph.nodeLayers.external,
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
        className={`flex h-[132px] w-[168px] flex-col justify-between rounded-sm border px-4 py-3 text-left transition ${
          interactive ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-desktop-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white" : "cursor-not-allowed"
        } ${
          data.active ? `${tone.fillActive} ${tone.border} ${tone.shadow}` : `${tone.fill} ${tone.border}`
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
            {unavailable ? t.harness.governanceLoop.graph.statusLabels.unavailable : t.harness.governanceLoop.graph.statusLabels.phase}
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
          className="mt-2 min-h-[16px] max-w-[168px] rounded-sm border border-dashed border-slate-200 bg-white/70 px-2.5 py-2 text-[10px] leading-4 text-slate-500 truncate"
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
  g: TranslationDictionary["harness"]["governanceLoop"]["graph"];
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
    g,
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
      title: g.nodeLabels.thinking,
      tone: getLayerTone("internal"),
      note: g.clues.thinkingNote,
      active: true,
      ...buildSelectionState("thinking", true),
    }),
    buildNode("coding", col2X, internalRowY, {
      nodeId: "coding",
      layer: "internal",
      title: g.nodeLabels.coding,
      tone: getLayerTone("internal"),
      note: g.clues.codingNote,
      active: hasCodingNode,
      unavailableReason: hasCodingNode
        ? undefined
        : g.nodeNotes.codingUnavailable,
      ...buildSelectionState("coding", hasCodingNode),
    }),
    buildNode("build", col3X, internalRowY, {
      nodeId: "build",
      layer: "internal",
      title: g.nodeLabels.build,
      tone: getLayerTone("internal"),
      note: instructionSummary
        ? `${g.clues.buildNotePrefix} ${instructionSummary.fileName} ${g.clues.buildNoteSuffix}`
        : g.clues.buildNote,
      active: true,
      ...buildSelectionState("build", true),
    }),
    buildNode("test", col4X, internalRowY, {
      nodeId: "test",
      layer: "internal",
      title: g.nodeLabels.test,
      tone: getLayerTone("internal"),
      note: g.clues.testNote,
      active: true,
      ...buildSelectionState("test", true),
    }),
    buildNode("precommit", col4X, commitRowY, {
      nodeId: "precommit",
      layer: "commit",
      title: g.nodeLabels.precommit,
      tone: getLayerTone("commit"),
      note: metricCount > 0
        ? g.detailChips.metricsAndGates.replace("{metrics}", String(metricCount)).replace("{gates}", String(hardGateCount))
        : hookSummary
          ? g.detailChips.prePushPhases.replace("{count}", String(hookSummary.phaseCount))
          : g.clues.precommitNote,
      active: true,
      ...buildSelectionState("precommit", true),
    }),
    buildNode("review", col3X, commitRowY, {
      nodeId: "review",
      layer: "commit",
      title: g.nodeLabels.review,
      tone: getLayerTone("commit"),
      note: g.clues.reviewNote,
      active: true,
      ...buildSelectionState("review", true),
    }),
    buildNode("commit", col2X, commitRowY, {
      nodeId: "commit",
      layer: "commit",
      title: g.nodeLabels.commit,
      tone: getLayerTone("commit"),
      note: g.clues.commitNote,
      active: false,
      unavailableReason: g.nodeNotes.commitUnavailable,
      ...buildSelectionState("commit", false),
    }),
    buildNode("post-commit", col1X, commitRowY, {
      nodeId: "post-commit",
      layer: "commit",
      title: g.nodeLabels["post-commit"],
      tone: getLayerTone("commit"),
      note: workflowSummary
        ? g.detailChips.flowsAndJobs.replace("{flows}", String(workflowSummary.flowCount)).replace("{jobs}", String(workflowSummary.jobCount))
        : g.clues.postCommitNote,
      active: true,
      ...buildSelectionState("post-commit", true),
    }),
    buildNode("release", col1X, externalRowY, {
      nodeId: "release",
      layer: "external",
      title: g.nodeLabels.release,
      tone: getLayerTone("external"),
      note: workflowSummary && workflowSummary.releaseFlowCount > 0
        ? g.detailChips.releaseFlows.replace("{count}", String(workflowSummary.releaseFlowCount))
        : g.clues.releaseNote,
      active: Boolean(workflowSummary && workflowSummary.releaseFlowCount > 0),
      unavailableReason: workflowSummary && workflowSummary.releaseFlowCount > 0
        ? undefined
        : g.nodeNotes.releaseUnavailable,
      ...buildSelectionState("release", Boolean(workflowSummary && workflowSummary.releaseFlowCount > 0)),
    }),
    buildNode("staging", col2X, externalRowY, {
      nodeId: "staging",
      layer: "external",
      title: g.nodeLabels.staging,
      tone: getLayerTone("external"),
      note: g.clues.stagingNote,
      active: false,
      unavailableReason: g.nodeNotes.stagingUnavailable,
      ...buildSelectionState("staging", false),
    }),
    buildNode("production", col3X, externalRowY, {
      nodeId: "production",
      layer: "external",
      title: g.nodeLabels.production,
      tone: getLayerTone("external"),
      note: g.clues.productionNote,
      active: false,
      unavailableReason: g.nodeNotes.productionUnavailable,
      ...buildSelectionState("production", false),
    }),
    buildNode("metrics", col4X, externalRowY, {
      nodeId: "metrics",
      layer: "external",
      title: g.nodeLabels.metrics,
      tone: getLayerTone("external"),
      note: g.clues.metricsNote,
      active: false,
      unavailableReason: g.nodeNotes.metricsUnavailable,
      ...buildSelectionState("metrics", false),
    }),
  ];

  const edges: Edge[] = [
    buildEdge("thinking-coding", "thinking", "coding", "source-right", "target-left", g.edgeLabels.clarify, LOOP_EDGE_COLORS.neutral),
    buildEdge("coding-build", "coding", "build", "source-right", "target-left", g.edgeLabels.implement, LOOP_EDGE_COLORS.internal),
    buildEdge("build-test", "build", "test", "source-right", "target-left", g.edgeLabels.validate, LOOP_EDGE_COLORS.internal),

    buildEdge("precommit-review", "precommit", "review", "source-left", "target-right", g.edgeLabels.sendForReview, LOOP_EDGE_COLORS.internal),
    buildEdge("review-commit", "review", "commit", "source-left", "target-right", g.edgeLabels.integrate, LOOP_EDGE_COLORS.neutral),
    buildEdge("commit-post-commit", "commit", "post-commit", "source-left", "target-right", g.edgeLabels.deliver, LOOP_EDGE_COLORS.commit),

    buildEdge("release-staging", "release", "staging", "source-right", "target-left", g.edgeLabels.preRelease, LOOP_EDGE_COLORS.commit),
    buildEdge("staging-production", "staging", "production", "source-right", "target-left", g.edgeLabels.deploy, LOOP_EDGE_COLORS.external),
    buildEdge("production-metrics", "production", "metrics", "source-right", "target-left", g.edgeLabels.evolve, LOOP_EDGE_COLORS.feedback),

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
          label: g.edgeLabels.autoRepairRetry,
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
  g: TranslationDictionary["harness"]["governanceLoop"]["graph"];
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
    g,
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
        { title: g.detailSections.fitness.title, items: [g.detailChips.tier.replace("{tier}", String(selectedTier)), g.detailChips.dimensions.replace("{count}", String(dimensionCount)), g.detailChips.metricsLabel.replace("{count}", String(metricCount)), g.detailChips.hardGatesLabel.replace("{count}", String(hardGateCount))] },
        { title: g.detailSections.fitness.hookPhasesTitle, items: uniquePhases.length ? uniquePhases : [g.detailSections.fitness.noPhase] },
        { title: g.detailSections.fitness.relatedSurface, items: g.detailSections.fitness.relatedItems },
      ] satisfies LoopDetailSection[];
    case "post-commit":
      return [
        { title: g.detailSections.workflow.title, items: workflowNames.length ? workflowNames.slice(0, 8) : [g.detailSections.workflow.noAction] },
        { title: g.detailSections.workflow.jobsTitle, items: workflowJobs.length ? workflowJobs.slice(0, 8) : [g.detailSections.workflow.noJob] },
        { title: g.detailSections.workflow.relatedSurface, items: g.detailSections.workflow.relatedItems },
      ] satisfies LoopDetailSection[];
    case "release":
      return [
        { title: g.detailSections.release.title, items: workflowNames.length ? workflowNames.slice(0, 6) : [g.detailSections.release.noReleaseWorkflow] },
        { title: g.detailSections.release.evidenceTitle, items: g.detailSections.release.evidenceItems },
        { title: g.detailSections.release.relatedSurface, items: g.detailSections.release.relatedItems },
      ] satisfies LoopDetailSection[];
    case "review":
    case "test":
      return [
        { title: g.detailSections.fitness.title, items: [g.detailChips.tier.replace("{tier}", String(selectedTier)), g.detailChips.dimensions.replace("{count}", String(dimensionCount)), g.detailChips.metricsLabel.replace("{count}", String(metricCount)), g.detailChips.hardGatesLabel.replace("{count}", String(hardGateCount))] },
        { title: g.detailSections.test.hookPhasesTitle, items: uniquePhases.length ? uniquePhases : [g.detailSections.fitness.noPhase] },
        { title: g.detailSections.test.dimensionFilesTitle, items: dimensionFiles.length ? dimensionFiles.slice(0, 6) : [g.detailSections.test.noDimensionSpec] },
      ] satisfies LoopDetailSection[];
    case "build":
      return [
        { title: g.detailSections.build.instructionSourceTitle, items: [instructionSummary?.fileName ?? "AGENTS.md"] },
        { title: g.detailSections.build.contextTitle, items: [g.detailSections.build.contextItem] },
        { title: g.detailSections.build.rulebookTitle, items: primaryRuleFiles.length ? primaryRuleFiles.slice(0, 4) : [g.detailSections.build.noRulebookManifest] },
      ] satisfies LoopDetailSection[];
    case "thinking":
      return [
        { title: g.detailSections.thinking.specSourcesTitle, items: [g.detailSections.thinking.specSourcesItem] },
        { title: g.detailSections.thinking.frameworksTitle, items: g.detailSections.thinking.frameworksItems },
        { title: g.detailSections.thinking.evidenceModelTitle, items: g.detailSections.thinking.evidenceModelItems },
      ] satisfies LoopDetailSection[];
    case "coding":
      return [
        { title: g.detailSections.coding.designDecisionTitle, items: [g.detailSections.coding.designDecisionItem] },
        { title: g.detailSections.coding.evidenceLocationsTitle, items: g.detailSections.coding.evidenceLocationsItems },
        { title: g.detailSections.coding.relatedSurface, items: g.detailSections.coding.relatedItems },
      ] satisfies LoopDetailSection[];
    default:
      return [
        { title: g.detailSections.default.connectedPanelsTitle, items: [g.detailSections.default.highlightedNodesClickable, g.detailSections.default.selectNodePreview] },
        { title: g.detailSections.default.connectedPanelsTitle, items: g.detailSections.default.connectedPanelsItems },
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
  const { t } = useTranslation();
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
      g: t.harness.governanceLoop.graph,
    }),
    [activeSelectedNodeId, designDecisionNodeEnabled, hardGateCount, hookSummary, instructionSummary, metricCount, onSelectedNodeChange, t.harness.governanceLoop.graph, workflowSummary],
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
      g: t.harness.governanceLoop.graph,
    }),
    [activeSelectedNodeId, dimensionCount, fitnessFiles, hardGateCount, hooksData, instructionSummary, metricCount, selectedTier, t.harness.governanceLoop.graph, workflowData],
  );

  return (
    <section className="space-y-0">
      {unsupportedMessage ? (
        <HarnessUnsupportedState />
      ) : null}

      {!hasContext && !unsupportedMessage ? (
        <div className="mt-4 rounded-sm border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          {t.harness.governanceLoop.graph.selectRepository}
        </div>
      ) : null}

      {hasContext && !unsupportedMessage && graphIssues.length > 0 ? (
        <div className="mt-4 space-y-2">
          {graphIssues.map((issue) => (
            <div key={issue} className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] text-amber-800">
              {issue}
            </div>
          ))}
        </div>
      ) : null}

      {hasContext && !unsupportedMessage ? (
        <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="relative overflow-hidden rounded-sm border border-desktop-border bg-desktop-bg-primary">
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
                  <div className="rounded-sm border border-desktop-border bg-desktop-bg-primary/70 px-3 py-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">{t.harness.governanceLoop.graph.nodeDetails}</div>
                    <div className="mt-1 text-sm font-semibold text-desktop-text-primary">
                      {graph.nodes.find((node) => node.id === activeSelectedNodeId)?.data.title ?? t.harness.governanceLoop.graph.phaseDetails}
                    </div>
                  </div>
                  {detailSections.map((section: LoopDetailSection) => (
                    <div key={section.title} className="rounded-sm border border-desktop-border bg-desktop-bg-primary/80 p-3">
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
