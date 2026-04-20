import { type ReactNode } from "react";
import { type CanvasTheme, type CanvasTokens, type CanvasPalette } from "./tokens";
export interface CanvasHostTheme {
    readonly kind: string;
    readonly tokens: CanvasTokens;
    readonly palette: CanvasPalette;
}
export declare function CanvasThemeProvider({ theme, children, }: {
    theme: CanvasTheme;
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
/**
 * Returns the current canvas host theme with semantic tokens and palette.
 * Falls back to dark theme when used outside a provider.
 */
export declare function useHostTheme(): CanvasHostTheme;
