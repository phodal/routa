import { type CSSProperties, type ReactNode, type JSX } from "react";
export type CardSize = "base" | "lg";
export type CardVariant = "default" | "borderless";
export type CardProps = {
    children?: ReactNode;
    variant?: CardVariant;
    size?: CardSize;
    stickyHeader?: boolean;
    collapsible?: boolean;
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    style?: CSSProperties;
};
export declare function Card({ children, variant, size, stickyHeader, collapsible, defaultOpen, open: controlledOpen, onOpenChange, style, }: CardProps): JSX.Element;
export type CardHeaderProps = {
    children?: ReactNode;
    trailing?: ReactNode;
    style?: CSSProperties;
};
export declare function CardHeader({ children, trailing, style, }: CardHeaderProps): JSX.Element;
export type CardBodyProps = {
    children?: ReactNode;
    style?: CSSProperties;
};
export declare function CardBody({ children, style }: CardBodyProps): JSX.Element | null;
