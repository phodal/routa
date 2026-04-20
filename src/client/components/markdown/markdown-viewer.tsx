"use client";

/**
 * MarkdownViewer - Read-only tiptap markdown renderer.
 *
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
import { CanonicalStoryRenderer } from "./canonical-story-renderer";
import { MermaidRenderer } from "./mermaid-renderer";
import { HtmlPreviewRenderer } from "./html-preview-renderer";
import { parseCanonicalStory, type CanonicalStoryParseResult } from "@/core/kanban/canonical-story";
import { openExternalUrl } from "@/client/utils/external-links";
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

// ─── Block splitting (Mermaid + HTML) ───────────────────────────────
type ContentSegment =
  | { type: "markdown"; content: string }
  | { type: "mermaid"; code: string }
  | { type: "html"; code: string }
  | { type: "canonical-story"; parseResult: CanonicalStoryParseResult };

const MERMAID_BLOCK_RE = /```mermaid\n([\s\S]*?)```/gm;
const HTML_BLOCK_RE = /```html\n([\s\S]*?)```/gm;
const CANONICAL_STORY_BLOCK_RE = /```yaml\n([\s\S]*?)```/gm;

function hasMermaidBlocks(content: string): boolean {
  MERMAID_BLOCK_RE.lastIndex = 0;
  return MERMAID_BLOCK_RE.test(content);
}

function hasHtmlBlocks(content: string): boolean {
  HTML_BLOCK_RE.lastIndex = 0;
  return HTML_BLOCK_RE.test(content);
}

function isCanonicalStoryBlock(code: string): boolean {
  return /^\s*story\s*:/.test(code);
}

function hasCanonicalStoryBlocks(content: string): boolean {
  CANONICAL_STORY_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CANONICAL_STORY_BLOCK_RE.exec(content)) !== null) {
    if (isCanonicalStoryBlock(match[1])) {
      return true;
    }
  }
  return false;
}

function stripCanonicalStoryBlocks(content: string): string {
  return content.replace(CANONICAL_STORY_BLOCK_RE, (match, code) => {
    return isCanonicalStoryBlock(code) ? "" : match;
  });
}

function splitSpecialBlocks(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let lastIndex = 0;
  const re = /```(mermaid|html|yaml)\n([\s\S]*?)```/gm;
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const before = content.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: "markdown", content: before });
    }
    const lang = match[1] as "mermaid" | "html" | "yaml";
    const code = match[2].trim();
    if (lang === "mermaid") {
      segments.push({ type: "mermaid", code });
    } else if (lang === "html") {
      segments.push({ type: "html", code });
    } else if (isCanonicalStoryBlock(match[2])) {
      segments.push({ type: "canonical-story", parseResult: parseCanonicalStory(match[0]) });
    } else {
      segments.push({ type: "markdown", content: match[0].trim() });
    }
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
  /** Hide canonical story renderer and only render canonical YAML as plain markdown */
  hideCanonicalStory?: boolean;
  compactCanonicalStory?: boolean;
  hideCanonicalStoryTitle?: boolean;
  hideCanonicalStoryInvestSummary?: boolean;
}

export function MarkdownViewer({
  content,
  isStreaming = false,
  className = "",
  onFileClick,
  hideCanonicalStory = false,
  compactCanonicalStory = false,
  hideCanonicalStoryTitle = false,
  hideCanonicalStoryInvestSummary = false,
}: MarkdownViewerProps) {
  const processedContent = useMemo(
    () => (hideCanonicalStory ? stripCanonicalStoryBlocks(content) : content),
    [content, hideCanonicalStory],
  );
  // ── Special blocks: Mermaid + HTML previews ─────────────────────────
  const hasSpecial = useMemo(
    () => !isStreaming && (hasMermaidBlocks(content) || hasHtmlBlocks(content)
      || (hasCanonicalStoryBlocks(content) && !hideCanonicalStory)),
    [content, hideCanonicalStory, isStreaming],
  );

  const complexity = useMemo(() => detectComplexity(processedContent), [processedContent]);
  const html = useMemo(() => {
    if (complexity === "simple") return "";
    return markdownToHtml(processedContent);
  }, [processedContent, complexity]);

  if (hasSpecial) {
    const segments = splitSpecialBlocks(content);
    return (
      <div className={`markdown-viewer special-content ${className}`}>
        {segments.map((seg, i) => {
          if (seg.type === "mermaid") {
            return <MermaidRenderer key={i} code={seg.code} className="my-2" />;
          }
          if (seg.type === "html") {
            return <HtmlPreviewRenderer key={i} code={seg.code} className="my-2" />;
          }
          if (seg.type === "canonical-story") {
            if (hideCanonicalStory) {
              return null;
            }
            return (
              <CanonicalStoryRenderer
                key={i}
                parseResult={seg.parseResult}
                compact={compactCanonicalStory}
                className="my-2"
                hideTitle={hideCanonicalStoryTitle}
                hideInvestSummary={hideCanonicalStoryInvestSummary}
              />
            );
          }
          return (
            <MarkdownViewer
              key={i}
              content={seg.content}
              isStreaming={false}
              className=""
              onFileClick={onFileClick}
              hideCanonicalStory={hideCanonicalStory}
              compactCanonicalStory={compactCanonicalStory}
              hideCanonicalStoryTitle={hideCanonicalStoryTitle}
              hideCanonicalStoryInvestSummary={hideCanonicalStoryInvestSummary}
            />
          );
        })}
      </div>
    );
  }

  // ── Simple: plain text ──────────────────────────────────────────────
  if (complexity === "simple") {
    return (
      <div className={`markdown-viewer simple-content ${className}`}>
        <p className="m-0 whitespace-pre-wrap">{processedContent}</p>
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
        e.stopPropagation();
        if (anchor.href.startsWith("http://") || anchor.href.startsWith("https://")) {
          void openExternalUrl(anchor.href);
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
          void openExternalUrl(anchor.href);
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
