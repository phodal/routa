import type { CSSProperties, JSX } from "react";
export type ChartTone = "success" | "danger" | "warning" | "info" | "neutral";
export type ChartDataPoint = {
    label: string;
    value: number;
};
export type ChartSeries = {
    name: string;
    data: number[];
    tone?: ChartTone;
};
export type BarChartEntry = {
    label: string;
    value: number;
    color?: string;
};
export type BarChartProps = {
    categories?: string[];
    series?: ChartSeries[];
    data?: BarChartEntry[];
    height?: number;
    stacked?: boolean;
    horizontal?: boolean;
    normalized?: boolean;
    valueSuffix?: string;
    style?: CSSProperties;
};
export declare function BarChart(props: BarChartProps): JSX.Element;
export type LineChartProps = {
    categories: string[];
    series: ChartSeries[];
    height?: number;
    fill?: boolean;
    valueSuffix?: string;
    style?: CSSProperties;
};
export declare function LineChart({ categories, series, height, fill, valueSuffix, style, }: LineChartProps): JSX.Element;
export type PieChartEntry = ChartDataPoint & {
    color?: string;
    tone?: ChartTone;
};
export type PieChartProps = {
    data: PieChartEntry[];
    size?: number;
    donut?: boolean;
    style?: CSSProperties;
};
export declare function PieChart({ data, size, donut, style, }: PieChartProps): JSX.Element;
