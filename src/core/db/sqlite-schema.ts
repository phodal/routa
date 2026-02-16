/**
 * Drizzle ORM SQLite Schema — All tables for the Routa multi-agent system.
 *
 * Mirrors the Postgres schema (schema.ts) but uses SQLite-compatible types.
 * Used for desktop deployments (Tauri, Electron) where a local SQLite database
 * is preferred over a remote Postgres instance.
 *
 * Key differences from Postgres schema:
 * - Uses sqliteTable instead of pgTable
 * - Uses integer for timestamps (Unix epoch milliseconds)
 * - Uses text for JSONB columns (JSON serialized as text)
 * - Uses integer for boolean columns (0/1)
 */

import {
  sqliteTable,
  text,
  integer,
} from "drizzle-orm/sqlite-core";

// ─── Workspaces ─────────────────────────────────────────────────────

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  repoPath: text("repo_path"),
  branch: text("branch"),
  status: text("status").notNull().default("active"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, string>>().default({}),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// ─── Agents ─────────────────────────────────────────────────────────

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  modelTier: text("model_tier").notNull().default("SMART"),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  status: text("status").notNull().default("PENDING"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, string>>().default({}),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// ─── Tasks ──────────────────────────────────────────────────────────

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  objective: text("objective").notNull(),
  scope: text("scope"),
  acceptanceCriteria: text("acceptance_criteria", { mode: "json" }).$type<string[]>(),
  verificationCommands: text("verification_commands", { mode: "json" }).$type<string[]>(),
  assignedTo: text("assigned_to"),
  status: text("status").notNull().default("PENDING"),
  dependencies: text("dependencies", { mode: "json" }).$type<string[]>().default([]),
  parallelGroup: text("parallel_group"),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  completionSummary: text("completion_summary"),
  verificationVerdict: text("verification_verdict"),
  verificationReport: text("verification_report"),
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// ─── Notes ──────────────────────────────────────────────────────────

export const notes = sqliteTable("notes", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  type: text("type").notNull().default("general"),
  taskStatus: text("task_status"),
  assignedAgentIds: text("assigned_agent_ids", { mode: "json" }).$type<string[]>(),
  parentNoteId: text("parent_note_id"),
  linkedTaskId: text("linked_task_id"),
  customMetadata: text("custom_metadata", { mode: "json" }).$type<Record<string, string>>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// ─── Messages (Conversation) ────────────────────────────────────────

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  toolName: text("tool_name"),
  toolArgs: text("tool_args"),
  turn: integer("turn"),
});

// ─── Event Subscriptions ────────────────────────────────────────────

export const eventSubscriptions = sqliteTable("event_subscriptions", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  agentName: text("agent_name").notNull(),
  eventTypes: text("event_types", { mode: "json" }).$type<string[]>().notNull(),
  excludeSelf: integer("exclude_self", { mode: "boolean" }).notNull().default(true),
  oneShot: integer("one_shot", { mode: "boolean" }).notNull().default(false),
  waitGroupId: text("wait_group_id"),
  priority: integer("priority").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// ─── Pending Events (buffered for agent polling) ────────────────────

export const pendingEvents = sqliteTable("pending_events", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  eventType: text("event_type").notNull(),
  sourceAgentId: text("source_agent_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  data: text("data", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
