"use client";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "routa.theme";
export const THEME_CHANGE_EVENT = "routa:theme-changed";

function hasLocalStorageAccess() {
  return (
    typeof window !== "undefined" &&
    window.localStorage != null &&
    typeof window.localStorage.getItem === "function" &&
    typeof window.localStorage.setItem === "function"
  );
}

function isValidThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function getStoredThemePreference(): ThemePreference {
  if (!hasLocalStorageAccess()) return "system";

  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isValidThemePreference(value) ? value : "system";
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveThemePreference(theme: ThemePreference): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

export function applyThemePreference(theme: ThemePreference): ResolvedTheme {
  if (typeof document === "undefined") return theme === "dark" ? "dark" : "light";

  const resolvedTheme = resolveThemePreference(theme);
  const root = document.documentElement;

  root.classList.remove("light", "dark");
  root.classList.add(resolvedTheme);
  root.dataset.themePreference = theme;
  root.style.colorScheme = resolvedTheme;

  return resolvedTheme;
}

export function setThemePreference(theme: ThemePreference): ResolvedTheme {
  if (typeof window === "undefined") return theme === "dark" ? "dark" : "light";

  const resolvedTheme = applyThemePreference(theme);
  if (typeof window === "undefined" || !hasLocalStorageAccess()) {
    return resolvedTheme;
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, theme);

  window.dispatchEvent(
    new CustomEvent(THEME_CHANGE_EVENT, {
      detail: { theme, resolvedTheme },
    }),
  );

  return resolvedTheme;
}

export function isDarkThemeActive(): boolean {
  if (typeof document !== "undefined") {
    return document.documentElement.classList.contains("dark");
  }

  return false;
}

export function subscribeToThemePreference(
  callback: (theme: ThemePreference, resolvedTheme: ResolvedTheme) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const mediaQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  const emitCurrentTheme = () => {
    const theme = getStoredThemePreference();
    const resolvedTheme = applyThemePreference(theme);
    callback(theme, resolvedTheme);
  };

  const handleThemeEvent = () => {
    emitCurrentTheme();
  };

  const handleSystemThemeChange = () => {
    if (getStoredThemePreference() !== "system") return;
    emitCurrentTheme();
  };

  window.addEventListener(THEME_CHANGE_EVENT, handleThemeEvent as EventListener);
  if (hasLocalStorageAccess()) {
    window.addEventListener("storage", handleThemeEvent);
  }

  if (mediaQuery) {
    mediaQuery.addEventListener("change", handleSystemThemeChange);
  }

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, handleThemeEvent as EventListener);
    if (hasLocalStorageAccess()) {
      window.removeEventListener("storage", handleThemeEvent);
    }
    if (mediaQuery) {
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
    }
  };
}
