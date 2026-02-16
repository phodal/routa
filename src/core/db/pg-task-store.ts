/**
 * PgTaskStore — Postgres-backed task store using Drizzle ORM.
 *
 * Supports optimistic-locking via a `version` column for atomic updates.
 */

import { eq, and, sql } from "drizzle-orm";
import type { Database } from "./index";
import { tasks } from "./schema";
import type { Task, TaskStatus } from "../models/task";
import type { TaskStore } from "../store/task-store";

export class PgTaskStore implements TaskStore {
  constructor(private db: Database) {}

  async save(task: Task): Promise<void> {
    const version = (task as Task & { version?: number }).version ?? 1;
    await this.db
      .insert(tasks)
      .values({
        id: task.id,
        title: task.title,
        objective: task.objective,
        scope: task.scope,
        acceptanceCriteria: task.acceptanceCriteria,
        verificationCommands: task.verificationCommands,
        assignedTo: task.assignedTo,
        status: task.status,
        dependencies: task.dependencies,
        parallelGroup: task.parallelGroup,
        workspaceId: task.workspaceId,
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
          scope: task.scope,
          acceptanceCriteria: task.acceptanceCriteria,
          verificationCommands: task.verificationCommands,
          assignedTo: task.assignedTo,
          status: task.status,
          dependencies: task.dependencies,
          parallelGroup: task.parallelGroup,
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
    return {
      id: row.id,
      title: row.title,
      objective: row.objective,
      scope: row.scope ?? undefined,
      acceptanceCriteria: (row.acceptanceCriteria as string[]) ?? undefined,
      verificationCommands: (row.verificationCommands as string[]) ?? undefined,
      assignedTo: row.assignedTo ?? undefined,
      status: row.status as TaskStatus,
      dependencies: (row.dependencies as string[]) ?? [],
      parallelGroup: row.parallelGroup ?? undefined,
      workspaceId: row.workspaceId,
      completionSummary: row.completionSummary ?? undefined,
      verificationVerdict: row.verificationVerdict as import("../models/task").VerificationVerdict | undefined,
      verificationReport: row.verificationReport ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
