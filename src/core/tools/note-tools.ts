/**
 * NoteTools — MCP-exposed tools for managing workspace notes.
 *
 * Provides CRUD operations for notes (the shared collaboration documents)
 * and integrates with the task-block parser to convert @@@task blocks into
 * structured Task Notes + Task records.
 */

import { v4 as uuidv4 } from "uuid";
import { NoteStore } from "../store/note-store";
import { TaskStore } from "../store/task-store";
import { createNote, Note, SPEC_NOTE_ID } from "../models/note";
import { createTask as createTaskModel, TaskStatus } from "../models/task";
import { extractTaskBlocks } from "../orchestration/task-block-parser";
import { ToolResult, successResult, errorResult } from "./tool-result";

export class NoteTools {
  constructor(
    private noteStore: NoteStore,
    private taskStore: TaskStore
  ) {}

  // ─── Create Note ───────────────────────────────────────────────────────

  async createNote(params: {
    title: string;
    content?: string;
    workspaceId: string;
    noteId?: string;
    type?: "spec" | "task" | "general";
  }): Promise<ToolResult> {
    const noteId = params.noteId ?? uuidv4();

    const existing = await this.noteStore.get(noteId, params.workspaceId);
    if (existing) {
      return errorResult(`Note already exists with id: ${noteId}`);
    }

    const note = createNote({
      id: noteId,
      title: params.title,
      content: params.content ?? "",
      workspaceId: params.workspaceId,
      metadata: { type: params.type ?? "general" },
    });

    await this.saveNote(note, "agent");

    return successResult({
      noteId: note.id,
      title: note.title,
      type: note.metadata.type,
    });
  }

  // ─── Read Note ────────────────────────────────────────────────────────

  async readNote(params: {
    noteId: string;
    workspaceId: string;
  }): Promise<ToolResult> {
    // Auto-ensure spec note exists
    if (params.noteId === SPEC_NOTE_ID) {
      await this.noteStore.ensureSpec(params.workspaceId);
    }

    const note = await this.noteStore.get(params.noteId, params.workspaceId);
    if (!note) {
      return errorResult(`Note not found: ${params.noteId}`);
    }

    return successResult({
      noteId: note.id,
      title: note.title,
      content: note.content,
      type: note.metadata.type,
      metadata: note.metadata,
      updatedAt: note.updatedAt.toISOString(),
    });
  }

  // ─── List Notes ───────────────────────────────────────────────────────

  async listNotes(params: {
    workspaceId: string;
    type?: "spec" | "task" | "general";
  }): Promise<ToolResult> {
    // Ensure spec note exists
    await this.noteStore.ensureSpec(params.workspaceId);

    const notes = params.type
      ? await this.noteStore.listByType(params.workspaceId, params.type)
      : await this.noteStore.listByWorkspace(params.workspaceId);

    return successResult(
      notes.map((n) => ({
        noteId: n.id,
        title: n.title,
        type: n.metadata.type,
        contentPreview: n.content.slice(0, 200),
        updatedAt: n.updatedAt.toISOString(),
      }))
    );
  }

  // ─── Set Note Content ─────────────────────────────────────────────────

  async setNoteContent(params: {
    noteId: string;
    workspaceId: string;
    content: string;
    title?: string;
  }): Promise<ToolResult> {
    let note = await this.noteStore.get(params.noteId, params.workspaceId);

    if (!note) {
      // Auto-create if it's the spec note
      if (params.noteId === SPEC_NOTE_ID) {
        note = await this.noteStore.ensureSpec(params.workspaceId);
      } else {
        return errorResult(
          `Note not found: ${params.noteId}. Use create_note first.`
        );
      }
    }

    note.content = params.content;
    if (params.title) {
      note.title = params.title;
    }
    note.updatedAt = new Date();
    await this.saveNote(note, "agent");

    return successResult({
      noteId: note.id,
      title: note.title,
      contentLength: note.content.length,
      updatedAt: note.updatedAt.toISOString(),
    });
  }

  // ─── Append to Note ───────────────────────────────────────────────────

  async appendToNote(params: {
    noteId: string;
    workspaceId: string;
    content: string;
  }): Promise<ToolResult> {
    let note = await this.noteStore.get(params.noteId, params.workspaceId);

    if (!note) {
      if (params.noteId === SPEC_NOTE_ID) {
        note = await this.noteStore.ensureSpec(params.workspaceId);
      } else {
        return errorResult(`Note not found: ${params.noteId}`);
      }
    }

    note.content = note.content
      ? note.content + "\n\n" + params.content
      : params.content;
    note.updatedAt = new Date();
    await this.saveNote(note, "agent");

    return successResult({
      noteId: note.id,
      contentLength: note.content.length,
      updatedAt: note.updatedAt.toISOString(),
    });
  }

  // ─── Get My Task ──────────────────────────────────────────────────────

