"use client";

import type { CSSProperties, JSX } from "react";
import hljs from "highlight.js/lib/core";
import bashLang from "highlight.js/lib/languages/bash";
import cssLang from "highlight.js/lib/languages/css";
import goLang from "highlight.js/lib/languages/go";
import javascriptLang from "highlight.js/lib/languages/javascript";
import jsonLang from "highlight.js/lib/languages/json";
import markdownLang from "highlight.js/lib/languages/markdown";
import pythonLang from "highlight.js/lib/languages/python";
import rustLang from "highlight.js/lib/languages/rust";
import sqlLang from "highlight.js/lib/languages/sql";
import typescriptLang from "highlight.js/lib/languages/typescript";
import xmlLang from "highlight.js/lib/languages/xml";
import yamlLang from "highlight.js/lib/languages/yaml";

import { useHostTheme } from "./theme-context";
import { mergeStyle } from "./primitives";

hljs.registerLanguage("bash", bashLang);
hljs.registerLanguage("css", cssLang);
hljs.registerLanguage("go", goLang);
hljs.registerLanguage("javascript", javascriptLang);
hljs.registerLanguage("json", jsonLang);
hljs.registerLanguage("markdown", markdownLang);
hljs.registerLanguage("python", pythonLang);
hljs.registerLanguage("rust", rustLang);
hljs.registerLanguage("sql", sqlLang);
hljs.registerLanguage("typescript", typescriptLang);
hljs.registerLanguage("xml", xmlLang);
hljs.registerLanguage("yaml", yamlLang);
hljs.registerAliases(["sh", "shell", "shellscript", "zsh"], { languageName: "bash" });
hljs.registerAliases(["js", "jsx"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["rs"], { languageName: "rust" });
hljs.registerAliases(["md"], { languageName: "markdown" });
hljs.registerAliases(["html"], { languageName: "xml" });
hljs.registerAliases(["yml"], { languageName: "yaml" });

export type DiffStatsProps = {
  additions?: number;
  deletions?: number;
  style?: CSSProperties;
};

export function DiffStats({
  additions = 0,
  deletions = 0,
  style,
}: DiffStatsProps): JSX.Element | null {
  const { palette } = useHostTheme();
  if (additions <= 0 && deletions <= 0) {
    return null;
  }

  return (
    <span
      style={mergeStyle(
        {
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
          lineHeight: "16px",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        },
        style,
      )}
    >
      {additions > 0 ? <span style={{ color: palette.success }}>+{additions}</span> : null}
      {deletions > 0 ? <span style={{ color: palette.danger }}>-{deletions}</span> : null}
    </span>
  );
}

export type DiffLineType = "added" | "removed" | "unchanged";

export type DiffLineData = {
  type: DiffLineType;
  content: string;
  lineNumber?: number;
};

export type DiffViewProps = {
  lines: DiffLineData[];
  path?: string;
  language?: string;
  showLineNumbers?: boolean;
  coloredLineNumbers?: boolean;
  showAccentStrip?: boolean;
  style?: CSSProperties;
};

function inferLanguageFromPath(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  const basename = path.split("/").at(-1);
  if (!basename || !basename.includes(".")) {
    return undefined;
  }
  const extension = basename.split(".").at(-1)?.toLowerCase();
  if (!extension) {
    return undefined;
  }

  const aliases: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    json: "json",
    jsonc: "jsonc",
    yml: "yaml",
    yaml: "yaml",
    md: "markdown",
    sh: "shell",
    zsh: "shell",
    css: "css",
    html: "html",
    sql: "sql",
  };

  return aliases[extension] ?? extension;
}

function normalizeLanguage(language: string | undefined): string | undefined {
  if (!language) {
    return undefined;
  }

  const normalized = language.trim().toLowerCase();
  const aliases: Record<string, string> = {
    sh: "bash",
    shell: "bash",
    shellscript: "bash",
    zsh: "bash",
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    rs: "rust",
    md: "markdown",
    html: "xml",
    yml: "yaml",
  };

  return aliases[normalized] ?? normalized;
}

function highlightDiffLine(content: string, language: string | undefined): string | null {
  const resolvedLanguage = normalizeLanguage(language);
  if (!resolvedLanguage || !hljs.getLanguage(resolvedLanguage)) {
    return null;
  }

  try {
    return hljs.highlight(content, {
      language: resolvedLanguage,
      ignoreIllegals: true,
    }).value;
  } catch {
    return null;
  }
}

