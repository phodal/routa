import type { CSSProperties, JSX } from "react";
export type DiffStatsProps = {
    additions?: number;
    deletions?: number;
    style?: CSSProperties;
};
export declare function DiffStats({ additions, deletions, style, }: DiffStatsProps): JSX.Element | null;
export type DiffLineType = "added" | "removed" | "unchanged";
export type DiffLineData = {
    type: DiffLineType;
    content: string;
    lineNumber?: number;
};
export type DiffViewProps = {
    lines: DiffLineData[];
    path?: string;
    language?: string;
    showLineNumbers?: boolean;
    coloredLineNumbers?: boolean;
    showAccentStrip?: boolean;
    style?: CSSProperties;
};
export declare function DiffView({ lines, path, language, showLineNumbers, coloredLineNumbers, showAccentStrip, style, }: DiffViewProps): JSX.Element;
