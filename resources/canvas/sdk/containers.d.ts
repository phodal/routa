import { type CSSProperties, type ReactNode, type JSX } from "react";
export type CardProps = {
    children?: ReactNode;
    collapsible?: boolean;
    defaultOpen?: boolean;
    style?: CSSProperties;
};
export declare function Card({ children, collapsible, defaultOpen, style, }: CardProps): JSX.Element;
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
export declare function CardBody({ children, style }: CardBodyProps): JSX.Element;
