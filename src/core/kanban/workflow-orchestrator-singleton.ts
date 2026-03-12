/**
 * Workflow Orchestrator Singleton
 *
 * Provides a global instance of the KanbanWorkflowOrchestrator.
 * Initialized when the RoutaSystem is created.
 */

import { KanbanWorkflowOrchestrator } from "./workflow-orchestrator";
import type { RoutaSystem } from "../routa-system";
import type { KanbanColumnAutomation } from "../models/kanban";
import { TaskStatus } from "../models/task";
import { GitWorktreeService } from "../git/git-worktree-service";
import {
  getDefaultWorkspaceWorktreeRoot,
  getEffectiveWorkspaceMetadata,
} from "../models/workspace";
import { getInternalApiOrigin, triggerAssignedTaskAgent } from "./agent-trigger";

// Use globalThis to survive HMR in Next.js dev mode
const GLOBAL_KEY = "__routa_workflow_orchestrator__";
const STARTED_KEY = "__routa_workflow_orchestrator_started__";

async function createAutomationSession(
  system: RoutaSystem,
  params: {
    workspaceId: string;
    cardTitle: string;
    columnName: string;
    cardId: string;
    columnId: string;
    automation: KanbanColumnAutomation;
  },
): Promise<string | null> {
  const task = await system.taskStore.get(params.cardId);
  if (!task) return null;
  if (task.triggerSessionId) return task.triggerSessionId;

  const nextTask = {
    ...task,
    assignedProvider:
      params.automation.providerId ?? task.assignedProvider ?? "opencode",
    assignedRole:
      params.automation.role ?? task.assignedRole ?? "DEVELOPER",
    assignedSpecialistId:
      params.automation.specialistId ?? task.assignedSpecialistId,
    assignedSpecialistName:
      params.automation.specialistName ?? task.assignedSpecialistName,
    updatedAt: new Date(),
  };

  let preferredCodebase = (nextTask.codebaseIds?.length ?? 0) > 0
    ? await system.codebaseStore.get(nextTask.codebaseIds[0])
    : undefined;
  if (!preferredCodebase) {
    preferredCodebase = await system.codebaseStore.getDefault(nextTask.workspaceId);
  }

  let worktreeCwd = preferredCodebase?.repoPath ?? process.cwd();
  let worktreeBranch = preferredCodebase?.branch;
  if (params.columnId === "dev" && preferredCodebase && !nextTask.worktreeId) {
    try {
      const worktreeService = new GitWorktreeService(
        system.worktreeStore,
        system.codebaseStore,
      );
      const slugifiedTitle = nextTask.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
      const branch = `issue/${nextTask.id.slice(0, 8)}-${slugifiedTitle}`;
      const label = `${nextTask.id.slice(0, 8)}-${slugifiedTitle}`;
      const workspace = await system.workspaceStore.get(nextTask.workspaceId);
      const worktreeRoot = workspace
        ? getEffectiveWorkspaceMetadata(workspace).worktreeRoot
        : getDefaultWorkspaceWorktreeRoot(nextTask.workspaceId);
      const worktree = await worktreeService.createWorktree(preferredCodebase.id, {
        branch,
        baseBranch: preferredCodebase.branch ?? "main",
        label,
        worktreeRoot,
      });
      nextTask.worktreeId = worktree.id;
      worktreeCwd = worktree.worktreePath;
      worktreeBranch = worktree.branch;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nextTask.status = TaskStatus.BLOCKED;
      nextTask.columnId = "blocked";
      nextTask.lastSyncError = `Worktree creation failed: ${message}`;
      await system.taskStore.save(nextTask);
      return null;
    }
  } else if (nextTask.worktreeId) {
    const existingWorktree = await system.worktreeStore.get(nextTask.worktreeId);
    if (existingWorktree?.worktreePath) {
      worktreeCwd = existingWorktree.worktreePath;
      worktreeBranch = existingWorktree.branch ?? worktreeBranch;
    }
  }

  const triggerResult = await triggerAssignedTaskAgent({
    origin: getInternalApiOrigin(),
    workspaceId: nextTask.workspaceId,
    cwd: worktreeCwd,
    branch: worktreeBranch,
    task: nextTask,
  });

  if (triggerResult.sessionId) {
    nextTask.triggerSessionId = triggerResult.sessionId;
    nextTask.lastSyncError = undefined;
    if (nextTask.worktreeId) {
      await system.worktreeStore.assignSession(nextTask.worktreeId, triggerResult.sessionId);
    }
  } else if (triggerResult.error) {
    nextTask.lastSyncError = triggerResult.error;
  }

  await system.taskStore.save(nextTask);
  return triggerResult.sessionId ?? null;
}

/**
 * Get or create the global KanbanWorkflowOrchestrator instance.
 */
export function getWorkflowOrchestrator(system: RoutaSystem): KanbanWorkflowOrchestrator {
  const g = globalThis as Record<string, unknown>;
  let orchestrator = g[GLOBAL_KEY] as KanbanWorkflowOrchestrator | undefined;

  if (!orchestrator) {
    orchestrator = new KanbanWorkflowOrchestrator(
      system.eventBus,
      system.kanbanBoardStore,
      system.taskStore,
    );
    g[GLOBAL_KEY] = orchestrator;
  }

  return orchestrator;
}

/**
 * Start the workflow orchestrator singleton. Idempotent across HMR restarts.
 */
export function startWorkflowOrchestrator(system: RoutaSystem): void {
  const g = globalThis as Record<string, unknown>;

  if (g[STARTED_KEY]) {
    return; // Already started
  }

  const orchestrator = getWorkflowOrchestrator(system);
  orchestrator.setCreateSession((params) => createAutomationSession(system, params));
  orchestrator.start();
  g[STARTED_KEY] = true;
}

/**
 * Reset the orchestrator (for testing).
 */
export function resetWorkflowOrchestrator(): void {
  const g = globalThis as Record<string, unknown>;
  
  const orchestrator = g[GLOBAL_KEY] as KanbanWorkflowOrchestrator | undefined;
  if (orchestrator) {
    orchestrator.stop();
  }
  
  delete g[GLOBAL_KEY];
  delete g[STARTED_KEY];
}
