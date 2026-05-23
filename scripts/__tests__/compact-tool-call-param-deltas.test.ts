import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  compactToolCallDeltaDatabase,
  parseArgs,
} from "../maintenance/compact-tool-call-param-deltas";

type NotificationRecord = { update?: Record<string, unknown> };

describe("compact-tool-call-param-deltas", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "routa-tool-delta-"));
    dbPath = path.join(tmpDir, "routa.db");
    seedDatabase(dbPath);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("parses dry-run and apply options", () => {
    expect(parseArgs(["--db", "custom.db", "--apply", "--batch-size", "10"])).toEqual({
      dbPath: "custom.db",
      apply: true,
      vacuum: false,
      batchSize: 10,
    });
    expect(() => parseArgs(["--vacuum"])).toThrow("--vacuum requires --apply");
  });

  it("reports savings without mutating rows in dry-run mode", () => {
    const before = readPayloads(dbPath);
    const result = compactToolCallDeltaDatabase({
      dbPath,
      apply: false,
      vacuum: false,
      batchSize: 1,
    });
    const after = readPayloads(dbPath);

    expect(result.mode).toBe("dry-run");
    expect(result.sessionMessages).toMatchObject({ scanned: 1, changed: 1 });
    expect(result.acpSessions).toMatchObject({ scanned: 1, changed: 1 });
    expect(result.sessionMessages.beforeBytes).toBeGreaterThan(result.sessionMessages.afterBytes);
    expect(after).toEqual(before);
  });

  it("compacts persisted tool parameter deltas in session_messages and message_history", () => {
    const result = compactToolCallDeltaDatabase({
      dbPath,
      apply: true,
      vacuum: false,
      batchSize: 1,
    });

    expect(result.mode).toBe("apply");
    expect(result.sessionMessages.changed).toBe(1);
    expect(result.acpSessions.changed).toBe(1);

    const { payload, messageHistory } = readPayloads(dbPath);
    const payloadUpdate = payload.update ?? {};
    const historyUpdate = messageHistory[0].update ?? {};
    expect(payloadUpdate).toMatchObject({
      sessionUpdate: "tool_call_params_delta",
      compacted: true,
      partialJsonBytes: 700,
      parsedInputKeys: 2,
    });
    expect(payloadUpdate).not.toHaveProperty("accumulatedJson");
    expect(payloadUpdate).not.toHaveProperty("parsedInput");
    expect(historyUpdate).not.toHaveProperty("accumulatedJson");
    expect(historyUpdate).not.toHaveProperty("parsedInput");
  });
});

function seedDatabase(targetPath: string): void {
  const db = new BetterSqlite3(targetPath);
  try {
    db.exec(`
      CREATE TABLE acp_sessions (
        id TEXT PRIMARY KEY,
        message_history TEXT DEFAULT '[]'
      );

      CREATE TABLE session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);

    const notification = {
      sessionId: "session-1",
      eventId: "event-1",
      update: {
        sessionUpdate: "tool_call_params_delta",
        partialJson: "x".repeat(700),
        accumulatedJson: JSON.stringify({ content: "y".repeat(2_000) }),
        parsedInput: { title: "Large card", body: "z".repeat(1_000) },
      },
    };

    db.prepare("INSERT INTO acp_sessions (id, message_history) VALUES (?, ?)").run(
      "session-1",
      JSON.stringify([notification]),
    );
    db.prepare(`
      INSERT INTO session_messages (id, session_id, message_index, event_type, payload)
      VALUES (?, ?, ?, ?, ?)
    `).run("event-1", "session-1", 0, "tool_call_params_delta", JSON.stringify(notification));
  } finally {
    db.close();
  }
}

function readPayloads(targetPath: string): {
  payload: NotificationRecord;
  messageHistory: NotificationRecord[];
} {
  const db = new BetterSqlite3(targetPath, { readonly: true });
  try {
    const messageRow = db.prepare("SELECT payload FROM session_messages WHERE id = ?").get("event-1") as {
      payload: string;
    };
    const sessionRow = db.prepare("SELECT message_history AS messageHistory FROM acp_sessions WHERE id = ?").get("session-1") as {
      messageHistory: string;
    };
    return {
      payload: JSON.parse(messageRow.payload),
      messageHistory: JSON.parse(sessionRow.messageHistory),
    };
  } finally {
    db.close();
  }
}
