/**
 * TaskStore - port of routa-core TaskStore.kt
 *
 * In-memory storage for tasks and their lifecycle.
 */

import { Task, TaskStatus } from "../models/task";

export interface TaskStore {
  save(task: Task): Promise<void>;
  get(taskId: string): Promise<Task | undefined>;
  listByWorkspace(workspaceId: string): Promise<Task[]>;
  listByStatus(workspaceId: string, status: TaskStatus): Promise<Task[]>;
  listByAssignee(agentId: string): Promise<Task[]>;
  findReadyTasks(workspaceId: string): Promise<Task[]>;
  updateStatus(taskId: string, status: TaskStatus): Promise<void>;
  delete(taskId: string): Promise<void>;
}

export class InMemoryTaskStore implements TaskStore {
  private tasks = new Map<string, Task>();

  async save(task: Task): Promise<void> {
    this.tasks.set(task.id, { ...task });
  }

  async get(taskId: string): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter(
      (t) => t.workspaceId === workspaceId
    );
  }

  async listByStatus(
    workspaceId: string,
    status: TaskStatus
  ): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter(
      (t) => t.workspaceId === workspaceId && t.status === status
    );
  }

  async listByAssignee(agentId: string): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter(
      (t) => t.assignedTo === agentId
    );
  }

  async findReadyTasks(workspaceId: string): Promise<Task[]> {
    const allTasks = await this.listByWorkspace(workspaceId);
    return allTasks.filter((task) => {
      if (task.status !== TaskStatus.PENDING) return false;
      // Check all dependencies are completed
      return task.dependencies.every((depId) => {
        const dep = this.tasks.get(depId);
        return dep && dep.status === TaskStatus.COMPLETED;
      });
    });
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      task.updatedAt = new Date();
    }
  }

  async delete(taskId: string): Promise<void> {
    this.tasks.delete(taskId);
  }
}
