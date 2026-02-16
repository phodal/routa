/**
 * PgNoteStore — Postgres-backed note store using Drizzle ORM.
 */

import { eq, and } from "drizzle-orm";
import type { Database } from "./index";
import { notes } from "./schema";
import type { Note, NoteType, NoteMetadata } from "../models/note";
import { createSpecNote, SPEC_NOTE_ID } from "../models/note";
import type { NoteStore } from "../store/note-store";

export class PgNoteStore implements NoteStore {
  constructor(private db: Database) {}

  async save(note: Note, _source?: "agent" | "user" | "system"): Promise<void> {
    await this.db
      .insert(notes)
      .values({
        id: note.id,
        workspaceId: note.workspaceId,
        title: note.title,
        content: note.content,
        type: note.metadata.type,
        taskStatus: note.metadata.taskStatus,
        assignedAgentIds: note.metadata.assignedAgentIds,
        parentNoteId: note.metadata.parentNoteId,
        linkedTaskId: note.metadata.linkedTaskId,
        customMetadata: note.metadata.custom,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })
      .onConflictDoUpdate({
        target: [notes.workspaceId, notes.id],
        set: {
          title: note.title,
          content: note.content,
          type: note.metadata.type,
          taskStatus: note.metadata.taskStatus,
          assignedAgentIds: note.metadata.assignedAgentIds,
          parentNoteId: note.metadata.parentNoteId,
          linkedTaskId: note.metadata.linkedTaskId,
          customMetadata: note.metadata.custom,
          updatedAt: new Date(),
        },
      });
  }

  async get(noteId: string, workspaceId: string): Promise<Note | undefined> {
    const rows = await this.db
      .select()
      .from(notes)
      .where(and(eq(notes.workspaceId, workspaceId), eq(notes.id, noteId)))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Note[]> {
    const rows = await this.db
      .select()
      .from(notes)
      .where(eq(notes.workspaceId, workspaceId));
    return rows.map(this.toModel);
  }

  async listByType(workspaceId: string, type: NoteType): Promise<Note[]> {
    const rows = await this.db
      .select()
      .from(notes)
      .where(and(eq(notes.workspaceId, workspaceId), eq(notes.type, type)));
    return rows.map(this.toModel);
  }

  async listByAssignedAgent(workspaceId: string, agentId: string): Promise<Note[]> {
    // jsonb array containment: check if assigned_agent_ids contains agentId
    const allNotes = await this.listByWorkspace(workspaceId);
    return allNotes.filter(
      (n) => n.metadata.assignedAgentIds?.includes(agentId)
    );
  }

  async delete(noteId: string, workspaceId: string): Promise<void> {
    await this.db
      .delete(notes)
      .where(and(eq(notes.workspaceId, workspaceId), eq(notes.id, noteId)));
  }

  async ensureSpec(workspaceId: string): Promise<Note> {
    const existing = await this.get(SPEC_NOTE_ID, workspaceId);
    if (existing) return existing;

    const spec = createSpecNote(workspaceId);
    await this.save(spec);
    return spec;
  }

  private toModel(row: typeof notes.$inferSelect): Note {
    const metadata: NoteMetadata = {
      type: row.type as NoteType,
      taskStatus: row.taskStatus as import("../models/task").TaskStatus | undefined,
      assignedAgentIds: (row.assignedAgentIds as string[]) ?? undefined,
      parentNoteId: row.parentNoteId ?? undefined,
      linkedTaskId: row.linkedTaskId ?? undefined,
      custom: (row.customMetadata as Record<string, string>) ?? undefined,
    };

    return {
      id: row.id,
      title: row.title,
      content: row.content,
      workspaceId: row.workspaceId,
      metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
