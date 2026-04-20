"use client";

import { useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { marked } from "marked";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { useTranslation } from "@/i18n";

export function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  try {
    return marked.parse(markdown, { async: false, breaks: true, gfm: true }) as string;
  } catch {
    return `<p>${markdown.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
  }
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_[\]#+\-!>])/g, "\\$1");
}

function collapseBlankLines(value: string): string {
  return value
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function serializeChildren(node: Node): string {
  return Array.from(node.childNodes).map(serializeNode).join("");
}

function serializeListItem(element: HTMLElement, index: number): string {
  const children = Array.from(element.childNodes);
  const nestedLists: string[] = [];
  const inlineContent = children
    .map((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child as HTMLElement).tagName.toLowerCase();
        if (tag === "ul" || tag === "ol") {
          nestedLists.push(serializeNode(child).trimEnd());
          return "";
        }
      }
      return serializeNode(child);
    })
    .join("")
    .trim();

  const marker = element.parentElement?.tagName.toLowerCase() === "ol" ? `${index + 1}. ` : "- ";
  const firstLine = `${marker}${inlineContent}`.trimEnd();
  const nested = nestedLists.map((item) => indentMarkdown(item, 2)).join("\n");
  return [firstLine, nested].filter(Boolean).join("\n");
}

function indentMarkdown(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeMarkdownText(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const content = serializeChildren(element);

  switch (tag) {
    case "p":
      return `${content.trim()}\n\n`;
    case "br":
      return "\n";
    case "strong":
    case "b":
      return `**${content}**`;
    case "em":
    case "i":
      return `*${content}*`;
    case "s":
    case "del":
      return `~~${content}~~`;
    case "code":
      if (element.parentElement?.tagName.toLowerCase() === "pre") {
        return content;
      }
      return `\`${content}\``;
    case "pre": {
      const code = element.textContent?.replace(/\n$/, "") ?? "";
      return `\`\`\`\n${code}\n\`\`\`\n\n`;
    }
    case "blockquote":
      return `${content
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(tag[1]);
      return `${"#".repeat(level)} ${content.trim()}\n\n`;
    }
    case "ul":
    case "ol":
      return `${Array.from(element.children)
        .map((child, index) => serializeListItem(child as HTMLElement, index))
        .join("\n")}\n\n`;
    case "a": {
      const href = element.getAttribute("href");
      return href ? `[${content || href}](${href})` : content;
    }
    case "hr":
      return `---\n\n`;
    default:
      return content;
  }
}

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return "";
  const document = new DOMParser().parseFromString(html, "text/html");
  return collapseBlankLines(serializeChildren(document.body));
}

interface KanbanDescriptionEditorProps {
  value: string;
  compact?: boolean;
  onSave: (value: string) => Promise<void>;
  onEditingChange?: (isEditing: boolean) => void;
}

export function KanbanDescriptionEditor({
  value,
  compact = false,
  onSave,
  onEditingChange,
}: KanbanDescriptionEditorProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const contentHtml = useMemo(() => markdownToHtml(value), [value]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: t.kanban.descriptionPlaceholder,
      }),
    ],
    content: contentHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: `outline-none prose prose-sm dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 ${compact
            ? "min-h-[12rem] max-h-[20rem] overflow-y-auto px-3 py-2.5"
            : "min-h-[16rem] max-h-[28rem] overflow-y-auto px-4 py-3"
          }`,
      },
    },
  });

  useEffect(() => {
    if (!editor || isEditing) return;
    const nextHtml = markdownToHtml(value);
    if (editor.getHTML() !== nextHtml) {
      editor.commands.setContent(nextHtml, { emitUpdate: false });
    }
  }, [editor, isEditing, value]);

  useEffect(() => {
    onEditingChange?.(isEditing);
  }, [isEditing, onEditingChange]);

  const beginEdit = () => {
    setIsEditing(true);
    editor?.commands.setContent(contentHtml, { emitUpdate: false });
  };

  const cancelEdit = () => {
    setIsEditing(false);
    editor?.commands.setContent(contentHtml, { emitUpdate: false });
  };

  const saveEdit = async () => {
    if (!editor) return;
    setIsSaving(true);
    try {
      const markdown = htmlToMarkdown(editor.getHTML());
      await onSave(markdown);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="border-b border-slate-200/70 dark:border-slate-700">
      <div className={`flex items-center justify-between border-b border-slate-200/70 dark:border-slate-700 ${compact ? "px-3 py-1.5" : "px-4 py-2"}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          <span>{t.kanbanDetail.description}</span>
          <span className="text-slate-300 dark:text-slate-600">/</span>
          <span>{isEditing ? t.kanban.editingMarkdown : t.kanban.renderedMarkdown}</span>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={isSaving}
                className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={isSaving}
                className="rounded-md bg-amber-500 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? t.workspace.saving : t.common.save}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={beginEdit}
              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t.common.edit}
            </button>
          )}
        </div>
      </div>

      {isEditing ? (
        <>
          <div className={`flex items-center gap-1 border-b border-slate-200/70 dark:border-slate-700 ${compact ? "px-2 py-1" : "px-3 py-1.5"}`}>
            {[
              { label: "B", active: editor?.isActive("bold"), action: () => editor?.chain().focus().toggleBold().run() },
              { label: "I", active: editor?.isActive("italic"), action: () => editor?.chain().focus().toggleItalic().run() },
              { label: "H", active: editor?.isActive("heading", { level: 3 }), action: () => editor?.chain().focus().toggleHeading({ level: 3 }).run() },
              { label: "UL", active: editor?.isActive("bulletList"), action: () => editor?.chain().focus().toggleBulletList().run() },
              { label: "OL", active: editor?.isActive("orderedList"), action: () => editor?.chain().focus().toggleOrderedList().run() },
              { label: "❝", active: editor?.isActive("blockquote"), action: () => editor?.chain().focus().toggleBlockquote().run() },
              { label: "```", active: editor?.isActive("codeBlock"), action: () => editor?.chain().focus().toggleCodeBlock().run() },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.action}
                className={`rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold transition-colors ${item.active
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                    : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <EditorContent editor={editor} />
        </>
      ) : (
        <div className={compact ? "px-3 py-2" : "px-4 py-2.5"}>
          {value.trim() ? (
            <MarkdownViewer
              content={value}
              className="text-slate-700 dark:text-slate-300"
              compactCanonicalStory
              hideCanonicalStoryTitle
              hideCanonicalStoryInvestSummary
            />
          ) : (
            <div className="text-sm text-slate-400 dark:text-slate-500">{t.kanban.noDescriptionYet}</div>
          )}
        </div>
      )}
    </div>
  );
}
