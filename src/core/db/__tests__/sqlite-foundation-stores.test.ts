import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCodebase } from "@/core/models/codebase";
import { TaskStatus, VerificationVerdict, createTask } from "@/core/models/task";
import { createWorkspace } from "@/core/models/workspace";
import * as sqliteSchema from "../sqlite-schema";
import { SqliteCodebaseStore } from "../sqlite-codebase-store";
import { SqliteTaskStore } from "../sqlite-task-store";
import { SqliteWorkspaceStore } from "../sqlite-workspace-store";

describe("sqlite foundation stores", () => {
  let sqlite: BetterSqlite3.Database;
  let workspaceStore: SqliteWorkspaceStore;
  let codebaseStore: SqliteCodebaseStore;
  let taskStore: SqliteTaskStore;

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

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        comment TEXT,
        comments TEXT DEFAULT '[]',
        scope TEXT,
        acceptance_criteria TEXT,
        verification_commands TEXT,
        test_cases TEXT,
        assigned_to TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        board_id TEXT,
        column_id TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        priority TEXT,
        labels TEXT DEFAULT '[]',
        assignee TEXT,
        assigned_provider TEXT,
        assigned_role TEXT,
        assigned_specialist_id TEXT,
        assigned_specialist_name TEXT,
        trigger_session_id TEXT,
        session_ids TEXT DEFAULT '[]',
        lane_sessions TEXT DEFAULT '[]',
        lane_handoffs TEXT DEFAULT '[]',
        github_id TEXT,
        github_number INTEGER,
        github_url TEXT,
        github_repo TEXT,
        github_state TEXT,
        github_synced_at INTEGER,
        last_sync_error TEXT,
        is_pull_request INTEGER,
        dependencies TEXT DEFAULT '[]',
        parallel_group TEXT,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        session_id TEXT,
        creation_source TEXT,
        codebase_ids TEXT DEFAULT '[]',
        worktree_id TEXT,
        delivery_snapshot TEXT,
        completion_summary TEXT,
        verification_verdict TEXT,
        verification_report TEXT,
        fallback_agent_chain TEXT DEFAULT '[]',
        enable_automatic_fallback INTEGER DEFAULT 0,
        max_fallback_attempts INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    const db = drizzle(sqlite, { schema: sqliteSchema });
    workspaceStore = new SqliteWorkspaceStore(db);
    codebaseStore = new SqliteCodebaseStore(db);
    taskStore = new SqliteTaskStore(db);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("saves workspaces and updates title, status, and merged metadata", async () => {
    const workspace = createWorkspace({
      id: "workspace-1",
      title: "Workspace One",
      metadata: { env: "dev" },
    });
    const archived = createWorkspace({
      id: "workspace-2",
      title: "Workspace Two",
      metadata: { env: "prod" },
    });
    archived.status = "archived";

    await workspaceStore.save(workspace);
    await workspaceStore.save(archived);
    await workspaceStore.updateTitle("workspace-1", "Workspace One Updated");
    await workspaceStore.updateStatus("workspace-1", "archived");
    await workspaceStore.updateMetadata("workspace-1", { region: "cn", env: "staging" });

    expect(await workspaceStore.get("workspace-1")).toMatchObject({
      title: "Workspace One Updated",
      status: "archived",
      metadata: expect.objectContaining({
        env: "staging",
        region: "cn",
      }),
    });
    expect(await workspaceStore.list()).toHaveLength(2);
    expect(await workspaceStore.listByStatus("archived")).toHaveLength(2);

    await workspaceStore.delete("workspace-2");

    expect(await workspaceStore.get("workspace-2")).toBeUndefined();
  });

  it("manages codebases, repo lookup, and default switching", async () => {
    await workspaceStore.save(createWorkspace({ id: "workspace-1", title: "Workspace One" }));

    const local = createCodebase({
      id: "codebase-local",
      workspaceId: "workspace-1",
      repoPath: "/repo/local",
      branch: "main",
      label: "Local Repo",
      isDefault: true,
    });
    const github = createCodebase({
      id: "codebase-github",
      workspaceId: "workspace-1",
      repoPath: "/tmp/imported/repo",
      branch: "feature/import",
      label: "Imported Repo",
      sourceType: "github",
      sourceUrl: "https://github.com/acme/repo",
    });

    await codebaseStore.add(local);
    await codebaseStore.add(github);
    await codebaseStore.update("codebase-github", {
      branch: "feature/updated",
      label: "Imported Repo Updated",
      repoPath: "/tmp/imported/repo-updated",
    });
    await codebaseStore.setDefault("workspace-1", "codebase-github");

    expect(await codebaseStore.get("codebase-github")).toMatchObject({
      branch: "feature/updated",
      label: "Imported Repo Updated",
      repoPath: "/tmp/imported/repo-updated",
      isDefault: true,
      sourceType: "github",
      sourceUrl: "https://github.com/acme/repo",
    });
    expect(await codebaseStore.getDefault("workspace-1")).toMatchObject({
      id: "codebase-github",
    });
    expect(await codebaseStore.findByRepoPath("workspace-1", "/tmp/imported/repo-updated")).toMatchObject({
      id: "codebase-github",
    });
    expect(await codebaseStore.countByWorkspace("workspace-1")).toBe(2);
    expect(await codebaseStore.listByWorkspace("workspace-1")).toHaveLength(2);

    await codebaseStore.remove("codebase-local");

    expect(await codebaseStore.get("codebase-local")).toBeUndefined();
  });

  it("stores tasks, resolves readiness, and enforces atomic updates", async () => {
    await workspaceStore.save(createWorkspace({ id: "workspace-1", title: "Workspace One" }));

    const doneTask = createTask({
      id: "task-done",
      title: "Prepare baseline",
      objective: "Set up project",
      workspaceId: "workspace-1",
      status: TaskStatus.COMPLETED,
      assignee: "agent-1",
      labels: ["infra"],
    });
    const readyTask = createTask({
      id: "task-ready",
      title: "Implement feature",
      objective: "Build the feature",
      workspaceId: "workspace-1",
      comment: "Carry legacy note",
      dependencies: ["task-done"],
      assignee: "agent-2",
      sessionId: "session-1",
      labels: ["core"],
      codebaseIds: ["codebase-github"],
    });
    const blockedTask = createTask({
      id: "task-blocked",
      title: "Follow-up",
      objective: "Wait on missing dependency",
      workspaceId: "workspace-1",
      dependencies: ["task-missing"],
      assignee: "agent-2",
    });

    await taskStore.save(doneTask);
    await taskStore.save(readyTask);
    await taskStore.save(blockedTask);

    await taskStore.updateStatus("task-ready", TaskStatus.IN_PROGRESS);
    await taskStore.save({
      ...readyTask,
      status: TaskStatus.PENDING,
      assignedTo: "agent-3",
      completionSummary: "Implemented and ready for review",
      verificationVerdict: VerificationVerdict.APPROVED,
      verificationReport: "Smoke checks passed",
      sessionIds: ["session-1", "session-2"],
      labels: ["core", "verified"],
      updatedAt: new Date(Date.now() + 1_000),
    });

    const savedTask = await taskStore.get("task-ready");
    expect(savedTask).toMatchObject({
      status: TaskStatus.PENDING,
      assignedTo: "agent-3",
      creationSource: "session",
      completionSummary: "Implemented and ready for review",
      verificationVerdict: VerificationVerdict.APPROVED,
      verificationReport: "Smoke checks passed",
      labels: ["core", "verified"],
      sessionIds: ["session-1", "session-2"],
    });
    expect(savedTask?.comments).toHaveLength(1);
    expect(savedTask?.comments[0]).toMatchObject({
      body: "Carry legacy note",
      source: "legacy_import",
    });

    expect(await taskStore.listByWorkspace("workspace-1")).toHaveLength(3);
    expect(await taskStore.listByStatus("workspace-1", TaskStatus.COMPLETED)).toHaveLength(1);
    expect(await taskStore.listByAssignee("agent-3")).toHaveLength(1);
    expect((await taskStore.findReadyTasks("workspace-1")).map((task) => task.id)).toEqual(["task-ready"]);

    expect(await taskStore.atomicUpdate("task-ready", 99, { status: TaskStatus.REVIEW_REQUIRED })).toBe(false);
    expect(
      await taskStore.atomicUpdate("task-ready", 3, {
        status: TaskStatus.REVIEW_REQUIRED,
        assignedTo: "agent-review",
      }),
    ).toBe(true);
    expect(await taskStore.get("task-ready")).toMatchObject({
      status: TaskStatus.REVIEW_REQUIRED,
      assignedTo: "agent-review",
    });

    await taskStore.delete("task-blocked");

    expect(await taskStore.get("task-blocked")).toBeUndefined();
    expect(await taskStore.deleteByWorkspace("workspace-1")).toBe(2);
    expect(await taskStore.listByWorkspace("workspace-1")).toEqual([]);
  });
});
