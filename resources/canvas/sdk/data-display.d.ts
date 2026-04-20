import type { CSSProperties, ReactNode, JSX } from "react";
export type TableColumnAlign = "left" | "center" | "right";
export type TableRowTone = "success" | "danger" | "warning" | "info" | "neutral";
export type TableProps = {
    headers: ReactNode[];
    rows: ReactNode[][];
    columnAlign?: Array<TableColumnAlign | undefined>;
    rowTone?: Array<TableRowTone | undefined>;
    framed?: boolean;
    striped?: boolean;
    style?: CSSProperties;
    emptyMessage?: ReactNode;
};
export declare function Table({ headers, rows, columnAlign, rowTone, framed, striped, style, emptyMessage, }: TableProps): JSX.Element;
export type StatTone = "success" | "danger" | "warning" | "info";
export type StatProps = {
    value: ReactNode;
    label: string;
    tone?: StatTone;
    style?: CSSProperties;
};
export declare function Stat({ value, label, tone, style }: StatProps): JSX.Element;
export type PillTone = "neutral" | "added" | "deleted" | "renamed" | "success" | "warning" | "info";
export type PillProps = {
    children?: ReactNode;
    active?: boolean;
    tone?: PillTone;
    style?: CSSProperties;
    onClick?: () => void;
};
export declare function Pill({ children, active, tone, style, onClick, }: PillProps): JSX.Element;
