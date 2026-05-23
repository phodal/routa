import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import * as historyCompactorModule from "../../src/core/storage/history-compactor";
import type { SessionHistoryNotification } from "../../src/core/storage/history-compactor";

type HistoryCompactorModule = typeof import("../../src/core/storage/history-compactor");
const runtimeHistoryCompactorModule = (
  "compactSessionHistoryNotifications" in historyCompactorModule
    ? historyCompactorModule
    : (historyCompactorModule as unknown as { default?: HistoryCompactorModule }).default
) as HistoryCompactorModule | undefined;

if (!runtimeHistoryCompactorModule?.compactSessionHistoryNotifications) {
  throw new Error("Unable to load session history compaction helpers");
}

const {
  compactSessionHistoryNotifications,
} = runtimeHistoryCompactorModule;

type Mode = "dry-run" | "apply";

interface Options {
  dbPath: string;
  mode: Mode;
  sessionCutoffDays: number;
  activeWindowMinutes: number;
  activeSessionIds: Set<string>;
  checkpoint: boolean;
  vacuum: boolean;
  json: boolean;
}

interface SessionRow {
  id: string;
  message_history: string | null;
  updated_at: number | null;
  lease_expires_at: number | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  message_index: number;
  payload: string | Record<string, unknown>;
}

interface PlannedMessageGroup {
  group: MessageRow[];
  mergedPayload: Record<string, unknown>;
}

interface MaintenanceSummary {
  mode: Mode;
  dbPath: string;
  protectedActiveSessions: string[];
  sessionMessages: {
    candidateSessions: number;
    mergedGroups: number;
    mergedChunks: number;
    deletedRows: number;
  };
  acpSessions: {
    candidateSessions: number;
    compactedSessions: number;
    originalMessages: number;
    compactedMessages: number;
    mergedChunks: number;
  };
  sqlite: {
    checkpoint: "skipped" | "planned" | "applied";
    vacuum: "skipped" | "planned" | "applied";
  };
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    dbPath: process.env.ROUTA_DB_PATH ?? "routa.db",
    mode: "dry-run",
    sessionCutoffDays: 7,
    activeWindowMinutes: 60,
    activeSessionIds: new Set(),
    checkpoint: false,
    vacuum: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) {
        throw new Error(`Missing value for ${arg}`);
      }
      return value;
    };

    if (arg === "--db") options.dbPath = next();
    else if (arg === "--apply") options.mode = "apply";
    else if (arg === "--dry-run") options.mode = "dry-run";
    else if (arg === "--session-cutoff-days") options.sessionCutoffDays = Number(next());
    else if (arg === "--active-window-minutes") options.activeWindowMinutes = Number(next());
    else if (arg === "--active-session") options.activeSessionIds.add(next());
    else if (arg === "--checkpoint") options.checkpoint = true;
    else if (arg === "--vacuum") options.vacuum = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.sessionCutoffDays) || options.sessionCutoffDays < 0) {
    throw new Error("--session-cutoff-days must be a non-negative number");
  }
  if (!Number.isFinite(options.activeWindowMinutes) || options.activeWindowMinutes < 0) {
    throw new Error("--active-window-minutes must be a non-negative number");
  }

  options.dbPath = path.resolve(options.dbPath);
  return options;
}

function printUsage(): void {
  console.log(`Compact Routa SQLite ACP session history.

Usage:
  node --import tsx scripts/maintenance/compact-session-history.ts [options]

Options:
  --db <path>                    SQLite db path, defaults to ROUTA_DB_PATH or ./routa.db
  --dry-run                      Report planned changes without writing (default)
  --apply                        Apply compaction
  --session-cutoff-days <days>   Only compact sessions/messages older than this cutoff (default: 7)
  --active-window-minutes <min>  Protect sessions updated within this window (default: 60)
  --active-session <id>          Protect an explicit active session; repeatable
  --checkpoint                   Run PRAGMA wal_checkpoint(TRUNCATE) in apply mode
  --vacuum                       Run VACUUM in apply mode
  --json                         Print machine-readable JSON
`);
}

