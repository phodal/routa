import type { CSSProperties, ReactNode, JSX } from "react";
export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonProps = {
    children?: ReactNode;
    variant?: ButtonVariant;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
    style?: CSSProperties;
    onClick?: () => void;
};
export declare function Button({ children, variant, disabled, type, style, onClick, }: ButtonProps): JSX.Element;
export type TextInputProps = {
    value?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    type?: "text" | "email" | "password" | "number" | "url" | "search";
    style?: CSSProperties;
};
export declare function TextInput({ value, onChange, placeholder, disabled, type, style, }: TextInputProps): JSX.Element;
export type TextAreaProps = {
    value?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    rows?: number;
    style?: CSSProperties;
};
export declare function TextArea({ value, onChange, placeholder, disabled, rows, style, }: TextAreaProps): JSX.Element;
export type CheckboxProps = {
    checked?: boolean;
    onChange?: (checked: boolean) => void;
    disabled?: boolean;
    label?: ReactNode;
    style?: CSSProperties;
};
export declare function Checkbox({ checked, onChange, disabled, label, style, }: CheckboxProps): JSX.Element;
export type ToggleProps = {
    checked?: boolean;
    onChange?: (checked: boolean) => void;
    disabled?: boolean;
    size?: "sm" | "md";
    style?: CSSProperties;
};
export declare function Toggle({ checked, onChange, disabled, size, style, }: ToggleProps): JSX.Element;
export type SelectOption = {
    value: string;
    label: string;
    disabled?: boolean;
};
export type SelectProps = {
    value?: string;
    onChange?: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    style?: CSSProperties;
};
export declare function Select({ value, onChange, options, placeholder, disabled, style, }: SelectProps): JSX.Element;
export type IconButtonProps = {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    variant?: "default" | "circle";
    size?: "sm" | "md";
    style?: CSSProperties;
};
export declare function IconButton({ children, onClick, disabled, title, variant, size, style, }: IconButtonProps): JSX.Element;
