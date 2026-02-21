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
import type { FileMatch } from "../hooks/use-file-search";

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

function createSuggestionDropdown(triggerChar?: string) {
  let popup: HTMLDivElement | null = null;
  let selectedIndex = 0;
  let currentItems: SuggestionItem[] = [];
  let currentCommand: ((item: SuggestionItem) => void) | null = null;
  const currentTriggerChar = triggerChar ?? null;

  const renderList = () => {
    const p = popup;
    if (!p) return;
    p.innerHTML = "";

    // Empty state with contextual message
    if (currentItems.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText =
        "padding: 12px 14px; color: #9ca3af; font-size: 12px; text-align: center;";

      // Show different message based on trigger character
      if (currentTriggerChar === "@") {
        empty.innerHTML = `
          <div style="margin-bottom: 4px;">📁 No files found</div>
          <div style="font-size: 11px; opacity: 0.7;">Clone a repository first to search files</div>
        `;
      } else {
        empty.textContent = "No results";
      }
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
      // File icon for file items
      const fileIcon = item.type === "file"
        ? `<span style="font-size: 11px; opacity: 0.6;">📄</span>`
        : "";
      btn.innerHTML = `
        ${statusDot}
        ${fileIcon}
        <span style="font-weight: 500;">${item.label}</span>
        ${item.description ? `<span style="opacity: 0.5; font-size: 11px; margin-left: auto; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.description}</span>` : ""}
      `;
      // Use mousedown instead of click to prevent blur issues
      btn.onmousedown = (e) => {
        e.preventDefault(); // Prevent editor blur
        e.stopPropagation();
        if (!item.disabled && currentCommand) {
          currentCommand(item);
        }
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

// ─── @ Mention Extension (file search) ─────────────────────────────────

interface FileSearchContext {
  repoPath: string | null;
  abortController: AbortController | null;
}

function createAtMention(
  getFileSearchContext: () => FileSearchContext
) {
  return Mention.extend({ name: "atMention" }).configure({
    HTMLAttributes: {
      class: "file-mention",
      "data-type": "file",
    },
    renderHTML({ node }) {
      return [
        "span",
        {
          class: "file-mention",
          "data-type": "file",
          "data-id": node.attrs.id,
          "data-path": node.attrs.path ?? node.attrs.id,
        },
        `@${node.attrs.label ?? node.attrs.id}`,
      ];
    },
    suggestion: {
      char: "@",
      pluginKey: new PluginKey("atMention"),
      items: async ({ query }: { query: string }): Promise<SuggestionItem[]> => {
        const ctx = getFileSearchContext();

        // If no repo selected, return empty - dropdown will show "Clone a repository first"
        if (!ctx.repoPath) {
          return [];
        }

        // Cancel previous request
        if (ctx.abortController) {
          ctx.abortController.abort();
        }

        // Create new abort controller
        const controller = new AbortController();
        ctx.abortController = controller;

        try {
          const params = new URLSearchParams({
            q: query,
            repoPath: ctx.repoPath,
            limit: "15",
          });

          const response = await fetch(`/api/files/search?${params}`, {
            signal: controller.signal,
          });

          if (!response.ok) {
            return [];
          }

          const data = await response.json();
          const files: FileMatch[] = data.files || [];

          return files.map((f) => ({
            id: f.path,
            label: f.name,
            description: f.path,
            type: "file",
            path: f.fullPath,
          }));
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            return []; // Request cancelled
          }
          return [];
        }
      },
      render: () => createSuggestionDropdown("@"),
    },
  });
}

// ─── # Mention Extension (providers + sessions) ────────────────────────

function createHashMention(
  getAgentItems: () => SuggestionItem[]
) {
  return Mention.extend({ name: "hashMention" }).configure({
    HTMLAttributes: {
      class: "agent-mention",
      "data-type": "agent",
    },
    renderHTML({ node }) {
      const mentionType = node.attrs.type ?? "provider";
      return [
        "span",
        {
          class: "agent-mention",
          "data-type": mentionType,
          "data-id": node.attrs.id,
        },
        `#${node.attrs.label ?? node.attrs.id}`,
      ];
    },
    suggestion: {
      char: "#",
      pluginKey: new PluginKey("hashMention"),
      items: ({ query }: { query: string }) => {
        const allItems = getAgentItems();
        if (!query) return allItems;
        return allItems.filter((p) =>
          p.label.toLowerCase().includes(query.toLowerCase()) ||
          p.id.toLowerCase().includes(query.toLowerCase()) ||
          (p.description ?? "").toLowerCase().includes(query.toLowerCase())
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

/** File reference from @ mention */
export interface FileReference {
  /** File path (relative or absolute) */
  path: string;
  /** Display label shown in the input */
  label: string;
}

export interface InputContext {
  /** Provider selected via # mention (e.g. "opencode") */
  provider?: string;
  /** Session selected via # mention */
  sessionId?: string;
  /** Skill selected via / command (e.g. "find-skills") */
  skill?: string;
  /** Working directory (e.g. cloned repo path) */
  cwd?: string;
  /** Session mode (provider-specific) */
  mode?: string;
  /** Files referenced via @ mention */
  files?: FileReference[];
}

interface ProviderItem {
  id: string;
  name: string;
  description: string;
  command: string;
  status?: "available" | "unavailable";
  /** Source of the provider: "static" for builtin, "registry" for ACP registry */
  source?: "static" | "registry";
}

interface SessionItem {
  sessionId: string;
  provider?: string;
  modeId?: string;
}

interface TiptapInputProps {
  onSend: (text: string, context: InputContext) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  skills?: SkillSummary[];
  /** Skills discovered from the selected repo (shown with "repo" badge) */
  repoSkills?: SkillSummary[];
  providers?: ProviderItem[];
  selectedProvider: string;
  onProviderChange?: (provider: string) => void;
  sessions?: SessionItem[];
  activeSessionMode?: string;
  repoSelection: RepoSelection | null;
  onRepoChange: (selection: RepoSelection | null) => void;
  /** Current agent role – ROUTA hides provider mode chips (Brave/Plan) */
  agentRole?: string;
}

export function TiptapInput({
  onSend,
  placeholder = "Type a message...",
  disabled = false,
  loading = false,
  skills = [],
  repoSkills = [],
  providers = [],
  selectedProvider,
  onProviderChange,
  agentRole,
  sessions = [],
  activeSessionMode,
  repoSelection,
  onRepoChange,
}: TiptapInputProps) {
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const providerDropdownRef = useRef<HTMLDivElement>(null);
  const providerBtnRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ left: number; bottom: number } | null>(null);
  const [claudeMode, setClaudeMode] = useState<"acceptEdits" | "plan">("acceptEdits");
  const [opencodeMode, setOpencodeMode] = useState<"build" | "plan">("build");

  // Keep mode chips aligned with the current session mode when switching sessions.
  useEffect(() => {
    if (!activeSessionMode) return;
    if (selectedProvider === "claude") {
      setClaudeMode(activeSessionMode === "plan" ? "plan" : "acceptEdits");
    } else if (selectedProvider === "opencode") {
      setOpencodeMode(activeSessionMode === "plan" ? "plan" : "build");
    }
  }, [activeSessionMode, selectedProvider]);

  // Ref for skills so the Mention extension always has latest
  // Merge local skills and repo-discovered skills, deduplicating by name
  const skillsRef = useRef<SuggestionItem[]>([]);
  const mergedSkillItems: SuggestionItem[] = [];
  const seenSkillNames = new Set<string>();

  for (const s of skills) {
    if (!seenSkillNames.has(s.name)) {
      seenSkillNames.add(s.name);
      mergedSkillItems.push({
        id: s.name,
        label: s.name,
        description: s.description,
        type: "skill",
      });
    }
  }
  for (const s of repoSkills) {
    if (!seenSkillNames.has(s.name)) {
      seenSkillNames.add(s.name);
      mergedSkillItems.push({
        id: s.name,
        label: s.name,
        description: `[repo] ${s.description}`,
        type: "skill",
      });
    }
  }
  skillsRef.current = mergedSkillItems;

  // Ref for # suggestions (providers + sessions) - agents
  const agentItemsRef = useRef<SuggestionItem[]>([]);
  const providerItems = providers.map((p) => ({
    id: p.id,
    label: p.name,
    description: `${p.command}${p.status === "available" ? " ✓" : ""}`,
    type: "provider",
    disabled: p.status === "unavailable",
  }));
  const sessionItems = sessions.map((s) => ({
    id: s.sessionId,
    label: `session-${s.sessionId.slice(0, 8)}`,
    description: `${s.provider ?? "unknown"}${s.modeId ? ` · ${s.modeId}` : ""}`,
    type: "session",
    disabled: false,
  }));
  agentItemsRef.current = [...providerItems, ...sessionItems];

  // Ref for @ suggestions (file search)
  // File search context for async API calls
  const fileSearchContextRef = useRef<FileSearchContext>({
    repoPath: repoSelection?.path ?? null,
    abortController: null,
  });

  // Update repo path when selection changes
  useEffect(() => {
    fileSearchContextRef.current.repoPath = repoSelection?.path ?? null;
  }, [repoSelection?.path]);

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
      createAtMention(() => fileSearchContextRef.current),
      createHashMention(() => agentItemsRef.current),
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
    let sessionId: string | undefined;
    let skill: string | undefined;
    const files: FileReference[] = [];

    // Walk the document to find mentions
    const walk = (node: any) => {
      // @ mentions are now for files
      if (node.type === "atMention" && node.attrs?.id) {
        files.push({
          path: node.attrs.path ?? node.attrs.id,
          label: node.attrs.label ?? node.attrs.id,
        });
      }
      // # mentions are for agents (providers + sessions)
      if (node.type === "hashMention" && node.attrs?.id) {
        if (node.attrs?.type === "session") {
          sessionId = node.attrs.id;
        } else {
          provider = node.attrs.id;
        }
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

    // Remove the #provider, @file, and /skill tokens from the text for the prompt
    let cleanText = text;
    if (provider) {
      const providerLabel = providers.find((p) => p.id === provider)?.name ?? provider;
      cleanText = cleanText.replace(new RegExp(`#${providerLabel}\\s*`, "gi"), "").trim();
    }
    // Remove file mentions from text
    for (const file of files) {
      cleanText = cleanText.replace(new RegExp(`@${file.label}\\s*`, "g"), "").trim();
    }
    if (skill) {
      cleanText = cleanText.replace(new RegExp(`/${skill}\\s*`, "g"), "").trim();
    }

    // Fallback for plain-text session mentions like #session-46b5807d
    if (!sessionId) {
      const sessionTokenMatch = cleanText.match(/#session-([a-f0-9]{6,})/i);
      if (sessionTokenMatch) {
        const prefix = sessionTokenMatch[1].toLowerCase();
        const matched = sessions.find((s) =>
          s.sessionId.toLowerCase().startsWith(prefix)
        );
        if (matched) {
          sessionId = matched.sessionId;
          cleanText = cleanText.replace(sessionTokenMatch[0], "").trim();
        }
      }
    }

    const effectiveProvider = provider ?? selectedProvider;
    // In ROUTA mode, don't send a mode – the backend forces bypassPermissions
    const mode = agentRole === "ROUTA"
      ? undefined
      : effectiveProvider === "claude"
        ? claudeMode
        : effectiveProvider === "opencode"
          ? opencodeMode
          : undefined;

    onSend(cleanText || text, {
      provider,
      sessionId,
      skill,
      cwd: repoSelection?.path ?? undefined,
      mode,
      files: files.length > 0 ? files : undefined,
    });
    editor.commands.clearContent();
  }, [editor, onSend, disabled, loading, repoSelection, providers, selectedProvider, claudeMode, opencodeMode, sessions, agentRole]);

  // Keep ref updated so EnterToSend and external send button always call latest
  handleSendRef.current = handleSend;

  // Close provider dropdown on click outside
  useEffect(() => {
    if (!providerDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (providerDropdownRef.current && !providerDropdownRef.current.contains(e.target as Node)) {
        setProviderDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [providerDropdownOpen]);

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  const selectedProviderInfo = providers.find((p) => p.id === selectedProvider);

  // Group providers by source (builtin/static first, then registry)
  const builtinAvailable = providers.filter((p) => p.source === "static" && p.status === "available");
  const builtinUnavailable = providers.filter((p) => p.source === "static" && p.status !== "available");
  const registryAvailable = providers.filter((p) => p.source === "registry" && p.status === "available");
  const registryUnavailable = providers.filter((p) => p.source === "registry" && p.status !== "available");

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
          {/* Repo picker */}
          <RepoPicker
            value={repoSelection}
            onChange={onRepoChange}
          />

          {/* Provider dropdown */}
          <div ref={providerDropdownRef}>
            <button
              ref={providerBtnRef}
              type="button"
              onClick={() => {
                if (!providerDropdownOpen && providerBtnRef.current) {
                  const rect = providerBtnRef.current.getBoundingClientRect();
                  setDropdownPos({ left: rect.left, bottom: window.innerHeight - rect.top + 4 });
                }
                setProviderDropdownOpen((v) => !v);
              }}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs transition-colors"
              title="Select provider"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${selectedProviderInfo?.status === "available" ? "bg-green-500" : "bg-gray-400"}`} />
              <span className="text-gray-700 dark:text-gray-300 font-medium max-w-[120px] truncate">
                {selectedProviderInfo?.name ?? selectedProvider}
              </span>
              <svg className={`w-3 h-3 text-gray-400 transition-transform ${providerDropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {providerDropdownOpen && dropdownPos && (
              <div
                className="fixed w-72 max-h-80 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] shadow-xl z-[9999]"
                style={{ left: dropdownPos.left, bottom: dropdownPos.bottom }}
              >
                {/* Builtin Available */}
                {builtinAvailable.length > 0 && (
                  <div className="py-1">
                    <div className="px-3 py-1 text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                      Built-in ({builtinAvailable.length})
                    </div>
                    {builtinAvailable.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onProviderChange?.(p.id);
                          setProviderDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs transition-colors ${
                          p.id === selectedProvider
                            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                            : "hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                        <span className="font-medium truncate flex-1">{p.name}</span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-[140px]">{p.command}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Registry Available */}
                {registryAvailable.length > 0 && (
                  <div className={`py-1 ${builtinAvailable.length > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""}`}>
                    <div className="px-3 py-1 text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                      ACP Registry ({registryAvailable.length})
                    </div>
                    {registryAvailable.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onProviderChange?.(p.id);
                          setProviderDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs transition-colors ${
                          p.id === selectedProvider
                            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                            : "hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                        <span className="font-medium truncate flex-1">{p.name}</span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-[140px]">{p.command}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Builtin Unavailable */}
                {builtinUnavailable.length > 0 && (
                  <div className={`py-1 ${(builtinAvailable.length > 0 || registryAvailable.length > 0) ? "border-t border-gray-100 dark:border-gray-800" : ""}`}>
                    <div className="px-3 py-1 text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                      Built-in - Not Installed ({builtinUnavailable.length})
                    </div>
                    {builtinUnavailable.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onProviderChange?.(p.id);
                          setProviderDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs transition-colors opacity-60 ${
                          p.id === selectedProvider
                            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                            : "hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0" />
                        <span className="font-medium truncate flex-1">{p.name}</span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-[140px]">{p.command}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Registry Unavailable */}
                {registryUnavailable.length > 0 && (
                  <div className="py-1 border-t border-gray-100 dark:border-gray-800">
                    <div className="px-3 py-1 text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                      ACP Registry - Not Installed ({registryUnavailable.length})
                    </div>
                    {registryUnavailable.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onProviderChange?.(p.id);
                          setProviderDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs transition-colors opacity-60 ${
                          p.id === selectedProvider
                            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                            : "hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0" />
                        <span className="font-medium truncate flex-1">{p.name}</span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-[140px]">{p.command}</span>
                      </button>
                    ))}
                  </div>
                )}

                {providers.length === 0 && (
                  <div className="px-3 py-3 text-xs text-gray-400 text-center">
                    Connecting...
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mode toggles for selected providers (hidden in ROUTA mode) */}
          {agentRole !== "ROUTA" && selectedProvider === "claude" && (
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
          {agentRole !== "ROUTA" && selectedProvider === "opencode" && (
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
            <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 font-mono">@</kbd> file
            <span className="mx-1.5">&middot;</span>
            <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 font-mono">#</kbd> agent
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
