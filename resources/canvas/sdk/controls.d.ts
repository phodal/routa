import type { CSSProperties, ReactNode, JSX } from "react";
export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonProps = {
    children?: ReactNode;
    variant?: ButtonVariant;
    disabled?: boolean;
    style?: CSSProperties;
    onClick?: () => void;
};
export declare function Button({ children, variant, disabled, style, onClick, }: ButtonProps): JSX.Element;
