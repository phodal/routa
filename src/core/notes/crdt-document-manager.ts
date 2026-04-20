/**
 * CRDTDocumentManager - Yjs-backed CRDT document management for notes.
 *
 * Each note gets a Y.Doc instance for conflict-free concurrent editing.
 * When multiple agents or the user edit the same note simultaneously,
 * Yjs merges the changes automatically.
 *
 * Modeled after Intent's CRDTDocumentManager but adapted for a web app:
 * - Session-only (in-memory, not persisted)
 * - Sync via SSE + REST, not IPC
 * - 24h inactivity cleanup
 */

import type { Doc } from "yjs";

// Yjs publishes separate ESM and CJS entrypoints. In the Next/Turbopack server
// runtime, mixing those entrypoints can trigger Yjs's duplicate-import guard and
// break constructor checks. Keep this server-side note layer on the CJS entry.
const Y = require("yjs") as typeof import("yjs");

export interface CRDTDocument {
  doc: Doc;
  lastAccess: Date;
  isDirty: boolean;
}

export class CRDTDocumentManager {
  private documents = new Map<string, CRDTDocument>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /** Change listeners: called when a doc is updated */
  private changeListeners = new Set<
    (key: string, content: string, source: "local" | "remote") => void
  >();

  constructor() {
    // Cleanup stale docs every hour
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  /**
   * Get or create a CRDT document for a note.
   */
  getOrCreate(workspaceId: string, noteId: string, initialContent?: string): CRDTDocument {
    const key = this.key(workspaceId, noteId);
    let entry = this.documents.get(key);

    if (!entry) {
      const doc = new Y.Doc();
      if (initialContent) {
        const text = doc.getText("content");
        doc.transact(() => {
          text.insert(0, initialContent);
        });
      }
      entry = { doc, lastAccess: new Date(), isDirty: false };

      // Observe changes to emit events
      doc.getText("content").observe(() => {
        entry!.isDirty = true;
        entry!.lastAccess = new Date();
        const currentContent = doc.getText("content").toString();
        for (const listener of this.changeListeners) {
          try {
            listener(key, currentContent, "local");
          } catch (err) {
            console.error("[CRDTDocumentManager] Change listener error:", err);
          }
        }
      });

      this.documents.set(key, entry);
    }

    entry.lastAccess = new Date();
    return entry;
  }

  /**
   * Initialize a document with content (replaces existing content).
   */
  initializeWithContent(workspaceId: string, noteId: string, content: string): void {
    const entry = this.getOrCreate(workspaceId, noteId);
    const text = entry.doc.getText("content");

    entry.doc.transact(() => {
      text.delete(0, text.length);
      if (content) {
        text.insert(0, content);
      }
    });
    entry.isDirty = false;
  }

  /**
   * Update content using text diff for minimal CRDT operations.
   * This is the key method for collaborative editing - it computes
   * the difference between current and new content and applies
   * minimal insert/delete operations.
   */
  updateContent(workspaceId: string, noteId: string, newContent: string): void {
    const entry = this.getOrCreate(workspaceId, noteId);
    const text = entry.doc.getText("content");
    const currentContent = text.toString();

    if (currentContent === newContent) return;

    entry.doc.transact(() => {
      // Compute simple diff and apply minimal operations
      const ops = computeTextDiff(currentContent, newContent);
      let offset = 0;
      for (const op of ops) {
        switch (op.type) {
          case "retain":
            offset += op.length;
            break;
          case "insert":
            text.insert(offset, op.text);
            offset += op.text.length;
            break;
          case "delete":
            text.delete(offset, op.length);
            break;
        }
      }
    });
  }

  /**
   * Get the current content of a note's CRDT document.
   */
  getContent(workspaceId: string, noteId: string): string | undefined {
    const key = this.key(workspaceId, noteId);
    const entry = this.documents.get(key);
    if (!entry) return undefined;
    entry.lastAccess = new Date();
    return entry.doc.getText("content").toString();
  }

  /**
   * Apply a remote Yjs update (binary) to a document.
   */
  applyUpdate(workspaceId: string, noteId: string, update: Uint8Array): void {
    const entry = this.getOrCreate(workspaceId, noteId);
    Y.applyUpdate(entry.doc, update);
    entry.lastAccess = new Date();
  }

  /**
   * Get the full state as a Yjs update (for syncing to new clients).
   */
  getStateAsUpdate(workspaceId: string, noteId: string): Uint8Array | undefined {
    const key = this.key(workspaceId, noteId);
    const entry = this.documents.get(key);
    if (!entry) return undefined;
    return Y.encodeStateAsUpdate(entry.doc);
  }

  /**
   * Remove a document.
   */
  removeDocument(workspaceId: string, noteId: string): void {
    const key = this.key(workspaceId, noteId);
    const entry = this.documents.get(key);
    if (entry) {
      entry.doc.destroy();
      this.documents.delete(key);
    }
  }

  /**
   * Register a change listener.
   */
  onChange(listener: (key: string, content: string, source: "local" | "remote") => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /**
   * Clean up documents inactive for 24 hours.
   */
  private cleanup(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, entry] of this.documents) {
      if (entry.lastAccess.getTime() < cutoff) {
        entry.doc.destroy();
        this.documents.delete(key);
      }
    }
  }

  /**
   * Destroy the manager and all documents.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    for (const entry of this.documents.values()) {
      entry.doc.destroy();
    }
    this.documents.clear();
    this.changeListeners.clear();
  }

  private key(workspaceId: string, noteId: string): string {
    return `${workspaceId}:${noteId}`;
  }
}

// ─── Text Diff ──────────────────────────────────────────────────────────

type DiffOp =
  | { type: "retain"; length: number }
  | { type: "insert"; text: string }
  | { type: "delete"; length: number };

/**
 * Compute a simple text diff as a sequence of retain/insert/delete operations.
 * Uses a basic approach: find common prefix, common suffix, then replace the middle.
 */
export function computeTextDiff(oldText: string, newText: string): DiffOp[] {
  if (oldText === newText) return [{ type: "retain", length: oldText.length }];

  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (not overlapping with prefix)
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const ops: DiffOp[] = [];

  if (prefixLen > 0) {
    ops.push({ type: "retain", length: prefixLen });
  }

  const oldMiddleLen = oldText.length - prefixLen - suffixLen;
  const newMiddle = newText.slice(prefixLen, newText.length - suffixLen);

  if (oldMiddleLen > 0) {
    ops.push({ type: "delete", length: oldMiddleLen });
  }

  if (newMiddle.length > 0) {
    ops.push({ type: "insert", text: newMiddle });
  }

  if (suffixLen > 0) {
    ops.push({ type: "retain", length: suffixLen });
  }

  return ops;
}
