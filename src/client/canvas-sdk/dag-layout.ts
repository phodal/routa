export type DAGLayoutOptions = {
  nodes: Array<{ id: string }>;
  edges: Array<{ from: string; to: string }>;
  direction?: "vertical" | "horizontal";
  nodeWidth?: number;
  nodeHeight?: number;
  rankGap?: number;
  nodeGap?: number;
  padding?: number;
};

export type DAGLayoutNode = {
  id: string;
  x: number;
  y: number;
  rank: number;
  order: number;
};

export type DAGLayoutEdge = {
  from: string;
  to: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  isBackEdge: boolean;
};

export type DAGLayoutRank = {
  rank: number;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeIds: string[];
};

export type DAGLayoutResult = {
  nodes: DAGLayoutNode[];
  edges: DAGLayoutEdge[];
  ranks: DAGLayoutRank[];
  direction: "vertical" | "horizontal";
  width: number;
  height: number;
};

type Edge = { from: string; to: string };

const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 40;
const DEFAULT_RANK_GAP = 64;
const DEFAULT_NODE_GAP = 48;
const DEFAULT_PADDING = 24;

function edgeKey(edge: Edge): string {
  return `${edge.from}\u0000${edge.to}`;
}

function uniqueNodes(nodes: Array<{ id: string }>): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const node of nodes) {
    if (!node.id || seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    ids.push(node.id);
  }
  return ids;
}

function normalizeEdges(edges: Edge[], ids: Set<string>): Edge[] {
  return edges.filter((edge) =>
    edge.from
    && edge.to
    && ids.has(edge.from)
    && ids.has(edge.to)
    && edge.from !== edge.to
  );
}

function detectBackEdges(nodeIds: string[], edges: Edge[]): Set<string> {
  const outgoing = new Map<string, Edge[]>();
  for (const id of nodeIds) {
    outgoing.set(id, []);
  }
  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const backEdges = new Set<string>();

  function visit(id: string): void {
    visiting.add(id);
    for (const edge of outgoing.get(id) ?? []) {
      if (visiting.has(edge.to)) {
        backEdges.add(edgeKey(edge));
        continue;
      }
      if (!visited.has(edge.to)) {
        visit(edge.to);
      }
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) {
      visit(id);
    }
  }

  return backEdges;
}

function buildRanks(nodeIds: string[], edges: Edge[], backEdges: Set<string>): Map<string, number> {
  const rank = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const incomingCount = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map(nodeIds.map((id) => [id, [] as Edge[]] as const));
  const acyclicEdges = edges.filter((edge) => !backEdges.has(edgeKey(edge)));

  for (const edge of acyclicEdges) {
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge);
  }

  const queue = nodeIds.filter((id) => (incomingCount.get(id) ?? 0) === 0);
  const processed = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    processed.add(id);
    const sourceRank = rank.get(id) ?? 0;
    for (const edge of outgoing.get(id) ?? []) {
      rank.set(edge.to, Math.max(rank.get(edge.to) ?? 0, sourceRank + 1));
      const nextCount = (incomingCount.get(edge.to) ?? 0) - 1;
      incomingCount.set(edge.to, nextCount);
      if (nextCount === 0) {
        queue.push(edge.to);
      }
    }
  }

  for (const id of nodeIds) {
    if (!processed.has(id)) {
      rank.set(id, 0);
    }
  }

  return rank;
}

export function computeDAGLayout(options: DAGLayoutOptions): DAGLayoutResult {
  const direction = options.direction ?? "vertical";
  const nodeWidth = options.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const nodeHeight = options.nodeHeight ?? DEFAULT_NODE_HEIGHT;
  const rankGap = options.rankGap ?? DEFAULT_RANK_GAP;
  const nodeGap = options.nodeGap ?? DEFAULT_NODE_GAP;
  const padding = options.padding ?? DEFAULT_PADDING;
  const nodeIds = uniqueNodes(options.nodes);
  const nodeIdSet = new Set(nodeIds);
  const edges = normalizeEdges(options.edges, nodeIdSet);
  const backEdges = detectBackEdges(nodeIds, edges);
  const ranksByNode = buildRanks(nodeIds, edges, backEdges);
  const rankBuckets = new Map<number, string[]>();

  for (const id of nodeIds) {
    const rank = ranksByNode.get(id) ?? 0;
    const bucket = rankBuckets.get(rank) ?? [];
    bucket.push(id);
    rankBuckets.set(rank, bucket);
  }

  const sortedRanks = Array.from(rankBuckets.entries())
    .sort(([left], [right]) => left - right);
  const maxNodesInRank = Math.max(1, ...sortedRanks.map(([, ids]) => ids.length));
  const maxRankWidth = maxNodesInRank * nodeWidth + (maxNodesInRank - 1) * nodeGap;
  const maxRankHeight = maxNodesInRank * nodeHeight + (maxNodesInRank - 1) * nodeGap;
  const rankCount = Math.max(1, sortedRanks.length);
  const totalWidth = direction === "vertical"
    ? maxRankWidth + padding * 2
    : rankCount * nodeWidth + (rankCount - 1) * rankGap + padding * 2;
  const totalHeight = direction === "vertical"
    ? rankCount * nodeHeight + (rankCount - 1) * rankGap + padding * 2
    : maxRankHeight + padding * 2;

  const layoutNodes: DAGLayoutNode[] = [];
  const layoutRanks: DAGLayoutRank[] = [];

  sortedRanks.forEach(([rank, ids], rankIndex) => {
    const laneSize = direction === "vertical"
      ? ids.length * nodeWidth + (ids.length - 1) * nodeGap
      : ids.length * nodeHeight + (ids.length - 1) * nodeGap;

    const rankX = direction === "vertical"
      ? padding + (maxRankWidth - laneSize) / 2
      : padding + rankIndex * (nodeWidth + rankGap);
    const rankY = direction === "vertical"
      ? padding + rankIndex * (nodeHeight + rankGap)
      : padding + (maxRankHeight - laneSize) / 2;

    ids.forEach((id, order) => {
      layoutNodes.push({
        id,
        rank,
        order,
        x: direction === "vertical" ? rankX + order * (nodeWidth + nodeGap) : rankX,
        y: direction === "vertical" ? rankY : rankY + order * (nodeHeight + nodeGap),
      });
    });

    layoutRanks.push({
      rank,
      x: rankX,
      y: rankY,
      width: direction === "vertical" ? laneSize : nodeWidth,
      height: direction === "vertical" ? nodeHeight : laneSize,
      nodeIds: [...ids],
    });
  });

  const byId = new Map(layoutNodes.map((node) => [node.id, node] as const));
  const layoutEdges = edges.map((edge): DAGLayoutEdge => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      return {
        from: edge.from,
        to: edge.to,
        sourceX: 0,
        sourceY: 0,
        targetX: 0,
        targetY: 0,
        isBackEdge: backEdges.has(edgeKey(edge)),
      };
    }

    return {
      from: edge.from,
      to: edge.to,
      sourceX: direction === "vertical" ? from.x + nodeWidth / 2 : from.x + nodeWidth,
      sourceY: direction === "vertical" ? from.y + nodeHeight : from.y + nodeHeight / 2,
      targetX: direction === "vertical" ? to.x + nodeWidth / 2 : to.x,
      targetY: direction === "vertical" ? to.y : to.y + nodeHeight / 2,
      isBackEdge: backEdges.has(edgeKey(edge)),
    };
  });

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    ranks: layoutRanks,
    direction,
    width: totalWidth,
    height: totalHeight,
  };
}
