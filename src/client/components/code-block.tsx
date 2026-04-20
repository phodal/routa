"use client";

/**
 * CodeBlock - Universal code block renderer with multiple backends
 *
 * Uses CodeMirror for rich code display or falls back to lowlight/pre for simple cases.
 *
 * Features:
 *   - Automatic language detection from filename or content
 *   - Copy to clipboard
 *   - Syntax highlighting via CodeMirror or lowlight
 *   - Dark/light theme support
 *   - Collapsible for large content
 *
 * Usage:
 *   <CodeBlock code="const x = 42;" language="javascript" />
 *   <CodeBlock content='{"key": "value"}' filename="config.json" />
 */

import { useState, useMemo } from "react";
import { CodeViewer } from "./codemirror";
import { common, createLowlight } from "lowlight";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "@/i18n";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";


const lowlight = createLowlight(common);

// Detect if content looks like JSON
function isJsonLike(content: string): boolean {
  const trimmed = content.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

// Detect language from extension
function detectLanguageFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    jsx: "jsx",
    tsx: "tsx",
    py: "python",
    pyw: "python",
    json: "json",
    html: "html",
    htm: "html",
    css: "css",
    xml: "xml",
    sql: "sql",
    md: "markdown",
    yaml: "yaml",
    yml: "yaml",
  };
  return ext && langMap[ext] ? langMap[ext] : "text";
}

// Detect language from content
function detectLanguageFromContent(content: string): string {
  const trimmed = content.trim();

  // JSON detection
  if (isJsonLike(trimmed)) {
    return "json";
  }

  // JavaScript/TypeScript patterns
  if (/^(const|let|var|function|class|import|export|interface|type)\s/m.test(trimmed)) {
    if (/\b(interface|type|enum)\b/.test(trimmed)) {
      return "typescript";
    }
    return "javascript";
  }

  // Python patterns
  if (/^(def |class |import |from |print\(|if __name__)/m.test(trimmed)) {
    return "python";
  }

  // HTML patterns
  if (/^\s*<(!doctype|html|head|body|div|span)/i.test(trimmed)) {
    return "html";
  }

  // CSS patterns
  if (/^[\w-#.]+\s*{[\s\S]*}/.test(trimmed)) {
    return "css";
  }

  return "text";
}

interface CodeBlockProps {
  /** The code/content to display */
  code?: string;
  content?: string;
  /** Language for syntax highlighting */
  language?: string;
  /** Filename for language detection and display */
  filename?: string;
  /** Use CodeMirror (rich) or lowlight (simple) */
  variant?: "rich" | "simple";
  /** Maximum height before scrolling */
  maxHeight?: string;
  /** Show line numbers (rich mode only) */
  showLineNumbers?: boolean;
  /** Additional class name */
  className?: string;
  /** Wrap long lines instead of horizontal scroll (default: false) */
  wordWrap?: boolean;
  /** Show header bar with filename, language, etc. (default: true) */
  showHeader?: boolean;
}

export function CodeBlock({
  code,
  content,
  language: propLanguage,
  filename,
  variant = "rich",
  maxHeight = "400px",
  showLineNumbers = true,
  className = "",
  wordWrap = false,
  showHeader = true,
}: CodeBlockProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const codeContent = code || content || "";

  // Auto-detect language if not provided
  const detectedLanguage = useMemo(() => {
    if (propLanguage && propLanguage !== "auto") return propLanguage;
    if (filename) return detectLanguageFromFilename(filename);
    return detectLanguageFromContent(codeContent);
  }, [propLanguage, filename, codeContent]);

  // Copy handler
  const handleCopy = () => {
    navigator.clipboard.writeText(codeContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Simple variant - use lowlight/pre
  if (variant === "simple" || codeContent.length < 50) {
    // Use lowlight to highlight the code
    const highlighted = lowlight.highlight(detectedLanguage, codeContent);
    const highlightedContent = toJsxRuntime(highlighted, {
      Fragment,
      jsx,
      jsxs,
      elementAttributeNameCase: "react",
      stylePropertyNameCase: "dom",
    });

    return (
      <div className={`code-block-simple ${className}`}>
        <div className="code-block-header">
          {filename && <span className="code-block-filename">{filename}</span>}
          <button
            type="button"
            onClick={handleCopy}
            className="code-block-copy-btn"
            title={t.common.copyToClipboard}
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            ) : (
              <Copy className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            )}
          </button>
        </div>
        <pre className={`language-${detectedLanguage}`} style={wordWrap ? { whiteSpace: "pre-wrap", wordBreak: "break-word" } : undefined}>
          <code>{highlightedContent}</code>
        </pre>
      </div>
    );
  }

  // Rich variant - use CodeMirror
  return (
    <CodeViewer
      code={codeContent}
      language={detectedLanguage as any}
      filename={filename}
      maxHeight={maxHeight}
      showLineNumbers={showLineNumbers}
      className={className}
      wordWrap={wordWrap}
      showHeader={showHeader}
    />
  );
}

export default CodeBlock;
