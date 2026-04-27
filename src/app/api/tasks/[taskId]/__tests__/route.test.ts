import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifact } from "@/core/models/artifact";
import { createTask, TaskStatus, VerificationVerdict, type Task } from "@/core/models/task";
import { InMemoryArtifactStore } from "@/core/store/artifact-store";
import type { TaskDeliveryReadiness } from "@/core/kanban/task-delivery-readiness";

const notify = vi.fn();
const removeCardJob = vi.fn();
const enqueueKanbanTaskSession = vi.fn();
const processKanbanColumnTransition = vi.fn();
const archiveActiveTaskSession = vi.fn<(task: Task) => void>();
const prepareTaskForColumnChange = vi.fn<(fromColumnId?: string, task?: Task) => boolean>(() => false);
const createWorktree = vi.fn();
const buildTaskDeliveryReadiness = vi.fn<
  (task: Task, currentSystem: typeof system) => Promise<TaskDeliveryReadiness>
>();
const buildTaskDeliveryTransitionErrorFromRules = vi.fn<
  (readiness: TaskDeliveryReadiness, targetColumnName: string, deliveryRules: Record<string, unknown> | undefined) => string | null
>(() => null);
let capturedEnqueueTask: Task | undefined;

const taskStore = {
  get: vi.fn<(_: string) => Promise<Task | null>>(),
  save: vi.fn<(task: Task) => Promise<void>>(),
};

const system = {
  taskStore,
  kanbanBoardStore: { get: vi.fn() },
  workspaceStore: { get: vi.fn() },
  worktreeStore: { assignSession: vi.fn(), get: vi.fn() },
  codebaseStore: { findByRepoPath: vi.fn(), get: vi.fn(), getDefault: vi.fn() },
  eventBus: {},
  artifactStore: undefined as InMemoryArtifactStore | undefined,
};
const artifactStore = new InMemoryArtifactStore();

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({
  getKanbanEventBroadcaster: () => ({ notify }),
}));

vi.mock("@/core/kanban/task-board-context", () => ({
  ensureTaskBoardContext: vi.fn(async () => ({})),
}));

vi.mock("@/core/kanban/github-issues", () => ({
  updateGitHubIssue: vi.fn(),
}));

vi.mock("@/core/git/git-worktree-service", () => ({
  GitWorktreeService: vi.fn(class {
    createWorktree = createWorktree;
  }),
}));

vi.mock("@/core/models/workspace", () => ({
  getDefaultWorkspaceWorktreeRoot: vi.fn(),
  getEffectiveWorkspaceMetadata: vi.fn(),
}));

vi.mock("@/core/kanban/column-transition", () => ({
  emitColumnTransition: vi.fn(),
}));

vi.mock("@/core/kanban/task-session-transition", () => ({
  archiveActiveTaskSession: (task: Task) => archiveActiveTaskSession(task),
  prepareTaskForColumnChange: (fromColumnId?: string, task?: Task) =>
    prepareTaskForColumnChange(fromColumnId, task),
}));

vi.mock("@/core/kanban/task-delivery-readiness", () => ({
  buildTaskDeliveryReadiness: (task: Task, currentSystem: typeof system) =>
    buildTaskDeliveryReadiness(task, currentSystem),
  buildTaskDeliveryTransitionErrorFromRules: (
    readiness: TaskDeliveryReadiness,
    targetColumnName: string,
    deliveryRules: Record<string, unknown> | undefined,
  ) => buildTaskDeliveryTransitionErrorFromRules(readiness, targetColumnName, deliveryRules),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  enqueueKanbanTaskSession: (currentSystem: typeof system, params: { task: Task }) =>
    enqueueKanbanTaskSession(currentSystem, params),
  getKanbanSessionQueue: () => ({ removeCardJob }),
  processKanbanColumnTransition: (...args: unknown[]) => processKanbanColumnTransition(...args),
}));

import { GET, PATCH } from "../route";