function parseJsonArray(value: string | null): SessionHistoryNotification[] {
  if (!value) {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed as SessionHistoryNotification[] : [];
}

function parsePayload(value: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof value !== "string") {
    return value;
  }
  return JSON.parse(value) as Record<string, unknown>;
}

function isActiveSession(row: SessionRow, options: Options, now: number): boolean {
  if (options.activeSessionIds.has(row.id)) {
    return true;
  }
  if (typeof row.lease_expires_at === "number" && row.lease_expires_at > now) {
    return true;
  }
  const activeCutoff = now - options.activeWindowMinutes * 60 * 1000;
  return typeof row.updated_at === "number" && row.updated_at >= activeCutoff;
}

function groupConsecutiveChunks(rows: MessageRow[]): MessageRow[][] {
  const groups: MessageRow[][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    const previous = last?.[last.length - 1];
    if (!last || previous?.session_id !== row.session_id || previous.message_index !== row.message_index - 1) {
      groups.push([row]);
    } else {
      last.push(row);
    }
  }
  return groups.filter((group) => group.length > 1);
}

function buildMergedPayload(group: MessageRow[]): Record<string, unknown> | null {
  const compacted = compactSessionHistoryNotifications(group.map((row) => ({
    ...(parsePayload(row.payload) as SessionHistoryNotification),
    sessionId: row.session_id,
  })));
  const merged = compacted.history[0];
  if (!merged || compacted.compactedCount !== 1) {
    return null;
  }
  return merged as Record<string, unknown>;
}

