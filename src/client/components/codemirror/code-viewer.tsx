"use client";

/**
 * CodeViewer - Read-only code display with syntax highlighting using CodeMirror 6
 *
 * Features:
 *   - Full syntax highlighting for 20+ languages
 *   - Line numbers
 *   - Dark/Light theme support
 *   - Copy to clipboard button
 *   - File extension-based language detection
 *   - Collapsible for large outputs
 *
 * Usage:
 *   <CodeViewer code="const x = 42;" language="javascript" />
 *   <CodeViewer code='{"key": "value"}' language="json" />
 *   <CodeViewer code="print('hello')" filename="script.py" />
 */

import { useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState, Extension } from "@codemirror/state";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { yaml as yamlLangCM } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import { lineNumbers } from "@codemirror/view";
import hljs from "highlight.js/lib/core";
import bashLang from "highlight.js/lib/languages/bash";
import markdownLang from "highlight.js/lib/languages/markdown";
import sqlLang from "highlight.js/lib/languages/sql";
import yamlLang from "highlight.js/lib/languages/yaml";
import {
  isDarkThemeActive,
  subscribeToThemePreference,
  type ResolvedTheme,
} from "@/client/utils/theme";
import { Check, ChevronDown, FileText, Copy, ChevronUp } from "lucide-react";


hljs.registerLanguage("bash", bashLang);
hljs.registerLanguage("shell", bashLang);
hljs.registerLanguage("sh", bashLang);
hljs.registerLanguage("zsh", bashLang);
hljs.registerLanguage("yaml", yamlLang);
hljs.registerLanguage("markdown", markdownLang);
hljs.registerLanguage("sql", sqlLang);

// ─── Language Support ───────────────────────────────────────────────────────

type SupportedLanguage =
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "python"
  | "json"
  | "html"
  | "css"
  | "bash"
  | "shell"
  | "sh"
  | "zsh"
  | "xml"
  | "sql"
  | "markdown"
  | "yaml"
  | "text";

interface LanguageExtension {
  name: string;
  extensions: Extension[];
  aliases?: string[];
}

const LANGUAGE_MAP: Record<string, LanguageExtension> = {
  javascript: { name: "JavaScript", extensions: [javascript()], aliases: ["js", "mjs", "cjs"] },
  typescript: { name: "TypeScript", extensions: [javascript({ typescript: true })], aliases: ["ts"] },
  jsx: { name: "JSX", extensions: [javascript({ jsx: true })], aliases: ["jsx"] },
  tsx: { name: "TSX", extensions: [javascript({ jsx: true, typescript: true })], aliases: ["tsx"] },
  python: { name: "Python", extensions: [python()], aliases: ["py", "pyw"] },
  json: { name: "JSON", extensions: [json()], aliases: ["json"] },
  html: { name: "HTML", extensions: [html()], aliases: ["html", "htm"] },
  css: { name: "CSS", extensions: [css()], aliases: ["css"] },
  bash: { name: "Bash", extensions: [], aliases: ["bash", "sh", "zsh", "shell"] },
  shell: { name: "Shell", extensions: [], aliases: ["shell"] },
  sh: { name: "Shell", extensions: [], aliases: ["sh"] },
  zsh: { name: "Zsh", extensions: [], aliases: ["zsh"] },
  xml: { name: "XML", extensions: [html()], aliases: ["xml"] },
  sql: { name: "SQL", extensions: [], aliases: ["sql"] },
  markdown: { name: "Markdown", extensions: [], aliases: ["md", "markdown"] },
  yaml: { name: "YAML", extensions: [yamlLangCM()], aliases: ["yaml", "yml"] },
  text: { name: "Plain Text", extensions: [], aliases: ["txt", "text"] },
};

function detectLanguage(filename?: string, language?: string): LanguageExtension {
  if (language && LANGUAGE_MAP[language]) {
    return LANGUAGE_MAP[language];
  }

  if (filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext) {
      for (const lang of Object.values(LANGUAGE_MAP)) {
        if (lang.aliases?.includes(ext)) {
          return lang;
        }
      }
    }
  }

  return LANGUAGE_MAP.text;
}

