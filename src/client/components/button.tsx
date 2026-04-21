"use client";

import React, { ButtonHTMLAttributes, forwardRef } from "react";
import { LoaderCircle } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "desktop-secondary" | "desktop-accent";
type ButtonSize = "xs" | "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading, disabled, className = "", children, ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

    const variantStyles: Record<ButtonVariant, string> = {
      primary:
        "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 dark:bg-blue-500 dark:hover:bg-blue-600",
      secondary:
        "bg-white text-slate-700 border border-slate-200 hover:border-blue-200 hover:bg-blue-50 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:border-blue-700 dark:hover:bg-blue-950/20 focus:ring-blue-500",
      ghost:
        "bg-transparent text-slate-600 hover:bg-blue-50 hover:text-blue-700 dark:text-slate-300 dark:hover:bg-blue-950/20 dark:hover:text-blue-300 focus:ring-blue-500",
      danger:
        "border border-transparent bg-[var(--danger-solid)] text-[var(--danger-on-solid)] hover:bg-[var(--danger-solid-hover)] focus:ring-[var(--danger-ring)]",
      "desktop-secondary":
        "border border-transparent bg-desktop-bg-secondary text-desktop-text-secondary hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary focus:ring-[var(--dt-accent)]",
      "desktop-accent":
        "border border-transparent bg-desktop-accent text-desktop-accent-text hover:bg-desktop-accent-strong focus:ring-[var(--dt-accent)]",
    };

    const sizeStyles: Record<ButtonSize, string> = {
      xs: "px-2 py-1 text-xs",
      sm: "px-3 py-1.5 text-sm",
      md: "px-4 py-2 text-sm",
      lg: "px-6 py-3 text-base",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        {...props}
      >
        {loading && (
          <LoaderCircle className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