describe("/api/tasks/[taskId]", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    capturedEnqueueTask = undefined;
    buildTaskDeliveryReadiness.mockResolvedValue({
      checked: false,
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      isGitHubRepo: false,
      canCreatePullRequest: false,
      reason: "Task has no linked repository or worktree.",
    });
    buildTaskDeliveryTransitionErrorFromRules.mockReturnValue(null);
    taskStore.save.mockResolvedValue();
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue(null);
    system.worktreeStore.get = vi.fn().mockResolvedValue(undefined);
    system.codebaseStore.findByRepoPath = vi.fn().mockResolvedValue(undefined);
    system.codebaseStore.get = vi.fn().mockResolvedValue(undefined);
    system.codebaseStore.getDefault = vi.fn().mockResolvedValue(undefined);
    system.artifactStore = undefined;
    await artifactStore.deleteByTask("task-1");
    taskStore.get.mockResolvedValue(createTask({
      id: "task-1",
      title: "Retry review",
      objective: "Retry review",
      comment: "Review requested another verification pass.",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-old",
      assignedProvider: "codex",
      assignedRole: "GATE",
      assignedSpecialistId: "pr-reviewer",
      assignedSpecialistName: "PR Reviewer",
    }));
    enqueueKanbanTaskSession.mockImplementation(async (_system, params: { task: Task }) => {
      capturedEnqueueTask = structuredClone(params.task);
      return {
        sessionId: "session-new",
        queued: false,
      };
    });
    processKanbanColumnTransition.mockResolvedValue(undefined);
    createWorktree.mockReset();
    createWorktree.mockResolvedValue({
      id: "wt-1",
      branch: "issue/task-1",
      worktreePath: "/tmp/worktrees/task-1",
    });
  });

  it("returns default evidence summary when artifact storage is unavailable", async () => {
    const response = await GET(new NextRequest("http://localhost/api/tasks/task-1"), {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task.comment).toBe("Review requested another verification pass.");
    expect(data.task.comments).toEqual([
      expect.objectContaining({ body: "Review requested another verification pass." }),
    ]);
    expect(data.task.artifactSummary).toEqual({
      total: 0,
      byType: {},
      requiredSatisfied: true,
      missingRequired: [],
    });
    expect(data.task.evidenceSummary).toEqual({
      artifact: {
        total: 0,
        byType: {},
        requiredSatisfied: true,
        missingRequired: [],
      },
      verification: {
        hasVerdict: false,
        verdict: undefined,
        hasReport: false,
      },
      completion: {
        hasSummary: false,
      },
      runs: {
        total: 0,
        latestStatus: "idle",
      },
    });
    expect(data.task.storyReadiness).toMatchObject({
      ready: true,
      missing: [],
      requiredTaskFields: [],
    });
    expect(data.task.deliveryReadiness).toMatchObject({
      checked: false,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
    });
    expect(data.task.investValidation).toMatchObject({
      source: "heuristic",
      overallStatus: "fail",
    });
  });

  it("updates contextSearchSpec through PATCH", async () => {
    const response = await PATCH(new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({
        contextSearchSpec: {
          query: "kanban jit context",
          featureCandidates: ["kanban-workflow"],
          relatedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx"],
        },
      }),
      headers: { "Content-Type": "application/json" },
    }), {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      contextSearchSpec: {
        query: "kanban jit context",
        featureCandidates: ["kanban-workflow"],
        relatedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx"],
      },
    }));
    expect(data.task.contextSearchSpec).toEqual({
      query: "kanban jit context",
      featureCandidates: ["kanban-workflow"],
      relatedFiles: ["src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx"],
    });
  });

  it("strips speculative backlog snapshots during unrelated PATCH updates", async () => {
    taskStore.get.mockResolvedValueOnce(createTask({
      id: "task-stale-backlog-history",
      title: "Legacy backlog card",
      objective: "Clear stale history memory on save",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
      githubRepo: "acme/platform",
      githubNumber: 42,
      jitContextSnapshot: {
        generatedAt: "2026-04-22T07:37:30.509Z",
        summary: "Speculative feature-explorer history memory.",
        matchConfidence: "high",
        matchReasons: ["Recovered stale feature-explorer files."],
        warnings: [],
        matchedFileDetails: [],
        matchedSessionIds: ["session-1"],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
      },
    }));

    const response = await PATCH(new NextRequest("http://localhost/api/tasks/task-stale-backlog-history", {
      method: "PATCH",
      body: JSON.stringify({
        comment: "Touch the task without confirming feature hints.",
      }),
      headers: { "Content-Type": "application/json" },
    }), {
      params: Promise.resolve({ taskId: "task-stale-backlog-history" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-stale-backlog-history",
      columnId: "backlog",
      contextSearchSpec: undefined,
      jitContextSnapshot: undefined,
    }));
    expect(data.task.jitContextSnapshot).toBeUndefined();
  });

  it("merges structured jitContextAnalysis through PATCH", async () => {
    taskStore.get.mockResolvedValueOnce(createTask({
      id: "task-jit-analysis",
      title: "Analyze JIT history",
      objective: "Persist analysis results",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
      jitContextSnapshot: {
        generatedAt: "2026-04-21T08:00:00.000Z",
        summary: "Recovered history context for Kanban workflow.",
        matchConfidence: "high",
        matchReasons: ["Matched the kanban-workflow feature."],
        warnings: [],
        matchedFileDetails: [{
          filePath: "src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx",
          changes: 2,
          sessions: 3,
          updatedAt: "2026-04-21T08:00:00.000Z",
        }],
        matchedSessionIds: ["session-codex"],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
      },
    }));

    const response = await PATCH(new NextRequest("http://localhost/api/tasks/task-jit-analysis", {
      method: "PATCH",
      body: JSON.stringify({
        jitContextAnalysis: {
          summary: "Focus next on the Kanban API and blocked interval read model.",
          topFiles: ["crates/routa-server/src/api/kanban.rs"],
          topSessions: [
            {
              sessionId: "019daf46-1a5b-7001-8a17-df4a7053ace0",
              provider: "codex",
              reason: "This session touched the durable flow-event implementation directly.",
            },
          ],
          reusablePrompts: ["Check Rust and TS flow-event parity first."],
          recommendedContextSearchSpec: {
            query: "kanban flow event persistence",
            featureCandidates: ["kanban-workflow"],
            relatedFiles: ["crates/routa-server/src/api/kanban.rs"],
          },
        },
      }),
      headers: { "Content-Type": "application/json" },
    }), {
      params: Promise.resolve({ taskId: "task-jit-analysis" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      jitContextSnapshot: expect.objectContaining({
        summary: "Recovered history context for Kanban workflow.",
        analysis: expect.objectContaining({
          summary: "Focus next on the Kanban API and blocked interval read model.",
          topFiles: ["crates/routa-server/src/api/kanban.rs"],
          recommendedContextSearchSpec: expect.objectContaining({
            query: "kanban flow event persistence",
            featureCandidates: ["kanban-workflow"],
          }),
        }),
      }),
    }));
    expect(data.task.jitContextSnapshot).toEqual(expect.objectContaining({
      analysis: expect.objectContaining({
        summary: "Focus next on the Kanban API and blocked interval read model.",
        topSessions: [
          expect.objectContaining({
            sessionId: "019daf46-1a5b-7001-8a17-df4a7053ace0",
            provider: "codex",
          }),
        ],
      }),
    }));
  });

  it("keeps legacy appended comments as a single migrated note", async () => {
    taskStore.get.mockResolvedValueOnce(createTask({
      id: "task-legacy-comments",
      title: "Legacy notes",
      objective: "Show note migration",
      comment: "Initial note\n\nSecond note\n\nThird note",
      comments: [],
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
    }));

    const response = await GET(new NextRequest("http://localhost/api/tasks/task-legacy-comments"), {
      params: Promise.resolve({ taskId: "task-legacy-comments" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task.comments).toEqual([
      expect.objectContaining({
        body: "Initial note\n\nSecond note\n\nThird note",
        source: "legacy_import",
      }),
    ]);
  });

  it("hides speculative backlog history memory on GET until context is confirmed", async () => {
    taskStore.get.mockResolvedValueOnce(createTask({
      id: "task-legacy-backlog-history",
      title: "Legacy backlog card",
      objective: "Do not surface stale history memory before refinement",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
      jitContextSnapshot: {
        generatedAt: "2026-04-22T07:37:30.509Z",
        summary: "Speculative feature-explorer history memory.",
        matchConfidence: "high",
        matchReasons: ["Recovered stale feature-explorer files."],
        warnings: [],
        matchedFileDetails: [],
        matchedSessionIds: ["session-1"],
        failures: [],
        repeatedReadFiles: [],
        sessions: [],
      },
    }));

    const response = await GET(new NextRequest("http://localhost/api/tasks/task-legacy-backlog-history"), {
      params: Promise.resolve({ taskId: "task-legacy-backlog-history" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task.contextSearchSpec).toBeUndefined();
    expect(data.task.jitContextSnapshot).toBeUndefined();
  });

  it("reports missing required artifacts and latest run status in evidence summary", async () => {
    const task = createTask({
      id: "task-1",
      title: "Verify dev handoff",
      objective: "Surface evidence requirements",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-todo-1",
    });
    task.sessionIds = ["session-todo-1"];
    task.laneSessions = [{
      sessionId: "session-todo-1",
      columnId: "todo",
      columnName: "Todo",
      status: "running",
      startedAt: "2026-03-18T00:00:00.000Z",
    }];
    task.verificationVerdict = VerificationVerdict.APPROVED;
    task.verificationReport = "Checks passed";
    task.completionSummary = "Ready for dev";
    taskStore.get.mockResolvedValue(task);
    system.artifactStore = artifactStore;
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "todo", name: "Todo", position: 0, stage: "todo" },
        {
          id: "dev",
          name: "Dev",
          position: 1,
          stage: "dev",
          automation: {
            requiredArtifacts: ["screenshot", "logs"],
          },
        },
      ],
    });

    await artifactStore.saveArtifact(createArtifact({
      id: "artifact-1",
      type: "logs",
      taskId: "task-1",
      workspaceId: "workspace-1",
      status: "provided",
    }));

    const response = await GET(new NextRequest("http://localhost/api/tasks/task-1"), {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task.evidenceSummary).toMatchObject({
      artifact: {
        total: 1,
        byType: {
          logs: 1,
        },
        requiredSatisfied: false,
        missingRequired: ["screenshot"],
      },
      verification: {
        hasVerdict: true,
        verdict: "APPROVED",
        hasReport: true,
      },
      completion: {
        hasSummary: true,
      },
      runs: {
        total: 1,
        latestStatus: "running",
      },
    });
    expect(data.task.storyReadiness).toMatchObject({
      ready: true,
      requiredTaskFields: [],
    });
  });

  it("blocks moving a card into a lane when required task fields are missing", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Prepare dev handoff",
      objective: "Need scope and verification plan",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
    });
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "todo", name: "Todo", position: 0, stage: "todo" },
        {
          id: "dev",
          name: "Dev",
          position: 1,
          stage: "dev",
          automation: {
            requiredTaskFields: ["scope", "acceptance_criteria", "verification_plan"],
          },
        },
      ],
    });

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ columnId: "dev" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Cannot move task to "Dev": missing required task fields');
    expect(data.missingTaskFields).toEqual(["scope", "acceptance criteria", "verification plan"]);
    expect(data.storyReadiness).toMatchObject({
      ready: false,
      missing: ["scope", "acceptance_criteria", "verification_plan"],
    });
  });

  it("converges a final approved review verdict into done", async () => {
    const task = createTask({
      id: "task-1",
      title: "Finalize review verdict",
      objective: "Leave review after Review Guard approval",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "review",
      status: TaskStatus.REVIEW_REQUIRED,
    });
    task.assignedSpecialistId = "kanban-review-guard";
    task.assignedSpecialistName = "Review Guard";
    taskStore.get.mockResolvedValue(task);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "dev", name: "Dev", position: 0, stage: "dev" },
        {
          id: "review",
          name: "Review",
          position: 1,
          stage: "review",
          automation: {
            enabled: true,
            steps: [
              {
                id: "qa-frontend",
                role: "GATE",
                specialistId: "kanban-qa-frontend",
                specialistName: "QA Frontend",
              },
              {
                id: "review-guard",
                role: "GATE",
                specialistId: "kanban-review-guard",
                specialistName: "Review Guard",
              },
            ],
          },
        },
        { id: "done", name: "Done", position: 2, stage: "done" },
      ],
    });

    const response = await PATCH(new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({
        verificationVerdict: VerificationVerdict.APPROVED,
        verificationReport: "Visual and functional checks passed",
      }),
    }), {
      params: Promise.resolve({ taskId: "task-1" }),
    });

    expect(response.status).toBe(200);
    const savedTask = taskStore.save.mock.calls.at(-1)?.[0];
    expect(savedTask).toMatchObject({
      columnId: "done",
      status: TaskStatus.COMPLETED,
      verificationVerdict: VerificationVerdict.APPROVED,
    });
  });

  it("rejects malformed canonical YAML when updating a backlog card description", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Refine canonical contract",
      objective: "Initial prose",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    });
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        {
          id: "todo",
          name: "Todo",
          position: 1,
          stage: "todo",
          automation: {
            enabled: true,
            contractRules: {
              requireCanonicalStory: true,
              loopBreakerThreshold: 2,
            },
          },
        },
      ],
    });

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ objective: "```yaml\nstory: [broken\n```" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Cannot update card description");
    expect(data.error).toContain('canonical story YAML is invalid for "Todo"');
    expect(data.contractReadiness).toMatchObject({
      checked: true,
      ready: false,
      hasCanonicalStoryBlock: true,
    });
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      comment: expect.stringContaining("Contract gate blocked:"),
    }));
  });

  it("breaks the contract retry loop after repeated canonical YAML failures", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Loop on malformed contract",
      objective: "Initial prose",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
      comments: [{
        id: "note-1",
        body: 'Contract gate blocked: Cannot update card description: canonical story YAML is invalid for "Todo".',
        createdAt: new Date().toISOString(),
      }],
    });
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        {
          id: "todo",
          name: "Todo",
          position: 1,
          stage: "todo",
          automation: {
            enabled: true,
            contractRules: {
              requireCanonicalStory: true,
              loopBreakerThreshold: 2,
            },
          },
        },
      ],
    });

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ objective: "```yaml\nstory: [broken-again\n```" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });

    expect(response.status).toBe(400);
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      labels: expect.arrayContaining(["contract-gate-blocked"]),
      lastSyncError: expect.stringContaining('Stopped automatic retries for "Todo"'),
    }));
  });

  it("clears the active queue entry before rerunning a task trigger", async () => {
    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ retryTrigger: true }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(archiveActiveTaskSession).toHaveBeenCalledTimes(1);
    expect(removeCardJob).toHaveBeenCalledWith("task-1");
    expect(enqueueKanbanTaskSession).toHaveBeenCalledTimes(1);
    expect(enqueueKanbanTaskSession).toHaveBeenCalledWith(system, expect.objectContaining({
      expectedColumnId: "todo",
      ignoreExistingTrigger: true,
    }));
    expect(capturedEnqueueTask).toMatchObject({
      id: "task-1",
      triggerSessionId: undefined,
    });
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      triggerSessionId: "session-new",
    }));
    expect(data.task.triggerSessionId).toBe("session-new");
  });

  it("reuses the existing task worktree when retrying a dev trigger", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Retry dev on the same worktree",
      objective: "Keep using the existing dev worktree",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.IN_PROGRESS,
      triggerSessionId: "session-dev-old",
      worktreeId: "wt-1",
    });
    taskStore.get.mockResolvedValue(existingTask);
    system.worktreeStore.get = vi.fn().mockResolvedValue({
      id: "wt-1",
      codebaseId: "repo-1",
      workspaceId: "workspace-1",
      worktreePath: "/tmp/worktrees/task-1",
      branch: "issue/task-1",
      baseBranch: "main",
      status: "active",
    });
    system.codebaseStore.get = vi.fn().mockResolvedValue({
      id: "repo-1",
      workspaceId: "workspace-1",
      repoPath: "/tmp/repos/main",
      branch: "main",
    });

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ retryTrigger: true }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createWorktree).not.toHaveBeenCalled();
    expect(capturedEnqueueTask).toMatchObject({
      id: "task-1",
      columnId: "dev",
      worktreeId: "wt-1",
      triggerSessionId: undefined,
    });
    expect(data.task.worktreeId).toBe("wt-1");
  });

  it("keeps retrying a dev trigger even when the stored worktree id is stale", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Retry dev after stale worktree",
      objective: "Replace missing worktree records before rerun",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.IN_PROGRESS,
      triggerSessionId: "session-dev-old",
      worktreeId: "wt-stale",
    });
    taskStore.get.mockResolvedValue(existingTask);
    system.worktreeStore.get = vi.fn().mockResolvedValue(undefined);
    system.codebaseStore.getDefault = vi.fn().mockResolvedValue({
      id: "repo-1",
      workspaceId: "workspace-1",
      repoPath: "/tmp/repos/main",
      branch: "main",
    });
    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ retryTrigger: true }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createWorktree).not.toHaveBeenCalled();
    expect(capturedEnqueueTask).toMatchObject({
      id: "task-1",
      columnId: "dev",
      worktreeId: "wt-stale",
      triggerSessionId: undefined,
    });
    expect(data.task.worktreeId).toBe("wt-stale");
  });

  it("passes a retry provider override without persisting a card provider override", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Retry with ACP provider",
      objective: "Keep lane specialist but switch provider for this run",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-old",
      assignedRole: "ROUTA",
      assignedSpecialistId: "backlog-refiner",
      assignedSpecialistName: "Backlog Refiner",
    });
    taskStore.get.mockResolvedValue(existingTask);

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ retryTrigger: true, retryProviderId: "codex" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(enqueueKanbanTaskSession).toHaveBeenCalledWith(system, expect.objectContaining({
      expectedColumnId: "backlog",
      ignoreExistingTrigger: true,
      providerOverride: "codex",
    }));
    expect(capturedEnqueueTask).toMatchObject({
      id: "task-1",
      assignedProvider: undefined,
      assignedRole: "ROUTA",
      assignedSpecialistId: "backlog-refiner",
    });
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      assignedProvider: undefined,
      assignedRole: "ROUTA",
      assignedSpecialistId: "backlog-refiner",
      triggerSessionId: "session-new",
    }));
    expect(data.task.triggerSessionId).toBe("session-new");
  });

  it("rejects moving a card out of a lane while later automation steps are still pending", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Run todo pipeline",
      objective: "Complete todo before dev",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-todo-1",
      assignedProvider: "codex",
      assignedRole: "CRAFTER",
      assignedSpecialistId: "kanban-todo-orchestrator",
      assignedSpecialistName: "Todo Orchestrator",
    });
    existingTask.laneSessions = [
      {
        sessionId: "session-todo-1",
        columnId: "todo",
        columnName: "Todo",
        stepId: "step-1",
        stepIndex: 0,
        stepName: "Todo Orchestrator",
        provider: "codex",
        role: "CRAFTER",
        specialistId: "kanban-todo-orchestrator",
        specialistName: "Todo Orchestrator",
        status: "running",
        startedAt: "2026-03-18T00:00:00.000Z",
      },
    ];
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        {
          id: "todo",
          name: "Todo",
          position: 1,
          stage: "todo",
          automation: {
            enabled: true,
            steps: [
              {
                id: "step-1",
                providerId: "codex",
                role: "CRAFTER",
                specialistId: "kanban-todo-orchestrator",
                specialistName: "Todo Orchestrator",
              },
              {
                id: "step-2",
                role: "GATE",
                specialistId: "gate",
                specialistName: "Verifier",
              },
            ],
          },
        },
        { id: "dev", name: "Dev", position: 2, stage: "dev" },
      ],
    });

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ columnId: "dev" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Todo Orchestrator");
    expect(data.error).toContain("Verifier");
    expect(taskStore.save).not.toHaveBeenCalled();
    expect(enqueueKanbanTaskSession).not.toHaveBeenCalled();
  });

  it("blocks moving a card to review when no committed changes are available", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Review blocked without commit",
      objective: "Need a real code commit before review",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.IN_PROGRESS,
    });
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "dev", name: "Dev", position: 1, stage: "dev" },
        {
          id: "review",
          name: "Review",
          position: 2,
          stage: "review",
          automation: {
            deliveryRules: {
              requireCommittedChanges: true,
              requireCleanWorktree: true,
            },
          },
        },
      ],
    });
    buildTaskDeliveryReadiness.mockResolvedValue({
      checked: true,
      branch: "issue/task-1",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      isGitHubRepo: true,
      canCreatePullRequest: false,
    });
    buildTaskDeliveryTransitionErrorFromRules.mockReturnValue(
      'Cannot move task to "Review": no committed changes detected on branch "issue/task-1" relative to "origin/main". Commit your implementation before requesting review.',
    );

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ columnId: "review" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("no committed changes detected");
    expect(data.deliveryReadiness).toMatchObject({
      checked: true,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
    });
    expect(taskStore.save).not.toHaveBeenCalled();
  });

  it("blocks moving a card to review when the branch still has uncommitted changes", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Review blocked until worktree is clean",
      objective: "Need all implementation committed before review",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.IN_PROGRESS,
    });
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "dev", name: "Dev", position: 1, stage: "dev" },
        {
          id: "review",
          name: "Review",
          position: 2,
          stage: "review",
          automation: {
            deliveryRules: {
              requireCommittedChanges: true,
              requireCleanWorktree: true,
            },
          },
        },
      ],
    });
    buildTaskDeliveryReadiness.mockResolvedValue({
      checked: true,
      branch: "issue/task-1",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 2,
      untracked: 1,
      ahead: 1,
      behind: 0,
      commitsSinceBase: 1,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: true,
      isGitHubRepo: true,
      canCreatePullRequest: false,
    });
    buildTaskDeliveryTransitionErrorFromRules.mockReturnValue(
      'Cannot move task to "Review": branch "issue/task-1" still has uncommitted changes (2 modified, 1 untracked). Commit the current card\'s work, then stash or restore unrelated leftovers before requesting review.',
    );

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ columnId: "review" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("uncommitted changes");
    expect(data.error).toContain("before requesting review");
    expect(data.error).toContain("stash or restore unrelated leftovers");
    expect(data.deliveryReadiness).toMatchObject({
      checked: true,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: true,
    });
    expect(taskStore.save).not.toHaveBeenCalled();
  });

  it("blocks moving a card to done when a GitHub task is not PR-ready", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Done blocked until PR is ready",
      objective: "Need a clean feature branch before completion",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "review",
      status: TaskStatus.REVIEW_REQUIRED,
    });
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "review", name: "Review", position: 2, stage: "review" },
        {
          id: "done",
          name: "Done",
          position: 3,
          stage: "done",
          automation: {
            deliveryRules: {
              requireCommittedChanges: true,
              requireCleanWorktree: true,
              requirePullRequestReady: true,
            },
          },
        },
      ],
    });
    buildTaskDeliveryReadiness.mockResolvedValue({
      checked: true,
      branch: "main",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 0,
      untracked: 0,
      ahead: 1,
      behind: 0,
      commitsSinceBase: 1,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: false,
      isGitHubRepo: true,
      canCreatePullRequest: false,
    });
    buildTaskDeliveryTransitionErrorFromRules.mockReturnValue(
      'Cannot move task to "Done": GitHub repo is not PR-ready yet. Use a feature branch instead of "main" so this task can open a pull request cleanly.',
    );

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ columnId: "done" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("PR-ready");
    expect(data.deliveryReadiness).toMatchObject({
      checked: true,
      branch: "main",
      canCreatePullRequest: false,
    });
    expect(taskStore.save).not.toHaveBeenCalled();
  });

  it("processes non-dev automated column transitions before returning", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Move into todo",
      objective: "Ensure todo automation is started eagerly.",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    });
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        {
          id: "todo",
          name: "Todo",
          position: 1,
          stage: "todo",
          automation: {
            enabled: true,
            steps: [{ id: "todo-a2a", transport: "a2a", role: "CRAFTER" }],
            transitionType: "entry",
          },
        },
      ],
    });

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({ columnId: "todo" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });

    expect(response.status).toBe(200);
    expect(processKanbanColumnTransition).toHaveBeenCalledWith(system, expect.objectContaining({
      cardId: "task-1",
      boardId: "board-1",
      fromColumnId: "backlog",
      toColumnId: "todo",
      toColumnName: "Todo",
    }));
  });

  it("uses a short task-id-based worktree branch when entering dev", async () => {
    const taskId = "cf7f1e28-011d-4d0b-98e3-0f7d9b012570";
    taskStore.get.mockResolvedValue(createTask({
      id: taskId,
      title: "Issue cf7f1e28 feat kanban add story readiness and evidence workflow with very long title",
      objective: "Ensure worktree naming stays compact.",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
    }));
    system.codebaseStore.getDefault = vi.fn().mockResolvedValue({
      id: "repo-1",
      workspaceId: "workspace-1",
      repoPath: "/tmp/repos/main",
      branch: "main",
    });
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "todo", name: "Todo", position: 0, stage: "todo" },
        { id: "dev", name: "Dev", position: 1, stage: "dev" },
      ],
    });

    const request = new NextRequest(`http://localhost/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ columnId: "dev" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId }),
    });

    expect(response.status).toBe(200);
    expect(createWorktree).toHaveBeenCalledWith("repo-1", expect.objectContaining({
      branch: "issue/cf7f1e28",
      label: "cf7f1e28",
      baseBranch: "main",
    }));
    expect(capturedEnqueueTask).toMatchObject({
      id: taskId,
      columnId: "dev",
      worktreeId: "wt-1",
    });
  });

  it("returns a review card to dev and reuses the original worktree when review is not approved", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Return review feedback to dev",
      objective: "Send the fix back to dev on the same worktree",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "review",
      status: TaskStatus.REVIEW_REQUIRED,
      triggerSessionId: "session-review-1",
      worktreeId: "wt-1",
    });
    taskStore.get.mockResolvedValue(existingTask);
    prepareTaskForColumnChange.mockImplementationOnce((_fromColumnId, task) => {
      if (task) {
        task.triggerSessionId = undefined;
        task.lastSyncError = undefined;
      }
      return true;
    });
    system.worktreeStore.get = vi.fn().mockResolvedValue({
      id: "wt-1",
      codebaseId: "repo-1",
      workspaceId: "workspace-1",
      worktreePath: "/tmp/worktrees/task-1",
      branch: "issue/task-1",
      baseBranch: "main",
      status: "active",
    });
    system.codebaseStore.get = vi.fn().mockResolvedValue({
      id: "repo-1",
      workspaceId: "workspace-1",
      repoPath: "/tmp/repos/main",
      branch: "main",
    });
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        { id: "dev", name: "Dev", position: 1, stage: "dev" },
        { id: "review", name: "Review", position: 2, stage: "review" },
      ],
    });

    const request = new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({
        verificationVerdict: VerificationVerdict.NOT_APPROVED,
        verificationReport: "Please address the failing review checks.",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createWorktree).not.toHaveBeenCalled();
    expect(capturedEnqueueTask).toMatchObject({
      id: "task-1",
      columnId: "dev",
      worktreeId: "wt-1",
    });
    expect(data.task).toMatchObject({
      columnId: "dev",
      status: TaskStatus.IN_PROGRESS,
      verificationVerdict: VerificationVerdict.NOT_APPROVED,
      worktreeId: "wt-1",
    });
  });

  it("maps approved review convergence from the target column stage when done uses a custom id", async () => {
    const existingTask = createTask({
      id: "task-1",
      title: "Release reviewed task",
      objective: "Move approved review work into a custom done lane",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "review",
      status: TaskStatus.REVIEW_REQUIRED,
    });
    existingTask.assignedSpecialistId = "kanban-review-guard";
    existingTask.assignedSpecialistName = "Review Guard";
    taskStore.get.mockResolvedValue(existingTask);
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        {
          id: "review",
          name: "Review",
          position: 1,
          stage: "review",
          automation: {
            enabled: true,
            steps: [
              {
                id: "qa-frontend",
                role: "GATE",
                specialistId: "kanban-qa-frontend",
                specialistName: "QA Frontend",
              },
              {
                id: "review-guard",
                role: "GATE",
                specialistId: "kanban-review-guard",
                specialistName: "Review Guard",
              },
            ],
          },
        },
        { id: "released-stage", name: "Released", position: 2, stage: "done" },
      ],
    });

    const response = await PATCH(new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({
        verificationVerdict: VerificationVerdict.APPROVED,
        verificationReport: "Release checks passed",
      }),
    }), {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task).toMatchObject({
      columnId: "released-stage",
      status: TaskStatus.COMPLETED,
      verificationVerdict: VerificationVerdict.APPROVED,
    });
  });
});
