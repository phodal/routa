import { type ReactNode } from "react";
import { type CanvasTheme } from "./tokens";
export type CanvasHostTheme = CanvasTheme;
export declare function CanvasThemeProvider({ theme, children, }: {
    theme: CanvasTheme;
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
/**
 * Returns the current canvas host theme with semantic tokens and palette.
 * Falls back to dark theme when used outside a provider.
 */
export declare function useHostTheme(): CanvasHostTheme;
