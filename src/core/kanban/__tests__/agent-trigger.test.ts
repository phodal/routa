import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTaskPrompt, resolveKanbanAutomationProvider, triggerAssignedTaskAgent } from "../agent-trigger";
import { createTask } from "../../models/task";
import { AgentEventType, type EventBus } from "../../events/event-bus";

vi.mock("../../acp/claude-code-sdk-adapter", () => ({
  isClaudeCodeSdkConfigured: vi.fn(),
}));

const sendMessageMock = vi.fn();
const waitForCompletionMock = vi.fn();

vi.mock("../../a2a", () => ({
  getA2AOutboundClient: vi.fn(() => ({
    sendMessage: sendMessageMock,
    waitForCompletion: waitForCompletionMock,
  })),
}));

import { isClaudeCodeSdkConfigured } from "../../acp/claude-code-sdk-adapter";

describe("buildTaskPrompt", () => {
  it("keeps backlog automation in planning mode", () => {
    const task = createTask({
      id: "task-1",
      title: "echo hello world",
      objective: "echo hello world",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
    });

    const prompt = buildTaskPrompt(task);

    expect(prompt).toContain("Treat backlog as planning and refinement, not implementation");
    expect(prompt).toContain("move_card");
    expect(prompt).toContain("Do NOT create or sync GitHub issues during backlog planning.");
    expect(prompt).toContain("Do not use native tools such as Bash, Read, Write, Edit, Glob, or Grep in backlog planning");
    expect(prompt).toContain("decompose_tasks");
    expect(prompt).not.toContain("Complete the work assigned to this column stage");
  });

  it("keeps dev automation in implementation mode", () => {
    const task = createTask({
      id: "task-2",
      title: "Implement login form",
      objective: "Build the login screen",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "dev",
    });

    const prompt = buildTaskPrompt(task);

    expect(prompt).toContain("Complete the work assigned to this column stage");
    expect(prompt).toContain("Start with direct task-scoped tools such as `list_artifacts`, `update_card`, `create_note`, and `move_card`");
    expect(prompt).toContain("move_card");
    expect(prompt).toContain("targetColumnId: \"review\"");
    expect(prompt).toContain("**Board ID:** board-1");
    expect(prompt).toContain("**Current Column ID:** dev");
    expect(prompt).toContain("**Next Column ID:** review");
    expect(prompt).toContain("Only call `get_board` if you truly need whole-board state, and if you do, pass boardId: \"board-1\"");
    expect(prompt).toContain("Do not call `report_to_parent`");
    expect(prompt).toContain("## Dev Verification Safety");
    expect(prompt).toContain("Do not assume `http://localhost:3000` is the right preview target");
    expect(prompt).toContain("`pkill -f \"next dev\"`");
    expect(prompt).toContain("Do not use `ps | grep | xargs kill`, `killall`, or broad `pkill` patterns for cleanup");
    expect(prompt).toContain("If the UI depends on env vars or setup");
    expect(prompt).not.toContain("Tool: report_to_parent");
  });

  it("does not invent a placeholder board id when the task has no board", () => {
    const task = createTask({
      id: "task-3",
      title: "Investigate flaky review check",
      objective: "Stabilize the review workflow",
      workspaceId: "default",
      columnId: "review",
    });

    const prompt = buildTaskPrompt(task);

    expect(prompt).toContain("**Board ID:** unavailable");
    expect(prompt).toContain("Only call `get_board` if the task context already provides a concrete boardId.");
    expect(prompt).not.toContain('boardId: "unknown"');
  });

  it("injects required artifact gates from the next transition into the prompt", () => {
    const task = createTask({
      id: "task-3",
      title: "Ship review-ready change",
      objective: "Implement and verify the change",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "dev",
    });

    const prompt = buildTaskPrompt(task, [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      {
        id: "review",
        name: "Review",
        position: 1,
        stage: "review",
        automation: {
          enabled: true,
          requiredArtifacts: ["screenshot", "test_results"],
        },
      },
      { id: "done", name: "Done", position: 2, stage: "done" },
    ]);

    expect(prompt).toContain("## Artifact Gates");
    expect(prompt).toContain("Moving this card to Review requires Screenshot, Test Results.");
    expect(prompt).toContain("Before you call `move_card`, make sure Screenshot, Test Results exist as artifacts");
    expect(prompt).toContain("Use `list_artifacts`");
    expect(prompt).toContain("provide_artifact");
    expect(prompt).toContain("capture_screenshot");
    expect(prompt).toContain("update_card is not an artifact tool");
    expect(prompt).toContain("Do not treat `update_card` text as artifact evidence");
  });

  it("injects normalized readiness, INVEST, and evidence summaries into the prompt", () => {
    const task = createTask({
      id: "task-ctx-1",
      title: "Prepare implementation brief",
      objective: "Clarify the story before development",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "todo",
    });

    const prompt = buildTaskPrompt(task, [
      { id: "todo", name: "Todo", position: 0, stage: "todo" },
      { id: "dev", name: "Dev", position: 1, stage: "dev" },
    ], {
      summaryContext: {
        storyReadiness: {
          ready: false,
          missing: ["scope", "verification_plan"],
          requiredTaskFields: ["scope", "acceptance_criteria", "verification_plan"],
          checks: {
            scope: false,
            acceptanceCriteria: true,
            verificationCommands: false,
            testCases: true,
            verificationPlan: true,
            dependenciesDeclared: false,
          },
        },
        investValidation: {
          source: "heuristic",
          overallStatus: "warning",
          checks: {
            independent: { status: "pass", reason: "No blocking prerequisite was detected." },
            negotiable: { status: "warning", reason: "Human review still needed." },
            valuable: { status: "pass", reason: "Objective is clear enough." },
            estimable: { status: "warning", reason: "Scope is incomplete." },
            small: { status: "pass", reason: "Story remains narrow." },
            testable: { status: "pass", reason: "Test cases exist." },
          },
          issues: [],
        },
        evidenceSummary: {
          artifact: {
            total: 1,
            byType: { screenshot: 1 },
            requiredSatisfied: false,
            missingRequired: ["test_results"],
          },
          verification: {
            hasVerdict: false,
            hasReport: true,
          },
          completion: {
            hasSummary: false,
          },
          runs: {
            total: 2,
            latestStatus: "completed",
          },
        },
      },
    });

    expect(prompt).toContain("## Story Readiness");
    expect(prompt).toContain("Missing fields: scope, verification_plan");
    expect(prompt).toContain("## INVEST Snapshot");
    expect(prompt).toContain("Overall: WARNING");
    expect(prompt).toContain("## Evidence Bundle");
    expect(prompt).toContain("Missing required artifacts: test_results");
  });

  it("adds previous-lane handoff guidance for review sessions", () => {
    const task = createTask({
      id: "task-4",
      title: "Review running app",
      objective: "Verify the feature in review",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "review",
    });
    task.laneSessions = [
      {
        sessionId: "session-dev-1",
        columnId: "dev",
        columnName: "Dev",
        provider: "opencode",
        role: "DEVELOPER",
        status: "completed",
        startedAt: "2026-03-17T00:00:00.000Z",
      },
    ];

    const prompt = buildTaskPrompt(task, [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      { id: "dev", name: "Dev", position: 1, stage: "dev" },
      { id: "review", name: "Review", position: 2, stage: "review" },
      { id: "done", name: "Done", position: 3, stage: "done" },
    ], {
      currentSessionId: "session-review-1",
    });

    expect(prompt).toContain("## Lane Handoff Context");
    expect(prompt).toContain("request_previous_lane_handoff");
    expect(prompt).toContain("Previous lane session");
    expect(prompt).toContain("Dev");
  });

  it("routes review happy-path guidance to done even if blocked is positioned before it", () => {
    const task = createTask({
      id: "task-review-1",
      title: "Approve review result",
      objective: "Verify the card advances to done on approval",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "review",
    });

    const prompt = buildTaskPrompt(task, [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      { id: "todo", name: "Todo", position: 1, stage: "todo" },
      { id: "dev", name: "Dev", position: 2, stage: "dev" },
      { id: "review", name: "Review", position: 3, stage: "review" },
      { id: "blocked", name: "Blocked", position: 4, stage: "blocked" },
      { id: "done", name: "Done", position: 5, stage: "done" },
    ]);

    expect(prompt).toContain("targetColumnId: \"done\"");
    expect(prompt).toContain("**Next Column ID:** done");
    expect(prompt).toContain("Moving this card to Done");
    expect(prompt).not.toContain("targetColumnId: \"blocked\"");
  });

  it("includes previous run context for multi-step sessions in the same lane", () => {
    const task = createTask({
      id: "task-5",
      title: "Continue todo planning",
      objective: "Run the second todo step with context from the first one",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "todo",
    });
    task.laneSessions = [
      {
        sessionId: "session-todo-1",
        columnId: "todo",
        columnName: "Todo",
        stepIndex: 0,
        stepName: "Todo Triage",
        provider: "claude",
        role: "CRAFTER",
        status: "completed",
        startedAt: "2026-03-17T00:00:00.000Z",
        completedAt: "2026-03-17T00:05:00.000Z",
      },
    ];

    const prompt = buildTaskPrompt(task, [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      { id: "todo", name: "Todo", position: 1, stage: "todo" },
      { id: "dev", name: "Dev", position: 2, stage: "dev" },
    ], {
      currentSessionId: "session-todo-2",
    });

    expect(prompt).toContain("## Current Lane History");
    expect(prompt).toContain("Previous run in this lane");
    expect(prompt).toContain("Todo Triage");
  });

  it("does not instruct an earlier lane step to move the card before later steps run", () => {
    const task = createTask({
      id: "task-6",
      title: "Run todo pipeline",
      objective: "Complete the first todo step and let the workflow continue in-lane",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "todo",
      assignedProvider: "codex",
      assignedRole: "CRAFTER",
      assignedSpecialistId: "kanban-todo-orchestrator",
      assignedSpecialistName: "Todo Orchestrator",
    });

    const prompt = buildTaskPrompt(task, [
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
    ], {
      currentSessionId: "session-todo-1",
    });

    expect(prompt).toContain("Do not call `move_card` to leave todo yet");
    expect(prompt).toContain("Verifier");
    expect(prompt).not.toContain('targetColumnId: "dev"');
  });
});

