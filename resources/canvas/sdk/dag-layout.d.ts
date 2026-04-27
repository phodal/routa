export type DAGLayoutOptions = {
    nodes: Array<{
        id: string;
    }>;
    edges: Array<{
        from: string;
        to: string;
    }>;
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
export declare function computeDAGLayout(options: DAGLayoutOptions): DAGLayoutResult;
