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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopAwareFetch } from "../utils/diagnostics";
import { useEditor, EditorContent } from "@tiptap/react";
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
import { isDarkThemeActive } from "../utils/theme";
import { AcpProviderDropdown } from "./acp-provider-dropdown";
import { useTranslation } from "@/i18n";

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
  path?: string;
}

function createSuggestionDropdown(triggerChar?: string) {
  let popup: HTMLDivElement | null = null;
  let selectedIndex = 0;
  let currentItems: SuggestionItem[] = [];
  let currentCommand: ((item: SuggestionItem) => void) | null = null;
  const currentTriggerChar = triggerChar ?? null;
  let shouldSyncScroll = false;

  const syncSelectedItemIntoView = () => {
    const p = popup;
    if (!p) return;

    const selectedItem = p.children.item(selectedIndex);
    if (!(selectedItem instanceof HTMLElement)) return;

    selectedItem.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  };

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
        shouldSyncScroll = false;
        renderList();
      };
      p.appendChild(btn);
    });

    if (shouldSyncScroll) {
      syncSelectedItemIntoView();
      shouldSyncScroll = false;
    }
  };

  // Click outside handler
  let clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

  const cleanup = () => {
    if (clickOutsideHandler) {
      document.removeEventListener("mousedown", clickOutsideHandler);
      clickOutsideHandler = null;
    }
    if (popup?.parentNode) {
      popup.parentNode.removeChild(popup);
    }
    popup = null;
  };

  return {
    onStart: (props: any) => {
      currentItems = props.items || [];
      currentCommand = props.command;
      selectedIndex = 0;

      popup = document.createElement("div");
      popup.className = "suggestion-popup";
      popup.style.cssText = `
        position: fixed; z-index: 100; min-width: 280px; max-width: 480px;
        max-height: 240px; overflow-y: auto; padding: 4px;
        background: #1e2130; color: #e5e7eb; border: 1px solid #374151;
        border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      `;
      // Light mode detection
      if (!isDarkThemeActive()) {
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

      // Add click outside listener (with small delay to avoid immediate close)
      setTimeout(() => {
        clickOutsideHandler = (e: MouseEvent) => {
          if (popup && !popup.contains(e.target as Node)) {
            cleanup();
          }
        };
        document.addEventListener("mousedown", clickOutsideHandler);
      }, 100);
    },
    onUpdate: (props: any) => {
      currentItems = props.items || [];
      currentCommand = props.command;
      selectedIndex = 0;
      shouldSyncScroll = false;
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
        shouldSyncScroll = true;
        renderList();
        return true;
      }
      if (props.event.key === "ArrowUp") {
        selectedIndex =
          (selectedIndex - 1 + currentItems.length) % currentItems.length;
        shouldSyncScroll = true;
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
      cleanup();
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
      allowedPrefixes: null,
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

          const response = await desktopAwareFetch(`/api/files/search?${params}`, {
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
      allowedPrefixes: null,
      items: ({ query }: { query: string }) => {
        const allItems = getAgentItems();
        if (!query) return allItems;
        return allItems.filter((p) =>
          p.label.toLowerCase().includes(query.toLowerCase()) ||
          p.id.toLowerCase().includes(query.toLowerCase()) ||
          (p.description ?? "").toLowerCase().includes(query.toLowerCase())
        );
      },
      render: () => createSuggestionDropdown("#"),
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
      allowedPrefixes: null,
      items: ({ query }: { query: string }) => {
        const skills = getSkills();
        if (!query) return skills;
        return skills.filter((s) =>
          s.label.toLowerCase().includes(query.toLowerCase()) ||
          (s.description ?? "").toLowerCase().includes(query.toLowerCase())
        );
      },
      render: () => createSuggestionDropdown("/"),
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
  /** Model to use for this session (provider-specific, e.g. "anthropic/claude-3-5-sonnet") */
  model?: string;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface ProviderItem {
  id: string;
  name: string;
  description: string;
  command: string;
  status?: "available" | "unavailable" | "checking";
  /** Source of the provider: "static" for builtin, "registry" for ACP registry */
  source?: "static" | "registry";
  unavailableReason?: string;
}

interface SessionItem {
  sessionId: string;
  provider?: string;
  modeId?: string;
}

interface TiptapInputProps {
  onSend: (text: string, context: InputContext) => void;
  /** Called when user clicks stop button during loading */
  onStop?: () => void;
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
  additionalRepos?: Array<{
    name: string;
    path: string;
    branch?: string;
  }>;
  repoPathDisplay?: "inline" | "below-muted" | "hidden";
  /** Current agent role – ROUTA hides provider mode chips (Brave/Plan) */
  agentRole?: string;
  /** Usage info from last completion to display in the input area */
  usageInfo?: UsageInfo | null;
  /** Fetch available models for a provider (returns model IDs like "anthropic/claude-3-5-sonnet") */
  onFetchModels?: (provider: string) => Promise<string[]>;
  /** When set, programmatically inserts this skill mention into the editor */
  pendingSkill?: string | null;
  /** Called after pendingSkill has been inserted so the parent can clear it */
  onSkillInserted?: () => void;
  /** When set, replaces the editor content with this plain text (e.g. to restore input after error) */
  prefillText?: string | null;
  /** Called after prefillText has been consumed so the parent can clear it */
  onPrefillConsumed?: () => void;
  /** Larger presentation used by landing/team launch surfaces */
  variant?: "default" | "hero";
}

export function TiptapInput({
  onSend,
  onStop,
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
  additionalRepos,
  repoPathDisplay = "hidden",
  usageInfo,
  onFetchModels,
  pendingSkill,
  onSkillInserted,
  prefillText,
  onPrefillConsumed,
  variant = "default",
}: TiptapInputProps) {
  const { t } = useTranslation();
  const isHero = variant === "hero";
  const [claudeMode, setClaudeMode] = useState<"acceptEdits" | "plan">("acceptEdits");
  const [opencodeMode, setOpencodeMode] = useState<"build" | "plan">("build");

  // Model selector state
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const [modelDropdownPos, setModelDropdownPos] = useState<{ left: number; bottom?: number; top?: number; maxHeight: number } | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const editorClass = isHero
    ? "tiptap-chat-input outline-none min-h-[120px] max-h-[360px] overflow-y-auto text-base leading-8 text-slate-900 dark:text-slate-100"
    : "tiptap-chat-input outline-none min-h-[60px] max-h-[240px] overflow-y-auto text-sm text-slate-900 dark:text-slate-100";
  const wrapperClass = isHero
    ? `tiptap-input-wrapper relative rounded-[24px] border border-[#d6e5fb] bg-white/88 px-4 py-3 shadow-[0_18px_48px_-36px_rgba(14,116,144,0.32)] transition-colors focus-within:ring-2 focus-within:ring-sky-500 focus-within:border-transparent dark:border-white/10 dark:bg-[#101a2d]/88 ${
        disabled ? "opacity-40 cursor-not-allowed" : ""
      }`
    : `tiptap-input-wrapper relative px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#161922] transition-colors focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent ${
        disabled ? "opacity-40 cursor-not-allowed" : ""
      }`;
  const toolbarClass = isHero
    ? "mt-2.5 flex min-w-0 items-center gap-2.5 overflow-visible"
    : "mt-1.5 -mb-0.5 flex min-w-0 items-center gap-2 overflow-hidden";
  const modelButtonClass = isHero
    ? "flex items-center gap-2 rounded-lg border border-[#d6e5fb] px-3 py-1.5 text-sm transition-colors hover:bg-sky-50 dark:border-white/10 dark:hover:bg-white/5"
    : "flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs transition-colors";
  const hintClass = isHero
    ? "ml-auto mr-1 text-xs text-slate-400 dark:text-slate-500"
    : "ml-auto mr-1 text-[10px] text-slate-300 dark:text-slate-600";
  const hintKbdClass = isHero
    ? "rounded bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-white/8 dark:text-slate-400"
    : "px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 font-mono";
  const sendButtonClass = isHero
    ? "shrink-0 flex h-11 w-11 items-center justify-center rounded-[18px] bg-blue-600 text-white shadow-[0_12px_26px_-14px_rgba(37,99,235,0.75)] transition-all hover:bg-blue-700 hover:shadow-[0_16px_30px_-16px_rgba(37,99,235,0.85)] disabled:opacity-40 disabled:cursor-not-allowed"
    : "shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const stopButtonClass = isHero
    ? "shrink-0 flex h-11 w-11 items-center justify-center rounded-[18px] bg-red-600 text-white shadow-[0_12px_26px_-14px_rgba(220,38,38,0.7)] transition-all hover:bg-red-700 hover:shadow-[0_16px_30px_-16px_rgba(220,38,38,0.82)]"
    : "shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors";

  // Keep mode chips aligned with the current session mode when switching sessions.
  useEffect(() => {
    if (!activeSessionMode) return;
    if (selectedProvider === "claude") {
      setClaudeMode(activeSessionMode === "plan" ? "plan" : "acceptEdits");
    } else if (selectedProvider === "opencode") {
      setOpencodeMode(activeSessionMode === "plan" ? "plan" : "build");
    }
  }, [activeSessionMode, selectedProvider]);

  // Merge local skills and repo-discovered skills, deduplicating by name
  const mergedSkillItems = useMemo<SuggestionItem[]>(() => {
    const items: SuggestionItem[] = [];
    const seen = new Set<string>();
    for (const s of skills) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      items.push({
        id: s.name,
        label: s.name,
        description: s.description,
        type: "skill",
      });
    }
    for (const s of repoSkills) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      items.push({
        id: s.name,
        label: s.name,
        description: `[repo] ${s.description}`,
        type: "skill",
      });
    }
    return items;
  }, [skills, repoSkills]);

  const agentItems = useMemo<SuggestionItem[]>(() => {
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
    return [...providerItems, ...sessionItems];
  }, [providers, sessions]);

  const agentItemsRef = useRef<SuggestionItem[]>(agentItems);
  const mergedSkillItemsRef = useRef<SuggestionItem[]>(mergedSkillItems);
  const fileSearchContextRef = useRef<FileSearchContext>({
    repoPath: repoSelection?.path ?? null,
    abortController: null,
  });

  useEffect(() => {
    agentItemsRef.current = agentItems;
  }, [agentItems]);

  useEffect(() => {
    mergedSkillItemsRef.current = mergedSkillItems;
  }, [mergedSkillItems]);

  useEffect(() => {
    const nextRepoPath = repoSelection?.path ?? null;
    if (
      fileSearchContextRef.current.abortController &&
      fileSearchContextRef.current.repoPath !== nextRepoPath
    ) {
      fileSearchContextRef.current.abortController.abort();
      fileSearchContextRef.current.abortController = null;
    }
    fileSearchContextRef.current.repoPath = nextRepoPath;
  }, [repoSelection?.path]);

  // Use a ref for the send handler so extensions always call the latest version
  const handleSendRef = useRef<() => void>(() => {});
  const handleSendProxy = useCallback(() => {
    handleSendRef.current();
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        link: false,
        code: {
          HTMLAttributes: {
            class:
              "px-1 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-xs font-mono",
          },
        },
        blockquote: {
          HTMLAttributes: {
            class:
              "border-l-2 border-slate-300 dark:border-slate-600 pl-3 italic text-slate-600 dark:text-slate-400",
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
            "bg-slate-50 dark:bg-[#0d0f17] rounded-lg p-3 text-xs font-mono overflow-x-auto my-1 border border-slate-100 dark:border-slate-800",
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
      // eslint-disable-next-line react-hooks/refs -- Tiptap suggestions resolve these getters later during editor interaction, not during React render
      createAtMention(() => fileSearchContextRef.current),
      // eslint-disable-next-line react-hooks/refs -- Tiptap suggestions resolve these getters later during editor interaction, not during React render
      createHashMention(() => agentItemsRef.current),
      // eslint-disable-next-line react-hooks/refs -- Tiptap suggestions resolve these getters later during editor interaction, not during React render
      createSkillMention(() => mergedSkillItemsRef.current),
      // eslint-disable-next-line react-hooks/refs -- EnterToSend intentionally calls the latest ref-backed send handler
      EnterToSend.configure({
        onSend: handleSendProxy,
      }),
    ],
    editable: !disabled,
    editorProps: {
      attributes: {
        class: editorClass,
        "data-testid": "tiptap-editor",
        "aria-label": placeholder,
        role: "textbox",
        "aria-multiline": "true",
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

  // Insert a skill mention when pendingSkill is set from outside (e.g. skill chip click)
  useEffect(() => {
    if (!pendingSkill || !editor) return;
    editor
      .chain()
      .focus()
      .insertContent({
        type: "skillMention",
        attrs: { id: pendingSkill, label: pendingSkill },
      })
      .insertContent(" ")
      .run();
    onSkillInserted?.();
  }, [pendingSkill, editor, onSkillInserted]);

  // Restore prefill text (e.g. after a session error) into the editor
  useEffect(() => {
    if (!prefillText || !editor) return;
    editor.commands.setContent(prefillText);
    editor.commands.focus("end");
    onPrefillConsumed?.();
  }, [prefillText, editor, onPrefillConsumed]);
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
    } else {
      const textSkillMatch = cleanText.match(/^\/([^\s]+)\s*/);
      if (textSkillMatch) {
        const typedSkill = textSkillMatch[1].toLowerCase();
        const matchedSkill = mergedSkillItems.find((item) =>
          item.id.toLowerCase() === typedSkill || item.label.toLowerCase() === typedSkill
        );
        if (matchedSkill) {
          skill = matchedSkill.id;
          cleanText = cleanText.slice(textSkillMatch[0].length).trim();
        }
      }
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
      model: selectedModel || undefined,
    });
    editor.commands.clearContent();
  }, [editor, onSend, disabled, loading, repoSelection, providers, selectedProvider, claudeMode, opencodeMode, sessions, agentRole, selectedModel, mergedSkillItems]);

  // Keep ref updated so EnterToSend and external send button always call latest
  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  // Close model dropdown on click outside
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
        setModelFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelDropdownOpen]);

  // Reset model when provider changes (model IDs are provider-specific)
  useEffect(() => {
    setSelectedModel("");
    setAvailableModels([]);
  }, [selectedProvider]);

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <div className="flex-1 flex flex-col gap-1.5">
      {/* Editor wrapper */}
      <div className={wrapperClass} data-testid="tiptap-input">
        <EditorContent editor={editor} />

        {/* Bottom toolbar */}
        <div className={toolbarClass}>
          {/* Repo picker */}
          <div className="min-w-0 flex-1">
            <RepoPicker
              value={repoSelection}
              onChange={onRepoChange}
              additionalRepos={additionalRepos}
              pathDisplay={repoPathDisplay}
            />
          </div>

          {/* Provider dropdown */}
          <div className="shrink-0">
            <AcpProviderDropdown
              providers={providers}
              selectedProvider={selectedProvider}
              onProviderChange={onProviderChange ?? (() => {})}
              disabled={disabled}
              variant={isHero ? "hero" : "compact"}
            />
          </div>

          {/* Model selector — shown for providers that support model listing */}
          {onFetchModels && (selectedProvider === "opencode" || selectedProvider === "gemini") && (
            <div ref={modelDropdownRef}>
              <button
                ref={modelBtnRef}
                type="button"
                onClick={async () => {
                  if (!modelDropdownOpen && modelBtnRef.current) {
                    const rect = modelBtnRef.current.getBoundingClientRect();
                    const spaceAbove = rect.top - 8;
                    const spaceBelow = window.innerHeight - rect.bottom - 8;
                    if (spaceAbove >= spaceBelow) {
                      // open upward, cap height to available space
                      setModelDropdownPos({ left: rect.left, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.min(spaceAbove, 280) });
                    } else {
                      // open downward
                      setModelDropdownPos({ left: rect.left, top: rect.bottom + 4, maxHeight: Math.min(spaceBelow, 280) });
                    }
                  }
                  if (!modelDropdownOpen && availableModels.length === 0) {
                    setModelLoading(true);
                    const models = await onFetchModels(selectedProvider);
                    setAvailableModels(models);
                    setModelLoading(false);
                  }
                  setModelDropdownOpen((v) => !v);
                  setModelFilter("");
                }}
                className={modelButtonClass}
                title="Select model"
              >
                <svg className="w-3 h-3 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className={`font-medium truncate ${isHero ? "max-w-[180px] text-slate-700 dark:text-slate-200" : "max-w-[140px] text-slate-700 dark:text-slate-300"}`}>
                  {selectedModel ? selectedModel.split("/").pop() : "Default model"}
                </span>
                {modelLoading
                  ? <span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
                  : <svg className={`w-3 h-3 text-slate-400 transition-transform ${modelDropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                }
              </button>

              {modelDropdownOpen && modelDropdownPos && (
                <div
                  className="fixed w-72 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2130] shadow-xl z-[9999] flex flex-col"
                  style={{ left: modelDropdownPos.left, bottom: modelDropdownPos.bottom, top: modelDropdownPos.top, maxHeight: `${modelDropdownPos.maxHeight}px` }}
                >
                  {/* Search */}
                  <div className="p-2 border-b border-slate-100 dark:border-slate-800">
                    <input
                      autoFocus
                      type="text"
                      value={modelFilter}
                      onChange={(e) => setModelFilter(e.target.value)}
                      placeholder="Filter models..."
                      className="w-full px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-transparent outline-none focus:ring-1 focus:ring-blue-500 text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {/* Default option */}
                    <button
                      type="button"
                      onClick={() => { setSelectedModel(""); setModelDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                        !selectedModel
                          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <span className="font-medium">Default model</span>
                    </button>
                    {availableModels
                      .filter((m) => !modelFilter || m.toLowerCase().includes(modelFilter.toLowerCase()))
                      .map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => { setSelectedModel(m); setModelDropdownOpen(false); setModelFilter(""); }}
                          className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                            m === selectedModel
                              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                              : "hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          <span className="text-slate-400 dark:text-slate-500 font-mono text-[10px] shrink-0">
                            {m.split("/")[0]}
                          </span>
                          <span className="font-medium truncate">{m.split("/").slice(1).join("/") || m}</span>
                        </button>
                      ))
                    }
                    {availableModels.length === 0 && !modelLoading && (
                      <div className="px-3 py-3 text-xs text-slate-400 text-center">No models found</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

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

          {/* Usage indicator (shown when we have usage data) */}
          {usageInfo && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-500 dark:text-slate-400 font-mono" title={`Input: ${usageInfo.inputTokens.toLocaleString()} tokens\nOutput: ${usageInfo.outputTokens.toLocaleString()} tokens`}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>{usageInfo.totalTokens.toLocaleString()}</span>
              <span className="text-slate-400 dark:text-slate-500">tokens</span>
            </div>
          )}

          {/* Hints + send */}
          <span className={hintClass}>
            <kbd className={hintKbdClass}>@</kbd> file
            <span className="mx-1.5">&middot;</span>
            <kbd className={hintKbdClass}>#</kbd> agent
            <span className="mx-1.5">&middot;</span>
            <kbd className={hintKbdClass}>/</kbd> skill
          </span>
          {loading ? (
            <button
              type="button"
              onClick={() => onStop?.()}
              className={stopButtonClass}
              title={t.common.stop}
            >
              <svg className={isHero ? "h-4 w-4" : "w-3 h-3"} fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={disabled}
              className={sendButtonClass}
              title={t.common.send}
              data-testid="tiptap-send-button"
              aria-label={t.common.send}
            >
              <svg className={isHero ? "h-4 w-4" : "w-3 h-3"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          )}
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
          : "bg-transparent text-slate-500 border-slate-200 hover:bg-slate-100 dark:text-slate-400 dark:border-slate-700 dark:hover:bg-slate-800"
      }`}
    >
      {label}
    </button>
  );
}
