import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTools } from "../workspace-tools";

const {
  execMock,
  currentDirMock,
  loadSpecialistsMock,
  resolveGitIdentityMock,
} = vi.hoisted(() => ({
  execMock: vi.fn(),
  currentDirMock: vi.fn(() => "/repo/default"),
  loadSpecialistsMock: vi.fn(),
  resolveGitIdentityMock: vi.fn(),
}));

vi.mock("@/core/platform", () => ({
  getServerBridge: () => ({
    process: {
      exec: execMock,
    },
    env: {
      currentDir: currentDirMock,
    },
  }),
}));

vi.mock("../../orchestration/specialist-prompts", () => ({
  loadSpecialists: loadSpecialistsMock,
}));

vi.mock("@/core/git/git-operations", () => ({
  resolveGitIdentity: resolveGitIdentityMock,
}));

function createTools() {
  const agentStore = {
    listByWorkspace: vi.fn(),
  };
  const taskStore = {
    listByWorkspace: vi.fn(),
  };
  const noteStore = {
    listByWorkspace: vi.fn(),
  };

  const tools = new WorkspaceTools(
    agentStore as never,
    taskStore as never,
    noteStore as never,
    "/repo/default",
  );

  return { tools, agentStore, taskStore, noteStore };
}

describe("WorkspaceTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentDirMock.mockReturnValue("/repo/default");
  });

  it("parses git status output into staged, unstaged, and untracked files", async () => {
    execMock.mockImplementation(async (command: string) => {
      if (command === "git status --porcelain=v1") {
        return {
          stdout: "M  src/staged.ts\n M src/unstaged.ts\n?? src/new.ts\nMM src/both.ts\n",
          stderr: "",
        };
      }
      if (command === "git branch --show-current") {
        return { stdout: "feature/coverage\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const { tools } = createTools();
    const result = await tools.gitStatus({});

    expect(result).toEqual({
      success: true,
      data: {
        branch: "feature/coverage",
        staged: ["M src/staged.ts", "M src/both.ts"],
        unstaged: ["M src/unstaged.ts", "M src/both.ts"],
        untracked: ["src/new.ts"],
        clean: false,
        raw: "M  src/staged.ts\n M src/unstaged.ts\n?? src/new.ts\nMM src/both.ts",
      },
    });
  });

  it("returns truncated diff output and supports staged file diffs", async () => {
    const hugeDiff = "x".repeat(50_100);
    execMock.mockImplementation(async (command: string) => {
      if (command === "git diff --cached --stat -- src/app.ts") {
        return { stdout: " src/app.ts | 10 +++++-----\n", stderr: "" };
      }
      if (command === "git diff --cached -- src/app.ts") {
        return { stdout: hugeDiff, stderr: "" };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const { tools } = createTools();
    const result = await tools.gitDiff({ staged: true, file: "src/app.ts" });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      stat: "src/app.ts | 10 +++++-----",
      truncated: true,
    });
    expect((result.data as { diff: string }).diff.endsWith("... (truncated)")).toBe(true);
  });

  it("summarizes workspace info and details", async () => {
    const { tools, agentStore, taskStore, noteStore } = createTools();
    agentStore.listByWorkspace.mockResolvedValue([
      { role: "ROUTA", status: "ACTIVE" },
      { role: "CRAFTER", status: "COMPLETED" },
      { role: "DEVELOPER", status: "PENDING" },
    ]);
    taskStore.listByWorkspace.mockResolvedValue([
      { status: "PENDING" },
      { status: "IN_PROGRESS" },
      { status: "COMPLETED" },
      { status: "NEEDS_FIX" },
    ]);
    noteStore.listByWorkspace.mockResolvedValue([
      { metadata: { type: "spec" } },
      { metadata: { type: "task" } },
      { metadata: { type: "general" } },
    ]);

    const workspaceStore = {
      get: vi.fn().mockResolvedValue({
        id: "workspace-1",
        title: "Workspace One",
        status: "active",
        metadata: { region: "cn" },
        createdAt: new Date("2026-04-12T00:00:00.000Z"),
        updatedAt: new Date("2026-04-12T01:00:00.000Z"),
      }),
      list: vi.fn(),
      updateTitle: vi.fn(),
      save: vi.fn(),
    };
    tools.setWorkspaceStore(workspaceStore as never);

    const info = await tools.getWorkspaceInfo({ workspaceId: "workspace-1" });
    const details = await tools.getWorkspaceDetails({ workspaceId: "workspace-1" });

    expect(info.success).toBe(true);
    expect(info.data).toMatchObject({
      workspaceId: "workspace-1",
      agents: { total: 3, byRole: { ROUTA: 1, CRAFTER: 1, GATE: 0, DEVELOPER: 1 } },
      tasks: { total: 4, byStatus: { PENDING: 1, IN_PROGRESS: 1, COMPLETED: 1, NEEDS_FIX: 1, BLOCKED: 0 } },
      notes: { total: 3, byType: { spec: 1, task: 1, general: 1 } },
    });
    expect(details.success).toBe(true);
    expect(details.data).toMatchObject({
      workspace: {
        id: "workspace-1",
        title: "Workspace One",
        status: "active",
        metadata: { region: "cn" },
      },
      agents: { total: 3, active: 1, completed: 1 },
      tasks: { total: 4, pending: 1, inProgress: 1, completed: 1, needsFix: 1 },
      notes: { total: 3, spec: 1, task: 1, general: 1 },
    });
  });

  it("updates workspace title, emits an event, and lists workspaces", async () => {
    const { tools } = createTools();
    const workspaceStore = {
      get: vi.fn().mockResolvedValue({
        id: "workspace-1",
        title: "Old Title",
        status: "active",
        metadata: {},
        createdAt: new Date("2026-04-12T00:00:00.000Z"),
      }),
      list: vi.fn().mockResolvedValue([
        {
          id: "workspace-1",
          title: "New Title",
          status: "active",
          createdAt: new Date("2026-04-12T00:00:00.000Z"),
        },
      ]),
      updateTitle: vi.fn().mockResolvedValue(undefined),
      save: vi.fn(),
    };
    const eventBus = { emit: vi.fn() };
    tools.setWorkspaceStore(workspaceStore as never);
    tools.setEventBus(eventBus as never);

    const setTitle = await tools.setWorkspaceTitle({
      workspaceId: "workspace-1",
      title: "New Title",
    });
    const listed = await tools.listWorkspaces();

    expect(setTitle).toEqual({
      success: true,
      data: {
        workspaceId: "workspace-1",
        title: "New Title",
        oldTitle: "Old Title",
      },
    });
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    expect(eventBus.emit.mock.calls[0][0]).toMatchObject({
      type: "WORKSPACE_UPDATED",
      workspaceId: "workspace-1",
      data: { field: "title", oldTitle: "Old Title", newTitle: "New Title" },
    });
    expect(listed).toEqual({
      success: true,
      data: [
        {
          id: "workspace-1",
          title: "New Title",
          status: "active",
          createdAt: "2026-04-12T00:00:00.000Z",
        },
      ],
    });
  });

  it("creates workspaces, rejects duplicates, and lists specialists", async () => {
    const { tools } = createTools();
    const workspaceStore = {
      get: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ id: "workspace-1", title: "Workspace One" }),
      list: vi.fn(),
      updateTitle: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    };
    tools.setWorkspaceStore(workspaceStore as never);
    loadSpecialistsMock.mockResolvedValue([
      {
        id: "crafter",
        name: "Crafter",
        description: "Writes code",
        role: "CRAFTER",
        defaultModelTier: "BALANCED",
        source: "bundled",
      },
    ]);

    const created = await tools.createWorkspace({
      id: "workspace-1",
      title: "Workspace One",
    });
    const duplicate = await tools.createWorkspace({
      id: "workspace-1",
      title: "Workspace One",
    });
    const specialists = await tools.listSpecialists();

    expect(created).toEqual({
      success: true,
      data: {
        workspaceId: "workspace-1",
        title: "Workspace One",
      },
    });
    expect(workspaceStore.save).toHaveBeenCalledTimes(1);
    expect(duplicate.success).toBe(false);
    expect(duplicate.error).toContain("already exists");
    expect(specialists).toEqual({
      success: true,
      data: [
        {
          id: "crafter",
          name: "Crafter",
          description: "Writes code",
          role: "CRAFTER",
          modelTier: "BALANCED",
          source: "bundled",
        },
      ],
    });
  });
});
