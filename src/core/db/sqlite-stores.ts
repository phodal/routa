/**
 * SQLite Store Implementations — for the local Node.js backend.
 *
 * Mirrors the Pg store implementations but uses the SQLite schema.
 * All stores implement the same interfaces as their Pg counterparts.
 */

import { eq, and, gte, lte, desc, asc, sql, isNotNull, isNull, lt } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "./sqlite-schema";
import type { Workspace, WorkspaceStatus } from "../models/workspace";
import type { Agent, AgentRole, AgentStatus } from "../models/agent";
import type { Task, TaskStatus } from "../models/task";
import type { Message, MessageRole } from "../models/message";
import type { Note, NoteType, NoteMetadata } from "../models/note";
import type { KanbanBoard } from "../models/kanban";
import { createSpecNote, SPEC_NOTE_ID } from "../models/note";
import type { WorkspaceStore } from "./pg-workspace-store";
import type { AgentStore } from "../store/agent-store";
import type { TaskStore } from "../store/task-store";
import type { ConversationStore } from "../store/conversation-store";
import type { NoteStore } from "../store/note-store";
import type { AcpSessionStore, AcpSession, AcpSessionNotification } from "../store/acp-session-store";
import type { KanbanBoardStore } from "../store/kanban-board-store";

type SqliteDb = BetterSQLite3Database<typeof sqliteSchema>;

// ─── SQLite Workspace Store ─────────────────────────────────────────────

export class SqliteWorkspaceStore implements WorkspaceStore {
  constructor(private db: SqliteDb) {}

  async save(workspace: Workspace): Promise<void> {
    await this.db
      .insert(sqliteSchema.workspaces)
      .values({
        id: workspace.id,
        title: workspace.title,
        status: workspace.status,
        metadata: workspace.metadata,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      })
      .onConflictDoUpdate({
        target: sqliteSchema.workspaces.id,
        set: {
          title: workspace.title,
          status: workspace.status,
          metadata: workspace.metadata,
          updatedAt: new Date(),
        },
      });
  }

