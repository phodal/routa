import { fileURLToPath } from "node:url";
import * as path from "node:path";

import BetterSqlite3 from "better-sqlite3";

import {
  compactSessionHistoryForPersistence,
  compactSessionNotificationForPersistence,
} from "../../src/core/acp/session-notification-retention";
import type { AcpSessionNotification } from "../../src/core/store/acp-session-store";

interface CompactToolCallDeltaOptions {
  dbPath: string;
  apply: boolean;
  vacuum: boolean;
  batchSize: number;
}

interface CompactionStats {
  scanned: number;
  changed: number;
  skippedInvalidJson: number;
  beforeBytes: number;
  afterBytes: number;
}

interface CompactionResult {
  mode: "dry-run" | "apply";
  dbPath: string;
  sessionMessages: CompactionStats;
  acpSessions: CompactionStats;
  vacuumed: boolean;
}

const DEFAULT_BATCH_SIZE = 500;

export function parseArgs(argv: string[]): CompactToolCallDeltaOptions {
  const options: CompactToolCallDeltaOptions = {
    dbPath: process.env.ROUTA_DB_PATH ?? "routa.db",
    apply: false,
    vacuum: false,
    batchSize: DEFAULT_BATCH_SIZE,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--vacuum") {
      options.vacuum = true;
      continue;
    }
    if (arg === "--db") {
      const value = argv[i + 1];
      if (!value) throw new Error("--db requires a database path");
      options.dbPath = value;
      i += 1;
      continue;
    }
    if (arg === "--batch-size") {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--batch-size requires a positive integer");
      }
      options.batchSize = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.vacuum && !options.apply) {
    throw new Error("--vacuum requires --apply because VACUUM is a mutating operation");
  }

  return options;
}

export function compactToolCallDeltaDatabase(options: CompactToolCallDeltaOptions): CompactionResult {
  const db = new BetterSqlite3(options.dbPath, { fileMustExist: true });
  try {
    const sessionMessages = hasTable(db, "session_messages")
      ? compactSessionMessageRows(db, options)
      : emptyStats();
    const acpSessions = hasTable(db, "acp_sessions")
      ? compactAcpSessionHistoryRows(db, options)
      : emptyStats();

    let vacuumed = false;
    if (options.apply && options.vacuum) {
      db.exec("VACUUM");
      vacuumed = true;
    }

    return {
      mode: options.apply ? "apply" : "dry-run",
      dbPath: options.dbPath,
      sessionMessages,
      acpSessions,
      vacuumed,
    };
  } finally {
    db.close();
  }
}

function compactSessionMessageRows(
  db: BetterSqlite3.Database,
  options: CompactToolCallDeltaOptions,
): CompactionStats {
  const stats = emptyStats();
  const select = db.prepare(`
    SELECT rowid, id, payload
    FROM session_messages
    WHERE event_type = 'tool_call_params_delta'
      AND rowid > ?
    ORDER BY rowid
    LIMIT ?
  `);
  const update = db.prepare("UPDATE session_messages SET payload = ? WHERE id = ?");
  const flush = db.transaction((rows: Array<{ id: string; payload: string }>) => {
    for (const row of rows) {
      update.run(row.payload, row.id);
    }
  });
  let lastRowId = 0;

  while (true) {
    const rows = select.all(lastRowId, options.batchSize) as Array<{
      rowid: number;
      id: string;
      payload: string;
    }>;
    if (rows.length === 0) break;

    const pending: Array<{ id: string; payload: string }> = [];
    for (const row of rows) {
      lastRowId = row.rowid;
      stats.scanned += 1;
      const compacted = compactNotificationJson(row.payload);
      accumulateStats(stats, row.payload, compacted);
      if (compacted.changed && options.apply) {
        pending.push({ id: row.id, payload: compacted.afterJson });
      }
    }

    if (pending.length > 0) {
      flush(pending);
    }
  }

  return stats;
}

function compactAcpSessionHistoryRows(
  db: BetterSqlite3.Database,
  options: CompactToolCallDeltaOptions,
): CompactionStats {
  const stats = emptyStats();
  const select = db.prepare(`
    SELECT rowid, id, message_history AS messageHistory
    FROM acp_sessions
    WHERE message_history LIKE '%tool_call_params_delta%'
      AND rowid > ?
    ORDER BY rowid
    LIMIT ?
  `);
  const update = db.prepare("UPDATE acp_sessions SET message_history = ? WHERE id = ?");
  const flush = db.transaction((rows: Array<{ id: string; messageHistory: string }>) => {
    for (const row of rows) {
      update.run(row.messageHistory, row.id);
    }
  });
  let lastRowId = 0;

  while (true) {
    const rows = select.all(lastRowId, options.batchSize) as Array<{
      rowid: number;
      id: string;
      messageHistory: string;
    }>;
    if (rows.length === 0) break;

    const pending: Array<{ id: string; messageHistory: string }> = [];
    for (const row of rows) {
      lastRowId = row.rowid;
      stats.scanned += 1;
      const compacted = compactHistoryJson(row.messageHistory);
      accumulateStats(stats, row.messageHistory, compacted);
      if (compacted.changed && options.apply) {
        pending.push({ id: row.id, messageHistory: compacted.afterJson });
      }
    }

    if (pending.length > 0) {
      flush(pending);
    }
  }

  return stats;
}