function buildHighlightCss(theme: ReturnType<typeof useHostTheme>): string {
  const { palette, tokens } = theme;
  return `
.routa-canvas-diff .hljs-keyword,
.routa-canvas-diff .hljs-selector-tag,
.routa-canvas-diff .hljs-literal,
.routa-canvas-diff .hljs-section,
.routa-canvas-diff .hljs-link {
  color: ${palette.info};
}
.routa-canvas-diff .hljs-string,
.routa-canvas-diff .hljs-title,
.routa-canvas-diff .hljs-name,
.routa-canvas-diff .hljs-type,
.routa-canvas-diff .hljs-attribute,
.routa-canvas-diff .hljs-symbol,
.routa-canvas-diff .hljs-bullet,
.routa-canvas-diff .hljs-built_in,
.routa-canvas-diff .hljs-addition {
  color: ${palette.success};
}
.routa-canvas-diff .hljs-number,
.routa-canvas-diff .hljs-variable,
.routa-canvas-diff .hljs-template-variable,
.routa-canvas-diff .hljs-attr {
  color: ${palette.warning};
}
.routa-canvas-diff .hljs-comment,
.routa-canvas-diff .hljs-quote,
.routa-canvas-diff .hljs-deletion,
.routa-canvas-diff .hljs-meta {
  color: ${tokens.text.tertiary};
}
.routa-canvas-diff .hljs-emphasis {
  font-style: italic;
}
.routa-canvas-diff .hljs-strong {
  font-weight: 650;
}
`;
}

function lineBackground(type: DiffLineType, tokens: ReturnType<typeof useHostTheme>["tokens"]): string {
  if (type === "added") {
    return tokens.diff.insertedLine;
  }
  if (type === "removed") {
    return tokens.diff.removedLine;
  }
  return "transparent";
}

function accentColor(type: DiffLineType, tokens: ReturnType<typeof useHostTheme>["tokens"]): string {
  if (type === "added") {
    return tokens.diff.stripAdded;
  }
  if (type === "removed") {
    return tokens.diff.stripRemoved;
  }
  return "transparent";
}

function gutterColor(
  type: DiffLineType,
  colored: boolean,
  theme: ReturnType<typeof useHostTheme>,
): string {
  if (!colored || type === "unchanged") {
    return theme.tokens.text.tertiary;
  }
  return type === "added" ? theme.palette.success : theme.palette.danger;
}

export function DiffView({
  lines,
  path,
  language,
  showLineNumbers = true,
  coloredLineNumbers = true,
  showAccentStrip = true,
  style,
}: DiffViewProps): JSX.Element {
  const theme = useHostTheme();
  const resolvedLanguage = normalizeLanguage(language ?? inferLanguageFromPath(path));

  return (
    <div
      className="routa-canvas-diff"
      aria-label={path ? `Diff for ${path}` : "Diff"}
      data-language={resolvedLanguage}
      style={mergeStyle(
        {
          boxSizing: "border-box",
          width: "100%",
          minWidth: 0,
          overflow: "auto",
          background: theme.tokens.bg.editor,
          color: theme.tokens.text.primary,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          lineHeight: "20px",
          tabSize: 4,
        },
        style,
      )}
    >
      <style>{buildHighlightCss(theme)}</style>
      <div style={{ minWidth: "100%", width: "max-content", paddingBlock: 2 }}>
        {lines.map((line, index) => {
          const highlighted = highlightDiffLine(line.content, resolvedLanguage);
          return (
            <div
              key={`${index}-${line.type}-${line.lineNumber ?? "none"}`}
              style={{
                display: "flex",
                minHeight: 20,
                background: lineBackground(line.type, theme.tokens),
              }}
            >
              {showAccentStrip ? (
                <span
                  aria-hidden="true"
                  style={{
                    flex: "0 0 3px",
                    background: accentColor(line.type, theme.tokens),
                  }}
                />
              ) : null}
              {showLineNumbers ? (
                <span
                  aria-hidden="true"
                  style={{
                    flex: "0 0 4ch",
                    paddingInline: "8px 6px",
                    textAlign: "right",
                    color: gutterColor(line.type, coloredLineNumbers, theme),
                    userSelect: "none",
                    fontVariantNumeric: "tabular-nums",
                    borderRight: `1px solid ${theme.tokens.stroke.tertiary}`,
                  }}
                >
                  {line.lineNumber ?? ""}
                </span>
              ) : null}
              <span
                style={{
                  display: "block",
                  whiteSpace: "pre",
                  paddingLeft: 8,
                  paddingRight: 12,
                  color: theme.tokens.text.primary,
                }}
                {...(highlighted
                  ? { dangerouslySetInnerHTML: { __html: highlighted } }
                  : { children: line.content })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
