/**
 * NoteStore — In-memory storage for workspace notes.
 *
 * Notes are the shared collaboration documents for multi-agent coordination.
 * Each workspace automatically has a "spec" note as the planning source of truth.
 */

import { Note, NoteType, createSpecNote, SPEC_NOTE_ID } from "../models/note";

export interface NoteStore {
  /** Save or update a note */
  save(note: Note): Promise<void>;
  /** Get a note by ID */
  get(noteId: string, workspaceId: string): Promise<Note | undefined>;
  /** List all notes in a workspace */
  listByWorkspace(workspaceId: string): Promise<Note[]>;
  /** List notes by type */
  listByType(workspaceId: string, type: NoteType): Promise<Note[]>;
  /** List task notes assigned to a specific agent */
  listByAssignedAgent(workspaceId: string, agentId: string): Promise<Note[]>;
  /** Delete a note */
  delete(noteId: string, workspaceId: string): Promise<void>;
  /** Ensure the spec note exists for a workspace, creating it if necessary */
  ensureSpec(workspaceId: string): Promise<Note>;
}

export class InMemoryNoteStore implements NoteStore {
  /** Keyed by `${workspaceId}:${noteId}` */
  private notes = new Map<string, Note>();

  private key(noteId: string, workspaceId: string): string {
    return `${workspaceId}:${noteId}`;
  }

  async save(note: Note): Promise<void> {
    this.notes.set(this.key(note.id, note.workspaceId), { ...note });
  }

  async get(noteId: string, workspaceId: string): Promise<Note | undefined> {
    const note = this.notes.get(this.key(noteId, workspaceId));
    return note ? { ...note } : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Note[]> {
    return Array.from(this.notes.values()).filter(
      (n) => n.workspaceId === workspaceId
    );
  }

  async listByType(workspaceId: string, type: NoteType): Promise<Note[]> {
    return Array.from(this.notes.values()).filter(
      (n) => n.workspaceId === workspaceId && n.metadata.type === type
    );
  }

  async listByAssignedAgent(
    workspaceId: string,
    agentId: string
  ): Promise<Note[]> {
    return Array.from(this.notes.values()).filter(
      (n) =>
        n.workspaceId === workspaceId &&
        n.metadata.assignedAgentIds?.includes(agentId)
    );
  }

  async delete(noteId: string, workspaceId: string): Promise<void> {
    this.notes.delete(this.key(noteId, workspaceId));
  }

  async ensureSpec(workspaceId: string): Promise<Note> {
    const existing = await this.get(SPEC_NOTE_ID, workspaceId);
    if (existing) return existing;

    const spec = createSpecNote(workspaceId);
    await this.save(spec);
    return spec;
  }
}
