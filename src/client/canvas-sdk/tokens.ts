/**
 * Canvas theme tokens — semantic color and spacing tokens for canvas components.
 *
 * Mirrors the Cursor Canvas token structure to maintain SDK compatibility.
 * Canvas components use inline styles with these tokens, not Tailwind classes.
 */

export interface CanvasTokens {
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    quaternary: string;
    link: string;
    onAccent: string;
  };
  bg: {
    editor: string;
    chrome: string;
    elevated: string;
  };
  fill: {
    primary: string;
    secondary: string;
    tertiary: string;
    quaternary: string;
  };
  stroke: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  accent: {
    primary: string;
    control: string;
    controlHover: string;
  };
  diff: {
    insertedLine: string;
    removedLine: string;
    stripAdded: string;
    stripRemoved: string;
  };
}

export interface CanvasPalette {
  foreground: string;
  foregroundSecondary: string;
  foregroundTertiary: string;
  foregroundQuaternary: string;
  editor: string;
  chrome: string;
  sidebar: string;
  elevated: string;
  fillPrimary: string;
  fillSecondary: string;
  fillTertiary: string;
  fillQuaternary: string;
  strokePrimary: string;
  strokeSecondary: string;
  strokeTertiary: string;
  background: string;
  accent: string;
  buttonBackground: string;
  buttonForeground: string;
  buttonHoverBackground: string;
  link: string;
  diffInsertedLine: string;
  diffRemovedLine: string;
  diffStripAdded: string;
  diffStripRemoved: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export interface CanvasTheme extends CanvasTokens {
  kind: string;
  tokens: CanvasTokens;
  palette: CanvasPalette;
}

export const darkTokens: CanvasTokens = {
  text: {
    primary: "rgba(228, 228, 228, 0.92)",
    secondary: "rgba(228, 228, 228, 0.74)",
    tertiary: "rgba(228, 228, 228, 0.55)",
    quaternary: "rgba(228, 228, 228, 0.38)",
    link: "#87C3FF",
    onAccent: "#FFFFFF",
  },
  bg: {
    editor: "#1E1E1E",
    chrome: "#252526",
    elevated: "#2D2D30",
  },
  fill: {
    primary: "rgba(228, 228, 228, 0.16)",
    secondary: "rgba(228, 228, 228, 0.10)",
    tertiary: "rgba(228, 228, 228, 0.06)",
    quaternary: "rgba(228, 228, 228, 0.04)",
  },
  stroke: {
    primary: "rgba(228, 228, 228, 0.20)",
    secondary: "rgba(228, 228, 228, 0.12)",
    tertiary: "rgba(228, 228, 228, 0.08)",
  },
  accent: {
    primary: "#4FC1FF",
    control: "#599CE7",
    controlHover: "#6AABE9",
  },
  diff: {
    insertedLine: "rgba(63, 162, 102, 0.12)",
    removedLine: "rgba(252, 107, 131, 0.12)",
    stripAdded: "rgba(63, 162, 102, 0.40)",
    stripRemoved: "rgba(252, 107, 131, 0.40)",
  },
};

export const lightTokens: CanvasTokens = {
  text: {
    primary: "rgba(20, 20, 20, 0.94)",
    secondary: "rgba(20, 20, 20, 0.74)",
    tertiary: "rgba(20, 20, 20, 0.55)",
    quaternary: "rgba(20, 20, 20, 0.38)",
    link: "#3685BF",
    onAccent: "#FFFFFF",
  },
  bg: {
    editor: "#FCFCFC",
    chrome: "#F3F3F3",
    elevated: "#FFFFFF",
  },
  fill: {
    primary: "rgba(20, 20, 20, 0.16)",
    secondary: "rgba(20, 20, 20, 0.10)",
    tertiary: "rgba(20, 20, 20, 0.06)",
    quaternary: "rgba(20, 20, 20, 0.04)",
  },
  stroke: {
    primary: "rgba(20, 20, 20, 0.20)",
    secondary: "rgba(20, 20, 20, 0.12)",
    tertiary: "rgba(20, 20, 20, 0.08)",
  },
  accent: {
    primary: "#005FB8",
    control: "#3685BF",
    controlHover: "#2E76AB",
  },
  diff: {
    insertedLine: "rgba(63, 162, 102, 0.12)",
    removedLine: "rgba(252, 107, 131, 0.12)",
    stripAdded: "rgba(63, 162, 102, 0.40)",
    stripRemoved: "rgba(252, 107, 131, 0.40)",
  },
};

export const darkPalette: CanvasPalette = {
  foreground: "#E4E4E4EB",
  foregroundSecondary: "#E4E4E48D",
  foregroundTertiary: "#E4E4E45E",
  foregroundQuaternary: "#E4E4E442",
  editor: "#181818",
  chrome: "#141414",
  sidebar: "#141414",
  elevated: "#181818",
  fillPrimary: "#E4E4E430",
  fillSecondary: "#E4E4E41E",
  fillTertiary: "#E4E4E411",
  fillQuaternary: "#E4E4E40A",
  strokePrimary: "#E4E4E433",
  strokeSecondary: "#E4E4E41F",
  strokeTertiary: "#E4E4E414",
  background: "#181818",
  accent: "#599CE7",
  buttonBackground: "#599CE7",
  buttonForeground: "#191c22",
  buttonHoverBackground: "#6AABE9",
  link: "#87c3ff",
  diffInsertedLine: "#3FA26633",
  diffRemovedLine: "#B8004933",
  diffStripAdded: "#3FA2668F",
  diffStripRemoved: "#FC6B838F",
  success: "rgba(82, 184, 150, 0.88)",
  warning: "rgba(240, 160, 64, 0.88)",
  danger: "rgba(252, 107, 131, 0.88)",
  info: "rgba(112, 176, 216, 0.88)",
};

export const lightPalette: CanvasPalette = {
  foreground: "#141414F0",
  foregroundSecondary: "#141414BD",
  foregroundTertiary: "#1414148A",
  foregroundQuaternary: "#1414145C",
  editor: "#FCFCFC",
  chrome: "#F8F8F8",
  sidebar: "#F3F3F3",
  elevated: "#FCFCFC",
  fillPrimary: "#14141433",
  fillSecondary: "#14141424",
  fillTertiary: "#14141414",
  fillQuaternary: "#1414140F",
  strokePrimary: "#14141433",
  strokeSecondary: "#1414141F",
  strokeTertiary: "#14141414",
  background: "#FCFCFC",
  accent: "#3685BF",
  buttonBackground: "#3685BF",
  buttonForeground: "#FCFCFC",
  buttonHoverBackground: "#2E76AB",
  link: "#3685BF",
  diffInsertedLine: "#1F8A651F",
  diffRemovedLine: "#CF2D5614",
  diffStripAdded: "#1F8A65CC",
  diffStripRemoved: "#CF2D56CC",
  success: "rgba(31, 138, 101, 0.88)",
  warning: "rgba(168, 112, 22, 0.88)",
  danger: "rgba(200, 50, 70, 0.88)",
  info: "rgba(31, 92, 158, 0.88)",
};

function buildTheme(
  kind: string,
  tokens: CanvasTokens,
  palette: CanvasPalette,
): CanvasTheme {
  return {
    ...tokens,
    kind,
    tokens,
    palette,
  };
}

export const darkTheme: CanvasTheme = buildTheme("dark", darkTokens, darkPalette);

export const lightTheme: CanvasTheme = buildTheme("light", lightTokens, lightPalette);

export const canvasPaletteDark = darkPalette;
export const canvasPaletteLight = lightPalette;
export const canvasTokens = darkTokens;
export const canvasTokensLight = lightTokens;

/** Spacing scale (px) matching canvas design language. */
export const canvasSpacing: Record<number, number> = {
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  3.5: 14,
  4: 16,
  4.5: 18,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
};

/** Border radius scale (px). */
export const canvasRadius = {
  none: 0,
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  full: 9999,
} as const;

/** Typography presets. */
export const canvasTypography = {
  h1: { fontSize: "24px", lineHeight: "30px", fontWeight: 590 },
  h2: { fontSize: "18px", lineHeight: "24px", fontWeight: 590 },
  h3: { fontSize: "16px", lineHeight: "22px", fontWeight: 590 },
  body: { fontSize: "14px", lineHeight: "20px", fontWeight: 400 },
  small: { fontSize: "12px", lineHeight: "16px", fontWeight: 400 },
  stat: { fontSize: "24px", lineHeight: "28px", fontWeight: 600 },
} as const;
