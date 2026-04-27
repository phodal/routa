"use client";

import { useLayoutEffect, useRef } from "react";
import type {
  ChangeEvent,
  CSSProperties,
  ReactNode,
  JSX,
} from "react";

import { useHostTheme } from "./theme-context";
import { canvasRadius } from "./tokens";
import { mergeStyle } from "./primitives";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = {
  children?: ReactNode;
  variant?: ButtonVariant;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  style?: CSSProperties;
  onClick?: () => void;
};

export function Button({
  children,
  variant = "secondary",
  disabled,
  type = "button",
  style,
  onClick,
}: ButtonProps): JSX.Element {
  const { tokens } = useHostTheme();

  const variantStyles: Record<ButtonVariant, CSSProperties> = {
    primary: {
      background: tokens.accent.control,
      color: tokens.text.onAccent,
      border: "none",
    },
    secondary: {
      background: "transparent",
      color: tokens.text.secondary,
      border: `1px solid ${tokens.stroke.secondary}`,
    },
    ghost: {
      background: "transparent",
      color: tokens.text.secondary,
      border: "none",
    },
  };

  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: "24px",
    padding: "0 8px",
    borderRadius: `${canvasRadius.sm}px`,
    fontSize: "12px",
    lineHeight: "16px",
    fontWeight: 500,
    fontFamily: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
    gap: 4,
    ...variantStyles[variant],
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={mergeStyle(base, style)}
    >
      {children}
    </button>
  );
}

function controlBaseStyle(
  tokens: ReturnType<typeof useHostTheme>["tokens"],
): CSSProperties {
  return {
    boxSizing: "border-box",
    minWidth: 0,
    height: "28px",
    border: `1px solid ${tokens.stroke.secondary}`,
    borderRadius: `${canvasRadius.sm}px`,
    background: tokens.bg.editor,
    color: tokens.text.primary,
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "18px",
    outline: "none",
  };
}

export type TextInputProps = {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: "text" | "email" | "password" | "number" | "url" | "search";
  style?: CSSProperties;
};

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  type = "text",
  style,
}: TextInputProps): JSX.Element {
  const { tokens } = useHostTheme();
  return (
    <input
      type={type}
      value={value ?? ""}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        onChange?.(event.target.value)
      }
      style={mergeStyle(
        {
          ...controlBaseStyle(tokens),
          width: "100%",
          padding: "0 8px",
          opacity: disabled ? 0.5 : 1,
        },
        style,
      )}
    />
  );
}

export type TextAreaProps = {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  style?: CSSProperties;
};

export function TextArea({
  value,
  onChange,
  placeholder,
  disabled,
  rows = 3,
  style,
}: TextAreaProps): JSX.Element {
  const { tokens } = useHostTheme();
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || style?.height) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [style?.height, value]);

  return (
    <textarea
      ref={ref}
      value={value ?? ""}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
        onChange?.(event.target.value)
      }
      style={mergeStyle(
        {
          ...controlBaseStyle(tokens),
          width: "100%",
          minHeight: `${rows * 20 + 14}px`,
          height: "auto",
          padding: "6px 8px",
          resize: "vertical",
          opacity: disabled ? 0.5 : 1,
        },
        style,
      )}
    />
  );
}

export type CheckboxProps = {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  style?: CSSProperties;
};

export function Checkbox({
  checked,
  onChange,
  disabled,
  label,
  style,
}: CheckboxProps): JSX.Element {
  const { tokens } = useHostTheme();
  return (
    <label
      style={mergeStyle(
        {
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          color: tokens.text.secondary,
          fontSize: "13px",
          lineHeight: "18px",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        },
        style,
      )}
    >
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onChange?.(event.target.checked)
        }
        style={{ accentColor: tokens.accent.control }}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

export type ToggleProps = {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  style?: CSSProperties;
};

export function Toggle({
  checked,
  onChange,
  disabled,
  size = "sm",
  style,
}: ToggleProps): JSX.Element {
  const { tokens } = useHostTheme();
  const height = size === "md" ? 20 : 16;
  const width = size === "md" ? 36 : 30;
  const knob = height - 4;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      disabled={disabled}
      onClick={disabled ? undefined : () => onChange?.(!checked)}
      style={mergeStyle(
        {
          position: "relative",
          width,
          height,
          border: "none",
          borderRadius: canvasRadius.full,
          background: checked ? tokens.accent.control : tokens.fill.primary,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          padding: 0,
        },
        style,
      )}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? width - knob - 2 : 2,
          width: knob,
          height: knob,
          borderRadius: canvasRadius.full,
          background: tokens.text.onAccent,
          transition: "left 120ms ease",
        }}
      />
    </button>
  );
}

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

export function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  style,
}: SelectProps): JSX.Element {
  const { tokens } = useHostTheme();
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
        onChange?.(event.target.value)
      }
      style={mergeStyle(
        {
          ...controlBaseStyle(tokens),
          width: "100%",
          padding: "0 28px 0 8px",
          opacity: disabled ? 0.5 : 1,
        },
        style,
      )}
    >
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options.map((option) => (
        <option
          key={option.value}
          value={option.value}
          disabled={option.disabled}
        >
          {option.label}
        </option>
      ))}
    </select>
  );
}

export type IconButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  variant?: "default" | "circle";
  size?: "sm" | "md";
  style?: CSSProperties;
};

export function IconButton({
  children,
  onClick,
  disabled,
  title,
  variant = "default",
  size = "md",
  style,
}: IconButtonProps): JSX.Element {
  const { tokens } = useHostTheme();
  const dimension = size === "sm" ? 16 : 20;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={mergeStyle(
        {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: dimension,
          height: dimension,
          padding: 0,
          border: "none",
          borderRadius: canvasRadius.full,
          background:
            variant === "circle" ? tokens.fill.tertiary : "transparent",
          color: tokens.text.secondary,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        },
        style,
      )}
    >
      {children}
    </button>
  );
}