function resolveHighlightLanguage(filename?: string, language?: string): string | null {
  if (language && LANGUAGE_MAP[language]) {
    return language;
  }

  if (filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext) {
      for (const [key, lang] of Object.entries(LANGUAGE_MAP)) {
        if (lang.aliases?.includes(ext)) {
          return key;
        }
      }
    }
  }

  return null;
}

// ─── Custom Theme ───────────────────────────────────────────────────────────

const lightTheme = EditorView.theme({
  "&": {
    backgroundColor: "#f8f9fa",
    color: "#1f2937",
    fontSize: "12px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-content": {
    padding: "12px 0",
    minHeight: "100px",
  },
  ".cm-line": {
    padding: "0 12px",
    lineHeight: "1.6",
  },
  ".cm-gutters": {
    backgroundColor: "#e5e7eb",
    color: "#6b7280",
    border: "none",
    paddingRight: "4px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#d1d5db",
    color: "#1f2937",
  },
  ".cm-lineNumbers": {
    cursor: "default",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 4px",
    minWidth: "20px",
    textAlign: "right",
    fontSize: "11px",
  },
});

// ─── Line Numbers Widget ────────────────────────────────────────────────────

const lineNumbersExtension = lineNumbers();

// ─── Component Props ────────────────────────────────────────────────────────

interface CodeViewerProps {
  /** The code content to display */
  code: string;
  /** Language for syntax highlighting */
  language?: SupportedLanguage;
  /** Filename to auto-detect language */
  filename?: string;
  /** Optional class name for wrapper */
  className?: string;
  /** Maximum height before scrolling */
  maxHeight?: string;
  /** Show line numbers (default: true) */
  showLineNumbers?: boolean;
  /** Show copy button (default: true) */
  showCopyButton?: boolean;
  /** Initial collapsed state */
  initiallyCollapsed?: boolean;
  /** Wrap long lines instead of horizontal scroll (default: false) */
  wordWrap?: boolean;
  /** Show header bar with filename, language badge, etc. (default: true) */
  showHeader?: boolean;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function CodeViewer({
  code,
  language,
  filename,
  className = "",
  maxHeight = "400px",
  showLineNumbers = true,
  showCopyButton = true,
  initiallyCollapsed = false,
  wordWrap = false,
  showHeader = true,
}: CodeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [lines, setLines] = useState(0);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    isDarkThemeActive() ? "dark" : "light",
  );

  const langInfo = detectLanguage(filename, language);
  const fallbackLanguage = resolveHighlightLanguage(filename, language);
  const useHighlightedFallback = langInfo.extensions.length === 0 && fallbackLanguage !== null && fallbackLanguage !== "text";
  const highlightedCode = useHighlightedFallback && fallbackLanguage
    ? hljs.highlight(code, { language: fallbackLanguage }).value
    : "";
  const highlightedMarkup = { __html: highlightedCode };

  useEffect(() => {
    return subscribeToThemePreference((_, nextResolvedTheme) => {
      setResolvedTheme(nextResolvedTheme);
    });
  }, []);

  // Count lines
  useEffect(() => {
    setLines(code.split("\n").length);
  }, [code]);

  // Copy to clipboard handler
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Initialize CodeMirror
  useEffect(() => {
    if (useHighlightedFallback) return;
    if (!containerRef.current) return;

    const extensions: Extension[] = [
      langInfo.extensions,
      lightTheme,
      syntaxHighlighting(defaultHighlightStyle),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.theme({
        "&": { maxHeight },
      }),
    ];

    if (wordWrap) {
      extensions.push(EditorView.lineWrapping);
    }

    if (showLineNumbers) {
      extensions.push(lineNumbersExtension);
    }

    if (resolvedTheme === "dark") {
      extensions.push(oneDark);
    }

    const state = EditorState.create({
      doc: code,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    editorRef.current = view;

    return () => {
      view.destroy();
      editorRef.current = null;
    };
  }, [code, langInfo.extensions, maxHeight, resolvedTheme, showLineNumbers, useHighlightedFallback, wordWrap]);

  // Update code content when it changes
  useEffect(() => {
    if (!editorRef.current) return;

    const currentDoc = editorRef.current.state.doc.toString();
    if (currentDoc !== code) {
      editorRef.current.dispatch({
        changes: {
          from: 0,
          to: currentDoc.length,
          insert: code,
        },
      });
    }
  }, [code]);

  return (
    <div className={`code-viewer-wrapper ${className}`}>
      {/* Header bar */}
      {showHeader && (
        <div className="cm-header">
          <div className="cm-header-left">
            {filename && (
              <span className="cm-filename">
                <FileText className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                {filename}
              </span>
            )}
            <span className="cm-language-badge">{langInfo.name}</span>
            <span className="cm-line-count">{lines} lines</span>
          </div>
          <div className="cm-header-right">
            {showCopyButton && (
              <button
                type="button"
                onClick={handleCopy}
                className="cm-copy-button"
                title={copied ? "Copied!" : "Copy to clipboard"}
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                ) : (
                  <Copy className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                )}
              </button>
            )}
            {lines > 10 && (
              <button
                type="button"
                onClick={() => setCollapsed(!collapsed)}
                className="cm-collapse-btn"
                title={collapsed ? "Expand" : "Collapse"}
              >
                {collapsed ? (
                  <ChevronDown className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                ) : (
                  <ChevronUp className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Editor container */}
      {useHighlightedFallback ? (
        <div
          className={`cm-container ${collapsed ? "cm-collapsed" : ""} overflow-auto`}
          style={{ display: collapsed ? "none" : undefined, maxHeight }}
        >
          <pre
            className={`${resolvedTheme === "dark" ? "bg-[#282c34] text-slate-100" : "bg-[#f8f9fa] text-slate-800"} ${wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
            style={{ margin: 0, padding: "12px", fontSize: "12px", lineHeight: 1.6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          >
            {/* highlightedCode is generated by the local syntax highlighter for plain text/code, not user-authored HTML. */}
            {/* nosemgrep */}
            <code dangerouslySetInnerHTML={highlightedMarkup} />
          </pre>
        </div>
      ) : (
        <div
          ref={containerRef}
          className={`cm-container ${collapsed ? "cm-collapsed" : ""}`}
          style={{ display: collapsed ? "none" : undefined }}
        />
      )}

      {/* Collapsed preview */}
      {collapsed && (
        <div className="cm-collapsed-preview" onClick={() => setCollapsed(false)}>
          <code className="text-xs text-gray-500 dark:text-gray-400">
            {lines > 5 ? `${lines} lines of ${langInfo.name}` : code.slice(0, 100) + "..."}
          </code>
        </div>
      )}
    </div>
  );
}

export default CodeViewer;

// ─── CodeEditor ─────────────────────────────────────────────────────────────
// Editable variant of CodeViewer — full CodeMirror with onChange callback.

interface CodeEditorProps {
  /** Current editor content */
  value: string;
  /** Language for syntax highlighting */
  language?: SupportedLanguage;
  /** Called whenever the document changes */
  onChange?: (value: string) => void;
  /** Maximum height before scrolling */
  maxHeight?: string;
  /** Optional classname for wrapper */
  className?: string;
  /** Placeholder text when empty */
  placeholder?: string;
}

export function CodeEditor({
  value,
  language = "json",
  onChange,
  maxHeight = "500px",
  className = "",
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  // Keep onChange in a ref so update listener doesn't go stale
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    isDarkThemeActive() ? "dark" : "light",
  );

  useEffect(() => {
    return subscribeToThemePreference((_, nextResolvedTheme) => {
      setResolvedTheme(nextResolvedTheme);
    });
  }, []);

  // Mount editor once
  useEffect(() => {
    if (!containerRef.current) return;
    const langInfo = detectLanguage(undefined, language);
    const extensions: Extension[] = [
      langInfo.extensions,
      lightTheme,
      syntaxHighlighting(defaultHighlightStyle),
      EditorView.theme({ "&": { maxHeight } }),
      EditorView.lineWrapping,
      lineNumbersExtension,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current?.(update.state.doc.toString());
        }
      }),
    ];
    if (resolvedTheme === "dark") extensions.push(oneDark);

    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    editorRef.current = view;
    return () => {
      view.destroy();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, maxHeight, resolvedTheme]);

  // Sync external value changes (e.g. reset)
  useEffect(() => {
    if (!editorRef.current) return;
    const current = editorRef.current.state.doc.toString();
    if (current !== value) {
      editorRef.current.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={`cm-container ${className}`}
      style={{ minHeight: "120px" }}
    />
  );
}
