import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

const SNAPSHOT_WORKSPACE_ID = "default";
const SNAPSHOT_WORKSPACE_TITLE = "Default Workspace";
const SNAPSHOT_BOARD_ID = "snapshot-board-default";
const SNAPSHOT_SESSION_ID = "1eed8a78-7673-4a1b-b6b9-cd68dc5b75c7";
const SNAPSHOT_DAY = "2026-03-19";
const SNAPSHOT_TIME = "2026-03-19T13:00:00.000Z";

const SNAPSHOT_BOARD_COLUMNS = [
  {
    id: "backlog",
    name: "Backlog",
    color: "slate",
    position: 0,
    stage: "backlog",
    automation: {
      enabled: true,
      steps: [{
        id: "backlog-refiner",
        role: "CRAFTER",
        specialistId: "kanban-backlog-refiner",
        specialistName: "Backlog Refiner",
        specialistLocale: "en",
      }],
      transitionType: "entry",
      autoAdvanceOnSuccess: true,
      role: "CRAFTER",
      specialistId: "kanban-backlog-refiner",
      specialistName: "Backlog Refiner",
      specialistLocale: "en",
    },
    visible: true,
  },
  {
    id: "todo",
    name: "Todo",
    color: "sky",
    position: 1,
    stage: "todo",
    automation: {
      enabled: true,
      steps: [{
        id: "todo-orchestrator",
        role: "CRAFTER",
        specialistId: "kanban-todo-orchestrator",
        specialistName: "Todo Orchestrator",
        specialistLocale: "en",
      }],
      transitionType: "entry",
      autoAdvanceOnSuccess: false,
      role: "CRAFTER",
      specialistId: "kanban-todo-orchestrator",
      specialistName: "Todo Orchestrator",
      specialistLocale: "en",
    },
    visible: true,
  },
  {
    id: "dev",
    name: "Dev",
    color: "amber",
    position: 2,
    stage: "dev",
    automation: {
      enabled: true,
      steps: [{
        id: "dev-executor",
        role: "CRAFTER",
        specialistId: "kanban-dev-executor",
        specialistName: "Dev Crafter",
        specialistLocale: "en",
      }],
      transitionType: "entry",
      autoAdvanceOnSuccess: false,
      role: "CRAFTER",
      specialistId: "kanban-dev-executor",
      specialistName: "Dev Crafter",
      specialistLocale: "en",
    },
    visible: true,
  },
  {
    id: "review",
    name: "Review",
    color: "slate",
    position: 3,
    stage: "review",
    automation: {
      enabled: true,
      steps: [
        {
          id: "qa-frontend",
          role: "GATE",
          specialistId: "kanban-qa-frontend",
          specialistName: "QA Frontend",
          specialistLocale: "en",
        },
        {
          id: "review-guard",
          role: "GATE",
          specialistId: "kanban-review-guard",
          specialistName: "Review Guard",
          specialistLocale: "en",
        },
      ],
      transitionType: "entry",
      requiredArtifacts: ["screenshot", "test_results"],
      autoAdvanceOnSuccess: false,
      role: "GATE",
      specialistId: "kanban-qa-frontend",
      specialistName: "QA Frontend",
      specialistLocale: "en",
    },
    visible: true,
  },
  {
    id: "done",
    name: "Done",
    color: "emerald",
    position: 4,
    stage: "done",
    automation: {
      enabled: true,
      steps: [{
        id: "done-reporter",
        role: "GATE",
        specialistId: "kanban-done-reporter",
        specialistName: "Done Reporter",
        specialistLocale: "en",
      }],
      transitionType: "entry",
      autoAdvanceOnSuccess: false,
      role: "GATE",
      specialistId: "kanban-done-reporter",
      specialistName: "Done Reporter",
      specialistLocale: "en",
    },
    visible: true,
  },
  {
    id: "blocked",
    name: "Blocked",
    color: "rose",
    position: 5,
    stage: "blocked",
    automation: {
      enabled: true,
      steps: [{
        id: "blocked-resolver",
        role: "CRAFTER",
        specialistId: "kanban-blocked-resolver",
        specialistName: "Blocked Resolver",
        specialistLocale: "en",
      }],
      transitionType: "entry",
      autoAdvanceOnSuccess: false,
      role: "CRAFTER",
      specialistId: "kanban-blocked-resolver",
      specialistName: "Blocked Resolver",
      specialistLocale: "en",
    },
    visible: false,
  },
];

