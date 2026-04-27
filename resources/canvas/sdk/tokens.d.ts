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
export declare const darkTokens: CanvasTokens;
export declare const lightTokens: CanvasTokens;
export declare const darkPalette: CanvasPalette;
export declare const lightPalette: CanvasPalette;
export declare const darkTheme: CanvasTheme;
export declare const lightTheme: CanvasTheme;
export declare const canvasPaletteDark: CanvasPalette;
export declare const canvasPaletteLight: CanvasPalette;
export declare const canvasTokens: CanvasTokens;
export declare const canvasTokensLight: CanvasTokens;
/** Spacing scale (px) matching canvas design language. */
export declare const canvasSpacing: Record<number, number>;
/** Border radius scale (px). */
export declare const canvasRadius: {
    readonly none: 0;
    readonly xs: 2;
    readonly sm: 4;
    readonly md: 6;
    readonly lg: 8;
    readonly xl: 12;
    readonly full: 9999;
};
/** Typography presets. */
export declare const canvasTypography: {
    readonly h1: {
        readonly fontSize: "24px";
        readonly lineHeight: "30px";
        readonly fontWeight: 590;
    };
    readonly h2: {
        readonly fontSize: "18px";
        readonly lineHeight: "24px";
        readonly fontWeight: 590;
    };
    readonly h3: {
        readonly fontSize: "16px";
        readonly lineHeight: "22px";
        readonly fontWeight: 590;
    };
    readonly body: {
        readonly fontSize: "14px";
        readonly lineHeight: "20px";
        readonly fontWeight: 400;
    };
    readonly small: {
        readonly fontSize: "12px";
        readonly lineHeight: "16px";
        readonly fontWeight: 400;
    };
    readonly stat: {
        readonly fontSize: "24px";
        readonly lineHeight: "28px";
        readonly fontWeight: 600;
    };
};
