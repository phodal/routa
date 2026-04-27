"use client";

import { createContext, useContext, type ReactNode } from "react";

import {
  darkTheme,
  type CanvasTheme,
} from "./tokens";

export type CanvasHostTheme = CanvasTheme;

const ThemeContext = createContext<CanvasTheme>(darkTheme);

export function CanvasThemeProvider({
  theme,
  children,
}: {
  theme: CanvasTheme;
  children: ReactNode;
}) {
  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

/**
 * Returns the current canvas host theme with semantic tokens and palette.
 * Falls back to dark theme when used outside a provider.
 */
export function useHostTheme(): CanvasHostTheme {
  return useContext(ThemeContext);
}
