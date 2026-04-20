"use client";

import React from "react";
import type { GitCommit, GraphEdge } from "./types";

interface CommitGraphCellProps {
  commit: GitCommit;
  /** Total number of lanes visible */
  totalLanes: number;
}

const LANE_WIDTH = 14;
const NODE_RADIUS = 3;
const CELL_HEIGHT = 24;

const LANE_COLORS = [
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#ef4444", // red
  "#06b6d4", // cyan
  "#f97316", // orange
  "#ec4899", // pink
];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

export function CommitGraphCell({ commit, totalLanes }: CommitGraphCellProps) {
  const lane = commit.lane ?? 0;
  const edges = commit.graphEdges ?? [];
  const width = Math.max(2, totalLanes) * LANE_WIDTH + 4;
  const cx = lane * LANE_WIDTH + LANE_WIDTH / 2 + 2;
  const cy = CELL_HEIGHT / 2;

  return (
    <svg
      width={width}
      height={CELL_HEIGHT}
      className="shrink-0"
      style={{ minWidth: width }}
    >
      {/* Vertical lane lines (faint background) */}
      {Array.from({ length: Math.max(2, totalLanes) }, (_, i) => (
        <line
          key={`lane-bg-${i}`}
          x1={i * LANE_WIDTH + LANE_WIDTH / 2 + 2}
          y1={0}
          x2={i * LANE_WIDTH + LANE_WIDTH / 2 + 2}
          y2={CELL_HEIGHT}
          stroke={laneColor(i)}
          strokeWidth={1}
          opacity={0.15}
        />
      ))}

      {/* Edges */}
      {edges.map((edge: GraphEdge, i: number) => {
        const x1 = edge.fromLane * LANE_WIDTH + LANE_WIDTH / 2 + 2;
        const x2 = edge.toLane * LANE_WIDTH + LANE_WIDTH / 2 + 2;
        const color = laneColor(edge.fromLane);

        if (x1 === x2) {
          // Straight line
          return (
            <line
              key={`edge-${i}`}
              x1={x1}
              y1={0}
              x2={x2}
              y2={CELL_HEIGHT}
              stroke={color}
              strokeWidth={1.5}
              opacity={0.6}
            />
          );
        }

        // Curved merge/branch line
        return (
          <path
            key={`edge-${i}`}
            d={`M ${x1} 0 C ${x1} ${CELL_HEIGHT * 0.4}, ${x2} ${CELL_HEIGHT * 0.6}, ${x2} ${CELL_HEIGHT}`}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            opacity={0.6}
          />
        );
      })}

      {/* Commit node */}
      <circle
        cx={cx}
        cy={cy}
        r={NODE_RADIUS}
        fill={laneColor(lane)}
        stroke="white"
        strokeWidth={1.5}
      />

      {/* Merge indicator: double circle */}
      {commit.parents.length > 1 && (
        <circle
          cx={cx}
          cy={cy}
          r={NODE_RADIUS + 2}
          fill="none"
          stroke={laneColor(lane)}
          strokeWidth={1}
          opacity={0.5}
        />
      )}
    </svg>
  );
}
