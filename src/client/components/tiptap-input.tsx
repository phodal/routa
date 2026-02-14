"use client";

/**
 * TiptapInput - Rich text chat input powered by Tiptap
 *
 * Features:
 *   - StarterKit (bold, italic, lists, blockquote, code)
 *   - Code blocks with syntax highlighting (lowlight)
 *   - Placeholder text
 *   - Enter to send, Shift+Enter for newline
 *   - Image paste support
 *   - Link support
 *   - Task list support
 *   - @ to mention/select agents
 *   - / to select skills
 *   - GitHub clone button (bottom-left)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Mention from "@tiptap/extension-mention";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { common, createLowlight } from "lowlight";
import type { SkillSummary } from "../skill-client";
import { RepoPicker, type RepoSelection } from "./repo-picker";

const lowlight = createLowlight(common);

// ─── EnterToSend Extension ─────────────────────────────────────────────

const EnterToSend = Extension.create({
  name: "enterToSend",
  addOptions() {
    return { onSend: () => {} };
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.parent.type.name === "codeBlock") return false;
        const text = editor.getText().trim();
        if (!text) return true;
        this.options.onSend();
        return true;
      },
    };
  },
});

// ─── Suggestion dropdown (vanilla DOM, works for both @ and /) ─────────

interface SuggestionItem {
  id: string;
  label: string;
  description?: string;
  type?: string;
  disabled?: boolean;
}

function createSuggestionDropdown() {
  let popup: HTMLDivElement | null = null;
  let selectedIndex = 0;
  let currentItems: SuggestionItem[] = [];
  let currentCommand: ((item: SuggestionItem) => void) | null = null;

  const renderList = () => {
    const p = popup;
    if (!p) return;
    p.innerHTML = "";
    if (currentItems.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText =
        "padding: 8px 12px; color: #9ca3af; font-size: 12px;";
      empty.textContent = "No results";
      p.appendChild(empty);
      return;
    }
    currentItems.forEach((item, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      const isSelected = index === selectedIndex;
      btn.style.cssText = `
        display: flex; align-items: center; gap: 8px; width: 100%;
        text-align: left; padding: 6px 10px; border: none; cursor: pointer;
        border-radius: 4px; font-size: 13px; line-height: 1.4;
        background: ${isSelected ? "#3b82f6" : "transparent"};
        color: ${isSelected ? "#fff" : "inherit"};
        opacity: ${item.disabled ? "0.5" : "1"};
      `;
      // Status dot for provider items
      const statusDot = item.type === "provider"
        ? `<span style="width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: ${item.disabled ? '#9ca3af' : '#22c55e'};"></span>`
        : "";
      btn.innerHTML = `
        ${statusDot}
        <span style="font-weight: 500;">${item.label}</span>
        ${item.description ? `<span style="opacity: 0.5; font-size: 11px; margin-left: auto; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.description}</span>` : ""}
      `;
      btn.onclick = () => {
        if (!item.disabled && currentCommand) currentCommand(item);
      };
      btn.onmouseenter = () => {
        selectedIndex = index;
        renderList();
      };
      p.appendChild(btn);
    });
  };

  return {
    onStart: (props: any) => {
      currentItems = props.items || [];
      currentCommand = props.command;
      selectedIndex = 0;

      popup = document.createElement("div");
      popup.className = "suggestion-popup";
      popup.style.cssText = `
        position: fixed; z-index: 100; min-width: 220px; max-width: 360px;
        max-height: 240px; overflow-y: auto; padding: 4px;
        background: #1e2130; color: #e5e7eb; border: 1px solid #374151;
        border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      `;
      // Light mode detection
      if (
        typeof window !== "undefined" &&
        !window.matchMedia("(prefers-color-scheme: dark)").matches
      ) {
        popup.style.background = "#fff";
        popup.style.color = "#1f2937";
        popup.style.border = "1px solid #e5e7eb";
        popup.style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)";
      }

      renderList();
      document.body.appendChild(popup);

      const rect = props.clientRect?.();
      if (rect && popup) {
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.top - popup.offsetHeight - 8}px`;
        // If above goes offscreen, put below
        if (parseInt(popup.style.top) < 0) {
          popup.style.top = `${rect.bottom + 4}px`;
        }
      }
    },
    onUpdate: (props: any) => {
      currentItems = props.items || [];
      currentCommand = props.command;
      selectedIndex = 0;
      renderList();
      const rect = props.clientRect?.();
      if (rect && popup) {
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.top - popup.offsetHeight - 8}px`;
        if (parseInt(popup.style.top) < 0) {
          popup.style.top = `${rect.bottom + 4}px`;
        }
      }
    },
    onKeyDown: (props: any) => {
      if (props.event.key === "Escape") return true;
      if (!currentItems.length) return false;
      if (props.event.key === "ArrowDown") {
        selectedIndex = (selectedIndex + 1) % currentItems.length;
        renderList();
        return true;
      }
      if (props.event.key === "ArrowUp") {
        selectedIndex =
          (selectedIndex - 1 + currentItems.length) % currentItems.length;
        renderList();
        return true;
      }
      if (props.event.key === "Enter") {
        const item = currentItems[selectedIndex];
        if (item && !item.disabled && currentCommand) currentCommand(item);
        return true;
      }
      return false;
    },
    onExit: () => {
      if (popup?.parentNode) popup.parentNode.removeChild(popup);
      popup = null;
    },
  };
}

// ─── Provider Mention Extension (@ trigger) ────────────────────────────

function createProviderMention(
  getProviders: () => SuggestionItem[]
) {
  return Mention.extend({ name: "providerMention" }).configure({
    HTMLAttributes: {
      class: "agent-mention",
      "data-type": "provider",
    },
    renderHTML({ node }) {
      return [
        "span",
        {
          class: "agent-mention",
          "data-type": "provider",
          "data-id": node.attrs.id,
        },
        `@${node.attrs.label ?? node.attrs.id}`,
      ];
    },
    suggestion: {
      char: "@",
      pluginKey: new PluginKey("providerMention"),
      items: ({ query }: { query: string }) => {
        const providers = getProviders();
        if (!query) return providers;
        return providers.filter((p) =>
          p.label.toLowerCase().includes(query.toLowerCase())
        );
      },
      render: createSuggestionDropdown,
    },
  });
}

// ─── Skill Command Extension (/ trigger) ───────────────────────────────

function createSkillMention(
  getSkills: () => SuggestionItem[]
) {
  return Mention.extend({ name: "skillMention" }).configure({
    HTMLAttributes: {
      class: "skill-mention",
      "data-type": "skill",
    },
    renderHTML({ node }) {
      return [
        "span",
        {
          class: "skill-mention",
          "data-type": "skill",
          "data-id": node.attrs.id,
        },
        `/${node.attrs.label ?? node.attrs.id}`,
      ];
    },
    suggestion: {
      char: "/",
      pluginKey: new PluginKey("skillMention"),
      items: ({ query }: { query: string }) => {
        const skills = getSkills();
        if (!query) return skills;
        return skills.filter((s) =>
          s.label.toLowerCase().includes(query.toLowerCase())
        );
      },
      render: createSuggestionDropdown,
    },
  });
}

// ─── Main Component ────────────────────────────────────────────────────

export interface InputContext {
  /** Provider selected via @ mention (e.g. "opencode") */
  provider?: string;
  /** Skill selected via / command (e.g. "find-skills") */
  skill?: string;
  /** Working directory (e.g. cloned repo path) */
  cwd?: string;
  /** Session mode (provider-specific) */
  mode?: string;
}