  async getMyTask(params: {
    agentId: string;
    workspaceId: string;
  }): Promise<ToolResult> {
    // Find task notes assigned to this agent
    const taskNotes = await this.noteStore.listByAssignedAgent(
      params.workspaceId,
      params.agentId
    );

    if (taskNotes.length === 0) {
      // Fallback: check tasks assigned in TaskStore
      const tasks = await this.taskStore.listByAssignee(params.agentId);
      if (tasks.length === 0) {
        return errorResult("No task assigned to this agent.");
      }
      return successResult(
        tasks.map((t) => ({
          taskId: t.id,
          title: t.title,
          objective: t.objective,
          scope: t.scope,
          acceptanceCriteria: t.acceptanceCriteria,
          verificationCommands: t.verificationCommands,
          status: t.status,
        }))
      );
    }

    return successResult(
      taskNotes.map((n) => ({
        noteId: n.id,
        title: n.title,
        content: n.content,
        linkedTaskId: n.metadata.linkedTaskId,
        taskStatus: n.metadata.taskStatus,
      }))
    );
  }

  // ─── Convert Task Blocks ──────────────────────────────────────────────

  async convertTaskBlocks(params: {
    noteId: string;
    workspaceId: string;
  }): Promise<ToolResult> {
    const note = await this.noteStore.get(params.noteId, params.workspaceId);
    if (!note) {
      return errorResult(`Note not found: ${params.noteId}`);
    }

    const parseResult = extractTaskBlocks(note.content);
    if (parseResult.validTaskCount === 0) {
      return successResult({
        message: "No @@@task blocks found in note.",
        blocksFound: 0,
      });
    }

    const createdTasks: Array<{ taskId: string; noteId: string; title: string }> = [];

    for (const parsedTask of parseResult.tasks) {
      // Create Task record in TaskStore
      const taskId = uuidv4();
      const task = createTaskModel({
        id: taskId,
        title: parsedTask.title,
        objective: parsedTask.sections.objective ?? parsedTask.content,
        workspaceId: params.workspaceId,
        scope: parsedTask.sections.scope,
        acceptanceCriteria: parsedTask.sections.definitionOfDone
          ? parsedTask.sections.definitionOfDone.split("\n").filter((l) => l.trim())
          : undefined,
        verificationCommands: parsedTask.sections.verification
          ? parsedTask.sections.verification.split("\n").filter((l) => l.trim())
          : undefined,
      });
      await this.taskStore.save(task);

      // Create Task Note
      const taskNoteId = `task-${taskId.slice(0, 8)}`;
      const taskNote = createNote({
        id: taskNoteId,
        title: parsedTask.title,
        content: parsedTask.content,
        workspaceId: params.workspaceId,
        metadata: {
          type: "task",
          taskStatus: TaskStatus.PENDING,
          parentNoteId: params.noteId,
          linkedTaskId: taskId,
        },
      });
      await this.saveNote(taskNote, "agent");

      createdTasks.push({
        taskId,
        noteId: taskNoteId,
        title: parsedTask.title,
      });
    }

    // Update the source note: replace @@@task blocks with links to task notes
    let updatedContent = note.content;
    for (let i = 0; i < createdTasks.length; i++) {
      const placeholder = `<!-- task-placeholder-${i} -->`;
      const taskRef = createdTasks[i];
      const replacement = `- [ ] [${taskRef.title}](task://${taskRef.noteId}) (task: ${taskRef.taskId})`;
      updatedContent = updatedContent.replace(placeholder, replacement);
    }
    // Also apply the cleaned content from the parser
    if (updatedContent === note.content) {
      updatedContent = parseResult.contentWithoutBlocks;
      for (let i = 0; i < createdTasks.length; i++) {
        const placeholder = `<!-- task-placeholder-${i} -->`;
        const taskRef = createdTasks[i];
        const replacement = `- [ ] [${taskRef.title}](task://${taskRef.noteId}) (task: ${taskRef.taskId})`;
        updatedContent = updatedContent.replace(placeholder, replacement);
      }
    }
    note.content = updatedContent;
    note.updatedAt = new Date();
    await this.saveNote(note, "agent");

    return successResult({
      blocksConverted: createdTasks.length,
      invalidBlocks: parseResult.invalidBlockCount,
      tasks: createdTasks,
    });
  }

  // ─── Helper: CRDT-aware save ──────────────────────────────────────────

  private async saveNote(
    note: Note,
    source: "agent" | "user" | "system"
  ): Promise<void> {
    await this.noteStore.save(note, source);
  }

  // ─── Delete Note ──────────────────────────────────────────────────────

  async deleteNote(params: {
    noteId: string;
    workspaceId: string;
  }): Promise<ToolResult> {
    if (params.noteId === SPEC_NOTE_ID) {
      return errorResult("Cannot delete the spec note.");
    }

    const note = await this.noteStore.get(params.noteId, params.workspaceId);
    if (!note) {
      return errorResult(`Note not found: ${params.noteId}`);
    }

    await this.noteStore.delete(params.noteId, params.workspaceId);
    return successResult({ deleted: true, noteId: params.noteId });
  }
}
