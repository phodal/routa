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
  background: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export interface CanvasTheme {
  kind: "dark" | "light";
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
    control: "#0078D4",
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
    control: "#0078D4",
  },
  diff: {
    insertedLine: "rgba(63, 162, 102, 0.12)",
    removedLine: "rgba(252, 107, 131, 0.12)",
    stripAdded: "rgba(63, 162, 102, 0.40)",
    stripRemoved: "rgba(252, 107, 131, 0.40)",
  },
};

export const darkPalette: CanvasPalette = {
  foreground: "#E4E4E4",
  background: "#1E1E1E",
  accent: "#4FC1FF",
  success: "rgba(82, 184, 150, 0.88)",
  warning: "rgba(240, 160, 64, 0.88)",
  danger: "rgba(252, 107, 131, 0.88)",
  info: "rgba(112, 176, 216, 0.88)",
};

export const lightPalette: CanvasPalette = {
  foreground: "#141414",
  background: "#FCFCFC",
  accent: "#005FB8",
  success: "rgba(31, 138, 101, 0.88)",
  warning: "rgba(168, 112, 22, 0.88)",
  danger: "rgba(200, 50, 70, 0.88)",
  info: "rgba(31, 92, 158, 0.88)",
};

export const darkTheme: CanvasTheme = {
  kind: "dark",
  tokens: darkTokens,
  palette: darkPalette,
};

export const lightTheme: CanvasTheme = {
  kind: "light",
  tokens: lightTokens,
  palette: lightPalette,
};

/** Spacing scale (px) matching canvas design language. */
export const canvasSpacing: Record<number, number> = {
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
};

/** Border radius scale (px). */
export const canvasRadius = {
  sm: 4,
  md: 6,
  lg: 8,
  full: 9999,
} as const;

/** Typography presets. */
export const canvasTypography = {
  h1: { fontSize: "24px", lineHeight: "30px", fontWeight: 590 },
  h2: { fontSize: "18px", lineHeight: "24px", fontWeight: 590 },
  h3: { fontSize: "15px", lineHeight: "20px", fontWeight: 590 },
  body: { fontSize: "14px", lineHeight: "20px", fontWeight: 400 },
  small: { fontSize: "12px", lineHeight: "16px", fontWeight: 400 },
  stat: { fontSize: "24px", lineHeight: "28px", fontWeight: 600 },
} as const;
