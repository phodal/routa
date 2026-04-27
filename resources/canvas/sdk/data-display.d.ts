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
    stickyHeader?: boolean;
    style?: CSSProperties;
    emptyMessage?: ReactNode;
};
export declare function Table({ headers, rows, columnAlign, rowTone, framed, striped, stickyHeader, style, emptyMessage, }: TableProps): JSX.Element;
export type StatTone = "success" | "danger" | "warning" | "info";
export type StatProps = {
    value: ReactNode;
    label: string;
    tone?: StatTone;
    style?: CSSProperties;
};
export declare function Stat({ value, label, tone, style }: StatProps): JSX.Element;
export type PillTone = "neutral" | "added" | "deleted" | "renamed" | "success" | "warning" | "info";
export type PillSize = "sm" | "md";
export type PillProps = {
    children?: ReactNode;
    active?: boolean;
    tone?: PillTone;
    size?: PillSize;
    leadingContent?: ReactNode;
    keyboardHint?: string;
    disabled?: boolean;
    title?: string;
    style?: CSSProperties;
    onClick?: () => void;
};
export declare function Pill({ children, active, tone, size, leadingContent, keyboardHint, disabled, title, style, onClick, }: PillProps): JSX.Element;
export type CalloutTone = "info" | "success" | "warning" | "danger" | "neutral";
export type CalloutProps = {
    children?: ReactNode;
    tone?: CalloutTone;
    title?: ReactNode;
    icon?: ReactNode;
    style?: CSSProperties;
};
export declare function Callout({ children, tone, title, icon, style, }: CalloutProps): JSX.Element;
