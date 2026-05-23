import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { runSessionHistoryMaintenance } from "../maintenance/compact-session-history";

const tempDirs: string[] = [];
type CountRow = { count: number };
type PayloadRow = { payload: string };
type SessionHistoryRow = { message_history: string };

function createFixtureDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-session-compact-"));
  tempDirs.push(dir);
  const dbPath = path.join(dir, "routa.db");
  const sqlite = new BetterSqlite3(dbPath);
  const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
  const active = Date.now();
  sqlite.exec(`
    CREATE TABLE acp_sessions (
      id TEXT PRIMARY KEY,
      message_history TEXT DEFAULT '[]',
      updated_at INTEGER,
      lease_expires_at INTEGER
    );
    CREATE TABLE session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_index INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER
    );
  `);
  sqlite.prepare("INSERT INTO acp_sessions (id, message_history, updated_at, lease_expires_at) VALUES (?, ?, ?, ?)").run(
    "old-session",
    JSON.stringify([
      { sessionId: "old-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hel" } } },
      { sessionId: "old-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } } },
      { sessionId: "old-session", update: { sessionUpdate: "turn_complete" } },
    ]),
    old,
    null,
  );
  sqlite.prepare("INSERT INTO acp_sessions (id, message_history, updated_at, lease_expires_at) VALUES (?, ?, ?, ?)").run(
    "active-session",
    JSON.stringify([
      { sessionId: "active-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Act" } } },
      { sessionId: "active-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ive" } } },
    ]),
    active,
    Date.now() + 60_000,
  );
  const insertMessage = sqlite.prepare(
    "INSERT INTO session_messages (id, session_id, message_index, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  insertMessage.run("m1", "old-session", 0, "agent_message_chunk", JSON.stringify({ type: "agent_message_chunk", text: "A" }), old);
  insertMessage.run("m2", "old-session", 1, "agent_message_chunk", JSON.stringify({ type: "agent_message_chunk", text: "B" }), old);
  insertMessage.run("m3", "active-session", 0, "agent_message_chunk", JSON.stringify({ sessionId: "active-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "C" } } }), old);
  insertMessage.run("m4", "active-session", 1, "agent_message_chunk", JSON.stringify({ sessionId: "active-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "D" } } }), old);
  sqlite.close();
  return dbPath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("compact-session-history maintenance script", () => {
  it("reports dry-run changes without writing", () => {
    const dbPath = createFixtureDb();
    const summary = runSessionHistoryMaintenance({
      dbPath,
      mode: "dry-run",
      sessionCutoffDays: 7,
      activeWindowMinutes: 60,
      activeSessionIds: new Set(),
      checkpoint: true,
      vacuum: true,
      json: true,
    });

    expect(summary.sessionMessages.mergedGroups).toBe(1);
    expect(summary.sessionMessages.deletedRows).toBe(1);
    expect(summary.acpSessions.compactedSessions).toBe(1);
    expect(summary.protectedActiveSessions).toEqual(["active-session"]);

    const sqlite = new BetterSqlite3(dbPath);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM session_messages").get()).toEqual({ count: 4 });
    sqlite.close();
  });

  it("applies compaction and skips active sessions", () => {
    const dbPath = createFixtureDb();
    const summary = runSessionHistoryMaintenance({
      dbPath,
      mode: "apply",
      sessionCutoffDays: 7,
      activeWindowMinutes: 60,
      activeSessionIds: new Set(),
      checkpoint: false,
      vacuum: false,
      json: true,
    });

    expect(summary.sessionMessages.deletedRows).toBe(1);
    const sqlite = new BetterSqlite3(dbPath);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM session_messages").get() as CountRow).toEqual({ count: 3 });
    const oldPayloadRow = sqlite.prepare("SELECT payload FROM session_messages WHERE id = ?").get("m1") as PayloadRow;
    const oldPayload = JSON.parse(oldPayloadRow.payload);
    expect(oldPayload.update.sessionUpdate).toBe("agent_message");
    expect(oldPayload.update.content.text).toBe("AB");
    expect(oldPayload.type).toBe("agent_message");
    expect(oldPayload.text).toBe("AB");

    const activePayloadRow = sqlite.prepare("SELECT payload FROM session_messages WHERE id = ?").get("m3") as PayloadRow;
    const activePayload = JSON.parse(activePayloadRow.payload);
    expect(activePayload.update.sessionUpdate).toBe("agent_message_chunk");

    const oldSession = sqlite.prepare("SELECT message_history FROM acp_sessions WHERE id = ?").get("old-session") as SessionHistoryRow;
    expect(JSON.parse(oldSession.message_history)).toHaveLength(2);
    const activeSession = sqlite.prepare("SELECT message_history FROM acp_sessions WHERE id = ?").get("active-session") as SessionHistoryRow;
    expect(JSON.parse(activeSession.message_history)).toHaveLength(2);
    sqlite.close();
  });
});