  async get(workspaceId: string): Promise<Workspace | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.workspaces)
      .where(eq(sqliteSchema.workspaces.id, workspaceId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async list(): Promise<Workspace[]> {
    const rows = await this.db.select().from(sqliteSchema.workspaces);
    return rows.map(this.toModel);
  }

  async listByStatus(status: WorkspaceStatus): Promise<Workspace[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.workspaces)
      .where(eq(sqliteSchema.workspaces.status, status));
    return rows.map(this.toModel);
  }

  async updateTitle(workspaceId: string, title: string): Promise<void> {
    await this.db
      .update(sqliteSchema.workspaces)
      .set({ title, updatedAt: new Date() })
      .where(eq(sqliteSchema.workspaces.id, workspaceId));
  }

  async updateStatus(workspaceId: string, status: WorkspaceStatus): Promise<void> {
    await this.db
      .update(sqliteSchema.workspaces)
      .set({ status, updatedAt: new Date() })
      .where(eq(sqliteSchema.workspaces.id, workspaceId));
  }

  async delete(workspaceId: string): Promise<void> {
    await this.db
      .delete(sqliteSchema.workspaces)
      .where(eq(sqliteSchema.workspaces.id, workspaceId));
  }

  private toModel(row: typeof sqliteSchema.workspaces.$inferSelect): Workspace {
    return {
      id: row.id,
      title: row.title,
      status: row.status as WorkspaceStatus,
      metadata: (row.metadata as Record<string, string>) ?? {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// ─── SQLite Codebase Store ──────────────────────────────────────────────

import type { Codebase } from "../models/codebase";
import type { CodebaseStore } from "./pg-codebase-store";

export class SqliteCodebaseStore implements CodebaseStore {
  constructor(private db: SqliteDb) {}

  async add(codebase: Codebase): Promise<void> {
    await this.db.insert(sqliteSchema.codebases).values({
      id: codebase.id,
      workspaceId: codebase.workspaceId,
      repoPath: codebase.repoPath,
      branch: codebase.branch,
      label: codebase.label,
      isDefault: codebase.isDefault,
      sourceType: codebase.sourceType ?? null,
      sourceUrl: codebase.sourceUrl ?? null,
      createdAt: codebase.createdAt,
      updatedAt: codebase.updatedAt,
    });
  }

  async get(codebaseId: string): Promise<Codebase | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.codebases)
      .where(eq(sqliteSchema.codebases.id, codebaseId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Codebase[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.codebases)
      .where(eq(sqliteSchema.codebases.workspaceId, workspaceId));
    return rows.map(this.toModel);
  }

  async update(codebaseId: string, fields: { branch?: string; label?: string }): Promise<void> {
    await this.db
      .update(sqliteSchema.codebases)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(sqliteSchema.codebases.id, codebaseId));
  }

  async remove(codebaseId: string): Promise<void> {
    await this.db.delete(sqliteSchema.codebases).where(eq(sqliteSchema.codebases.id, codebaseId));
  }

  async getDefault(workspaceId: string): Promise<Codebase | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.codebases)
      .where(and(eq(sqliteSchema.codebases.workspaceId, workspaceId), eq(sqliteSchema.codebases.isDefault, true)))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async setDefault(workspaceId: string, codebaseId: string): Promise<void> {
    await this.db
      .update(sqliteSchema.codebases)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(sqliteSchema.codebases.workspaceId, workspaceId), eq(sqliteSchema.codebases.isDefault, true)));
    await this.db
      .update(sqliteSchema.codebases)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(sqliteSchema.codebases.id, codebaseId));
  }

  async countByWorkspace(workspaceId: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.codebases)
      .where(eq(sqliteSchema.codebases.workspaceId, workspaceId));
    return rows.length;
  }

  async findByRepoPath(workspaceId: string, repoPath: string): Promise<Codebase | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.codebases)
      .where(and(eq(sqliteSchema.codebases.workspaceId, workspaceId), eq(sqliteSchema.codebases.repoPath, repoPath)))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  private toModel(row: typeof sqliteSchema.codebases.$inferSelect): Codebase {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      repoPath: row.repoPath,
      branch: row.branch ?? undefined,
      label: row.label ?? undefined,
      isDefault: row.isDefault,
      sourceType: (row.sourceType as Codebase["sourceType"]) ?? undefined,
      sourceUrl: row.sourceUrl ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// ─── SQLite Worktree Store ─────────────────────────────────────────────

import type { Worktree, WorktreeStatus } from "../models/worktree";
import type { WorktreeStore } from "./pg-worktree-store";

export class SqliteWorktreeStore implements WorktreeStore {
  constructor(private db: SqliteDb) {}

  async add(worktree: Worktree): Promise<void> {
    await this.db.insert(sqliteSchema.worktrees).values({
      id: worktree.id,
      codebaseId: worktree.codebaseId,
      workspaceId: worktree.workspaceId,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch,
      baseBranch: worktree.baseBranch,
      status: worktree.status,
      sessionId: worktree.sessionId ?? null,
      label: worktree.label ?? null,
      errorMessage: worktree.errorMessage ?? null,
      createdAt: worktree.createdAt,
      updatedAt: worktree.updatedAt,
    });
  }

  async get(worktreeId: string): Promise<Worktree | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.worktrees)
      .where(eq(sqliteSchema.worktrees.id, worktreeId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByCodebase(codebaseId: string): Promise<Worktree[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.worktrees)
      .where(eq(sqliteSchema.worktrees.codebaseId, codebaseId));
    return rows.map(this.toModel);
  }

  async listByWorkspace(workspaceId: string): Promise<Worktree[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.worktrees)
      .where(eq(sqliteSchema.worktrees.workspaceId, workspaceId));
    return rows.map(this.toModel);
  }

  async updateStatus(worktreeId: string, status: WorktreeStatus, errorMessage?: string): Promise<void> {
    await this.db
      .update(sqliteSchema.worktrees)
      .set({ status, errorMessage: errorMessage ?? null, updatedAt: new Date() })
      .where(eq(sqliteSchema.worktrees.id, worktreeId));
  }

  async assignSession(worktreeId: string, sessionId: string | null): Promise<void> {
    await this.db
      .update(sqliteSchema.worktrees)
      .set({ sessionId, updatedAt: new Date() })
      .where(eq(sqliteSchema.worktrees.id, worktreeId));
  }

  async remove(worktreeId: string): Promise<void> {
    await this.db.delete(sqliteSchema.worktrees).where(eq(sqliteSchema.worktrees.id, worktreeId));
  }

  async findByBranch(codebaseId: string, branch: string): Promise<Worktree | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.worktrees)
      .where(and(eq(sqliteSchema.worktrees.codebaseId, codebaseId), eq(sqliteSchema.worktrees.branch, branch)))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  private toModel(row: typeof sqliteSchema.worktrees.$inferSelect): Worktree {
    return {
      id: row.id,
      codebaseId: row.codebaseId,
      workspaceId: row.workspaceId,
      worktreePath: row.worktreePath,
      branch: row.branch,
      baseBranch: row.baseBranch,
      status: row.status as WorktreeStatus,
      sessionId: row.sessionId ?? undefined,
      label: row.label ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// ─── SQLite Agent Store ─────────────────────────────────────────────────

export class SqliteAgentStore implements AgentStore {
  constructor(private db: SqliteDb) {}

  async save(agent: Agent): Promise<void> {
    await this.db
      .insert(sqliteSchema.agents)
      .values({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        modelTier: agent.modelTier,
        workspaceId: agent.workspaceId,
        parentId: agent.parentId,
        status: agent.status,
        metadata: agent.metadata,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      })
      .onConflictDoUpdate({
        target: sqliteSchema.agents.id,
        set: {
          name: agent.name,
          role: agent.role,
          modelTier: agent.modelTier,
          status: agent.status,
          parentId: agent.parentId,
          metadata: agent.metadata,
          updatedAt: new Date(),
        },
      });
  }

  async get(agentId: string): Promise<Agent | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.agents)
      .where(eq(sqliteSchema.agents.id, agentId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Agent[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.agents)
      .where(eq(sqliteSchema.agents.workspaceId, workspaceId));
    return rows.map(this.toModel);
  }

  async listByParent(parentId: string): Promise<Agent[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.agents)
      .where(eq(sqliteSchema.agents.parentId, parentId));
    return rows.map(this.toModel);
  }

  async listByRole(workspaceId: string, role: AgentRole): Promise<Agent[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.agents)
      .where(
        and(
          eq(sqliteSchema.agents.workspaceId, workspaceId),
          eq(sqliteSchema.agents.role, role)
        )
      );
    return rows.map(this.toModel);
  }

  async listByStatus(workspaceId: string, status: AgentStatus): Promise<Agent[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.agents)
      .where(
        and(
          eq(sqliteSchema.agents.workspaceId, workspaceId),
          eq(sqliteSchema.agents.status, status)
        )
      );
    return rows.map(this.toModel);
  }

  async delete(agentId: string): Promise<void> {
    await this.db
      .delete(sqliteSchema.agents)
      .where(eq(sqliteSchema.agents.id, agentId));
  }

  async updateStatus(agentId: string, status: AgentStatus): Promise<void> {
    await this.db
      .update(sqliteSchema.agents)
      .set({ status, updatedAt: new Date() })
      .where(eq(sqliteSchema.agents.id, agentId));
  }

  private toModel(row: typeof sqliteSchema.agents.$inferSelect): Agent {
    return {
      id: row.id,
      name: row.name,
      role: row.role as AgentRole,
      modelTier: row.modelTier as import("../models/agent").ModelTier,
      workspaceId: row.workspaceId,
      parentId: row.parentId ?? undefined,
      status: row.status as AgentStatus,
      metadata: (row.metadata as Record<string, string>) ?? {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// ─── SQLite Task Store ──────────────────────────────────────────────────

export class SqliteTaskStore implements TaskStore {
  constructor(private db: SqliteDb) {}

  async save(task: Task): Promise<void> {
    const version = (task as Task & { version?: number }).version ?? 1;
    await this.db
      .insert(sqliteSchema.tasks)
      .values({
        id: task.id,
        title: task.title,
        objective: task.objective,
        scope: task.scope,
        acceptanceCriteria: task.acceptanceCriteria,
        verificationCommands: task.verificationCommands,
        assignedTo: task.assignedTo,
        status: task.status,
        boardId: task.boardId,
        columnId: task.columnId,
        position: task.position,
        priority: task.priority,
        labels: task.labels,
        assignee: task.assignee,
        assignedProvider: task.assignedProvider,
        assignedRole: task.assignedRole,
        assignedSpecialistId: task.assignedSpecialistId,
        assignedSpecialistName: task.assignedSpecialistName,
        triggerSessionId: task.triggerSessionId,
        githubId: task.githubId,
        githubNumber: task.githubNumber,
        githubUrl: task.githubUrl,
        githubRepo: task.githubRepo,
        githubState: task.githubState,
        githubSyncedAt: task.githubSyncedAt,
        lastSyncError: task.lastSyncError,
        dependencies: task.dependencies,
        parallelGroup: task.parallelGroup,
        workspaceId: task.workspaceId,
        sessionId: task.sessionId,
        completionSummary: task.completionSummary,
        verificationVerdict: task.verificationVerdict,
        verificationReport: task.verificationReport,
        version,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })
      .onConflictDoUpdate({
        target: sqliteSchema.tasks.id,
        set: {
          title: task.title,
          objective: task.objective,
          scope: task.scope,
          acceptanceCriteria: task.acceptanceCriteria,
          verificationCommands: task.verificationCommands,
          assignedTo: task.assignedTo,
          status: task.status,
          boardId: task.boardId,
          columnId: task.columnId,
          position: task.position,
          priority: task.priority,
          labels: task.labels,
          assignee: task.assignee,
          assignedProvider: task.assignedProvider,
          assignedRole: task.assignedRole,
          assignedSpecialistId: task.assignedSpecialistId,
          assignedSpecialistName: task.assignedSpecialistName,
          triggerSessionId: task.triggerSessionId,
          githubId: task.githubId,
          githubNumber: task.githubNumber,
          githubUrl: task.githubUrl,
          githubRepo: task.githubRepo,
          githubState: task.githubState,
          githubSyncedAt: task.githubSyncedAt,
          lastSyncError: task.lastSyncError,
          dependencies: task.dependencies,
          parallelGroup: task.parallelGroup,
          sessionId: task.sessionId,
          completionSummary: task.completionSummary,
          verificationVerdict: task.verificationVerdict,
          verificationReport: task.verificationReport,
          version: sql`${sqliteSchema.tasks.version} + 1`,
          updatedAt: new Date(),
        },
      });
  }

  async get(taskId: string): Promise<Task | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.tasks)
      .where(eq(sqliteSchema.tasks.id, taskId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.tasks)
      .where(eq(sqliteSchema.tasks.workspaceId, workspaceId));
    return rows.map(this.toModel);
  }

  async listByStatus(workspaceId: string, status: TaskStatus): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.tasks)
      .where(
        and(
          eq(sqliteSchema.tasks.workspaceId, workspaceId),
          eq(sqliteSchema.tasks.status, status)
        )
      );
    return rows.map(this.toModel);
  }

  async listByAssignee(agentId: string): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.tasks)
      .where(eq(sqliteSchema.tasks.assignedTo, agentId));
    return rows.map(this.toModel);
  }

  async findReadyTasks(workspaceId: string): Promise<Task[]> {
    const allTasks = await this.listByWorkspace(workspaceId);
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));

    return allTasks.filter((task) => {
      if (task.status !== "PENDING") return false;
      return task.dependencies.every((depId) => {
        const dep = taskMap.get(depId);
        return dep && dep.status === "COMPLETED";
      });
    });
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    await this.db
      .update(sqliteSchema.tasks)
      .set({
        status,
        updatedAt: new Date(),
        version: sql`${sqliteSchema.tasks.version} + 1`,
      })
      .where(eq(sqliteSchema.tasks.id, taskId));
  }

  async delete(taskId: string): Promise<void> {
    await this.db
      .delete(sqliteSchema.tasks)
      .where(eq(sqliteSchema.tasks.id, taskId));
  }

  async atomicUpdate(
    taskId: string,
    expectedVersion: number,
    updates: Partial<
      Pick<
        Task,
        | "status"
        | "completionSummary"
        | "verificationVerdict"
        | "verificationReport"
        | "assignedTo"
      >
    >
  ): Promise<boolean> {
    const result = this.db
      .update(sqliteSchema.tasks)
      .set({
        ...updates,
        version: sql`${sqliteSchema.tasks.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sqliteSchema.tasks.id, taskId),
          eq(sqliteSchema.tasks.version, expectedVersion)
        )
      )
      .run();

    return (result?.changes ?? 0) > 0;
  }

  private toModel(row: typeof sqliteSchema.tasks.$inferSelect): Task {
    return {
      id: row.id,
      title: row.title,
      objective: row.objective,
      scope: row.scope ?? undefined,
      acceptanceCriteria: (row.acceptanceCriteria as string[]) ?? undefined,
      verificationCommands: (row.verificationCommands as string[]) ?? undefined,
      assignedTo: row.assignedTo ?? undefined,
      status: row.status as TaskStatus,
      boardId: row.boardId ?? undefined,
      columnId: row.columnId ?? undefined,
      position: row.position,
      priority: row.priority as import("../models/task").TaskPriority | undefined,
      labels: (row.labels as string[]) ?? [],
      assignee: row.assignee ?? undefined,
      assignedProvider: row.assignedProvider ?? undefined,
      assignedRole: row.assignedRole ?? undefined,
      assignedSpecialistId: row.assignedSpecialistId ?? undefined,
      assignedSpecialistName: row.assignedSpecialistName ?? undefined,
      triggerSessionId: row.triggerSessionId ?? undefined,
      githubId: row.githubId ?? undefined,
      githubNumber: row.githubNumber ?? undefined,
      githubUrl: row.githubUrl ?? undefined,
      githubRepo: row.githubRepo ?? undefined,
      githubState: row.githubState ?? undefined,
      githubSyncedAt: row.githubSyncedAt ?? undefined,
      lastSyncError: row.lastSyncError ?? undefined,
      dependencies: (row.dependencies as string[]) ?? [],
      parallelGroup: row.parallelGroup ?? undefined,
      workspaceId: row.workspaceId,
      sessionId: row.sessionId ?? undefined,
      completionSummary: row.completionSummary ?? undefined,
      verificationVerdict: row.verificationVerdict as
        | import("../models/task").VerificationVerdict
        | undefined,
      verificationReport: row.verificationReport ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export class SqliteKanbanBoardStore implements KanbanBoardStore {
  constructor(private db: SqliteDb) {}

  async save(board: KanbanBoard): Promise<void> {
    await this.db
      .insert(sqliteSchema.kanbanBoards)
      .values({
        id: board.id,
        workspaceId: board.workspaceId,
        name: board.name,
        isDefault: board.isDefault,
        columns: board.columns,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
      })
      .onConflictDoUpdate({
        target: sqliteSchema.kanbanBoards.id,
        set: {
          name: board.name,
          isDefault: board.isDefault,
          columns: board.columns,
          updatedAt: new Date(),
        },
      });
  }

  async get(boardId: string): Promise<KanbanBoard | undefined> {
    const rows = await this.db.select().from(sqliteSchema.kanbanBoards).where(eq(sqliteSchema.kanbanBoards.id, boardId)).limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<KanbanBoard[]> {
    const rows = await this.db.select().from(sqliteSchema.kanbanBoards).where(eq(sqliteSchema.kanbanBoards.workspaceId, workspaceId));
    return rows.map((row) => this.toModel(row));
  }

  async getDefault(workspaceId: string): Promise<KanbanBoard | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.kanbanBoards)
      .where(and(eq(sqliteSchema.kanbanBoards.workspaceId, workspaceId), eq(sqliteSchema.kanbanBoards.isDefault, true)))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async delete(boardId: string): Promise<void> {
    await this.db.delete(sqliteSchema.kanbanBoards).where(eq(sqliteSchema.kanbanBoards.id, boardId));
  }

  private toModel(row: typeof sqliteSchema.kanbanBoards.$inferSelect): KanbanBoard {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      isDefault: row.isDefault,
      columns: row.columns,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// ─── SQLite Conversation Store ──────────────────────────────────────────

export class SqliteConversationStore implements ConversationStore {
  constructor(private db: SqliteDb) {}

  async append(message: Message): Promise<void> {
    await this.db.insert(sqliteSchema.messages).values({
      id: message.id,
      agentId: message.agentId,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      toolName: message.toolName,
      toolArgs: message.toolArgs,
      turn: message.turn,
    });
  }

  async getConversation(agentId: string): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.messages)
      .where(eq(sqliteSchema.messages.agentId, agentId))
      .orderBy(sqliteSchema.messages.timestamp);
    return rows.map(this.toModel);
  }

  async getLastN(agentId: string, n: number): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.messages)
      .where(eq(sqliteSchema.messages.agentId, agentId))
      .orderBy(desc(sqliteSchema.messages.timestamp))
      .limit(n);
    return rows.reverse().map(this.toModel);
  }

  async getByTurnRange(
    agentId: string,
    startTurn: number,
    endTurn: number
  ): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.messages)
      .where(
        and(
          eq(sqliteSchema.messages.agentId, agentId),
          gte(sqliteSchema.messages.turn, startTurn),
          lte(sqliteSchema.messages.turn, endTurn)
        )
      )
      .orderBy(sqliteSchema.messages.timestamp);
    return rows.map(this.toModel);
  }

  async getMessageCount(agentId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(sqliteSchema.messages)
      .where(eq(sqliteSchema.messages.agentId, agentId));
    return result[0]?.count ?? 0;
  }

  async deleteConversation(agentId: string): Promise<void> {
    await this.db
      .delete(sqliteSchema.messages)
      .where(eq(sqliteSchema.messages.agentId, agentId));
  }

  private toModel(row: typeof sqliteSchema.messages.$inferSelect): Message {
    return {
      id: row.id,
      agentId: row.agentId,
      role: row.role as MessageRole,
      content: row.content,
      timestamp: row.timestamp,
      toolName: row.toolName ?? undefined,
      toolArgs: row.toolArgs ?? undefined,
      turn: row.turn ?? undefined,
    };
  }
}

// ─── SQLite Note Store ──────────────────────────────────────────────────

export class SqliteNoteStore implements NoteStore {
  constructor(private db: SqliteDb) {}

  async save(note: Note, _source?: "agent" | "user" | "system"): Promise<void> {
    await this.db
      .insert(sqliteSchema.notes)
      .values({
        id: note.id,
        workspaceId: note.workspaceId,
        sessionId: note.sessionId,
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
        target: [sqliteSchema.notes.workspaceId, sqliteSchema.notes.id],
        set: {
          sessionId: note.sessionId,
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
      .from(sqliteSchema.notes)
      .where(
        and(
          eq(sqliteSchema.notes.workspaceId, workspaceId),
          eq(sqliteSchema.notes.id, noteId)
        )
      )
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Note[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.notes)
      .where(eq(sqliteSchema.notes.workspaceId, workspaceId));
    return rows.map(this.toModel);
  }

  async listByType(workspaceId: string, type: NoteType): Promise<Note[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.notes)
      .where(
        and(
          eq(sqliteSchema.notes.workspaceId, workspaceId),
          eq(sqliteSchema.notes.type, type)
        )
      );
    return rows.map(this.toModel);
  }

  async listByAssignedAgent(
    workspaceId: string,
    agentId: string
  ): Promise<Note[]> {
    const allNotes = await this.listByWorkspace(workspaceId);
    return allNotes.filter((n) =>
      n.metadata.assignedAgentIds?.includes(agentId)
    );
  }

  async delete(noteId: string, workspaceId: string): Promise<void> {
    await this.db
      .delete(sqliteSchema.notes)
      .where(
        and(
          eq(sqliteSchema.notes.workspaceId, workspaceId),
          eq(sqliteSchema.notes.id, noteId)
        )
      );
  }

  async ensureSpec(workspaceId: string): Promise<Note> {
    const existing = await this.get(SPEC_NOTE_ID, workspaceId);
    if (existing) return existing;

    const spec = createSpecNote(workspaceId);
    await this.save(spec);
    return spec;
  }

  private toModel(row: typeof sqliteSchema.notes.$inferSelect): Note {
    const metadata: NoteMetadata = {
      type: row.type as NoteType,
      taskStatus: row.taskStatus as
        | import("../models/task").TaskStatus
        | undefined,
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
      sessionId: row.sessionId ?? undefined,
      metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// ─── SQLite ACP Session Store ───────────────────────────────────────────

export class SqliteAcpSessionStore implements AcpSessionStore {
  constructor(private db: SqliteDb) {}

  async save(session: AcpSession): Promise<void> {
    await this.db
      .insert(sqliteSchema.acpSessions)
      .values({
        id: session.id,
        name: session.name,
        cwd: session.cwd,
        branch: session.branch,
        workspaceId: session.workspaceId,
        routaAgentId: session.routaAgentId,
        provider: session.provider,
        role: session.role,
        modeId: session.modeId,
        firstPromptSent: session.firstPromptSent ?? false,
        messageHistory: session.messageHistory,
        parentSessionId: session.parentSessionId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      })
      .onConflictDoUpdate({
        target: sqliteSchema.acpSessions.id,
        set: {
          name: session.name,
          modeId: session.modeId,
          firstPromptSent: session.firstPromptSent ?? false,
          messageHistory: session.messageHistory,
          updatedAt: new Date(),
        },
      });
  }

  async get(sessionId: string): Promise<AcpSession | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.acpSessions)
      .where(eq(sqliteSchema.acpSessions.id, sessionId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async list(): Promise<AcpSession[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.acpSessions)
      .orderBy(desc(sqliteSchema.acpSessions.createdAt));
    return rows.map(this.toModel);
  }

  async delete(sessionId: string): Promise<void> {
    await this.db
      .delete(sqliteSchema.acpSessions)
      .where(eq(sqliteSchema.acpSessions.id, sessionId));
  }

  async rename(sessionId: string, name: string): Promise<void> {
    await this.db
      .update(sqliteSchema.acpSessions)
      .set({ name, updatedAt: new Date() })
      .where(eq(sqliteSchema.acpSessions.id, sessionId));
  }

  async appendHistory(sessionId: string, notification: AcpSessionNotification): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;
    const history = [...session.messageHistory, notification];
    await this.db
      .update(sqliteSchema.acpSessions)
      .set({ messageHistory: history, updatedAt: new Date() })
      .where(eq(sqliteSchema.acpSessions.id, sessionId));
  }

  async getHistory(sessionId: string): Promise<AcpSessionNotification[]> {
    const session = await this.get(sessionId);
    return session?.messageHistory ?? [];
  }

  async markFirstPromptSent(sessionId: string): Promise<void> {
    await this.db
      .update(sqliteSchema.acpSessions)
      .set({ firstPromptSent: true, updatedAt: new Date() })
      .where(eq(sqliteSchema.acpSessions.id, sessionId));
  }

  async updateMode(sessionId: string, modeId: string): Promise<void> {
    await this.db
      .update(sqliteSchema.acpSessions)
      .set({ modeId, updatedAt: new Date() })
      .where(eq(sqliteSchema.acpSessions.id, sessionId));
  }

  private toModel(row: typeof sqliteSchema.acpSessions.$inferSelect): AcpSession {
    return {
      id: row.id,
      name: row.name ?? undefined,
      cwd: row.cwd,
      branch: (row as unknown as { branch?: string | null }).branch ?? undefined,
      workspaceId: row.workspaceId,
      routaAgentId: row.routaAgentId ?? undefined,
      provider: row.provider ?? undefined,
      role: row.role ?? undefined,
      modeId: row.modeId ?? undefined,
      firstPromptSent: row.firstPromptSent ?? false,
      messageHistory: row.messageHistory ?? [],
      parentSessionId: row.parentSessionId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// ─── SQLite Skill Store ──────────────────────────────────────────────────

import type { SkillFileEntry } from "./schema";
import type { SkillDefinition } from "../skills/skill-loader";

export interface StoredSkill {
  id: string;
  name: string;
  description: string;
  source: string;
  catalogType: string;
  files: SkillFileEntry[];
  license?: string;
  metadata: Record<string, string>;
  installs: number;
  createdAt: Date;
  updatedAt: Date;
}

export class SqliteSkillStore {
  constructor(private db: SqliteDb) {}

  /**
   * Save or update a skill.
   */
  async save(skill: {
    id: string;
    name: string;
    description: string;
    source: string;
    catalogType: string;
    files: SkillFileEntry[];
    license?: string;
    metadata?: Record<string, string>;
  }): Promise<void> {
    const existing = await this.get(skill.id);
    if (existing) {
      await this.db
        .update(sqliteSchema.skills)
        .set({
          name: skill.name,
          description: skill.description,
          source: skill.source,
          catalogType: skill.catalogType,
          files: skill.files,
          license: skill.license ?? null,
          metadata: skill.metadata ?? {},
          updatedAt: new Date(),
        })
        .where(eq(sqliteSchema.skills.id, skill.id));
    } else {
      await this.db.insert(sqliteSchema.skills).values({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        source: skill.source,
        catalogType: skill.catalogType,
        files: skill.files,
        license: skill.license ?? null,
        metadata: skill.metadata ?? {},
        installs: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  /**
   * Get a skill by ID (name).
   */
  async get(skillId: string): Promise<StoredSkill | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.skills)
      .where(eq(sqliteSchema.skills.id, skillId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  /**
   * List all installed skills.
   */
  async list(): Promise<StoredSkill[]> {
    const rows = await this.db.select().from(sqliteSchema.skills);
    return rows.map(this.toModel);
  }

  /**
   * Delete a skill by ID.
   */
  async delete(skillId: string): Promise<void> {
    await this.db
      .delete(sqliteSchema.skills)
      .where(eq(sqliteSchema.skills.id, skillId));
  }

  /**
   * Convert a stored skill to a SkillDefinition for API compatibility.
   * Extracts content from the SKILL.md file in the files array.
   */
  toSkillDefinition(skill: StoredSkill): SkillDefinition {
    // Find the main SKILL.md file
    const skillFile = skill.files.find(
      (f) => f.path === "SKILL.md" || f.path.endsWith("/SKILL.md")
    );
    const content = skillFile?.content ?? "";

    return {
      name: skill.name,
      description: skill.description,
      content,
      source: `db:${skill.source}`,
      license: skill.license,
      metadata: skill.metadata,
    };
  }

  private toModel(row: typeof sqliteSchema.skills.$inferSelect): StoredSkill {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      source: row.source,
      catalogType: row.catalogType,
      files: (row.files as SkillFileEntry[]) ?? [],
      license: row.license ?? undefined,
      metadata: (row.metadata as Record<string, string>) ?? {},
      installs: row.installs,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// ─── SQLite Background Task Store ─────────────────────────────────────────

import type { BackgroundTask, BackgroundTaskStatus } from "../models/background-task";
import type { BackgroundTaskStore } from "../store/background-task-store";

export class SqliteBackgroundTaskStore implements BackgroundTaskStore {
  constructor(private db: SqliteDb) {}

  async save(task: BackgroundTask): Promise<void> {
    await this.db
      .insert(sqliteSchema.backgroundTasks)
      .values({
        id: task.id,
        title: task.title,
        prompt: task.prompt,
        agentId: task.agentId,
        workspaceId: task.workspaceId,
        status: task.status,
        triggeredBy: task.triggeredBy,
        triggerSource: task.triggerSource,
        priority: task.priority,
        resultSessionId: task.resultSessionId,
        errorMessage: task.errorMessage,
        attempts: task.attempts,
        maxAttempts: task.maxAttempts,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        lastActivity: task.lastActivity,
        currentActivity: task.currentActivity,
        toolCallCount: task.toolCallCount ?? 0,
        inputTokens: task.inputTokens ?? 0,
        outputTokens: task.outputTokens ?? 0,
        // Workflow orchestration fields
        workflowRunId: task.workflowRunId,
        workflowStepName: task.workflowStepName,
        dependsOnTaskIds: task.dependsOnTaskIds,
        taskOutput: task.taskOutput,
      })
      .onConflictDoUpdate({
        target: sqliteSchema.backgroundTasks.id,
        set: {
          title: task.title,
          prompt: task.prompt,
          agentId: task.agentId,
          status: task.status,
          triggeredBy: task.triggeredBy,
          triggerSource: task.triggerSource,
          resultSessionId: task.resultSessionId,
          errorMessage: task.errorMessage,
          attempts: task.attempts,
          maxAttempts: task.maxAttempts,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          updatedAt: new Date(),
          lastActivity: task.lastActivity,
          currentActivity: task.currentActivity,
          toolCallCount: task.toolCallCount ?? 0,
          inputTokens: task.inputTokens ?? 0,
          outputTokens: task.outputTokens ?? 0,
          // Workflow orchestration fields
          workflowRunId: task.workflowRunId,
          workflowStepName: task.workflowStepName,
          dependsOnTaskIds: task.dependsOnTaskIds,
          taskOutput: task.taskOutput,
        },
      });
  }

  async get(taskId: string): Promise<BackgroundTask | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.backgroundTasks)
      .where(eq(sqliteSchema.backgroundTasks.id, taskId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<BackgroundTask[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.backgroundTasks)
      .where(eq(sqliteSchema.backgroundTasks.workspaceId, workspaceId))
      .orderBy(desc(sqliteSchema.backgroundTasks.createdAt));
    return rows.map(this.toModel.bind(this));
  }

  async listPending(): Promise<BackgroundTask[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.backgroundTasks)
      .where(eq(sqliteSchema.backgroundTasks.status, "PENDING"))
      .orderBy(
        // Sort by priority first (HIGH=0, NORMAL=1, LOW=2) - ascending order
        asc(sql`CASE ${sqliteSchema.backgroundTasks.priority} WHEN 'HIGH' THEN 0 WHEN 'NORMAL' THEN 1 WHEN 'LOW' THEN 2 ELSE 3 END`),
        // Then by createdAt (oldest first)
        asc(sqliteSchema.backgroundTasks.createdAt)
      );
    return rows.map(this.toModel.bind(this));
  }

  async listRunning(): Promise<BackgroundTask[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.backgroundTasks)
      .where(
        and(
          eq(sqliteSchema.backgroundTasks.status, "RUNNING"),
          isNotNull(sqliteSchema.backgroundTasks.resultSessionId)
        )
      )
      .orderBy(asc(sqliteSchema.backgroundTasks.createdAt));
    return rows.map(this.toModel.bind(this));
  }

  async listOrphaned(thresholdMinutes = 5): Promise<BackgroundTask[]> {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    const rows = await this.db
      .select()
      .from(sqliteSchema.backgroundTasks)
      .where(
        and(
          eq(sqliteSchema.backgroundTasks.status, "RUNNING"),
          isNull(sqliteSchema.backgroundTasks.resultSessionId),
          lt(sqliteSchema.backgroundTasks.startedAt, threshold)
        )
      )
      .orderBy(asc(sqliteSchema.backgroundTasks.createdAt));
    return rows.map(this.toModel.bind(this));
  }

  async listByStatus(
    workspaceId: string,
    status: BackgroundTaskStatus
  ): Promise<BackgroundTask[]> {
    const query = this.db
      .select()
      .from(sqliteSchema.backgroundTasks)
      .where(
        and(
          eq(sqliteSchema.backgroundTasks.workspaceId, workspaceId),
          eq(sqliteSchema.backgroundTasks.status, status)
        )
      );

    // For PENDING tasks, sort by priority first, then by createdAt
    if (status === "PENDING") {
      const rows = await query.orderBy(
        asc(sql`CASE ${sqliteSchema.backgroundTasks.priority} WHEN 'HIGH' THEN 0 WHEN 'NORMAL' THEN 1 WHEN 'LOW' THEN 2 ELSE 3 END`),
        asc(sqliteSchema.backgroundTasks.createdAt)
      );
      return rows.map(this.toModel.bind(this));
    }

    // For other statuses, sort by createdAt (newest first)
    const rows = await query.orderBy(desc(sqliteSchema.backgroundTasks.createdAt));
    return rows.map(this.toModel.bind(this));
  }

  async updateStatus(
    taskId: string,
    status: BackgroundTaskStatus,
    opts?: {
      resultSessionId?: string;
      errorMessage?: string;
      startedAt?: Date;
      completedAt?: Date;
    }
  ): Promise<void> {
    await this.db
      .update(sqliteSchema.backgroundTasks)
      .set({
        status,
        resultSessionId: opts?.resultSessionId,
        errorMessage: opts?.errorMessage,
        startedAt: opts?.startedAt,
        completedAt: opts?.completedAt,
        updatedAt: new Date(),
      })
      .where(eq(sqliteSchema.backgroundTasks.id, taskId));
  }

  async updateProgress(
    taskId: string,
    progress: {
      lastActivity?: Date;
      currentActivity?: string;
      toolCallCount?: number;
      inputTokens?: number;
      outputTokens?: number;
    }
  ): Promise<void> {
    await this.db
      .update(sqliteSchema.backgroundTasks)
      .set({
        lastActivity: progress.lastActivity,
        currentActivity: progress.currentActivity,
        toolCallCount: progress.toolCallCount,
        inputTokens: progress.inputTokens,
        outputTokens: progress.outputTokens,
        updatedAt: new Date(),
      })
      .where(eq(sqliteSchema.backgroundTasks.id, taskId));
  }

  async findBySessionId(sessionId: string): Promise<BackgroundTask | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.backgroundTasks)
      .where(eq(sqliteSchema.backgroundTasks.resultSessionId, sessionId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async delete(taskId: string): Promise<void> {
    await this.db
      .delete(sqliteSchema.backgroundTasks)
      .where(eq(sqliteSchema.backgroundTasks.id, taskId));
  }

  // ─── Workflow orchestration methods ────────────────────────────────────────

  async listByWorkflowRunId(workflowRunId: string): Promise<BackgroundTask[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.backgroundTasks)
      .where(eq(sqliteSchema.backgroundTasks.workflowRunId, workflowRunId))
      .orderBy(asc(sqliteSchema.backgroundTasks.createdAt));
    return rows.map(this.toModel.bind(this));
  }

  async listReadyToRun(): Promise<BackgroundTask[]> {
    // Get all PENDING tasks
    const pending = await this.db
      .select()
      .from(sqliteSchema.backgroundTasks)
      .where(eq(sqliteSchema.backgroundTasks.status, "PENDING"))
      .orderBy(
        asc(sql`CASE ${sqliteSchema.backgroundTasks.priority} WHEN 'HIGH' THEN 0 WHEN 'NORMAL' THEN 1 WHEN 'LOW' THEN 2 ELSE 3 END`),
        asc(sqliteSchema.backgroundTasks.createdAt)
      );

    // Filter to tasks whose dependencies are all COMPLETED
    const ready: BackgroundTask[] = [];
    for (const row of pending) {
      const task = this.toModel(row);
      if (!task.dependsOnTaskIds || task.dependsOnTaskIds.length === 0) {
        ready.push(task);
        continue;
      }
      // Check all dependencies - SQLite doesn't have ANY(), use IN()
      const deps = await this.db
        .select()
        .from(sqliteSchema.backgroundTasks)
        .where(sql`${sqliteSchema.backgroundTasks.id} IN (${sql.join(task.dependsOnTaskIds.map(id => sql`${id}`), sql`, `)})`);
      const allCompleted = deps.length === task.dependsOnTaskIds.length && deps.every((d) => d.status === "COMPLETED");
      if (allCompleted) {
        ready.push(task);
      }
    }
    return ready;
  }

  async updateTaskOutput(taskId: string, output: string): Promise<void> {
    await this.db
      .update(sqliteSchema.backgroundTasks)
      .set({
        taskOutput: output,
        updatedAt: new Date(),
      })
      .where(eq(sqliteSchema.backgroundTasks.id, taskId));
  }

  private toModel(
    row: typeof sqliteSchema.backgroundTasks.$inferSelect
  ): BackgroundTask {
    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      agentId: row.agentId,
      workspaceId: row.workspaceId,
      status: row.status as BackgroundTaskStatus,
      triggeredBy: row.triggeredBy,
      triggerSource: row.triggerSource as BackgroundTask["triggerSource"],
      priority: row.priority as BackgroundTask["priority"],
      resultSessionId: row.resultSessionId ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastActivity: row.lastActivity ?? undefined,
      currentActivity: row.currentActivity ?? undefined,
      toolCallCount: row.toolCallCount ?? undefined,
      inputTokens: row.inputTokens ?? undefined,
      outputTokens: row.outputTokens ?? undefined,
      // Workflow orchestration fields
      workflowRunId: row.workflowRunId ?? undefined,
      workflowStepName: row.workflowStepName ?? undefined,
      dependsOnTaskIds: row.dependsOnTaskIds ?? undefined,
      taskOutput: row.taskOutput ?? undefined,
    };
  }
}

// ─── SQLite Schedule Store ─────────────────────────────────────────────────

import { v4 as uuidv4 } from "uuid";
import type { Schedule, CreateScheduleInput } from "../models/schedule";
import type { ScheduleStore } from "../store/schedule-store";

export class SqliteScheduleStore implements ScheduleStore {
  constructor(private db: SqliteDb) {}

  async create(input: CreateScheduleInput): Promise<Schedule> {
    const now = new Date();
    const id = input.id ?? uuidv4();
    const row = {
      id,
      name: input.name,
      cronExpr: input.cronExpr,
      taskPrompt: input.taskPrompt,
      agentId: input.agentId,
      workspaceId: input.workspaceId,
      enabled: input.enabled !== false,
      lastRunAt: null as Date | null,
      nextRunAt: null as Date | null,
      lastTaskId: null as string | null,
      promptTemplate: input.promptTemplate ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(sqliteSchema.schedules).values(row);
    return this.toModel({ ...row });
  }

  async get(scheduleId: string): Promise<Schedule | undefined> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.schedules)
      .where(eq(sqliteSchema.schedules.id, scheduleId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Schedule[]> {
    const rows = await this.db
      .select()
      .from(sqliteSchema.schedules)
      .where(eq(sqliteSchema.schedules.workspaceId, workspaceId))
      .orderBy(desc(sqliteSchema.schedules.createdAt));
    return rows.map(this.toModel.bind(this));
  }

  async listDue(): Promise<Schedule[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(sqliteSchema.schedules)
      .where(
        and(
          eq(sqliteSchema.schedules.enabled, true),
          lte(sqliteSchema.schedules.nextRunAt, now)
        )
      );
    return rows.map(this.toModel.bind(this));
  }

  async update(
    scheduleId: string,
    fields: Partial<Pick<Schedule, "name" | "cronExpr" | "taskPrompt" | "agentId" | "enabled" | "promptTemplate" | "lastRunAt" | "nextRunAt" | "lastTaskId">>
  ): Promise<void> {
    await this.db
      .update(sqliteSchema.schedules)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(sqliteSchema.schedules.id, scheduleId));
  }

  async setEnabled(scheduleId: string, enabled: boolean): Promise<void> {
    await this.db
      .update(sqliteSchema.schedules)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(sqliteSchema.schedules.id, scheduleId));
  }

  async delete(scheduleId: string): Promise<void> {
    await this.db.delete(sqliteSchema.schedules).where(eq(sqliteSchema.schedules.id, scheduleId));
  }

  private toModel(row: typeof sqliteSchema.schedules.$inferSelect): Schedule {
    return {
      id: row.id,
      name: row.name,
      cronExpr: row.cronExpr,
      taskPrompt: row.taskPrompt,
      agentId: row.agentId,
      workspaceId: row.workspaceId,
      enabled: row.enabled,
      lastRunAt: row.lastRunAt ?? undefined,
      nextRunAt: row.nextRunAt ?? undefined,
      lastTaskId: row.lastTaskId ?? undefined,
      promptTemplate: row.promptTemplate ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
