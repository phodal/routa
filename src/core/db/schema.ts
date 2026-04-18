/**
 * Drizzle ORM Schema — All tables for the Routa multi-agent system.
 *
 * Uses Neon Serverless Postgres (Vercel's recommended Postgres provider).
 * Every table uses `text` primary keys (UUIDs generated in JS) so that
 * agent/task/workspace IDs stay consistent across the MCP/ACP boundary.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { TaskCreationSource } from "../kanban/task-creation-policy";
import type { KanbanColumn } from "../models/kanban";
import type { TaskCommentEntry, TaskDeliverySnapshot, TaskLaneHandoff, TaskLaneSession } from "../models/task";

// ─── Workspaces ─────────────────────────────────────────────────────

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull().default("active"),
  metadata: jsonb("metadata").$type<Record<string, string>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Codebases ──────────────────────────────────────────────────────

export const codebases = pgTable("codebases", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  repoPath: text("repo_path").notNull(),
  branch: text("branch"),
  label: text("label"),
  isDefault: boolean("is_default").notNull().default(false),
  sourceType: text("source_type"),   // "local" | "github" — null treated as "local"
  sourceUrl: text("source_url"),     // e.g. "https://github.com/owner/repo"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Agents ─────────────────────────────────────────────────────────

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(), // ROUTA | CRAFTER | GATE | DEVELOPER
  modelTier: text("model_tier").notNull().default("SMART"), // SMART | BALANCED | FAST
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  status: text("status").notNull().default("PENDING"), // PENDING | ACTIVE | COMPLETED | ERROR | CANCELLED
  metadata: jsonb("metadata").$type<Record<string, string>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Tasks ──────────────────────────────────────────────────────────

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  objective: text("objective").notNull(),
  comment: text("comment"),
  comments: jsonb("comments").$type<TaskCommentEntry[]>().default([]),
  scope: text("scope"),
  acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>(),
  verificationCommands: jsonb("verification_commands").$type<string[]>(),
  testCases: jsonb("test_cases").$type<string[]>(),
  assignedTo: text("assigned_to"),
  status: text("status").notNull().default("PENDING"),
  boardId: text("board_id"),
  columnId: text("column_id"),
  position: integer("position").notNull().default(0),
  priority: text("priority"),
  labels: jsonb("labels").$type<string[]>().default([]),
  assignee: text("assignee"),
  assignedProvider: text("assigned_provider"),
  assignedRole: text("assigned_role"),
  assignedSpecialistId: text("assigned_specialist_id"),
  assignedSpecialistName: text("assigned_specialist_name"),
  triggerSessionId: text("trigger_session_id"),
  /** All session IDs that have been associated with this task (history) */
  sessionIds: jsonb("session_ids").$type<string[]>().default([]),
  laneSessions: jsonb("lane_sessions").$type<TaskLaneSession[]>().default([]),
  laneHandoffs: jsonb("lane_handoffs").$type<TaskLaneHandoff[]>().default([]),
  githubId: text("github_id"),
  githubNumber: integer("github_number"),
  githubUrl: text("github_url"),
  githubRepo: text("github_repo"),
  githubState: text("github_state"),
  githubSyncedAt: timestamp("github_synced_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  isPullRequest: boolean("is_pull_request"),
  dependencies: jsonb("dependencies").$type<string[]>().default([]),
  blocking: jsonb("blocking").$type<string[]>().default([]),
  dependencyStatus: text("dependency_status"),
  parentTaskId: text("parent_task_id"),
  parallelGroup: text("parallel_group"),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  /** Session ID that created this task (for session-scoped filtering) */
  sessionId: text("session_id"),
  creationSource: text("creation_source").$type<TaskCreationSource>(),
  /** Associated codebase IDs for this task */
  codebaseIds: jsonb("codebase_ids").$type<string[]>().default([]),
  /** Git worktree ID created for this task when it enters the dev column */
  worktreeId: text("worktree_id"),
  deliverySnapshot: jsonb("delivery_snapshot").$type<TaskDeliverySnapshot>(),
  /** URL of the pull/merge request created for this task (set by PR Publisher) */
  pullRequestUrl: text("pull_request_url"),
  /** Timestamp when the PR was merged */
  pullRequestMergedAt: timestamp("pull_request_merged_at", { withTimezone: true }),
  completionSummary: text("completion_summary"),
  verificationVerdict: text("verification_verdict"),
  verificationReport: text("verification_report"),
  /** Optimistic-locking version for atomic updates */
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kanbanBoards = pgTable("kanban_boards", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  githubToken: text("github_token"),
  columns: jsonb("columns").$type<KanbanColumn[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Notes ──────────────────────────────────────────────────────────

export const notes = pgTable(
  "notes",
  {
    id: text("id").notNull(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    /** Session ID that created this note (for session-scoped grouping) */
    sessionId: text("session_id"),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    type: text("type").notNull().default("general"), // spec | task | general
    taskStatus: text("task_status"),
    assignedAgentIds: jsonb("assigned_agent_ids").$type<string[]>(),
    parentNoteId: text("parent_note_id"),
    linkedTaskId: text("linked_task_id"),
    customMetadata: jsonb("custom_metadata").$type<Record<string, string>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.id] })]
);

// ─── Messages (Conversation) ────────────────────────────────────────

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  role: text("role").notNull(), // SYSTEM | USER | ASSISTANT | TOOL
  content: text("content").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  toolName: text("tool_name"),
  toolArgs: text("tool_args"),
  turn: integer("turn"),
});

