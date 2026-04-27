import type { CSSProperties, ReactNode, JSX } from "react";
export declare function mergeStyle(base: CSSProperties, override?: CSSProperties): CSSProperties;
export type StackProps = {
    children?: ReactNode;
    gap?: number;
    style?: CSSProperties;
};
export declare function Stack({ children, gap, style }: StackProps): JSX.Element;
export type RowProps = {
    children?: ReactNode;
    gap?: number;
    align?: "start" | "center" | "end" | "stretch";
    justify?: "start" | "center" | "end" | "space-between";
    wrap?: boolean;
    style?: CSSProperties;
};
export declare function Row({ children, gap, align, justify, wrap, style, }: RowProps): JSX.Element;
export type GridProps = {
    children?: ReactNode;
    columns: number | string;
    gap?: number;
    align?: "start" | "center" | "end" | "stretch";
    style?: CSSProperties;
};
export declare function Grid({ children, columns, gap, align, style, }: GridProps): JSX.Element;
export type DividerProps = {
    style?: CSSProperties;
};
export declare function Divider({ style }: DividerProps): JSX.Element;
export declare function Spacer(): JSX.Element;
export type TextWeight = "normal" | "medium" | "semibold" | "bold";
export type TextProps = {
    children?: ReactNode;
    tone?: "primary" | "secondary" | "tertiary" | "quaternary";
    size?: "body" | "small";
    as?: "p" | "span";
    weight?: TextWeight;
    italic?: boolean;
    truncate?: boolean | "start" | "end";
    style?: CSSProperties;
};
export declare function Text({ children, tone, size, as, weight, italic, truncate, style, }: TextProps): JSX.Element;
export type H1Props = {
    children?: ReactNode;
    style?: CSSProperties;
};
export declare function H1({ children, style }: H1Props): JSX.Element;
export type H2Props = {
    children?: ReactNode;
    style?: CSSProperties;
};
export declare function H2({ children, style }: H2Props): JSX.Element;
export type H3Props = {
    children?: ReactNode;
    style?: CSSProperties;
};
export declare function H3({ children, style }: H3Props): JSX.Element;
export type CodeProps = {
    children?: ReactNode;
    style?: CSSProperties;
};
export declare function Code({ children, style }: CodeProps): JSX.Element;
export type LinkProps = {
    children?: ReactNode;
    href: string;
    style?: CSSProperties;
};
export declare function Link({ children, href, style }: LinkProps): JSX.Element;
