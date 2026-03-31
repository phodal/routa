"use client";

import { useMemo, useState } from "react";
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
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";

export type RunnerKind = "shell" | "graph" | "sarif";
export type TierValue = "fast" | "normal" | "deep";
export type ScopeValue = "local" | "ci" | "staging" | "prod_observation";

export type PlannedMetric = {
  name: string;
  command: string;
  description: string;
  tier: TierValue;
  gate: string;
  hardGate: boolean;
  runner: RunnerKind;
  executionScope: ScopeValue;
};

export type PlannedDimension = {
  name: string;
  weight: number;
  thresholdPass: number;
  thresholdWarn: number;
  sourceFile: string;
  metrics: PlannedMetric[];
};

export type PlanResponse = {
  generatedAt: string;
  tier: TierValue;
  scope: ScopeValue;
  repoRoot: string;
  dimensionCount: number;
  metricCount: number;
  hardGateCount: number;
  runnerCounts: Record<RunnerKind, number>;
  dimensions: PlannedDimension[];
};

type PlanNodeKind = "root" | "stage" | "dimension" | "metric" | "lane" | "anchor";
type EdgeStatus = "hard" | "warn" | "pass" | "blocked" | "flow";

type PlanNodeData = {
  kind: PlanNodeKind;
  title: string;
  subtitle?: string;
  meta?: string[];
  status?: EdgeStatus;
  badgeText?: string;
  expanded?: boolean;
  onToggle?: () => void;
  frameWidth?: number;
  frameHeight?: number;
  entryOffsetPx?: number;
  exitOffsetPx?: number;
};

type HarnessExecutionPlanFlowProps = {
  loading: boolean;
  error: string | null;
  plan: PlanResponse | null;
  repoLabel: string;
  selectedTier: TierValue;
  onTierChange: (tier: TierValue) => void;
  unsupportedMessage?: string | null;
  variant?: "full" | "compact";
  embedded?: boolean;
};

function getStatusTone(status: EdgeStatus | undefined) {
  switch (status) {
    case "hard":
      return {
        badge: "border-red-200 bg-red-50 text-red-700",
        border: "border-red-200",
        glow: "shadow-red-100/80",
      };
    case "warn":
      return {
        badge: "border-amber-200 bg-amber-50 text-amber-700",
        border: "border-amber-200",
        glow: "shadow-amber-100/80",
      };
    case "pass":
      return {
        badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
        border: "border-emerald-200",
        glow: "shadow-emerald-100/80",
      };
    case "blocked":
      return {
        badge: "border-slate-300 bg-slate-100 text-slate-700",
        border: "border-slate-300",
        glow: "shadow-slate-200/80",
      };
    default:
      return {
        badge: "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary",
        border: "border-desktop-border",
        glow: "shadow-black/5",
      };
  }
}

