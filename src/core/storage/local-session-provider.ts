/**
 * LocalSessionProvider — JSONL file-based session storage.
 *
 * Stores sessions under ~/.routa/projects/{folder-slug}/sessions/{uuid}.jsonl
 *
 * Each session file contains:
 * - A metadata entry (first line)
 * - Optional summary entries
 * - Message entries (one per line, appended)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getSessionsDir } from "./folder-slug";
import { JsonlWriter, readJsonlFile, listJsonlFiles } from "./jsonl-writer";
import type {
  SessionStorageProvider,
  SessionRecord,
  SessionJsonlEntry,
  SessionMetadata,
  SessionSummary,
} from "./types";

export class LocalSessionProvider implements SessionStorageProvider {
  private writers = new Map<string, JsonlWriter>();

  constructor(private projectPath: string) {}

  private get sessionsDir(): string {
    return getSessionsDir(this.projectPath);
  }

  private sessionFilePath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.jsonl`);
  }

  private getWriter(sessionId: string): JsonlWriter {
    let writer = this.writers.get(sessionId);
    if (!writer) {
      writer = new JsonlWriter(this.sessionFilePath(sessionId));
      this.writers.set(sessionId, writer);
    }
    return writer;
  }

  async save(session: SessionRecord): Promise<void> {
    const filePath = this.sessionFilePath(session.id);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write metadata as first entry
    const metadata: SessionMetadata = {
      type: "metadata",
      sessionId: session.id,
      name: session.name,
      cwd: session.cwd,
      branch: session.branch,
      workspaceId: session.workspaceId,
      routaAgentId: session.routaAgentId,
      provider: session.provider,
      role: session.role,
      modeId: session.modeId,
      model: session.model,
      parentSessionId: session.parentSessionId,
      executionMode: session.executionMode,
      ownerInstanceId: session.ownerInstanceId,
      leaseExpiresAt: session.leaseExpiresAt,
      createdAt: session.createdAt,
    };

    // Check if file exists — if so, update metadata in place
    try {
      await fs.access(filePath);
      // File exists — read, replace metadata, rewrite
      const entries = await readJsonlFile<SessionJsonlEntry>(filePath);
      const metaIndex = entries.findIndex(
        (e) => (e as SessionMetadata).type === "metadata"
      );
      if (metaIndex >= 0) {
        entries[metaIndex] = metadata;
      } else {
        entries.unshift(metadata);
      }
      // Rewrite file
      const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
      await fs.writeFile(filePath, content, "utf-8");
    } catch {
      // File doesn't exist — create with metadata
      const writer = this.getWriter(session.id);
      await writer.append(metadata);
    }
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    const filePath = this.sessionFilePath(sessionId);
    const entries = await readJsonlFile<SessionJsonlEntry>(filePath);
    if (entries.length === 0) return undefined;

    const metadata = entries.find(
      (e) => (e as SessionMetadata).type === "metadata"
    ) as SessionMetadata | undefined;

    if (!metadata) return undefined;

    // Derive name from summary or first user message
    const summary = entries.find(
      (e) => (e as SessionSummary).type === "summary"
    ) as SessionSummary | undefined;

    const name =
      metadata.name ||
      summary?.summary ||
      this.deriveLabel(entries) ||
      "Routa Session";

    return {
      id: sessionId,
      name,
      cwd: metadata.cwd,
      branch: metadata.branch,
      workspaceId: metadata.workspaceId,
      routaAgentId: metadata.routaAgentId,
      provider: metadata.provider,
      role: metadata.role,
      modeId: metadata.modeId,
      model: metadata.model,
      parentSessionId: metadata.parentSessionId,
      executionMode: metadata.executionMode,
      ownerInstanceId: metadata.ownerInstanceId,
      leaseExpiresAt: metadata.leaseExpiresAt,
      createdAt: metadata.createdAt,
      updatedAt: this.getLastTimestamp(entries) || metadata.createdAt,
    };
  }

  async list(workspaceId?: string, limit?: number): Promise<SessionRecord[]> {
    const dir = this.sessionsDir;
    const files = await listJsonlFiles(dir);
    const sessions: SessionRecord[] = [];

    for (const file of files) {
      const sessionId = path.basename(file, ".jsonl");
      const session = await this.get(sessionId);
      if (!session) continue;
      if (workspaceId && session.workspaceId !== workspaceId) continue;
      sessions.push(session);
    }

    // Sort by updatedAt descending
    sessions.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return limit ? sessions.slice(0, limit) : sessions;
  }

  async delete(sessionId: string): Promise<void> {
    this.writers.delete(sessionId);
    try {
      await fs.unlink(this.sessionFilePath(sessionId));
    } catch {
      // File may not exist
    }
  }

  async getHistory(sessionId: string): Promise<unknown[]> {
    const entries = await readJsonlFile<SessionJsonlEntry>(
      this.sessionFilePath(sessionId)
    );
    // Return message entries sorted by timestamp
    return entries
      .filter((e) => {
        const t = (e as SessionMetadata).type;
        return t !== "metadata" && t !== "summary";
      })
      .sort((a, b) => {
        const aTs = (a as { timestamp?: string }).timestamp || "";
        const bTs = (b as { timestamp?: string }).timestamp || "";
        return aTs.localeCompare(bTs);
      });
  }

  async appendMessage(
    sessionId: string,
    entry: SessionJsonlEntry
  ): Promise<void> {
    const writer = this.getWriter(sessionId);
    await writer.append(entry);
  }

  async replaceHistory(
    sessionId: string,
    entries: SessionJsonlEntry[]
  ): Promise<void> {
    const filePath = this.sessionFilePath(sessionId);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    const existing = await readJsonlFile<SessionJsonlEntry>(filePath);
    const preserved = existing.filter((entry) => {
      const type = (entry as SessionMetadata | SessionSummary).type;
      return type === "metadata" || type === "summary";
    });

    const content = [...preserved, ...entries]
      .map((entry) => JSON.stringify(entry))
      .join("\n");

    await fs.writeFile(filePath, content ? `${content}\n` : "", "utf-8");
    this.writers.delete(sessionId);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  /** Derive a label from the first user message (truncated to 80 chars). */
  private deriveLabel(entries: SessionJsonlEntry[]): string | undefined {
    for (const entry of entries) {
      const msg = entry as { type?: string; message?: unknown };
      if (msg.type === "user_message") {
        const text =
          typeof msg.message === "string"
            ? msg.message
            : JSON.stringify(msg.message);
        return text.length > 80 ? text.slice(0, 80) + "…" : text;
      }
    }
    return undefined;
  }

  /** Get the last timestamp from entries. */
  private getLastTimestamp(entries: SessionJsonlEntry[]): string | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
      const ts = (entries[i] as { timestamp?: string }).timestamp;
      if (ts) return ts;
    }
    return undefined;
  }
}