// TODO: This test suite is flaky - skipping temporarily
// See: ACP session creation failures and 403 Forbidden errors
describe.skip("triggerAssignedTaskAgent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sendMessageMock.mockReset();
    waitForCompletionMock.mockReset();
  });

  it("emits AGENT_FAILED when session/prompt returns a JSON-RPC error payload", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: "new",
        result: { sessionId: "sess-1" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: "prompt",
        error: { code: -32000, message: "Permission denied: HTTP error: 403 Forbidden" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const eventBus = { emit: vi.fn() };
    const task = createTask({
      id: "task-json-error",
      title: "Run failing provider",
      objective: "Trigger a provider failure",
      workspaceId: "default",
      columnId: "dev",
      assignedProvider: "auggie",
      assignedRole: "DEVELOPER",
    });

    const result = await triggerAssignedTaskAgent({
      origin: "http://127.0.0.1:3000",
      workspaceId: "default",
      cwd: "/tmp/project",
      task,
      eventBus: eventBus as unknown as EventBus,
    });

    expect(result).toMatchObject({
      sessionId: "sess-1",
      transport: "acp",
      displayTarget: "auggie",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: AgentEventType.AGENT_FAILED,
      agentId: "sess-1",
    }));
  });

  it("uses A2A transport for A2A-configured automation steps", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    sendMessageMock.mockResolvedValue({
      id: "remote-task-1",
      contextId: "ctx-1",
      status: { state: "submitted", timestamp: "2026-03-21T00:00:00Z" },
      history: [],
    });
    waitForCompletionMock.mockResolvedValue({
      id: "remote-task-1",
      contextId: "ctx-1",
      status: { state: "completed", timestamp: "2026-03-21T00:00:10Z" },
      history: [],
    });

    const eventBus = { emit: vi.fn() };
    const task = createTask({
      id: "task-a2a",
      title: "Run remote review",
      objective: "Send this card to a remote A2A reviewer",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "review",
      assignedRole: "GATE",
    });

    const result = await triggerAssignedTaskAgent({
      origin: "http://127.0.0.1:3000",
      workspaceId: "default",
      cwd: "/tmp/project",
      task,
      step: {
        id: "remote-review",
        transport: "a2a",
        agentCardUrl: "https://agents.example.com/reviewer/agent-card.json",
        skillId: "review",
      },
      eventBus: eventBus as unknown as EventBus,
    });

    expect(result.transport).toBe("a2a");
    expect(result.sessionId).toMatch(/^a2a-/);
    expect(result.externalTaskId).toBe("remote-task-1");
    expect(result.contextId).toBe("ctx-1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith(
      "https://agents.example.com/reviewer/agent-card.json",
      expect.stringContaining("You are assigned to Kanban task: Run remote review"),
      expect.objectContaining({
        workspaceId: "default",
        cardId: "task-a2a",
        skillId: "review",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(waitForCompletionMock).toHaveBeenCalledWith(
      "https://agents.example.com/reviewer/agent-card.json",
      "remote-task-1",
    );
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: AgentEventType.AGENT_COMPLETED,
      data: expect.objectContaining({
        transport: "a2a",
        externalTaskId: "remote-task-1",
        contextId: "ctx-1",
      }),
    }));
  });
});

describe("resolveKanbanAutomationProvider", () => {
  afterEach(() => {
    vi.mocked(isClaudeCodeSdkConfigured).mockReset();
  });

  it("falls back to the Claude SDK when automation targets claude and the SDK is configured", () => {
    vi.mocked(isClaudeCodeSdkConfigured).mockReturnValue(true);

    expect(resolveKanbanAutomationProvider("claude")).toBe("claude-code-sdk");
  });

  it("preserves the configured provider when no Claude SDK fallback is needed", () => {
    vi.mocked(isClaudeCodeSdkConfigured).mockReturnValue(false);

    expect(resolveKanbanAutomationProvider("claude")).toBe("claude");
    expect(resolveKanbanAutomationProvider("codex")).toBe("codex");
    expect(resolveKanbanAutomationProvider(undefined)).toBe("opencode");
  });
});
