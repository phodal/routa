"use client";

/**
 * MarkdownViewer - Read-only tiptap markdown renderer.
 *
 * Inspired by intent-0.2.4's MarkdownViewer.svelte:
 *   - Uses `marked` to convert markdown → HTML
 *   - Uses tiptap `Editor` (read-only) for interactive rendering
 *   - Supports task lists, code blocks with syntax highlighting, tables, etc.
 *   - Three rendering paths based on content complexity:
 *     1. Simple: plain text, no markdown → <p>
 *     2. Static: processed HTML without tiptap (for links, code blocks, etc.)
 *     3. Complex: full tiptap for interactive content (task lists)
 *   - Mermaid: fenced ```mermaid blocks are rendered via MermaidRenderer
 *
 * Usage:
 *   <MarkdownViewer content={markdownString} />
 *   <MarkdownViewer content={markdownString} isStreaming />
 */

import { useRef, useEffect, useMemo } from "react";
import { MermaidRenderer } from "./mermaid-renderer";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import { all, createLowlight } from "lowlight";
import { marked } from "marked";

// ─── Lowlight instance ────────────────────────────────────────────────
const lowlight = createLowlight(all);

// ─── Markdown → HTML conversion ──────────────────────────────────────
function markdownToHtml(md: string): string {
  if (!md) return "";
  try {
    return marked.parse(md, { async: false, breaks: true, gfm: true }) as string;
  } catch {
    // Fallback: escape and wrap in <p>
    return `<p>${md.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
  }
}

// ─── Mermaid block splitting ─────────────────────────────────────────
type ContentSegment =
  | { type: "markdown"; content: string }
  | { type: "mermaid"; code: string };

const MERMAID_BLOCK_RE = /```mermaid\n([\s\S]*?)```/gm;

function hasMermaidBlocks(content: string): boolean {
  MERMAID_BLOCK_RE.lastIndex = 0;
  return MERMAID_BLOCK_RE.test(content);
}

function splitMermaidBlocks(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let lastIndex = 0;
  const re = /```mermaid\n([\s\S]*?)```/gm;
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const before = content.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: "markdown", content: before });
    }
    segments.push({ type: "mermaid", code: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const rest = content.slice(lastIndex).trim();
    if (rest) segments.push({ type: "markdown", content: rest });
  }

  return segments;
}

// ─── Content complexity detection ────────────────────────────────────
// Patterns that REQUIRE tiptap for interactivity
const NEEDS_TIPTAP = [
  /^\s*[-*]\s*\[[ x]\]/m, // Task lists
];

// Patterns that need markdown processing but not tiptap
const NEEDS_PROCESSING = [
  /```/,                  // Code blocks
  /`[^`]+`/,             // Inline code
  /\|.*\|/,              // Tables
  /\[.*\]\(.*\)/,        // Links
  /^#{1,6}\s/m,          // Headers
  /^\s*>\s/m,            // Blockquotes
  /\*\*[^*]+\*\*/,       // Bold
  /\*[^*]+\*/,           // Italic
  /~~[^~]+~~/,           // Strikethrough
  /^[-*_]{3,}\s*$/m,     // Horizontal rules
  /^\s*[-*+]\s/m,        // Unordered lists
  /^\s*\d+\.\s/m,        // Ordered lists
];

type ContentComplexity = "simple" | "static" | "complex";

function detectComplexity(content: string): ContentComplexity {
  if (!content) return "simple";
  if (NEEDS_TIPTAP.some((p) => p.test(content))) return "complex";
  if (NEEDS_PROCESSING.some((p) => p.test(content))) return "static";
  return "simple";
}

// ─── Component Props ──────────────────────────────────────────────────

interface MarkdownViewerProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
  /** Called when a file path is clicked in the rendered content */
  onFileClick?: (path: string) => void;
}

export function MarkdownViewer({
  content,
  isStreaming = false,
  className = "",
  onFileClick,
}: MarkdownViewerProps) {
  // ── Mermaid: split content and render blocks separately ─────────────
  const hasMermaid = useMemo(() => hasMermaidBlocks(content), [content]);

  if (hasMermaid && !isStreaming) {
    const segments = splitMermaidBlocks(content);
    return (
      <div className={`markdown-viewer mermaid-content ${className}`}>
        {segments.map((seg, i) =>
          seg.type === "mermaid" ? (
            <MermaidRenderer key={i} code={seg.code} className="my-2" />
          ) : (
            <MarkdownViewer
              key={i}
              content={seg.content}
              isStreaming={false}
              className=""
              onFileClick={onFileClick}
            />
          )
        )}
      </div>
    );
  }

  const complexity = useMemo(() => detectComplexity(content), [content]);
  const html = useMemo(() => {
    if (complexity === "simple") return "";
    return markdownToHtml(content);
  }, [content, complexity]);

  // ── Simple: plain text ──────────────────────────────────────────────
  if (complexity === "simple") {
    return (
      <div className={`markdown-viewer simple-content ${className}`}>
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    );
  }

  // ── Static: processed HTML without tiptap ──────────────────────────
  if (complexity === "static" && !isStreaming) {
    return (
      <StaticMarkdownContent
        html={html}
        className={className}
        onFileClick={onFileClick}
      />
    );
  }

  // ── Complex / Streaming: full tiptap ────────────────────────────────
  return (
    <TiptapMarkdownContent
      html={html}
      content={content}
      isStreaming={isStreaming}
      className={className}
      onFileClick={onFileClick}
    />
  );
}

// ─── Static HTML Renderer ─────────────────────────────────────────────

function StaticMarkdownContent({
  html,
  className,
  onFileClick,
}: {
  html: string;
  className: string;
  onFileClick?: (path: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (anchor?.href) {
        e.preventDefault();
        if (anchor.href.startsWith("http://") || anchor.href.startsWith("https://")) {
          window.open(anchor.href, "_blank");
        }
        return;
      }

      // Handle file reference clicks
      if (onFileClick) {
        const code = target.closest("code");
        if (code) {
          const text = code.textContent || "";
          if (text.includes("/") && text.includes(".")) {
            e.preventDefault();
            onFileClick(text.replace(/^@/, ""));
          }
        }
      }
    };

    el.addEventListener("click", handleClick, true);
    return () => el.removeEventListener("click", handleClick, true);
  }, [onFileClick]);

  return (
    <div
      ref={ref}
      className={`markdown-viewer static-content ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ─── Tiptap Editor Renderer ───────────────────────────────────────────

function TiptapMarkdownContent({
  html,
  content,
  isStreaming,
  className,
  onFileClick,
}: {
  html: string;
  content: string;
  isStreaming: boolean;
  className: string;
  onFileClick?: (path: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const editorInstanceRef = useRef<Editor | null>(null);
  const streamingRef = useRef<HTMLDivElement>(null);
  const lastContentRef = useRef("");

  // Create/destroy editor
  useEffect(() => {
    if (!editorRef.current || isStreaming) return;

    const editor = new Editor({
      element: editorRef.current,
      editable: false,
      content: html,
      extensions: [
        StarterKit.configure({
          codeBlock: false,
        }),
        Link.configure({
          openOnClick: false,
          HTMLAttributes: {
            class: "markdown-link cursor-pointer text-blue-500 hover:text-blue-600 underline",
          },
        }),
        TaskList.configure({
          HTMLAttributes: { class: "task-list" },
        }),
        TaskItem.configure({
          nested: true,
          HTMLAttributes: { class: "task-item" },
        }),
        CodeBlockLowlight.configure({
          lowlight,
          HTMLAttributes: { class: "code-block" },
        }),
      ],
    });

    editorInstanceRef.current = editor;
    lastContentRef.current = content;

    return () => {
      editor.destroy();
      editorInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  // Update content when it changes (non-streaming)
  useEffect(() => {
    if (isStreaming || !editorInstanceRef.current) return;
    if (content === lastContentRef.current) return;
    lastContentRef.current = content;
    editorInstanceRef.current.commands.setContent(html, { emitUpdate: false });
  }, [content, html, isStreaming]);

  // Streaming: update innerHTML directly (fast path)
  useEffect(() => {
    if (!isStreaming || !streamingRef.current) return;
    if (content === lastContentRef.current) return;
    lastContentRef.current = content;
    streamingRef.current.innerHTML = markdownToHtml(content);
  }, [content, isStreaming]);

  // Click handler for links and file references
  useEffect(() => {
    const el = isStreaming ? streamingRef.current : editorRef.current;
    if (!el) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (anchor?.href) {
        e.preventDefault();
        e.stopPropagation();
        if (anchor.href.startsWith("http")) {
          window.open(anchor.href, "_blank");
        }
        return;
      }

      if (onFileClick) {
        const code = target.closest("code");
        if (code) {
          const text = code.textContent || "";
          if (text.includes("/") && text.includes(".")) {
            e.preventDefault();
            onFileClick(text.replace(/^@/, ""));
          }
        }
      }
    };

    el.addEventListener("click", handleClick, true);
    return () => el.removeEventListener("click", handleClick, true);
  }, [isStreaming, onFileClick]);

  if (isStreaming) {
    return (
      <div
        ref={streamingRef}
        className={`markdown-viewer streaming-content ${className}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return <div ref={editorRef} className={`markdown-viewer ${className}`} />;
}

// ─── Export for use in task-panel and chat-panel ──────────────────────
export default MarkdownViewer;
