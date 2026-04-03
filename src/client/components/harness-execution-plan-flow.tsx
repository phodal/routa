"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import { useTranslation } from "@/i18n";

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

type FitViewOptions = {
  padding: number;
  minZoom: number;
  maxZoom: number;
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

function getPlanNodeInitialSize(data: PlanNodeData) {
  switch (data.kind) {
    case "metric":
      return { width: 244, height: 184 };
    case "dimension":
      return { width: 252, height: 208 };
    case "lane":
      return { width: data.frameWidth ?? 640, height: data.frameHeight ?? 220 };
    case "anchor":
      return { width: 1, height: 1 };
    default:
      return { width: 292, height: 124 };
  }
}

function ExecutionPlanViewportController({
  flowId,
  layoutKey,
  fitViewOptions,
}: {
  flowId: string;
  layoutKey: string;
  fitViewOptions: FitViewOptions;
}) {
  const nodesInitialized = useNodesInitialized();
  const { fitView } = useReactFlow<Node<PlanNodeData>, Edge>();
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!nodesInitialized || typeof window === "undefined") {
      return;
    }

    const clearScheduledFitView = () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const runFitView = () => {
      void fitView(fitViewOptions);
    };

    const scheduleFitView = () => {
      clearScheduledFitView();
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = window.requestAnimationFrame(() => {
          runFitView();
        });
      });
      timeoutRef.current = window.setTimeout(runFitView, 160);
    };

    scheduleFitView();

    const flowElement = document.getElementById(flowId);
    if (typeof ResizeObserver === "undefined" || !flowElement) {
      return clearScheduledFitView;
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleFitView();
    });
    resizeObserver.observe(flowElement);

    return () => {
      resizeObserver.disconnect();
      clearScheduledFitView();
    };
  }, [fitView, fitViewOptions, flowId, layoutKey, nodesInitialized]);

  return null;
}

function getStatusTone(status: EdgeStatus | undefined) {
  switch (status) {
    case "hard":
      return {
        badge: "border-red-200 bg-red-50 text-red-700",
        border: "border-red-200",
        glow: "",
      };
    case "warn":
      return {
        badge: "border-amber-200 bg-amber-50 text-amber-700",
        border: "border-amber-200",
        glow: "",
      };
    case "pass":
      return {
        badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
        border: "border-emerald-200",
        glow: "",
      };
    case "blocked":
      return {
        badge: "border-slate-300 bg-slate-100 text-slate-700",
        border: "border-slate-300",
        glow: "",
      };
    default:
      return {
        badge: "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary",
        border: "border-desktop-border",
        glow: "",
      };
  }
}

