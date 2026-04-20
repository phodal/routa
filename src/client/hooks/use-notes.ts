"use client";

/**
 * useNotes - React hook for collaborative note management.
 *
 * Provides:
 * - Fetching notes from the server
 * - Real-time updates via SSE subscription
 * - CRUD operations that sync to server
 * - Automatic reconnection on SSE drop
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  desktopAwareFetch,
  getDesktopApiBaseUrl,
  logRuntime,
  shouldSuppressTeardownError,
  toErrorMessage,
} from "../utils/diagnostics";
import { resolveApiPath } from "../config/backend";

export interface NoteData {
  id: string;
  title: string;
  content: string;
  workspaceId: string;
  sessionId?: string;
  metadata: {
    type: "spec" | "task" | "general";
    taskStatus?: string;
    assignedAgentIds?: string[];
    parentNoteId?: string;
    linkedTaskId?: string;
    childSessionId?: string;
    provider?: string;
    custom?: Record<string, string>;
  };
  createdAt: string;
  updatedAt: string;
}

export interface UseNotesReturn {
  notes: NoteData[];
  loading: boolean;
  error: string | null;
  connected: boolean;
  /** Fetch all notes for the workspace */
  fetchNotes: () => Promise<void>;
  /** Fetch a single note by ID */
  fetchNote: (noteId: string) => Promise<NoteData | null>;
  /** Create a new note */
  createNote: (params: {
    noteId?: string;
    title: string;
    content?: string;
    type?: "spec" | "task" | "general";
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<NoteData | null>;
  /** Update an existing note */
  updateNote: (
    noteId: string,
    update: { title?: string; content?: string; metadata?: Record<string, unknown> }
  ) => Promise<NoteData | null>;
  /** Delete a note */
  deleteNote: (noteId: string) => Promise<void>;
}

/**
 * Normalize a Note from SSE/API to ensure consistent NoteData shape.
 * SSE broadcasts raw Note objects with Date timestamps; API returns serialized strings.
 */
function normalizeNote(raw: Record<string, unknown>): NoteData {
  return {
    id: raw.id as string,
    title: raw.title as string,
    content: (raw.content as string) ?? "",
    workspaceId: raw.workspaceId as string,
    sessionId: raw.sessionId as string | undefined,
    metadata: (raw.metadata ?? { type: "general" }) as NoteData["metadata"],
    createdAt: typeof raw.createdAt === "string"
      ? raw.createdAt
      : (raw.createdAt as Date)?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === "string"
      ? raw.updatedAt
      : (raw.updatedAt as Date)?.toISOString?.() ?? new Date().toISOString(),
  };
}

function shouldIncludeSessionNote(note: NoteData, sessionId?: string): boolean {
  if (!sessionId) return true;

  const noteSessionId = note.sessionId;
  const noteType = note.metadata?.type;

  if (noteType === "task") {
    return noteSessionId === sessionId;
  }

  if (noteType === "spec" || noteType === "general") {
    return !noteSessionId || noteSessionId === sessionId;
  }

  return noteSessionId === sessionId;
}

export function useNotes(workspaceId: string, sessionId?: string): UseNotesReturn {
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tearingDownRef = useRef(false);

  // ─── Fetch Notes ──────────────────────────────────────────────────

  const fetchNotes = useCallback(async () => {
    tearingDownRef.current = false;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/notes?workspaceId=${encodeURIComponent(workspaceId)}`;
      const res = await desktopAwareFetch(url);
      if (!res.ok) throw new Error(`Failed to fetch notes: ${res.status}`);
      const data = await res.json();
      if (tearingDownRef.current) return;
      const fetchedNotes = Array.isArray(data.notes)
        ? (data.notes as Record<string, unknown>[]).map(normalizeNote)
        : [];
      setNotes(fetchedNotes.filter((note) => shouldIncludeSessionNote(note, sessionId)));
    } catch (err) {
      if (tearingDownRef.current || shouldSuppressTeardownError(err)) {
        return;
      }
      logRuntime("warn", "useNotes.fetchNotes", "Failed to fetch notes", err);
      setError(toErrorMessage(err) || "Failed to fetch notes");
    } finally {
      if (tearingDownRef.current) {
        // Early return is safe here - cleanup is handled by teardown
        // eslint-disable-next-line no-unsafe-finally
        return;
      }
      setLoading(false);
    }
  }, [workspaceId, sessionId]);

  const fetchNote = useCallback(
    async (noteId: string): Promise<NoteData | null> => {
      try {
        const res = await desktopAwareFetch(
          `/api/notes?workspaceId=${encodeURIComponent(workspaceId)}&noteId=${encodeURIComponent(noteId)}`
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.note ?? null;
      } catch {
        return null;
      }
    },
    [workspaceId]
  );

  // ─── CRUD Operations ──────────────────────────────────────────────

  const createNote = useCallback(
    async (params: {
      noteId?: string;
      title: string;
      content?: string;
      type?: "spec" | "task" | "general";
      sessionId?: string;
      metadata?: Record<string, unknown>;
    }): Promise<NoteData | null> => {
      try {
        const res = await desktopAwareFetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...params, workspaceId, source: "user" }),
        });
        if (!res.ok) throw new Error(`Failed to create note: ${res.status}`);
        const data = await res.json();
        return data.note ?? null;
      } catch (err) {
        logRuntime("warn", "useNotes.createNote", "Failed to create note", err);
        setError(toErrorMessage(err) || "Failed to create note");
        return null;
      }
    },
    [workspaceId]
  );

  const updateNote = useCallback(
    async (
      noteId: string,
      update: { title?: string; content?: string; metadata?: Record<string, unknown> }
    ): Promise<NoteData | null> => {
      try {
        const res = await desktopAwareFetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ noteId, ...update, workspaceId, source: "user" }),
        });
        if (!res.ok) throw new Error(`Failed to update note: ${res.status}`);
        const data = await res.json();
        return data.note ?? null;
      } catch (err) {
        logRuntime("warn", "useNotes.updateNote", "Failed to update note", err);
        setError(toErrorMessage(err) || "Failed to update note");
        return null;
      }
    },
    [workspaceId]
  );

  const deleteNote = useCallback(
    async (noteId: string): Promise<void> => {
      try {
        const res = await desktopAwareFetch(
          `/api/notes?noteId=${encodeURIComponent(noteId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error(`Failed to delete note: ${res.status}`);
      } catch (err) {
        logRuntime("warn", "useNotes.deleteNote", "Failed to delete note", err);
        setError(toErrorMessage(err) || "Failed to delete note");
      }
    },
    [workspaceId]
  );

  // ─── SSE Subscription ────────────────────────────────────────────

  /**
   * Check if a note should be included based on sessionId filter.
   * - If no sessionId filter, include all notes
   * - Task notes require exact sessionId match
   * - Spec/general notes: include if no sessionId or matching sessionId
   */
  const shouldIncludeNote = useCallback((note: NoteData): boolean => {
    return shouldIncludeSessionNote(note, sessionId);
  }, [sessionId]);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const base = getDesktopApiBaseUrl();
    // SSE subscribes at workspace level; filtering happens client-side
    const es = new EventSource(
      resolveApiPath(`api/notes/events?workspaceId=${encodeURIComponent(workspaceId)}`, base),
    );
    eventSourceRef.current = es;

    es.onopen = () => {
      if (tearingDownRef.current) return;
      setConnected(true);
      setError(null);
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "connected") {
          setConnected(true);
          // Re-fetch notes on reconnect to catch any missed events
          fetchNotes();
          return;
        }

        if (data.type === "note:created" && data.note) {
          const note = normalizeNote(data.note);
          // Filter by sessionId if provided
          if (!shouldIncludeNote(note)) return;
          setNotes((prev) => {
            // Avoid duplicates
            if (prev.some((n) => n.id === note.id)) {
              return prev.map((n) => (n.id === note.id ? note : n));
            }
            return [...prev, note];
          });
        }

        if (data.type === "note:updated" && data.note) {
          const note = normalizeNote(data.note);
          // Filter by sessionId if provided
          if (!shouldIncludeNote(note)) {
            // If note no longer matches filter, remove it
            setNotes((prev) => prev.filter((n) => n.id !== note.id));
            return;
          }
          setNotes((prev) => {
            // If note doesn't exist yet (missed create event), add it
            if (!prev.some((n) => n.id === note.id)) {
              return [...prev, note];
            }
            return prev.map((n) => (n.id === note.id ? note : n));
          });
        }

        if (data.type === "note:deleted") {
          setNotes((prev) => prev.filter((n) => n.id !== data.noteId));
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      if (tearingDownRef.current || document.visibilityState === "hidden") {
        es.close();
        eventSourceRef.current = null;
        return;
      }
      logRuntime("warn", "useNotes.connectSSE", "SSE connection error");
      setConnected(false);
      es.close();
      eventSourceRef.current = null;

      // Reconnect after 3s
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => connectSSE(), 3000);
    };
  }, [workspaceId, shouldIncludeNote, fetchNotes]);

  // Clear notes when workspaceId or sessionId changes to avoid showing stale data
  useEffect(() => {
    setNotes([]);
    setConnected(false);
  }, [workspaceId, sessionId]);

  // Connect SSE and fetch initial notes
  useEffect(() => {
    // Skip if workspaceId is a placeholder (static export mode)
    if (workspaceId === "__placeholder__") return;

    tearingDownRef.current = false;

    fetchNotes();
    connectSSE();

    return () => {
      tearingDownRef.current = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [fetchNotes, connectSSE, workspaceId]);

  return {
    notes,
    loading,
    error,
    connected,
    fetchNotes,
    fetchNote,
    createNote,
    updateNote,
    deleteNote,
  };
}
