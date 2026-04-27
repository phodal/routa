/**
 * PgTaskStore — Postgres-backed task store using Drizzle ORM.
 *
 * Supports optimistic-locking via a `version` column for atomic updates.
 */

import { eq, and, sql } from "drizzle-orm";
import type { Database } from "./index";
import { tasks } from "./schema";
import { normalizeTaskCreationSource } from "../kanban/task-creation-policy";
import { stripSpeculativeKanbanTaskAdaptiveSnapshot } from "../kanban/task-adaptive";
import { hydrateTaskComments, type Task, type TaskStatus } from "../models/task";
import type { TaskStore } from "../store/task-store";

export class PgTaskStore implements TaskStore {
  constructor(private db: Database) {}

  async save(task: Task): Promise<void> {
    task = stripSpeculativeKanbanTaskAdaptiveSnapshot(task);
    const version = (task as Task & { version?: number }).version ?? 1;
    await this.db
      .insert(tasks)
      .values({
        id: task.id,
        title: task.title,
        objective: task.objective,
        comment: task.comment,
        comments: task.comments ?? [],
        scope: task.scope,
        acceptanceCriteria: task.acceptanceCriteria,
        verificationCommands: task.verificationCommands,
        testCases: task.testCases,
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
        fallbackAgentChain: task.fallbackAgentChain,
        enableAutomaticFallback: task.enableAutomaticFallback,
        maxFallbackAttempts: task.maxFallbackAttempts,
        triggerSessionId: task.triggerSessionId,
        sessionIds: task.sessionIds ?? [],
        laneSessions: task.laneSessions ?? [],
        laneHandoffs: task.laneHandoffs ?? [],
        githubId: task.githubId,
        githubNumber: task.githubNumber,
        githubUrl: task.githubUrl,
        githubRepo: task.githubRepo,
        githubState: task.githubState,
        githubSyncedAt: task.githubSyncedAt,
        lastSyncError: task.lastSyncError,
        isPullRequest: task.isPullRequest,
        dependencies: task.dependencies,
        parallelGroup: task.parallelGroup,
        workspaceId: task.workspaceId,
        sessionId: task.sessionId,
        creationSource: task.creationSource,
        codebaseIds: task.codebaseIds ?? [],
        contextSearchSpec: task.contextSearchSpec,
        jitContextSnapshot: task.jitContextSnapshot,
        worktreeId: task.worktreeId,
        deliverySnapshot: task.deliverySnapshot,
        completionSummary: task.completionSummary,
        verificationVerdict: task.verificationVerdict,
        verificationReport: task.verificationReport,
        version,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })
      .onConflictDoUpdate({
        target: tasks.id,
        set: {
          title: task.title,
          objective: task.objective,
          comment: task.comment,
          comments: task.comments ?? [],
          scope: task.scope,
          acceptanceCriteria: task.acceptanceCriteria,
          verificationCommands: task.verificationCommands,
          testCases: task.testCases,
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
          fallbackAgentChain: task.fallbackAgentChain,
          enableAutomaticFallback: task.enableAutomaticFallback,
          maxFallbackAttempts: task.maxFallbackAttempts,
          triggerSessionId: task.triggerSessionId,
          sessionIds: task.sessionIds ?? [],
          laneSessions: task.laneSessions ?? [],
          laneHandoffs: task.laneHandoffs ?? [],
          githubId: task.githubId,
          githubNumber: task.githubNumber,
          githubUrl: task.githubUrl,
          githubRepo: task.githubRepo,
          githubState: task.githubState,
          githubSyncedAt: task.githubSyncedAt,
          lastSyncError: task.lastSyncError,
          isPullRequest: task.isPullRequest,
          dependencies: task.dependencies,
          parallelGroup: task.parallelGroup,
          sessionId: task.sessionId,
          creationSource: task.creationSource,
          codebaseIds: task.codebaseIds ?? [],
          contextSearchSpec: task.contextSearchSpec,
          jitContextSnapshot: task.jitContextSnapshot,
          worktreeId: task.worktreeId,
          deliverySnapshot: task.deliverySnapshot,
          completionSummary: task.completionSummary,
          verificationVerdict: task.verificationVerdict,
          verificationReport: task.verificationReport,
          version: sql`${tasks.version} + 1`,
          updatedAt: new Date(),
        },
      });
  }

