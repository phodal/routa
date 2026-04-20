import { useEffect } from "react";

export interface KeyboardShortcutCallbacks {
  onTogglePanel?: () => void;
  onStageSelected?: () => void;
  onUnstageSelected?: () => void;
  onOpenCommit?: () => void;
  onEscape?: () => void;
  onSelectAll?: () => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  onShowDiff?: () => void;
}

interface UseKeyboardShortcutsOptions {
  enabled: boolean;
  callbacks: KeyboardShortcutCallbacks;
}

/**
 * Hook for registering keyboard shortcuts for the file changes panel
 */
export function useKeyboardShortcuts({ enabled, callbacks }: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modKey = isMac ? event.metaKey : event.ctrlKey;

      // Cmd/Ctrl + K: Toggle panel
      if (modKey && event.key === "k") {
        event.preventDefault();
        callbacks.onTogglePanel?.();
        return;
      }

      // Escape: Close panel or collapse diff
      if (event.key === "Escape") {
        event.preventDefault();
        callbacks.onEscape?.();
        return;
      }

      // Space: Stage/unstage selected file(s)
      if (event.key === " " && !event.shiftKey && !modKey) {
        // Only if not in an input field
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return;
        }
        event.preventDefault();
        callbacks.onStageSelected?.();
        return;
      }

      // Enter: Show diff for selected file
      if (event.key === "Enter" && !modKey) {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return;
        }
        event.preventDefault();
        callbacks.onShowDiff?.();
        return;
      }

      // Cmd/Ctrl + A: Select all files in current section
      if (modKey && event.key === "a") {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return;
        }
        event.preventDefault();
        callbacks.onSelectAll?.();
        return;
      }

      // Cmd/Ctrl + Enter: Open commit modal (if in staged section with files)
      if (modKey && event.key === "Enter") {
        event.preventDefault();
        callbacks.onOpenCommit?.();
        return;
      }

      // Arrow Up: Navigate to previous file
      if (event.key === "ArrowUp" && !modKey) {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return;
        }
        event.preventDefault();
        callbacks.onNavigateUp?.();
        return;
      }

      // Arrow Down: Navigate to next file
      if (event.key === "ArrowDown" && !modKey) {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return;
        }
        event.preventDefault();
        callbacks.onNavigateDown?.();
        return;
      }

      // Shift + Space: Unstage selected file(s)
      if (event.key === " " && event.shiftKey && !modKey) {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return;
        }
        event.preventDefault();
        callbacks.onUnstageSelected?.();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, callbacks]);
}

/**
 * Get keyboard shortcut help text
 */
export function getKeyboardShortcutHelp(): Array<{ keys: string; description: string }> {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modKey = isMac ? "⌘" : "Ctrl";

  return [
    { keys: `${modKey} K`, description: "Toggle file changes panel" },
    { keys: "Space", description: "Stage selected files" },
    { keys: "Shift Space", description: "Unstage selected files" },
    { keys: "Enter", description: "Show diff for selected file" },
    { keys: `${modKey} Enter`, description: "Open commit modal" },
    { keys: `${modKey} A`, description: "Select all files" },
    { keys: "↑/↓", description: "Navigate files" },
    { keys: "Esc", description: "Close panel or diff" },
  ];
}
