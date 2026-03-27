"use client";

import { useLayoutEffect } from "react";

import { applyThemePreference, getStoredThemePreference } from "@/client/utils/theme";

export function ThemeInitializer() {
  useLayoutEffect(() => {
    applyThemePreference(getStoredThemePreference());
  }, []);

  return null;
}