function PlanNodeView({ data }: NodeProps<Node<PlanNodeData>>) {
  const tone = getStatusTone(data.status);
  const interactive = typeof data.onToggle === "function";
  const widthClass = data.kind === "metric"
    ? "w-[244px]"
    : data.kind === "dimension"
      ? "w-[252px]"
      : data.kind === "lane"
        ? ""
      : "w-[292px]";
  const kindLabelClass = data.kind === "dimension"
    ? "text-[11px] font-semibold uppercase tracking-[0.18em] text-desktop-text-secondary"
    : "text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary";
  const titleClass = data.kind === "dimension"
    ? "mt-1 text-[18px] font-semibold leading-7 text-desktop-text-primary [overflow-wrap:anywhere]"
    : "mt-1 overflow-hidden text-[15px] font-semibold leading-6 text-desktop-text-primary [overflow-wrap:anywhere]";
  const subtitleClass = data.kind === "dimension"
    ? "mt-1 overflow-hidden text-[14px] leading-7 text-desktop-text-secondary"
    : "mt-1 overflow-hidden text-[13px] leading-6 text-desktop-text-secondary";
  const contentPaddingClass = data.kind === "metric" ? "px-3 py-2" : "px-4 py-3";
  const heightClass = data.kind === "metric"
    ? "h-[184px]"
    : data.kind === "dimension"
      ? "h-[208px]"
      : data.kind === "lane"
        ? ""
      : "h-[124px]";
  const visibleMeta = data.kind === "dimension" ? [] : [];

  if (data.kind === "lane") {
    return (
      <div
        className="rounded-[28px] border border-desktop-border/70 bg-desktop-bg-primary/35 px-3 py-1.5 shadow-sm backdrop-blur-[1px]"
        style={{ width: data.frameWidth ?? 640, height: data.frameHeight ?? 220 }}
      >
        <Handle
          id="entry"
          type="target"
          position={Position.Top}
          style={{ left: data.entryOffsetPx ?? (data.frameWidth ?? 640) / 2 }}
          className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border"
        />
        <Handle
          id="exit"
          type="source"
          position={Position.Bottom}
          style={{ left: data.exitOffsetPx ?? (data.frameWidth ?? 640) / 2 }}
          className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border"
        />
      </div>
    );
  }

  if (data.kind === "anchor") {
    return (
      <div className="relative h-0 w-0 overflow-visible">
        <Handle id="top" type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-desktop-border" />
        <Handle id="bottom" type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-desktop-border" />
      </div>
    );
  }

  return (
    <div className="relative">
      <Handle id="top" type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="left" type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="right" type="target" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="left" type="source" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <Handle id="right" type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-desktop-border" />
      <button
        type="button"
        onClick={() => {
          data.onToggle?.();
        }}
        className={`${widthClass} ${heightClass} ${contentPaddingClass} flex flex-col overflow-hidden rounded-2xl border bg-desktop-bg-primary/96 text-left shadow-sm transition ${tone.border} ${tone.glow} ${interactive ? "cursor-pointer hover:bg-desktop-bg-secondary/90" : "cursor-default"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={kindLabelClass}>{data.kind}</div>
            <div className={titleClass} style={{ maxHeight: data.kind === "metric" ? 48 : undefined }}>
              {data.title}
            </div>
            {data.subtitle ? (
              <div className={subtitleClass} style={{ maxHeight: data.kind === "metric" ? 72 : 64 }}>
                {data.subtitle}
              </div>
            ) : null}
          </div>
          {data.status ? (
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone.badge}`}>
              {data.badgeText ?? data.status}
            </span>
          ) : null}
        </div>
        <div className="mt-auto">
        {visibleMeta.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {visibleMeta.map((item) => (
              <span key={item} className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
                {item}
              </span>
            ))}
          </div>
        ) : null}
        {interactive && data.kind !== "dimension" ? (
          <div className="mt-3 text-[10px] text-desktop-text-secondary">
            {data.expanded ? "Click to collapse metrics" : "Click to expand metrics"}
          </div>
        ) : null}
        </div>
      </button>
    </div>
  );
}

const nodeTypes = {
  plan: PlanNodeView,
};

function buildEdgeStyle(status: EdgeStatus) {
  switch (status) {
    case "hard":
      return { stroke: "#dc2626", strokeWidth: 1.8 };
    case "warn":
      return { stroke: "#d97706", strokeWidth: 1.8 };
    case "pass":
      return { stroke: "#059669", strokeWidth: 1.8 };
    case "blocked":
      return { stroke: "#64748b", strokeWidth: 1.8, strokeDasharray: "6 4" };
    default:
      return { stroke: "#94a3b8", strokeWidth: 1.3 };
  }
}

function buildNode(id: string, x: number, y: number, data: PlanNodeData): Node<PlanNodeData> {
  return {
    id,
    type: "plan",
    position: { x, y },
    data,
    draggable: data.kind !== "anchor",
    selectable: data.kind !== "anchor",
    sourcePosition: data.kind === "metric" ? Position.Right : Position.Bottom,
    targetPosition: data.kind === "metric" ? Position.Left : Position.Top,
  };
}

