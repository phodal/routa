/**
 * Unified Storage Provider Interfaces
 *
 * Defines the contracts for session and trace storage that both
 * local (JSONL file) and remote (Postgres) providers implement.
 */

import type { TraceRecord } from "../trace/types";
import type { TraceQuery } from "../trace/reader";

// ─── Session Types ──────────────────────────────────────────────────

/** A single message entry in a session JSONL file. */
export interface SessionMessage {
  uuid: string;
  type: string;
  message: unknown;
  parentUuid?: string;
  sessionId: string;
  timestamp: string;
}

/** Metadata entry written to session JSONL. */
export interface SessionMetadata {
  type: "metadata";
  sessionId: string;
  name?: string;
  cwd: string;
  branch?: string;
  workspaceId: string;
  routaAgentId?: string;
  provider?: string;
  role?: string;
  modeId?: string;
  model?: string;
  parentSessionId?: string;
  executionMode?: "embedded" | "runner";
  ownerInstanceId?: string;
  leaseExpiresAt?: string;
  createdAt: string;
}

/** Summary entry written to session JSONL. */
export interface SessionSummary {
  type: "summary";
  summary: string;
  leafUuid?: string;
}

/** Union of all JSONL entry types. */
export type SessionJsonlEntry = SessionMessage | SessionMetadata | SessionSummary;

/** Session record for listing. */
export interface SessionRecord {
  id: string;
  name?: string;
  cwd: string;
  branch?: string;
  workspaceId: string;
  routaAgentId?: string;
  provider?: string;
  role?: string;
  modeId?: string;
  model?: string;
  firstPromptSent?: boolean;
  parentSessionId?: string;
  executionMode?: "embedded" | "runner";
  ownerInstanceId?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Session Storage Provider ───────────────────────────────────────

export interface SessionStorageProvider {
  /** Create or update a session. */
  save(session: SessionRecord): Promise<void>;

  /** Get a session by ID. */
  get(sessionId: string): Promise<SessionRecord | undefined>;

  /** List all sessions, sorted by most recent first. */
  list(workspaceId?: string, limit?: number): Promise<SessionRecord[]>;

  /** Delete a session. */
  delete(sessionId: string): Promise<void>;

  /** Get message history for a session. */
  getHistory(sessionId: string): Promise<unknown[]>;

  /** Append a message to session history. */
  appendMessage(sessionId: string, entry: SessionJsonlEntry): Promise<void>;
}

// ─── Trace Storage Provider ─────────────────────────────────────────

export interface TraceStorageProvider {
  /** Append a trace record. */
  append(record: TraceRecord): Promise<void>;

  /** Query traces with filters. */
  query(query: TraceQuery): Promise<TraceRecord[]>;

  /** Get a single trace by ID. */
  getById(id: string): Promise<TraceRecord | null>;

  /** Get trace statistics. */
  stats(): Promise<{
    totalDays: number;
    totalFiles: number;
    totalRecords: number;
    uniqueSessions: number;
    eventTypes: Record<string, number>;
  }>;
}