  async get(taskId: string): Promise<Task | undefined> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.workspaceId, workspaceId));
    return rows.map(this.toModel);
  }

  async listByStatus(workspaceId: string, status: TaskStatus): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.status, status)));
    return rows.map(this.toModel);
  }

  async listByAssignee(agentId: string): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.assignedTo, agentId));
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
      .update(tasks)
      .set({ status, updatedAt: new Date(), version: sql`${tasks.version} + 1` })
      .where(eq(tasks.id, taskId));
  }

  async delete(taskId: string): Promise<void> {
    await this.db.delete(tasks).where(eq(tasks.id, taskId));
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const result = await this.db.delete(tasks).where(eq(tasks.workspaceId, workspaceId));
    return result.rowCount;
  }

  /**
   * Atomic update with optimistic locking.
   * Returns true if the update was applied, false if version mismatch.
   */
  async atomicUpdate(
    taskId: string,
    expectedVersion: number,
    updates: Partial<Pick<Task, "status" | "completionSummary" | "verificationVerdict" | "verificationReport" | "assignedTo">>
  ): Promise<boolean> {
    const result = await this.db
      .update(tasks)
      .set({
        ...updates,
        version: sql`${tasks.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.version, expectedVersion)));

    // Neon HTTP driver returns { rowCount } on update
    const rowCount = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    return rowCount > 0;
  }

  private toModel(row: typeof tasks.$inferSelect): Task {
    const comments = hydrateTaskComments(
      row.comments as import("../models/task").TaskCommentEntry[] | undefined,
      row.comment ?? undefined,
    );

    return stripSpeculativeKanbanTaskAdaptiveSnapshot({
      id: row.id,
      title: row.title,
      objective: row.objective,
      comment: row.comment ?? undefined,
      comments,
      scope: row.scope ?? undefined,
      acceptanceCriteria: (row.acceptanceCriteria as string[]) ?? undefined,
      verificationCommands: (row.verificationCommands as string[]) ?? undefined,
      testCases: (row.testCases as string[]) ?? undefined,
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
      fallbackAgentChain: (row.fallbackAgentChain as import("../models/task").FallbackAgent[]) ?? undefined,
      enableAutomaticFallback: row.enableAutomaticFallback ?? undefined,
      maxFallbackAttempts: row.maxFallbackAttempts ?? undefined,
      triggerSessionId: row.triggerSessionId ?? undefined,
      sessionIds: (row.sessionIds as string[]) ?? [],
      laneSessions: (row.laneSessions as import("../models/task").TaskLaneSession[]) ?? [],
      laneHandoffs: (row.laneHandoffs as import("../models/task").TaskLaneHandoff[]) ?? [],
      githubId: row.githubId ?? undefined,
      githubNumber: row.githubNumber ?? undefined,
      githubUrl: row.githubUrl ?? undefined,
      githubRepo: row.githubRepo ?? undefined,
      githubState: row.githubState ?? undefined,
      githubSyncedAt: row.githubSyncedAt ?? undefined,
      lastSyncError: row.lastSyncError ?? undefined,
      isPullRequest: row.isPullRequest ?? undefined,
      dependencies: (row.dependencies as string[]) ?? [],
      parallelGroup: row.parallelGroup ?? undefined,
      workspaceId: row.workspaceId,
      sessionId: row.sessionId ?? undefined,
      creationSource: normalizeTaskCreationSource(row.creationSource, {
        sessionId: row.sessionId,
      }),
      codebaseIds: (row.codebaseIds as string[]) ?? [],
      contextSearchSpec: row.contextSearchSpec as import("../models/task").TaskContextSearchSpec | undefined,
      jitContextSnapshot: row.jitContextSnapshot as import("../models/task").TaskJitContextSnapshot | undefined,
      worktreeId: row.worktreeId ?? undefined,
      deliverySnapshot: row.deliverySnapshot as import("../models/task").TaskDeliverySnapshot | undefined,
      completionSummary: row.completionSummary ?? undefined,
      verificationVerdict: row.verificationVerdict as import("../models/task").VerificationVerdict | undefined,
      verificationReport: row.verificationReport ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