interface ProviderItem {
  id: string;
  name: string;
  description: string;
  command: string;
  status?: "available" | "unavailable";
}

interface TiptapInputProps {
  onSend: (text: string, context: InputContext) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  skills?: SkillSummary[];
  providers?: ProviderItem[];
  selectedProvider: string;
  repoSelection: RepoSelection | null;
  onRepoChange: (selection: RepoSelection | null) => void;
}

export function TiptapInput({
  onSend,
  placeholder = "Type a message...",
  disabled = false,
  loading = false,
  skills = [],
  providers = [],
  selectedProvider,
  repoSelection,
  onRepoChange,
}: TiptapInputProps) {
  const [claudeMode, setClaudeMode] = useState<"acceptEdits" | "plan">("acceptEdits");
  const [opencodeMode, setOpencodeMode] = useState<"build" | "plan">("build");

  // Ref for skills so the Mention extension always has latest
  const skillsRef = useRef<SuggestionItem[]>([]);
  skillsRef.current = skills.map((s) => ({
    id: s.name,
    label: s.name,
    description: s.description,
    type: "skill",
  }));

  // Ref for providers so the Mention extension always has latest
  const providersRef = useRef<SuggestionItem[]>([]);
  providersRef.current = providers.map((p) => ({
    id: p.id,
    label: p.name,
    description: `${p.command}${p.status === "available" ? " ✓" : ""}`,
    type: "provider",
    disabled: p.status === "unavailable",
  }));

  // Use a ref for the send handler so extensions always call the latest version
  const handleSendRef = useRef<() => void>(() => {});

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        code: {
          HTMLAttributes: {
            class:
              "px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs font-mono",
          },
        },
        blockquote: {
          HTMLAttributes: {
            class:
              "border-l-2 border-gray-300 dark:border-gray-600 pl-3 italic text-gray-600 dark:text-gray-400",
          },
        },
        bulletList: { HTMLAttributes: { class: "list-disc ml-4" } },
        orderedList: { HTMLAttributes: { class: "list-decimal ml-4" } },
        hardBreak: {},
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class:
            "bg-gray-50 dark:bg-[#0d0f17] rounded-lg p-3 text-xs font-mono overflow-x-auto my-1 border border-gray-100 dark:border-gray-800",
        },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: "max-w-full rounded-md max-h-48" },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-blue-500 underline cursor-pointer" },
      }),
      TaskList.configure({
        HTMLAttributes: { class: "pl-0 list-none" },
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: { class: "flex items-start gap-2" },
      }),
      createProviderMention(() => providersRef.current),
      createSkillMention(() => skillsRef.current),
      EnterToSend.configure({
        onSend: () => handleSendRef.current(),
      }),
    ],
    editable: !disabled,
    editorProps: {
      attributes: {
        class:
          "tiptap-chat-input outline-none min-h-[24px] max-h-[160px] overflow-y-auto text-sm text-gray-900 dark:text-gray-100",
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (items) {
          for (const item of Array.from(items)) {
            if (item.type.startsWith("image/")) {
              event.preventDefault();
              const file = item.getAsFile();
              if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                  const src = e.target?.result as string;
                  if (src) {
                    view.dispatch(
                      view.state.tr.replaceSelectionWith(
                        view.state.schema.nodes.image.create({ src })
                      )
                    );
                  }
                };
                reader.readAsDataURL(file);
              }
              return true;
            }
          }
        }
        return false;
      },
    },
    immediatelyRender: false,
  });

  // Define handleSend AFTER editor is available, using the editor ref pattern
  const handleSend = useCallback(() => {
    if (!editor || disabled || loading) return;

    // Extract mentions from the editor content
    const json = editor.getJSON();
    let provider: string | undefined;
    let skill: string | undefined;

    // Walk the document to find mentions
    const walk = (node: any) => {
      if (node.type === "providerMention" && node.attrs?.id) {
        provider = node.attrs.id;
      }
      if (node.type === "skillMention" && node.attrs?.id) {
        skill = node.attrs.id;
      }
      if (node.content) {
        node.content.forEach(walk);
      }
    };
    walk(json);

    const text = editor.getText().trim();
    if (!text) return;

    // Remove the @provider and /skill tokens from the text for the prompt
    let cleanText = text;
    if (provider) {
      const providerLabel = providers.find((p) => p.id === provider)?.name ?? provider;
      cleanText = cleanText.replace(new RegExp(`@${providerLabel}\\s*`, "gi"), "").trim();
    }
    if (skill) {
      cleanText = cleanText.replace(new RegExp(`/${skill}\\s*`, "g"), "").trim();
    }

    const effectiveProvider = provider ?? selectedProvider;
    const mode =
      effectiveProvider === "claude"
        ? claudeMode
        : effectiveProvider === "opencode"
          ? opencodeMode
          : undefined;

    onSend(cleanText || text, {
      provider,
      skill,
      cwd: repoSelection?.path ?? undefined,
      mode,
    });
    editor.commands.clearContent();
  }, [editor, onSend, disabled, loading, repoSelection, providers, selectedProvider, claudeMode, opencodeMode]);

  // Keep ref updated so EnterToSend and external send button always call latest
  handleSendRef.current = handleSend;

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <div className="flex-1 flex flex-col gap-1.5">
      {/* Editor wrapper */}
      <div
        className={`tiptap-input-wrapper relative px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#161922] transition-colors focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent ${
          disabled ? "opacity-40 cursor-not-allowed" : ""
        }`}
      >
        <EditorContent editor={editor} />

        {/* Bottom toolbar */}
        <div className="flex items-center gap-2 mt-1.5 -mb-0.5">
          {/* Repo picker (replaces old Clone button) */}
          <RepoPicker
            value={repoSelection}
            onChange={onRepoChange}
          />

          {/* Mode toggles for selected providers */}
          {selectedProvider === "claude" && (
            <div className="flex items-center gap-1">
              <ModeChip
                active={claudeMode === "acceptEdits"}
                onClick={() => setClaudeMode("acceptEdits")}
                label="Brave"
              />
              <ModeChip
                active={claudeMode === "plan"}
                onClick={() => setClaudeMode("plan")}
                label="Plan"
              />
            </div>
          )}
          {selectedProvider === "opencode" && (
            <div className="flex items-center gap-1">
              <ModeChip
                active={opencodeMode === "build"}
                onClick={() => setOpencodeMode("build")}
                label="Build"
              />
              <ModeChip
                active={opencodeMode === "plan"}
                onClick={() => setOpencodeMode("plan")}
                label="Plan"
              />
            </div>
          )}

          {/* Hints + send */}
          <span className="text-[10px] text-gray-300 dark:text-gray-600 ml-auto mr-1">
            <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 font-mono">@</kbd> provider
            <span className="mx-1.5">&middot;</span>
            <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 font-mono">/</kbd> skill
          </span>
          <button
            type="button"
            onClick={() => handleSendRef.current()}
            disabled={disabled || loading}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Send"
          >
            {loading ? (
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
        active
          ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800"
          : "bg-transparent text-gray-500 border-gray-200 hover:bg-gray-100 dark:text-gray-400 dark:border-gray-700 dark:hover:bg-gray-800"
      }`}
    >
      {label}
    </button>
  );
}
