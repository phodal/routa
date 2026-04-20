import type { CSSProperties, JSX } from "react";
export type BarChartEntry = {
    label: string;
    value: number;
    color?: string;
};
export type BarChartProps = {
    data: BarChartEntry[];
    /** Chart height in px. Default 360. */
    height?: number;
    style?: CSSProperties;
};
export declare function BarChart({ data, height, style, }: BarChartProps): JSX.Element;
export type PieChartEntry = {
    label: string;
    value: number;
    color?: string;
};
export type PieChartProps = {
    data: PieChartEntry[];
    /** Diameter in px. Default 260. */
    size?: number;
    style?: CSSProperties;
};
export declare function PieChart({ data, size, style, }: PieChartProps): JSX.Element;