function PlanNodeView({ data }: NodeProps<Node<PlanNodeData>>) {
  const { t } = useTranslation();
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
        className="rounded-sm border border-desktop-border bg-desktop-bg-primary/40 px-3 py-1.5"
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
        className={`${widthClass} ${heightClass} ${contentPaddingClass} flex flex-col overflow-hidden rounded-sm border bg-desktop-bg-primary text-left transition ${tone.border} ${tone.glow} ${interactive ? "cursor-pointer hover:bg-desktop-bg-secondary/90" : "cursor-default"}`}
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
            {data.expanded ? t.harness.executionPlan.clickToCollapseMetrics : t.harness.executionPlan.clickToExpandMetrics}
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
  const size = getPlanNodeInitialSize(data);
  return {
    id,
    type: "plan",
    position: { x, y },
    data,
    initialWidth: size.width,
    initialHeight: size.height,
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
  t: ReturnType<typeof useTranslation>["t"],
): { nodes: Node<PlanNodeData>[]; edges: Edge[]; minHeight: number } {
  const dimensions = plan.dimensions ?? [];
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
  const dimensionColumns = Math.max(dimensions.length, 1);
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
      title: t.settings.harness.entrixFitness,
      subtitle: t.harness.executionPlan.dimensionsAndMetricsSubtitle
        .replace("{dimensionCount}", String(plan.dimensionCount))
        .replace("{metricCount}", String(plan.metricCount)),
      meta: [
        t.harness.executionPlan.tierLabel.replace("{tier}", plan.tier),
        t.harness.executionPlan.scopeLabel.replace("{scope}", plan.scope),
        t.harness.executionPlan.hardGatesCount.replace("{count}", String(plan.hardGateCount)),
      ],
    }),
    buildNode("filter", filterX, stageY, {
      kind: "stage",
      title: t.harness.executionPlan.filter,
      subtitle: t.harness.executionPlan.filterSubtitle,
      meta: [
        t.harness.executionPlan.tierLessThan.replace("{tier}", plan.tier),
        t.harness.executionPlan.scopeEquals.replace("{scope}", plan.scope),
        t.harness.executionPlan.dimensionCount.replace("{count}", String(plan.dimensionCount)),
      ],
      status: "pass",
    }),
    buildNode("dispatch", dispatchX, stageY, {
      kind: "stage",
      title: t.harness.executionPlan.dispatch,
      subtitle: t.harness.executionPlan.dispatchSubtitle,
      meta: [
        t.harness.executionPlan.shellCount.replace("{count}", String(plan.runnerCounts.shell)),
        t.harness.executionPlan.graphCount.replace("{count}", String(plan.runnerCounts.graph)),
        t.harness.executionPlan.sarifCount.replace("{count}", String(plan.runnerCounts.sarif)),
      ],
      status: "pass",
    }),
    buildNode("gates", gatesX, stageY, {
      kind: "stage",
      title: t.harness.executionPlan.gates,
      subtitle: t.harness.executionPlan.gatesSubtitle,
      meta: [
        t.harness.executionPlan.hardCount.replace("{count}", String(plan.hardGateCount)),
        t.harness.executionPlan.blockedOnFailure,
      ],
      status: plan.hardGateCount > 0 ? "blocked" : "pass",
    }),
    buildNode("report", reportX, stageY, {
      kind: "stage",
      title: t.harness.executionPlan.report,
      subtitle: t.harness.executionPlan.reportSubtitle,
      meta: [t.harness.executionPlan.weightedScore, t.harness.executionPlan.thresholds, t.harness.executionPlan.finalStatus],
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
  const activeDimensionName = dimensions.find((dimension) => expandedDimensions.has(dimension.name))?.name ?? null;

  dimensions.forEach((dimension, dimensionIndex) => {
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
      subtitle: dimension.sourceFile,
      status: hasHardMetric ? "hard" : "pass",
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

  const activeDimension = dimensions.find((dimension) => expandedDimensions.has(dimension.name)) ?? null;
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
      subtitle: t.harness.executionPlan.expandedMetricsSubtitle,
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
        meta: [metric.runner, metric.tier, metric.executionScope, metric.hardGate ? t.harness.executionPlan.hardGate : metric.gate || t.harness.executionPlan.passLabel],
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
  repoLabel: _repoLabel,
  selectedTier,
  onTierChange,
  unsupportedMessage,
  variant = "full",
  embedded = false,
}: HarnessExecutionPlanFlowProps) {
  const { t } = useTranslation();
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

    return new Set((plan.dimensions ?? []).slice(0, 1).map((dimension) => dimension.name));
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
    }, t);
  }, [expandedDimensions, plan, planKey, t, variant]);

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
  const flowId = `harness-execution-plan-${flowKey.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;

  const content = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!embedded ? (
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">{t.settings.harness.entrixFitness}</div>
        ) : null}
        <div className="rounded-full border border-desktop-border bg-desktop-bg-primary p-0.5">
          {(["fast", "normal", "deep"] as const).map((tier) => {
            const tierLabels: Record<string, string> = {
              fast: t.harness.executionPlan.tierFast,
              normal: t.harness.executionPlan.tierNormal,
              deep: t.harness.executionPlan.tierDeep,
            };
            return (
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
                {tierLabels[tier] || tier}
              </button>
            );
          })}
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
                  names: base.size > 0 ? new Set<string>() : new Set((plan.dimensions ?? []).slice(0, 1).map((dimension) => dimension.name)),
                };
              });
            }}
            className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary"
          >
            {expandedDimensions.size > 0 ? t.harness.executionPlan.hideMetrics : t.harness.executionPlan.showMetrics}
          </button>
        ) : null}
        {plan ? (
          <>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] text-emerald-700">{t.harness.executionPlan.legendPass}</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] text-amber-700">{t.harness.executionPlan.legendWarn}</span>
            <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] text-red-700">{t.harness.executionPlan.legendHard}</span>
            <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-[10px] text-slate-700">{t.harness.executionPlan.legendBlocked}</span>
          </>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-5 text-[11px] text-desktop-text-secondary">
          {t.harness.executionPlan.buildingTopology}
        </div>
      ) : null}

      {unsupportedMessage ? (
        <HarnessUnsupportedState />
      ) : null}

      {error && !unsupportedMessage ? (
        <div className="mt-4 rounded-sm border border-red-200 bg-red-50 px-4 py-5 text-[11px] text-red-700">
          {error}
        </div>
      ) : null}

      {!unsupportedMessage && plan ? (
        <div className="mt-4">
          <div className="overflow-hidden rounded-sm border border-desktop-border bg-desktop-bg-primary">
            <div style={{ height: graph.minHeight }}>
              <ReactFlow
                key={flowKey}
                id={flowId}
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
                fitViewOptions={fitViewOptions}
                proOptions={{ hideAttribution: true }}
              >
                <ExecutionPlanViewportController
                  flowId={flowId}
                  layoutKey={flowKey}
                  fitViewOptions={fitViewOptions}
                />
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
      ? "rounded-sm border border-desktop-border bg-desktop-bg-primary/60 p-4"
      : "rounded-sm border border-desktop-border bg-desktop-bg-secondary/40 p-4"}
    >
      {content}
    </section>
  );
}
