/**
 * TraceWriter - Append-only JSONL file writer for trace records.
 *
 * Local storage: ~/.routa/projects/{folder-slug}/traces/{day}/traces-{datetime}.jsonl
 * Serverless: Postgres via PgTraceStore
 *
 * In serverless environments (Vercel), traces are written to Postgres instead
 * of the filesystem (which is ephemeral in /tmp).
 */

import { TraceRecord } from "./types";
import path from "path";
import fs from "fs/promises";
import { getTracesDir } from "../storage/folder-slug";

/**
 * Check if running in a serverless environment (e.g., Vercel)
 */
function isServerlessEnvironment(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Format a date as YYYY-MM-DD for daily directory names.
 */
function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Format a date as YYYYMMDD-HHmmss for file names.
 */
function formatDateTime(date: Date): string {
  return date.toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
}

/**
 * TraceWriter manages JSONL trace file writing with automatic directory creation
 * and daily file rotation.
 *
 * Local traces are stored under ~/.routa/projects/{folder-slug}/traces/.
 * In serverless environments (Vercel), traces are written to Postgres since
 * the filesystem is ephemeral.
 */
export class TraceWriter {
  private cwd: string;
  private currentDay: string | null = null;
  private currentFilePath: string | null = null;
  private readonly isServerless: boolean;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.isServerless = isServerlessEnvironment();
  }

  /**
   * Get the trace directory path for a given day (local only).
   * Now uses ~/.routa/projects/{folder-slug}/traces/{day}
   */
  private getTraceDir(day: string): string {
    return path.join(getTracesDir(this.cwd), day);
  }

  /**
   * Get a trace file path for the current datetime (local only).
   */
  private async getTracePath(day: string): Promise<string> {
    const dir = this.getTraceDir(day);
    await fs.mkdir(dir, { recursive: true });

    if (this.currentDay === day && this.currentFilePath) {
      return this.currentFilePath;
    }

    const datetime = formatDateTime(new Date());
    const filePath = path.join(dir, `traces-${datetime}.jsonl`);
    this.currentDay = day;
    this.currentFilePath = filePath;
    return filePath;
  }

  /**
   * Append a trace record. In serverless, writes to Postgres; locally writes to JSONL.
   */
  async append(record: TraceRecord): Promise<void> {
    if (this.isServerless) {
      // Write to Postgres in serverless environments
      const { getDatabaseDriver, getPostgresDatabase } = await import("../db/index");
      if (getDatabaseDriver() === "postgres") {
        const { PgTraceStore } = await import("../db/pg-trace-store");
        const db = getPostgresDatabase();
        await new PgTraceStore(db).save(record);
        return;
      }
    }

    // Local: write to JSONL file under ~/.routa/projects/{slug}/traces/
    const day = formatDay(new Date());
    const filePath = await this.getTracePath(day);
    const line = JSON.stringify(record) + "\n";
    await fs.appendFile(filePath, line, "utf-8");
  }

  /**
   * Append a trace record safely - logs errors but never throws.
   */
  async appendSafe(record: TraceRecord): Promise<void> {
    try {
      await this.append(record);
    } catch (err) {
      console.error("[TraceWriter] Failed to append trace:", err);
    }
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────

const GLOBAL_KEY = "__trace_writers__";

type TraceWriterCache = Map<string, TraceWriter>;

function getWriterCache(): TraceWriterCache {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<string, TraceWriter>();
  }
  return g[GLOBAL_KEY] as TraceWriterCache;
}

/**
 * Get or create a TraceWriter for the given cwd.
 */
export function getTraceWriter(cwd: string): TraceWriter {
  const cache = getWriterCache();
  let writer = cache.get(cwd);
  if (!writer) {
    writer = new TraceWriter(cwd);
    cache.set(cwd, writer);

    // Fire-and-forget: run trace migration on first writer creation (local only)
    if (!isServerlessEnvironment()) {
      import("../storage/migration-tool").then(({ MigrationTool }) => {
        new MigrationTool(cwd).migrateTraces().catch(() => {});
      }).catch(() => {});
    }
  }
  return writer;
}

/**
 * Create trace records and append them in one call.
 */
export async function recordTrace(
  cwd: string,
  record: TraceRecord
): Promise<void> {
  const writer = getTraceWriter(cwd);
  await writer.appendSafe(record);
}

