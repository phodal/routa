import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentRole, AgentStatus, ModelTier, createAgent } from "@/core/models/agent";
import { createKanbanBoard } from "@/core/models/kanban";
import { MessageRole, createMessage } from "@/core/models/message";
import { SPEC_NOTE_ID, createNote } from "@/core/models/note";
import { createWorktree } from "@/core/models/worktree";
import * as sqliteSchema from "../sqlite-schema";
import {
  SqliteAgentStore,
  SqliteConversationStore,
  SqliteKanbanBoardStore,
  SqliteNoteStore,
  SqliteWorktreeStore,
} from "../sqlite-stores";

describe("sqlite stores", () => {
  let sqlite: BetterSqlite3.Database;
  let worktreeStore: SqliteWorktreeStore;
  let agentStore: SqliteAgentStore;
  let kanbanStore: SqliteKanbanBoardStore;
  let conversationStore: SqliteConversationStore;
  let noteStore: SqliteNoteStore;

  beforeEach(() => {
    sqlite = new BetterSqlite3(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE codebases (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        repo_path TEXT NOT NULL,
        branch TEXT,
        label TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        source_type TEXT,
        source_url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE worktrees (
        id TEXT PRIMARY KEY,
        codebase_id TEXT NOT NULL REFERENCES codebases(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        worktree_path TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL,
        base_branch TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'creating',
        session_id TEXT,
        label TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(codebase_id, branch)
      );

      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        model_tier TEXT NOT NULL DEFAULT 'SMART',
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        parent_id TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE kanban_boards (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        github_token TEXT,
        columns TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tool_name TEXT,
        tool_args TEXT,
        turn INTEGER
      );

      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        session_id TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'general',
        task_status TEXT,
        assigned_agent_ids TEXT,
        parent_note_id TEXT,
        linked_task_id TEXT,
        custom_metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(workspace_id, id)
      );
    `);

    const now = Date.now();
    sqlite.prepare(`
      INSERT INTO workspaces (id, title, status, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("workspace-1", "Workspace One", "active", "{}", now, now);
    sqlite.prepare(`
      INSERT INTO workspaces (id, title, status, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("workspace-2", "Workspace Two", "active", "{}", now, now);
    sqlite.prepare(`
      INSERT INTO codebases (id, workspace_id, repo_path, branch, label, is_default, source_type, source_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("codebase-1", "workspace-1", "/repo/main", "main", "Main Repo", 1, "local", null, now, now);

    const db = drizzle(sqlite, { schema: sqliteSchema });
    worktreeStore = new SqliteWorktreeStore(db);
    agentStore = new SqliteAgentStore(db);
    kanbanStore = new SqliteKanbanBoardStore(db);
    conversationStore = new SqliteConversationStore(db);
    noteStore = new SqliteNoteStore(db);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("manages worktrees across lookup, updates, and deletion", async () => {
    const primary = createWorktree({
      id: "worktree-1",
      codebaseId: "codebase-1",
      workspaceId: "workspace-1",
      worktreePath: "/repo/worktrees/feature-a",
      branch: "feature/a",
      baseBranch: "main",
      label: "Feature A",
    });
    const secondary = createWorktree({
      id: "worktree-2",
      codebaseId: "codebase-1",
      workspaceId: "workspace-1",
      worktreePath: "/repo/worktrees/feature-b",
      branch: "feature/b",
      baseBranch: "main",
    });

    await worktreeStore.add(primary);
    await worktreeStore.add(secondary);
    await worktreeStore.assignSession("worktree-1", "session-1");
    await worktreeStore.updateStatus("worktree-1", "error", "failed to checkout");

    expect(await worktreeStore.get("worktree-1")).toMatchObject({
      id: "worktree-1",
      sessionId: "session-1",
      status: "error",
      errorMessage: "failed to checkout",
      label: "Feature A",
    });
    expect(await worktreeStore.findByBranch("codebase-1", "feature/a")).toMatchObject({
      id: "worktree-1",
    });
    expect(await worktreeStore.findByBranch("codebase-1", "missing")).toBeUndefined();
    expect(await worktreeStore.listByCodebase("codebase-1")).toHaveLength(2);
    expect(await worktreeStore.listByWorkspace("workspace-1")).toHaveLength(2);

    await worktreeStore.remove("worktree-2");

    expect(await worktreeStore.get("worktree-2")).toBeUndefined();
  });

  it("upserts agents and supports workspace filters", async () => {
    const parent = createAgent({
      id: "agent-parent",
      name: "Parent",
      role: AgentRole.ROUTA,
      workspaceId: "workspace-1",
      modelTier: ModelTier.SMART,
      metadata: { delegationDepth: "0" },
    });
    const child = createAgent({
      id: "agent-child",
      name: "Child",
      role: AgentRole.CRAFTER,
      workspaceId: "workspace-1",
      parentId: "agent-parent",
      modelTier: ModelTier.BALANCED,
      metadata: { lane: "dev" },
    });
    const outsider = createAgent({
      id: "agent-outsider",
      name: "Outsider",
      role: AgentRole.CRAFTER,
      workspaceId: "workspace-2",
      modelTier: ModelTier.FAST,
    });

    await agentStore.save(parent);
    await agentStore.save(child);
    await agentStore.save(outsider);

    await agentStore.updateStatus("agent-child", AgentStatus.ACTIVE);

    await agentStore.save({
      ...child,
      name: "Child Updated",
      status: AgentStatus.COMPLETED,
      metadata: { lane: "review" },
      updatedAt: new Date(Date.now() + 1_000),
    });

    expect(await agentStore.get("agent-child")).toMatchObject({
      name: "Child Updated",
      status: AgentStatus.COMPLETED,
      metadata: { lane: "review" },
      parentId: "agent-parent",
    });
    expect(await agentStore.listByWorkspace("workspace-1")).toHaveLength(2);
    expect(await agentStore.listByParent("agent-parent")).toHaveLength(1);
    expect(await agentStore.listByRole("workspace-1", AgentRole.CRAFTER)).toHaveLength(1);
    expect(await agentStore.listByStatus("workspace-1", AgentStatus.COMPLETED)).toHaveLength(1);

    await agentStore.delete("agent-outsider");

    expect(await agentStore.get("agent-outsider")).toBeUndefined();
  });

  it("persists kanban boards and switches the default board", async () => {
    const planning = createKanbanBoard({
      id: "board-planning",
      workspaceId: "workspace-1",
      name: "Planning",
      isDefault: true,
      columns: [{ id: "backlog", name: "Backlog", color: "#999", position: 0, stage: "backlog" }],
    });
    const delivery = createKanbanBoard({
      id: "board-delivery",
      workspaceId: "workspace-1",
      name: "Delivery",
      columns: [{ id: "done", name: "Done", color: "#0a0", position: 4, stage: "done" }],
    });

    await kanbanStore.save(planning);
    await kanbanStore.save(delivery);
    await kanbanStore.setDefault("workspace-1", "board-delivery");
    await kanbanStore.save({
      ...delivery,
      name: "Delivery Updated",
      isDefault: true,
      columns: [{ id: "review", name: "Review", color: "#fa0", position: 3, stage: "review" }],
      updatedAt: new Date(Date.now() + 2_000),
    });

    expect(await kanbanStore.getDefault("workspace-1")).toMatchObject({
      id: "board-delivery",
      name: "Delivery Updated",
      isDefault: true,
    });
    expect(await kanbanStore.get("board-planning")).toMatchObject({
      isDefault: false,
    });
    expect(await kanbanStore.listByWorkspace("workspace-1")).toHaveLength(2);

    await kanbanStore.delete("board-planning");

    expect(await kanbanStore.get("board-planning")).toBeUndefined();
  });

  it("stores ordered conversations and supports range queries", async () => {
    const first = createMessage({
      id: "msg-1",
      agentId: "agent-child",
      role: MessageRole.USER,
      content: "first",
      turn: 1,
    });
    const second = createMessage({
      id: "msg-2",
      agentId: "agent-child",
      role: MessageRole.ASSISTANT,
      content: "second",
      turn: 2,
    });
    const third = createMessage({
      id: "msg-3",
      agentId: "agent-child",
      role: MessageRole.TOOL,
      content: "third",
      toolName: "grep",
      toolArgs: "{\"q\":\"todo\"}",
      turn: 3,
    });

    first.timestamp = new Date("2026-04-12T09:00:00.000Z");
    second.timestamp = new Date("2026-04-12T09:01:00.000Z");
    third.timestamp = new Date("2026-04-12T09:02:00.000Z");

    await conversationStore.append(second);
    await conversationStore.append(third);
    await conversationStore.append(first);

    expect((await conversationStore.getConversation("agent-child")).map((msg) => msg.id)).toEqual([
      "msg-1",
      "msg-2",
      "msg-3",
    ]);
    expect((await conversationStore.getLastN("agent-child", 2)).map((msg) => msg.id)).toEqual([
      "msg-2",
      "msg-3",
    ]);
    expect((await conversationStore.getByTurnRange("agent-child", 2, 3)).map((msg) => msg.id)).toEqual([
      "msg-2",
      "msg-3",
    ]);
    expect(await conversationStore.getMessageCount("agent-child")).toBe(3);

    await conversationStore.deleteConversation("agent-child");

    expect(await conversationStore.getConversation("agent-child")).toEqual([]);
    expect(await conversationStore.getMessageCount("agent-child")).toBe(0);
  });

  it("stores notes, filters assigned agents, and creates spec notes on demand", async () => {
    const taskNote = createNote({
      id: "note-task",
      title: "Implement flow",
      content: "Need follow-up",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      metadata: {
        type: "task",
        taskStatus: "IN_PROGRESS" as import("@/core/models/task").TaskStatus,
        assignedAgentIds: ["agent-parent", "agent-child"],
        parentNoteId: "spec",
        linkedTaskId: "task-1",
        custom: { area: "core" },
      },
    });

    await noteStore.save(taskNote);
    await noteStore.save({
      ...taskNote,
      title: "Implement flow (updated)",
      metadata: {
        ...taskNote.metadata,
        assignedAgentIds: ["agent-child"],
      },
      updatedAt: new Date(Date.now() + 3_000),
    });

    const createdSpec = await noteStore.ensureSpec("workspace-1");
    const reusedSpec = await noteStore.ensureSpec("workspace-1");

    expect(await noteStore.get("note-task", "workspace-1")).toMatchObject({
      title: "Implement flow (updated)",
      sessionId: "session-1",
      metadata: {
        type: "task",
        taskStatus: "IN_PROGRESS",
        assignedAgentIds: ["agent-child"],
        parentNoteId: "spec",
        linkedTaskId: "task-1",
        custom: { area: "core" },
      },
    });
    expect(await noteStore.listByWorkspace("workspace-1")).toHaveLength(2);
    expect(await noteStore.listByType("workspace-1", "task")).toHaveLength(1);
    expect(await noteStore.listByAssignedAgent("workspace-1", "agent-child")).toHaveLength(1);
    expect(await noteStore.listByAssignedAgent("workspace-1", "agent-parent")).toHaveLength(0);
    expect(createdSpec.id).toBe(SPEC_NOTE_ID);
    expect(reusedSpec.id).toBe(SPEC_NOTE_ID);
    expect(createdSpec.createdAt).toEqual(reusedSpec.createdAt);

    await noteStore.delete("note-task", "workspace-1");

    expect(await noteStore.get("note-task", "workspace-1")).toBeUndefined();
  });
});