function compactNotificationJson(rawJson: string): { changed: boolean; invalidJson: boolean; afterJson: string } {
  try {
    const notification = JSON.parse(rawJson) as AcpSessionNotification;
    const compacted = compactSessionNotificationForPersistence(notification);
    const afterJson = JSON.stringify(compacted);
    return {
      changed: afterJson !== rawJson,
      invalidJson: false,
      afterJson,
    };
  } catch {
    return { changed: false, invalidJson: true, afterJson: rawJson };
  }
}

function compactHistoryJson(rawJson: string): { changed: boolean; invalidJson: boolean; afterJson: string } {
  try {
    const history = JSON.parse(rawJson) as AcpSessionNotification[];
    if (!Array.isArray(history)) {
      return { changed: false, invalidJson: true, afterJson: rawJson };
    }
    const compacted = compactSessionHistoryForPersistence(history);
    const afterJson = JSON.stringify(compacted);
    return {
      changed: afterJson !== rawJson,
      invalidJson: false,
      afterJson,
    };
  } catch {
    return { changed: false, invalidJson: true, afterJson: rawJson };
  }
}

function accumulateStats(
  stats: CompactionStats,
  beforeJson: string,
  compacted: { changed: boolean; invalidJson: boolean; afterJson: string },
): void {
  if (compacted.invalidJson) {
    stats.skippedInvalidJson += 1;
    return;
  }
  const beforeBytes = Buffer.byteLength(beforeJson, "utf8");
  const afterBytes = Buffer.byteLength(compacted.afterJson, "utf8");
  stats.beforeBytes += beforeBytes;
  stats.afterBytes += afterBytes;
  if (compacted.changed) {
    stats.changed += 1;
  }
}

function hasTable(db: BetterSqlite3.Database, tableName: string): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName),
  );
}

function emptyStats(): CompactionStats {
  return {
    scanned: 0,
    changed: 0,
    skippedInvalidJson: 0,
    beforeBytes: 0,
    afterBytes: 0,
  };
}

function printResult(result: CompactionResult): void {
  const totalBefore = result.sessionMessages.beforeBytes + result.acpSessions.beforeBytes;
  const totalAfter = result.sessionMessages.afterBytes + result.acpSessions.afterBytes;
  const saved = Math.max(0, totalBefore - totalAfter);

  console.log(`Mode: ${result.mode}`);
  console.log(`DB: ${result.dbPath}`);
  console.log(formatStats("session_messages", result.sessionMessages));
  console.log(formatStats("acp_sessions.message_history", result.acpSessions));
  console.log(`Estimated payload reduction: ${formatBytes(saved)} (${formatBytes(totalBefore)} -> ${formatBytes(totalAfter)})`);
  if (result.mode === "dry-run") {
    console.log("Dry-run only. Re-run with --apply to write compacted JSON.");
  } else if (result.vacuumed) {
    console.log("VACUUM completed; SQLite file size should now reflect reclaimed pages.");
  } else {
    console.log("Apply completed. Run again with --apply --vacuum to physically shrink the SQLite file.");
  }
}

function formatStats(label: string, stats: CompactionStats): string {
  return [
    `${label}: scanned=${stats.scanned}`,
    `changed=${stats.changed}`,
    `invalid_json=${stats.skippedInvalidJson}`,
    `payload=${formatBytes(stats.beforeBytes)} -> ${formatBytes(stats.afterBytes)}`,
  ].join(", ");
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value}B`;
  const kib = value / 1024;
  if (kib < 1024) return `${kib.toFixed(2)}KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(2)}MiB`;
  return `${(mib / 1024).toFixed(2)}GiB`;
}

function printHelp(): void {
  console.log(`
Usage:
  npm run db:compact:tool-deltas -- --db routa.db
  npm run db:compact:tool-deltas -- --db routa.db --apply
  npm run db:compact:tool-deltas -- --db routa.db --apply --vacuum

Options:
  --db <path>       SQLite database path. Defaults to ROUTA_DB_PATH or routa.db.
  --apply           Persist compacted payloads. Default is read-only dry-run.
  --vacuum          Run VACUUM after applying updates to shrink the database file.
  --batch-size <n>  Update batch size. Default: ${DEFAULT_BATCH_SIZE}.
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = compactToolCallDeltaDatabase(options);
  printResult(result);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFile === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