function buildPlanGraph(
  plan: PlanResponse,
  expandedDimensions: Set<string>,
  toggleDimension: (name: string) => void,
): { nodes: Node<PlanNodeData>[]; edges: Edge[]; minHeight: number } {
  const nodes: Node<PlanNodeData>[] = [];
  const edges: Edge[] = [];

  const stageY = 32;
  const rootX = 96;
  const stageCardWidth = 292;
  const stageGap = 44;
  const filterX = rootX + stageCardWidth + stageGap;
  const dispatchX = filterX + stageCardWidth + stageGap;
  const gatesX = dispatchX + stageCardWidth + stageGap;
  const reportX = gatesX + stageCardWidth + stageGap;
  const dispatchCenterX = dispatchX + 146;
  const dimensionsTopY = 214;
  const dimensionColumnWidth = 260;
  const dimensionColumns = Math.max(plan.dimensions.length, 1);
  const dimensionsGridWidth = (dimensionColumns - 1) * dimensionColumnWidth + 252;
  const dimensionsStartX = Math.round(Math.max(88, dispatchCenterX - dimensionsGridWidth / 2));
  const dimensionCardHeight = 208;
  const dimensionRowHeight = 248;
  const metricRowOffsetY = 24;
  const metricSpacingX = 248;
  const metricCardHeight = 184;
  const metricRowHeight = 196;
  const metricColumns = 6;
  const stageContentHeight = 124;
  const dimensionPositions = new Map<string, { x: number; y: number }>();

  nodes.push(
    buildNode("root", rootX, stageY, {
      kind: "root",
      title: "Entrix Fitness",
      subtitle: `${plan.dimensionCount} dimensions · ${plan.metricCount} metrics`,
      meta: [`tier ${plan.tier}`, `scope ${plan.scope}`, `${plan.hardGateCount} hard gates`],
    }),
    buildNode("filter", filterX, stageY, {
      kind: "stage",
      title: "Filter",
      subtitle: "Tier and scope decide which checks survive planning.",
      meta: [`tier <= ${plan.tier}`, `scope = ${plan.scope}`, `${plan.dimensionCount} dimensions`],
      status: "pass",
    }),
    buildNode("dispatch", dispatchX, stageY, {
      kind: "stage",
      title: "Dispatch",
      subtitle: "Metrics route to shell, graph, or sarif runners.",
      meta: [`shell ${plan.runnerCounts.shell}`, `graph ${plan.runnerCounts.graph}`, `sarif ${plan.runnerCounts.sarif}`],
      status: "pass",
    }),
    buildNode("gates", gatesX, stageY, {
      kind: "stage",
      title: "Gates",
      subtitle: "Hard-gated dimensions can stop the report path.",
      meta: [`${plan.hardGateCount} hard`, "blocked on failure"],
      status: plan.hardGateCount > 0 ? "blocked" : "pass",
    }),
    buildNode("report", reportX, stageY, {
      kind: "stage",
      title: "Report",
      subtitle: "Weighted dimension score and final state.",
      meta: ["weighted score", "thresholds", "final status"],
      status: "pass",
    }),
  );

  edges.push(
    {
      id: "root-filter",
      source: "root",
      target: "filter",
      type: "smoothstep",
      sourceHandle: "right",
      targetHandle: "left",
      style: buildEdgeStyle("flow"),
      markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
    },
    {
      id: "filter-dispatch",
      source: "filter",
      target: "dispatch",
      type: "smoothstep",
      sourceHandle: "right",
      targetHandle: "left",
      style: buildEdgeStyle("pass"),
      markerEnd: { type: MarkerType.ArrowClosed, color: "#059669" },
    },
    {
      id: "dispatch-gates",
      source: "dispatch",
      target: "gates",
      type: "smoothstep",
      sourceHandle: "right",
      targetHandle: "left",
      style: buildEdgeStyle(plan.hardGateCount > 0 ? "blocked" : "pass"),
      markerEnd: { type: MarkerType.ArrowClosed, color: plan.hardGateCount > 0 ? "#64748b" : "#059669" },
    },
    {
      id: "gates-report",
      source: "gates",
      target: "report",
      type: "smoothstep",
      sourceHandle: "right",
      targetHandle: "left",
      style: buildEdgeStyle(plan.hardGateCount > 0 ? "blocked" : "pass"),
      markerEnd: { type: MarkerType.ArrowClosed, color: plan.hardGateCount > 0 ? "#64748b" : "#059669" },
    },
  );

  let dimensionGridBottom = dimensionsTopY;
  const activeDimensionName = plan.dimensions.find((dimension) => expandedDimensions.has(dimension.name))?.name ?? null;

  plan.dimensions.forEach((dimension, dimensionIndex) => {
    const dimensionColumn = dimensionIndex % dimensionColumns;
    const dimensionRow = Math.floor(dimensionIndex / dimensionColumns);
    const dimensionX = Math.round(dimensionsStartX + dimensionColumn * dimensionColumnWidth);
    const dimensionY = dimensionsTopY + dimensionRow * dimensionRowHeight;
    const dimensionId = `dimension:${dimension.name}`;
    const expanded = expandedDimensions.has(dimension.name);
    const hasHardMetric = dimension.metrics.some((metric) => metric.hardGate);
    dimensionPositions.set(dimension.name, { x: dimensionX, y: dimensionY });

    nodes.push(buildNode(dimensionId, dimensionX, dimensionY, {
      kind: "dimension",
      title: dimension.name,
      subtitle: `${dimension.sourceFile} · ${dimension.thresholdPass}/${dimension.thresholdWarn}`,
      status: hasHardMetric ? "hard" : "pass",
      badgeText: `${dimension.thresholdPass}/${dimension.thresholdWarn}`,
      expanded,
      onToggle: () => {
        toggleDimension(dimension.name);
      },
    }));

    const dispatchEdgeStatus: EdgeStatus = dimension.name === activeDimensionName
      ? (hasHardMetric ? "hard" : "pass")
      : "flow";

    edges.push({
      id: `dispatch-${dimensionId}`,
      source: "dispatch",
      target: dimensionId,
      type: "smoothstep",
      sourceHandle: "bottom",
      targetHandle: "top",
      style: buildEdgeStyle(dispatchEdgeStatus),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: dispatchEdgeStatus === "hard" ? "#dc2626" : dispatchEdgeStatus === "pass" ? "#059669" : "#94a3b8",
      },
    });

    dimensionGridBottom = Math.max(dimensionGridBottom, dimensionY + dimensionCardHeight);
  });

  const activeDimension = plan.dimensions.find((dimension) => expandedDimensions.has(dimension.name)) ?? null;
  let contentBottom = dimensionGridBottom;

  if (activeDimension) {
    const dimensionId = `dimension:${activeDimension.name}`;
    const activeDimensionPosition = dimensionPositions.get(activeDimension.name) ?? { x: dimensionsStartX, y: dimensionsTopY };
    const activeDimensionCenterX = activeDimensionPosition.x + 126;
    const detailColumns = Math.min(metricColumns, Math.max(activeDimension.metrics.length, 1));
    const centeredMetricStartX = Math.round(Math.max(88, activeDimensionCenterX - ((detailColumns - 1) * metricSpacingX + 244) / 2));
    const detailLaneY = dimensionGridBottom + metricRowOffsetY;
    const metricsStartY = detailLaneY + 18;
    let metricGridBottom = metricsStartY;
    const metricRows = Math.max(1, Math.ceil(activeDimension.metrics.length / metricColumns));
    const detailLaneId = `lane:${activeDimension.name}`;
    const detailLaneX = Math.round(centeredMetricStartX - 40);
    const detailLaneWidth = Math.max(420, (detailColumns - 1) * metricSpacingX + 344);
    const detailLaneHeight = Math.max(224, 18 + (metricRows - 1) * metricRowHeight + metricCardHeight + 18);
    const activeDimensionHasHardMetric = activeDimension.metrics.some((metric) => metric.hardGate);
    const laneEntryOffsetPx = Math.round(Math.max(32, Math.min(detailLaneWidth - 32, activeDimensionCenterX - detailLaneX)));
    const laneExitOffsetPx = Math.round(Math.max(32, Math.min(detailLaneWidth - 32, activeDimensionCenterX - detailLaneX)));

    nodes.push(buildNode(detailLaneId, detailLaneX, detailLaneY, {
      kind: "lane",
      title: activeDimension.name,
      subtitle: "Expanded metrics for the selected dimension",
      frameWidth: detailLaneWidth,
      frameHeight: detailLaneHeight,
      entryOffsetPx: laneEntryOffsetPx,
      exitOffsetPx: laneExitOffsetPx,
    }));

    activeDimension.metrics.forEach((metric, metricIndex) => {
      const metricId = `${dimensionId}:metric:${metric.name}`;
      const metricColumn = metricIndex % metricColumns;
      const metricRow = Math.floor(metricIndex / metricColumns);
      const rowStartIndex = metricRow * metricColumns;
      const rowCount = Math.min(metricColumns, activeDimension.metrics.length - rowStartIndex);
      const rowStartX = Math.round(Math.max(88, activeDimensionCenterX - ((rowCount - 1) * metricSpacingX + 244) / 2));
      const metricX = Math.round(rowStartX + metricColumn * metricSpacingX);
      const metricY = metricsStartY + metricRow * metricRowHeight;
      const metricStatus: EdgeStatus = metric.hardGate ? "hard" : metric.gate === "warn" ? "warn" : "pass";

      nodes.push(buildNode(metricId, metricX, metricY, {
        kind: "metric",
        title: metric.name,
        subtitle: metric.description || undefined,
        meta: [metric.runner, metric.tier, metric.executionScope, metric.hardGate ? "hard gate" : metric.gate || "pass"],
        status: metricStatus,
      }));

      metricGridBottom = Math.max(metricGridBottom, metricY + metricCardHeight);
    });

    edges.push({
      id: `${dimensionId}-${detailLaneId}`,
      source: dimensionId,
      target: detailLaneId,
      type: "smoothstep",
      sourceHandle: "bottom",
      targetHandle: "entry",
      style: buildEdgeStyle(activeDimensionHasHardMetric ? "hard" : "pass"),
      markerEnd: { type: MarkerType.ArrowClosed, color: activeDimensionHasHardMetric ? "#dc2626" : "#059669" },
    });

    contentBottom = detailLaneY + detailLaneHeight;
  }

  return {
    nodes,
    edges,
    minHeight: Math.max(stageY + stageContentHeight + 32, contentBottom + 28),
  };
}