const SNAPSHOT_SESSION_HISTORY = [
  {
    sessionId: SNAPSHOT_SESSION_ID,
    update: {
      sessionUpdate: "user_message",
      content: { type: "text", text: "Build a deterministic page snapshot fixture setup." },
    },
  },
  {
    sessionId: SNAPSHOT_SESSION_ID,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "tool-snapshot-1",
      tool: "codebase-retrieval",
      kind: "unknown",
      status: "running",
      rawInput: {
        information_request: "Locate the snapshot validation flow.",
      },
    },
  },
  {
    sessionId: SNAPSHOT_SESSION_ID,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-snapshot-1",
      tool: "codebase-retrieval",
      kind: "unknown",
      status: "completed",
      rawInput: {
        information_request: "Locate the snapshot validation flow.",
      },
      rawOutput: "Found page snapshot scripts and registry entries.",
    },
  },
  {
    sessionId: SNAPSHOT_SESSION_ID,
    update: {
      sessionUpdate: "agent_message",
      content: {
        type: "text",
        text: "Prepared a stable snapshot runtime with seeded workspace, Kanban, session, and trace data.",
      },
    },
  },
];

const SNAPSHOT_TRACES = [
  {
    version: "0.1.0",
    id: "trace-session-start",
    timestamp: "2026-03-19T13:00:00.000Z",
    sessionId: SNAPSHOT_SESSION_ID,
    workspaceId: SNAPSHOT_WORKSPACE_ID,
    contributor: { provider: "opencode" },
    eventType: "session_start",
    conversation: { role: "system", contentPreview: "Session started" },
  },
  {
    version: "0.1.0",
    id: "trace-user-message",
    timestamp: "2026-03-19T13:00:10.000Z",
    sessionId: SNAPSHOT_SESSION_ID,
    workspaceId: SNAPSHOT_WORKSPACE_ID,
    contributor: { provider: "opencode" },
    eventType: "user_message",
    conversation: {
      role: "user",
      contentPreview: "Build a deterministic page snapshot fixture setup.",
      fullContent: "Build a deterministic page snapshot fixture setup.",
    },
  },
  {
    version: "0.1.0",
    id: "trace-tool-call",
    timestamp: "2026-03-19T13:00:20.000Z",
    sessionId: SNAPSHOT_SESSION_ID,
    workspaceId: SNAPSHOT_WORKSPACE_ID,
    contributor: { provider: "opencode" },
    eventType: "tool_call",
    tool: {
      name: "codebase-retrieval",
      toolCallId: "tool-snapshot-1",
      status: "completed",
      input: { information_request: "Locate the snapshot validation flow." },
    },
    metadata: {
      toolCallContentPath: "scripts/page-snapshot-lib.mjs",
    },
  },
  {
    version: "0.1.0",
    id: "trace-tool-result",
    timestamp: "2026-03-19T13:00:23.000Z",
    sessionId: SNAPSHOT_SESSION_ID,
    workspaceId: SNAPSHOT_WORKSPACE_ID,
    contributor: { provider: "opencode" },
    eventType: "tool_result",
    tool: {
      name: "codebase-retrieval",
      toolCallId: "tool-snapshot-1",
      status: "completed",
      output: "Found page snapshot scripts and registry entries.",
    },
  },
  {
    version: "0.1.0",
    id: "trace-agent-message",
    timestamp: "2026-03-19T13:00:35.000Z",
    sessionId: SNAPSHOT_SESSION_ID,
    workspaceId: SNAPSHOT_WORKSPACE_ID,
    contributor: { provider: "opencode" },
    eventType: "agent_message",
    conversation: {
      role: "assistant",
      contentPreview: "Prepared a stable snapshot runtime with seeded workspace, Kanban, session, and trace data.",
      fullContent: "Prepared a stable snapshot runtime with seeded workspace, Kanban, session, and trace data.",
    },
  },
  {
    version: "0.1.0",
    id: "trace-session-end",
    timestamp: "2026-03-19T13:00:45.000Z",
    sessionId: SNAPSHOT_SESSION_ID,
    workspaceId: SNAPSHOT_WORKSPACE_ID,
    contributor: { provider: "opencode" },
    eventType: "session_end",
    conversation: { role: "system", contentPreview: "Session completed" },
  },
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toFolderSlug(absolutePath) {
  let cleaned = absolutePath.replace(/^[/\\]+/, "");
  cleaned = cleaned.replace(/[/\\]+$/, "");
  cleaned = cleaned.replace(/:/g, "");
  cleaned = cleaned.replace(/[/\\]+/g, "-");
  return cleaned;
}

function initializeFixtureDb(dbPath, projectRoot, homeDir) {
  const db = new BetterSqlite3(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      repo_path TEXT,
      branch TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      model_tier TEXT NOT NULL DEFAULT 'SMART',
      workspace_id TEXT NOT NULL,
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      scope TEXT,
      acceptance_criteria TEXT,
      verification_commands TEXT,
      assigned_to TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      dependencies TEXT DEFAULT '[]',
      parallel_group TEXT,
      workspace_id TEXT NOT NULL,
      completion_summary TEXT,
      verification_verdict TEXT,
      verification_report TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      session_id TEXT,
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
      github_id TEXT,
      github_number INTEGER,
      github_url TEXT,
      github_repo TEXT,
      github_state TEXT,
      github_synced_at INTEGER,
      last_sync_error TEXT,
      codebase_ids TEXT DEFAULT '[]',
      worktree_id TEXT,
      session_ids TEXT DEFAULT '[]',
      lane_sessions TEXT DEFAULT '[]',
      lane_handoffs TEXT DEFAULT '[]',
      test_cases TEXT
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
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
      PRIMARY KEY (workspace_id, id)
    );

    CREATE TABLE IF NOT EXISTS acp_sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      cwd TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      routa_agent_id TEXT,
      provider TEXT,
      role TEXT,
      mode_id TEXT,
      first_prompt_sent INTEGER DEFAULT 0,
      message_history TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      model TEXT,
      branch TEXT,
      parent_session_id TEXT,
      specialist_id TEXT,
      execution_mode TEXT,
      owner_instance_id TEXT,
      lease_expires_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_index INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS codebases (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      branch TEXT,
      label TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source_type TEXT,
      source_url TEXT
    );

    CREATE TABLE IF NOT EXISTS kanban_boards (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      columns TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS background_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      status TEXT NOT NULL,
      triggered_by TEXT,
      trigger_source TEXT NOT NULL,
      priority TEXT NOT NULL,
      result_session_id TEXT,
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_activity INTEGER,
      current_activity TEXT,
      tool_call_count INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      workflow_run_id TEXT,
      workflow_step_name TEXT,
      depends_on_task_ids TEXT,
      task_output TEXT
    );
  `);

  const createdAt = Date.parse(SNAPSHOT_TIME);
  const workspaceMetadata = JSON.stringify({
    worktreeRoot: path.join(homeDir, ".routa", "workspace", SNAPSHOT_WORKSPACE_ID),
  });

  db.prepare(`
    INSERT INTO workspaces (id, title, status, metadata, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?, ?)
  `).run(
    SNAPSHOT_WORKSPACE_ID,
    SNAPSHOT_WORKSPACE_TITLE,
    workspaceMetadata,
    createdAt,
    createdAt,
  );

  db.prepare(`
    INSERT INTO kanban_boards (id, workspace_id, name, is_default, columns, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?)
  `).run(
    SNAPSHOT_BOARD_ID,
    SNAPSHOT_WORKSPACE_ID,
    `${SNAPSHOT_WORKSPACE_TITLE} Board`,
    JSON.stringify(SNAPSHOT_BOARD_COLUMNS),
    createdAt,
    createdAt,
  );

  const insertTask = db.prepare(`
    INSERT INTO tasks (
      id, title, objective, status, dependencies, workspace_id, version,
      created_at, updated_at, board_id, column_id, position, priority,
      labels, assigned_provider, assigned_role, assigned_specialist_id, assigned_specialist_name,
      trigger_session_id, codebase_ids, session_ids, lane_sessions, lane_handoffs, completion_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertTask.run(
    "snapshot-task-backlog",
    "Stabilize Page Snapshot Fixtures",
    "Introduce deterministic fixture data for snapshot validation.",
    "PENDING",
    "[]",
    SNAPSHOT_WORKSPACE_ID,
    1,
    createdAt,
    createdAt,
    SNAPSHOT_BOARD_ID,
    "backlog",
    0,
    "high",
    JSON.stringify(["snapshot", "ci"]),
    null,
    "CRAFTER",
    "kanban-backlog-refiner",
    "Backlog Refiner",
    null,
    "[]",
    JSON.stringify([]),
    "[]",
    "[]",
    "Capture stable fixtures for workspace and Kanban pages.",
  );

  insertTask.run(
    "snapshot-task-done",
    "Validate Snapshot Pipeline",
    "Verify the snapshot validator runs against fixture data.",
    "COMPLETED",
    "[]",
    SNAPSHOT_WORKSPACE_ID,
    1,
    createdAt + 1000,
    createdAt + 2000,
    SNAPSHOT_BOARD_ID,
    "done",
    1,
    "medium",
    JSON.stringify(["snapshot"]),
    null,
    "GATE",
    "kanban-done-reporter",
    "Done Reporter",
    SNAPSHOT_SESSION_ID,
    JSON.stringify([]),
    JSON.stringify([SNAPSHOT_SESSION_ID]),
    "[]",
    "[]",
    "Fixture-backed snapshot validation completed successfully.",
  );

  db.prepare(`
    INSERT INTO acp_sessions (
      id, name, cwd, workspace_id, routa_agent_id, provider, role,
      first_prompt_sent, message_history, created_at, updated_at, model, branch
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
  `).run(
    SNAPSHOT_SESSION_ID,
    "Snapshot Fixture Session",
    projectRoot,
    SNAPSHOT_WORKSPACE_ID,
    SNAPSHOT_SESSION_ID,
    "opencode",
    "CRAFTER",
    JSON.stringify(SNAPSHOT_SESSION_HISTORY),
    createdAt,
    createdAt,
    "gpt-5",
    "main",
  );

  db.close();
}

function writeTraceFixtures(projectRoot, homeDir) {
  const traceDir = path.join(
    homeDir,
    ".routa",
    "projects",
    toFolderSlug(projectRoot),
    "traces",
    SNAPSHOT_DAY,
  );
  ensureDir(traceDir);
  const traceFile = path.join(traceDir, "traces-2026-03-19T13-00-00.jsonl");
  fs.writeFileSync(
    traceFile,
    `${SNAPSHOT_TRACES.map((trace) => JSON.stringify(trace)).join("\n")}\n`,
    "utf-8",
  );
}

export async function prepareSnapshotFixtures(projectRoot) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "routa-page-snapshot-"));
  const homeDir = path.join(tempRoot, "home");
  ensureDir(homeDir);

  const dbPath = path.join(tempRoot, "routa.db");
  initializeFixtureDb(dbPath, projectRoot, homeDir);
  writeTraceFixtures(projectRoot, homeDir);

  return {
    env: {
      HOME: homeDir,
      ROUTA_DB_DRIVER: "sqlite",
      ROUTA_DB_PATH: dbPath,
      PAGE_SNAPSHOT_FIXTURE_MODE: "1",
    },
    cleanup() {
      // Retry cleanup with delays to handle SQLite WAL file locks
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          break;
        } catch (error) {
          attempts += 1;
          if (attempts >= maxAttempts) {
            // Log but don't fail - temp cleanup failure is not critical
            console.warn(`Warning: Failed to clean up ${tempRoot}:`, error);
          } else {
            // Wait a bit for file locks to be released
            const delay = 100 * attempts;
            const now = Date.now();
            while (Date.now() - now < delay) {
              // Busy wait
            }
          }
        }
      }
    },
  };
}
