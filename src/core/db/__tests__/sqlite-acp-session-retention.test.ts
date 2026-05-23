import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AcpSessionNotification } from "@/core/store/acp-session-store";

import * as sqliteSchema from "../sqlite-schema";
import { SqliteAcpSessionStore } from "../sqlite-stores";

describe("sqlite ACP session retention", () => {
  let sqlite: BetterSqlite3.Database;
  let store: SqliteAcpSessionStore;

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

      CREATE TABLE acp_sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        cwd TEXT NOT NULL,
        branch TEXT,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        routa_agent_id TEXT,
        provider TEXT,
        role TEXT,
        mode_id TEXT,
        model TEXT,
        first_prompt_sent INTEGER DEFAULT 0,
        message_history TEXT DEFAULT '[]',
        parent_session_id TEXT,
        specialist_id TEXT,
        execution_mode TEXT,
        owner_instance_id TEXT,
        lease_expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES acp_sessions(id) ON DELETE CASCADE,
        message_index INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
      );
    `);
    const now = Date.now();
    sqlite.prepare(`
      INSERT INTO workspaces (id, title, status, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("workspace-1", "Workspace One", "active", "{}", now, now);

    store = new SqliteAcpSessionStore(drizzle(sqlite, { schema: sqliteSchema }));
  });

  afterEach(() => {
    sqlite.close();
  });

  it("compacts tool call parameter deltas in saved session history and appended message rows", async () => {
    const firstDelta = makeToolCallParamsDelta("session-1", "event-1");

    await store.save({
      id: "session-1",
      cwd: "C:/Project/Routa",
      workspaceId: "workspace-1",
      messageHistory: [firstDelta],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const saved = await store.get("session-1");
    const savedUpdate = saved?.messageHistory[0].update ?? {};
    expect(savedUpdate).toMatchObject({
      sessionUpdate: "tool_call_params_delta",
      compacted: true,
      partialJsonBytes: 700,
      parsedInputKeys: 2,
    });
    expect(savedUpdate).not.toHaveProperty("accumulatedJson");
    expect(savedUpdate).not.toHaveProperty("parsedInput");

    const secondDelta = makeToolCallParamsDelta("session-1", "event-2");
    await store.appendHistory("session-1", secondDelta);

    const history = await store.getHistory("session-1");
    const appendedUpdate = history[0].update ?? {};
    expect(appendedUpdate).toMatchObject({
      sessionUpdate: "tool_call_params_delta",
      compacted: true,
      partialJsonBytes: 700,
      parsedInputKeys: 2,
    });
    expect(appendedUpdate).not.toHaveProperty("accumulatedJson");
    expect(appendedUpdate).not.toHaveProperty("parsedInput");

    const row = sqlite
      .prepare("SELECT message_history AS messageHistory FROM acp_sessions WHERE id = ?")
      .get("session-1") as { messageHistory: string };
    const sessionHistory = JSON.parse(row.messageHistory) as AcpSessionNotification[];
    expect(sessionHistory).toHaveLength(2);
    for (const notification of sessionHistory) {
      expect(notification.update).not.toHaveProperty("accumulatedJson");
      expect(notification.update).not.toHaveProperty("parsedInput");
    }
  });
});

function makeToolCallParamsDelta(sessionId: string, eventId: string): AcpSessionNotification {
  return {
    sessionId,
    eventId,
    update: {
      sessionUpdate: "tool_call_params_delta",
      toolCallId: "tool-1",
      title: "Used tool: update_card",
      partialJson: "x".repeat(700),
      accumulatedJson: JSON.stringify({ content: "y".repeat(2_000) }),
      parsedInput: { title: "Large card", body: "z".repeat(1_000) },
    },
  };
}