export function HarnessExecutionPlanFlow({
  loading,
  error,
  plan,
  repoLabel,
  selectedTier,
  onTierChange,
  unsupportedMessage,
  variant = "full",
  embedded = false,
}: HarnessExecutionPlanFlowProps) {
  const compactMode = variant === "compact";
  const [expandedState, setExpandedState] = useState<{
    planKey: string | null;
    names: Set<string>;
  }>({
    planKey: null,
    names: new Set(),
  });

  const planKey = useMemo(() => {
    if (!plan) {
      return null;
    }
    return `${plan.repoRoot}:${plan.tier}:${plan.scope}:${plan.generatedAt}`;
  }, [plan]);

  const defaultExpandedDimensions = useMemo(() => {
    if (!plan || compactMode) {
      return new Set<string>();
    }

    return new Set(plan.dimensions.slice(0, 1).map((dimension) => dimension.name));
  }, [compactMode, plan]);

  const expandedDimensions = useMemo(() => {
    if (!plan) {
      return new Set<string>();
    }
    if (expandedState.planKey === planKey) {
      return expandedState.names;
    }
    return defaultExpandedDimensions;
  }, [defaultExpandedDimensions, expandedState.names, expandedState.planKey, plan, planKey]);

  const graph = useMemo(() => {
    if (!plan) {
      return { nodes: [] as Node<PlanNodeData>[], edges: [] as Edge[], minHeight: variant === "compact" ? 520 : 660 };
    }

    return buildPlanGraph(plan, expandedDimensions, (name) => {
      setExpandedState({
        planKey,
        names: expandedDimensions.has(name) ? new Set<string>() : new Set([name]),
      });
    });
  }, [expandedDimensions, plan, planKey, variant]);

  const compactMinZoom = compactMode ? 0.18 : 0.58;
  const fitViewOptions = useMemo(
    () => ({
      padding: compactMode ? 0.12 : 0.055,
      minZoom: compactMode ? 0.18 : 0.58,
      maxZoom: compactMode ? 0.9 : 0.94,
    }),
    [compactMode],
  );
  const flowKey = `${variant}:${planKey ?? "empty"}:${[...expandedDimensions].sort().join("|")}`;

  const content = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!embedded ? (
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Entrix Fitness</div>
        ) : null}
        <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
          {repoLabel}
        </div>
        <div className="rounded-full border border-desktop-border bg-desktop-bg-primary p-0.5">
          {(["fast", "normal", "deep"] as const).map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => {
                onTierChange(tier);
              }}
              className={`rounded-full px-2.5 py-1 text-[10px] transition-colors ${
                selectedTier === tier
                  ? "bg-desktop-accent text-desktop-accent-text"
                  : "text-desktop-text-secondary hover:bg-desktop-bg-secondary"
              }`}
            >
              {tier}
            </button>
          ))}
        </div>
        {!compactMode ? (
          <button
            type="button"
            onClick={() => {
              if (!plan) {
                return;
              }
              setExpandedState((current) => {
                const base = current.planKey === planKey ? current.names : expandedDimensions;
                return {
                  planKey,
                  names: base.size > 0 ? new Set<string>() : new Set(plan.dimensions.slice(0, 1).map((dimension) => dimension.name)),
                };
              });
            }}
            className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary"
          >
            {expandedDimensions.size > 0 ? "Hide metrics" : "Show metrics"}
          </button>
        ) : null}
        {plan ? (
          <>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] text-emerald-700">pass = scoring path</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] text-amber-700">warn = degraded dimension</span>
            <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] text-red-700">hard = blocking gate</span>
            <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-[10px] text-slate-700">blocked = report can stop</span>
          </>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Building execution topology...
        </div>
      ) : null}

      {unsupportedMessage ? (
        <HarnessUnsupportedState />
      ) : null}

      {error && !unsupportedMessage ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-[11px] text-red-700">
          {error}
        </div>
      ) : null}

      {!unsupportedMessage && plan ? (
        <div className="mt-4">
          <div className="overflow-hidden rounded-2xl border border-desktop-border bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.08),transparent_28%)]">
            <div style={{ height: graph.minHeight }}>
              <ReactFlow
                key={flowKey}
                id={compactMode ? "harness-execution-plan-compact" : "harness-execution-plan-full"}
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={nodeTypes}
                nodesDraggable={!compactMode}
                nodesConnectable={false}
                elementsSelectable={!compactMode}
                zoomOnScroll
                panOnDrag
                minZoom={compactMinZoom}
                maxZoom={1.2}
                fitView
                fitViewOptions={fitViewOptions}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#d7dee7" gap={20} size={1} />
                <Controls
                  showInteractive={false}
                  showZoom
                  showFitView
                  fitViewOptions={fitViewOptions}
                  position="bottom-right"
                />
              </ReactFlow>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <section className={variant === "compact"
      ? "rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4"
      : "rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm"}
    >
      {content}
    </section>
  );
}