export function runSessionHistoryMaintenance(options: Options): MaintenanceSummary {
  if (!fs.existsSync(options.dbPath)) {
    throw new Error(`SQLite database not found: ${options.dbPath}`);
  }

  const sqlite = new BetterSqlite3(options.dbPath);
  try {
    sqlite.pragma("foreign_keys = ON");
    const now = Date.now();
    const cutoff = now - options.sessionCutoffDays * 24 * 60 * 60 * 1000;
    const sessions = sqlite
      .prepare("SELECT id, message_history, updated_at, lease_expires_at FROM acp_sessions")
      .all() as SessionRow[];
    const activeSessionIds = new Set(
      sessions
        .filter((session) => isActiveSession(session, options, now))
        .map((session) => session.id),
    );

    const summary: MaintenanceSummary = {
      mode: options.mode,
      dbPath: options.dbPath,
      protectedActiveSessions: [...activeSessionIds].sort(),
      sessionMessages: {
        candidateSessions: 0,
        mergedGroups: 0,
        mergedChunks: 0,
        deletedRows: 0,
      },
      acpSessions: {
        candidateSessions: 0,
        compactedSessions: 0,
        originalMessages: 0,
        compactedMessages: 0,
        mergedChunks: 0,
      },
      sqlite: {
        checkpoint: options.checkpoint ? (options.mode === "apply" ? "applied" : "planned") : "skipped",
        vacuum: options.vacuum ? (options.mode === "apply" ? "applied" : "planned") : "skipped",
      },
    };

    const messageRows = sqlite
      .prepare(`
        SELECT id, session_id, message_index, payload
        FROM session_messages
        WHERE event_type = 'agent_message_chunk'
          AND created_at < ?
        ORDER BY session_id, message_index
      `)
      .all(cutoff) as MessageRow[];
    const inactiveMessageRows = messageRows.filter((row) => !activeSessionIds.has(row.session_id));
    const groups = groupConsecutiveChunks(inactiveMessageRows);
    const plannedMessageGroups: PlannedMessageGroup[] = [];
    for (const group of groups) {
      const mergedPayload = buildMergedPayload(group);
      if (!mergedPayload) {
        continue;
      }
      plannedMessageGroups.push({ group, mergedPayload });
    }
    summary.sessionMessages.candidateSessions = new Set(plannedMessageGroups.map((item) => item.group[0].session_id)).size;
    summary.sessionMessages.mergedGroups = plannedMessageGroups.length;
    summary.sessionMessages.mergedChunks = plannedMessageGroups.reduce((total, item) => total + item.group.length, 0);
    summary.sessionMessages.deletedRows = plannedMessageGroups.reduce((total, item) => total + item.group.length - 1, 0);

    const applyMessageGroups = sqlite.transaction((chunkGroups: PlannedMessageGroup[]) => {
      const update = sqlite.prepare("UPDATE session_messages SET event_type = ?, payload = ? WHERE id = ?");
      const remove = sqlite.prepare("DELETE FROM session_messages WHERE id = ?");
      for (const item of chunkGroups) {
        update.run("agent_message", JSON.stringify(item.mergedPayload), item.group[0].id);
        for (const row of item.group.slice(1)) {
          remove.run(row.id);
        }
      }
    });

    const applySessionJson = sqlite.transaction((updates: Array<{ id: string; history: SessionHistoryNotification[] }>) => {
      const update = sqlite.prepare("UPDATE acp_sessions SET message_history = ? WHERE id = ?");
      for (const item of updates) {
        update.run(JSON.stringify(item.history), item.id);
      }
    });

    const sessionJsonUpdates: Array<{ id: string; history: SessionHistoryNotification[] }> = [];
    for (const session of sessions) {
      if (activeSessionIds.has(session.id)) {
        continue;
      }
      if (typeof session.updated_at === "number" && session.updated_at >= cutoff) {
        continue;
      }

      const history = parseJsonArray(session.message_history);
      if (history.length === 0) {
        continue;
      }

      summary.acpSessions.candidateSessions++;
      summary.acpSessions.originalMessages += history.length;
      const compacted = compactSessionHistoryNotifications(history);
      summary.acpSessions.compactedMessages += compacted.compactedCount;
      summary.acpSessions.mergedChunks += compacted.mergedChunks;

      if (compacted.compactedCount !== compacted.originalCount) {
        summary.acpSessions.compactedSessions++;
        sessionJsonUpdates.push({ id: session.id, history: compacted.history });
      }
    }

    if (options.mode === "apply") {
      applyMessageGroups(plannedMessageGroups);
      applySessionJson(sessionJsonUpdates);
      if (options.checkpoint) {
        sqlite.pragma("wal_checkpoint(TRUNCATE)");
      }
      if (options.vacuum) {
        sqlite.exec("VACUUM");
      }
    }

    return summary;
  } finally {
    sqlite.close();
  }
}

function printSummary(summary: MaintenanceSummary): void {
  console.log(`Session history maintenance (${summary.mode})`);
  console.log(`Database: ${summary.dbPath}`);
  console.log(`Protected active sessions: ${summary.protectedActiveSessions.length}`);
  console.log(
    `session_messages: ${summary.sessionMessages.mergedGroups} groups, ` +
    `${summary.sessionMessages.mergedChunks} chunks, ${summary.sessionMessages.deletedRows} rows removable`,
  );
  console.log(
    `acp_sessions.message_history: ${summary.acpSessions.compactedSessions}/` +
    `${summary.acpSessions.candidateSessions} sessions compactable, ` +
    `${summary.acpSessions.originalMessages} -> ${summary.acpSessions.compactedMessages} messages`,
  );
  console.log(`SQLite checkpoint: ${summary.sqlite.checkpoint}`);
  console.log(`SQLite vacuum: ${summary.sqlite.vacuum}`);
}

export function main(argv: string[] = process.argv.slice(2)): number {
  try {
    const options = parseOptions(argv);
    const summary = runSessionHistoryMaintenance(options);
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printSummary(summary);
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