// ─── Event Subscriptions ────────────────────────────────────────────

export const eventSubscriptions = pgTable("event_subscriptions", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  agentName: text("agent_name").notNull(),
  eventTypes: jsonb("event_types").$type<string[]>().notNull(),
  excludeSelf: boolean("exclude_self").notNull().default(true),
  /** If true, auto-remove after first matching event delivery */
  oneShot: boolean("one_shot").notNull().default(false),
  /** Group ID for wait-all semantics */
  waitGroupId: text("wait_group_id"),
  /** Higher priority subscriptions are notified first */
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Pending Events (buffered for agent polling) ────────────────────

export const pendingEvents = pgTable("pending_events", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  eventType: text("event_type").notNull(),
  sourceAgentId: text("source_agent_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().default({}),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

// ─── ACP Sessions ─────────────────────────────────────────────────────

export interface AcpSessionNotification {
  sessionId: string;
  update?: Record<string, unknown>;
  [key: string]: unknown;
}

export const acpSessions = pgTable("acp_sessions", {
  id: text("id").primaryKey(),
  /** User-editable display name */
  name: text("name"),
  cwd: text("cwd").notNull(),
  /** Git branch the session is scoped to (optional) */
  branch: text("branch"),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  routaAgentId: text("routa_agent_id"),
  provider: text("provider"),
  role: text("role"),
  modeId: text("mode_id"),
  /** Model used for this session */
  model: text("model"),
  /** Whether the first prompt has been sent */
  firstPromptSent: boolean("first_prompt_sent").default(false),
  /** Message history stored as JSONB array */
  messageHistory: jsonb("message_history").$type<AcpSessionNotification[]>().default([]),
  /** Parent session ID for child (CRAFTER/GATE) sessions */
  parentSessionId: text("parent_session_id"),
  /** Specialist ID used to configure this session, if any. */
  specialistId: text("specialist_id"),
  executionMode: text("execution_mode"),
  ownerInstanceId: text("owner_instance_id"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Session Messages (per-message storage, split from JSONB) ─────────

export const sessionMessages = pgTable("session_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => acpSessions.id, { onDelete: "cascade" }),
  messageIndex: integer("message_index").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});


// ─── Traces ───────────────────────────────────────────────────────────

export const traces = pgTable("traces", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  workspaceId: text("workspace_id"),
  eventType: text("event_type").notNull(),
  version: text("version").notNull().default("0.1.0"),
  contributor: jsonb("contributor").$type<Record<string, unknown>>().notNull(),
  tool: jsonb("tool").$type<Record<string, unknown>>(),
  files: jsonb("files").$type<unknown[]>(),
  conversation: jsonb("conversation").$type<Record<string, unknown>>(),
  vcs: jsonb("vcs").$type<Record<string, unknown>>(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  /** Original trace timestamp (ISO 8601) */
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Skills ───────────────────────────────────────────────────────────

export interface SkillFileEntry {
  /** Relative path within the skill (e.g., "SKILL.md", "examples/usage.md") */
  path: string;
  /** File content */
  content: string;
}

export const skills = pgTable("skills", {
  /** Skill name (unique identifier, e.g., "mysql-best-practices") */
  id: text("id").primaryKey(),
  /** Human-readable name */
  name: text("name").notNull(),
  /** Short description extracted from SKILL.md frontmatter */
  description: text("description").notNull().default(""),
  /** Source repository (e.g., "mindrally/skills") */
  source: text("source").notNull(),
  /** Catalog type: "skillssh" | "github" | "local" */
  catalogType: text("catalog_type").notNull().default("skillssh"),
  /** All files in the skill directory, stored as JSON array */
  files: jsonb("files").$type<SkillFileEntry[]>().notNull().default([]),
  /** Optional license from SKILL.md frontmatter */
  license: text("license"),
  /** Additional metadata from SKILL.md frontmatter */
  metadata: jsonb("metadata").$type<Record<string, string>>().default({}),
  /** Installation count (for analytics) */
  installs: integer("installs").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Workspace Skills (many-to-many) ────────────────────────────────

export const workspaceSkills = pgTable("workspace_skills", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  skillId: text("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.skillId] })]);

// ─── Custom MCP Servers ───────────────────────────────────────────────────

export const customMcpServers = pgTable("custom_mcp_servers", {
  /** Unique identifier */
  id: text("id").primaryKey(),
  /** Human-readable name */
  name: text("name").notNull(),
  /** Short description */
  description: text("description"),
  /** MCP server type: "stdio" | "http" | "sse" */
  type: text("type").notNull(),
  /** Command to execute (for stdio type) */
  command: text("command"),
  /** Command arguments (for stdio type) */
  args: jsonb("args").$type<string[]>(),
  /** URL endpoint (for http/sse type) */
  url: text("url"),
  /** HTTP headers (for http/sse type) */
  headers: jsonb("headers").$type<Record<string, string>>(),
  /** Environment variables */
  env: jsonb("env").$type<Record<string, string>>(),
  /** Whether this server is enabled */
  enabled: boolean("enabled").notNull().default(true),
  /** Workspace scope (null = global) */
  workspaceId: text("workspace_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Workflow Runs (multi-step workflow execution) ─────────────────────────

export const workflowRuns = pgTable("workflow_runs", {
  id: text("id").primaryKey(),
  /** Workflow ID (references YAML file name, e.g., "pr-verify") */
  workflowId: text("workflow_id").notNull(),
  /** PENDING | RUNNING | COMPLETED | FAILED | CANCELLED */
  status: text("status").notNull().default("PENDING"),
  /** JSON payload that triggered the workflow */
  triggerPayload: jsonb("trigger_payload").$type<Record<string, unknown>>(),
  /** Resolved workflow variables (JSON) */
  variables: jsonb("variables").$type<Record<string, unknown>>(),
  /** Current step index (0-based) */
  currentStepIndex: integer("current_step_index").notNull().default(0),
  /** Total number of steps in the workflow */
  totalSteps: integer("total_steps").notNull().default(0),
  /** Optional workspace scope */
  workspaceId: text("workspace_id"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Background Tasks (async agent job queue) ─────────────────────────────

export const backgroundTasks = pgTable("background_tasks", {
  id: text("id").primaryKey(),
  /** Short human-readable title */
  title: text("title").notNull(),
  /** Full prompt to dispatch to the agent */
  prompt: text("prompt").notNull(),
  /** ACP agent/provider ID */
  agentId: text("agent_id").notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  /** PENDING | RUNNING | COMPLETED | FAILED | CANCELLED */
  status: text("status").notNull().default("PENDING"),
  /** Who triggered it (user ID or system) */
  triggeredBy: text("triggered_by").notNull().default("user"),
  /** manual | schedule | webhook | fleet | workflow */
  triggerSource: text("trigger_source").notNull().default("manual"),
  /** Task priority: HIGH | NORMAL | LOW */
  priority: text("priority").notNull().default("NORMAL"),
  /** ACP session created when the task starts */
  resultSessionId: text("result_session_id"),
  /** Error message when status = FAILED */
  errorMessage: text("error_message"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(1),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // ─── Progress tracking fields ────────────────────────────────────────────
  /** Most recent activity timestamp */
  lastActivity: timestamp("last_activity", { withTimezone: true }),
  /** Current activity description */
  currentActivity: text("current_activity"),
  /** Number of tool calls executed */
  toolCallCount: integer("tool_call_count").default(0),
  /** Input tokens consumed */
  inputTokens: integer("input_tokens").default(0),
  /** Output tokens consumed */
  outputTokens: integer("output_tokens").default(0),
  // ─── Workflow orchestration fields ───────────────────────────────────────
  /** FK to workflow_runs.id */
  workflowRunId: text("workflow_run_id"),
  /** Name of the workflow step this task represents */
  workflowStepName: text("workflow_step_name"),
  /** JSON array of task IDs that must complete before this task can run */
  dependsOnTaskIds: jsonb("depends_on_task_ids").$type<string[]>(),
  /** JSON output from this task (for chaining to dependent tasks) */
  taskOutput: text("task_output"),
});

// ─── GitHub Webhook Configs ───────────────────────────────────────────────

/**
 * Stores user-configured GitHub webhook trigger rules.
 * Each row describes: which repo, which events, which agent to trigger.
 */
export const githubWebhookConfigs = pgTable("github_webhook_configs", {
  id: text("id").primaryKey(),
  /** Human-readable name for this trigger config */
  name: text("name").notNull(),
  /** GitHub repository in "owner/repo" format */
  repo: text("repo").notNull(),
  /** GitHub personal access token (stored encrypted/plaintext) */
  githubToken: text("github_token").notNull(),
  /** HMAC secret used to verify webhook payloads */
  webhookSecret: text("webhook_secret").notNull().default(""),
  /** GitHub event types to subscribe to, e.g. ["issues", "pull_request"] */
  eventTypes: jsonb("event_types").$type<string[]>().notNull().default([]),
  /** Optional label filter for issues.opened events */
  labelFilter: jsonb("label_filter").$type<string[]>().default([]),
  /** ACP agent/provider ID to trigger when event fires (mutually exclusive with workflowId) */
  triggerAgentId: text("trigger_agent_id").notNull(),
  /** Workflow ID to trigger instead of single agent (e.g., "pr-verify") */
  workflowId: text("workflow_id"),
  /** Workspace scope */
  workspaceId: text("workspace_id"),
  /** Whether this config is active */
  enabled: boolean("enabled").notNull().default(true),
  /** Optional prompt template; {event} and {payload} are substituted */
  promptTemplate: text("prompt_template"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── GitLab Webhook Configs ────────────────────────────────────────────────

/**
 * Stores user-configured GitLab webhook trigger rules.
 * Each row describes: which project, which events, which agent to trigger.
 */
export const gitlabWebhookConfigs = pgTable("gitlab_webhook_configs", {
  id: text("id").primaryKey(),
  /** Human-readable name for this trigger config */
  name: text("name").notNull(),
  /** GitLab project in "group/project" or "owner/repo" format */
  repo: text("repo").notNull(),
  /** GitLab personal access token (stored encrypted/plaintext) */
  gitlabToken: text("gitlab_token").notNull(),
  /** Token secret used to verify webhook payloads */
  webhookSecret: text("webhook_secret").notNull().default(""),
  /** GitLab event types to subscribe to, e.g. ["issues", "merge_request"] */
  eventTypes: jsonb("event_types").$type<string[]>().notNull().default([]),
  /** Optional label filter for issues.opened events */
  labelFilter: jsonb("label_filter").$type<string[]>().default([]),
  /** ACP agent/provider ID to trigger when event fires (mutually exclusive with workflowId) */
  triggerAgentId: text("trigger_agent_id").notNull(),
  /** Workflow ID to trigger instead of single agent (e.g., "pr-verify") */
  workflowId: text("workflow_id"),
  /** Workspace scope */
  workspaceId: text("workspace_id"),
  /** Whether this config is active */
  enabled: boolean("enabled").notNull().default(true),
  /** Optional prompt template; {event} and {payload} are substituted */
  promptTemplate: text("prompt_template"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Schedules (cron-based agent triggers) ───────────────────────────────────

/**
 * Stores user-configured cron-based agent trigger rules.
 * Each row describes: which workspace, which cron expression, which agent to trigger.
 */
export const schedules = pgTable("schedules", {
  id: text("id").primaryKey(),
  /** Human-readable name for this schedule */
  name: text("name").notNull(),
  /** Cron expression, e.g. "0 2 * * *" (daily at 02:00 UTC) */
  cronExpr: text("cron_expr").notNull(),
  /** Full prompt to send when the schedule fires */
  taskPrompt: text("task_prompt").notNull(),
  /** ACP agent/provider ID to use (e.g. "claude-code") */
  agentId: text("agent_id").notNull(),
  /** Workspace scope */
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  /** Whether this schedule is active */
  enabled: boolean("enabled").notNull().default(true),
  /** Timestamp of last successful trigger */
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  /** Computed next trigger time (updated after each run) */
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  /** Background task ID from the most recent trigger */
  lastTaskId: text("last_task_id"),
  /** Optional prompt template; {timestamp}, {cronExpr} are substituted */
  promptTemplate: text("prompt_template"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Webhook Trigger Logs ─────────────────────────────────────────────────

/**
 * Audit log for every GitHub webhook event received.
 */
export const webhookTriggerLogs = pgTable("webhook_trigger_logs", {
  id: text("id").primaryKey(),
  /** Config that matched this event */
  configId: text("config_id").notNull(),
  /** GitHub event type (e.g. "issues") */
  eventType: text("event_type").notNull(),
  /** GitHub event action (e.g. "opened") */
  eventAction: text("event_action"),
  /** Full payload (JSON) */
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  /** Background task created, if any */
  backgroundTaskId: text("background_task_id"),
  /** Whether signature verification passed */
  signatureValid: boolean("signature_valid").notNull().default(false),
  /** Processing outcome: "triggered" | "skipped" | "error" */
  outcome: text("outcome").notNull().default("triggered"),
  /** Error message if outcome = "error" */
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Worktrees ──────────────────────────────────────────────────────

export const worktrees = pgTable("worktrees", {
  id: text("id").primaryKey(),
  codebaseId: text("codebase_id").notNull().references(() => codebases.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  worktreePath: text("worktree_path").notNull(),
  branch: text("branch").notNull(),
  baseBranch: text("base_branch").notNull(),
  status: text("status").notNull().default("creating"), // creating | active | error | removing
  sessionId: text("session_id"),
  label: text("label"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_worktrees_codebase_branch").on(table.codebaseId, table.branch),
  uniqueIndex("uq_worktrees_path").on(table.worktreePath),
]);

// ─── Specialists (user-defined agent specialist configurations) ───────────

export const specialists = pgTable("specialists", {
  /** Unique identifier (e.g., "routa", "crafter", or custom ID) */
  id: text("id").primaryKey(),
  /** Human-readable name */
  name: text("name").notNull(),
  /** Short description */
  description: text("description").notNull().default(""),
  /** Source of this specialist: "user" | "bundled" | "hardcoded" */
  source: text("source").notNull().default("user"),
  /** Agent role: "ROUTA" | "CRAFTER" | "GATE" | "DEVELOPER" */
  role: text("role").notNull(),
  /** Default model tier: "FAST" | "BALANCED" | "SMART" */
  defaultModelTier: text("default_model_tier").notNull().default("SMART"),
  /** System prompt / behavior prompt */
  systemPrompt: text("system_prompt").notNull(),
  /** Short role reminder */
  roleReminder: text("role_reminder").notNull().default(""),
  /** Optional default ACP provider override */
  defaultProvider: text("default_provider"),
  /** Optional default adapter/runtime hint */
  defaultAdapter: text("default_adapter"),
  /** Optional specific model override */
  model: text("model"),
  /** Whether this specialist is enabled */
  enabled: boolean("enabled").notNull().default(true),
  /** Created by user ID (for future multi-tenant support) */
  createdBy: text("created_by"),
  /** Creation timestamp */
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Last update timestamp */
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Artifacts (agent-to-agent communication) ───────────────────────────

export const artifacts = pgTable("artifacts", {
  id: text("id").primaryKey(),
  /** Type: screenshot | test_results | code_diff | logs */
  type: text("type").notNull(),
  /** Task this artifact is associated with */
  taskId: text("task_id").notNull(),
  /** Workspace ID */
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  /** Agent that provided this artifact */
  providedByAgentId: text("provided_by_agent_id"),
  /** Agent that requested this artifact */
  requestedByAgentId: text("requested_by_agent_id"),
  /** Request ID if this artifact fulfills a request */
  requestId: text("request_id"),
  /** Content (base64 for images, text for others) */
  content: text("content"),
  /** Context or description */
  context: text("context"),
  /** Status: pending | provided | expired */
  status: text("status").notNull().default("pending"),
  /** Expiration timestamp */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** Additional metadata */
  metadata: jsonb("metadata").$type<Record<string, string>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Artifact Requests (pending artifact requests) ───────────────────────

export const artifactRequests = pgTable("artifact_requests", {
  id: text("id").primaryKey(),
  /** Agent requesting the artifact */
  fromAgentId: text("from_agent_id").notNull(),
  /** Agent that should provide the artifact */
  toAgentId: text("to_agent_id").notNull(),
  /** Type of artifact requested */
  artifactType: text("artifact_type").notNull(),
  /** Task this request is for */
  taskId: text("task_id").notNull(),
  /** Workspace ID */
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  /** Context for the request */
  context: text("context"),
  /** Status: pending | fulfilled | rejected | expired */
  status: text("status").notNull().default("pending"),
  /** ID of artifact that fulfilled this request */
  artifactId: text("artifact_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
