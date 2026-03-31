/**
 * TraceReader — Query and read trace records from filesystem or Postgres.
 *
 * In serverless environments (Vercel), reads from Postgres since the filesystem
 * is ephemeral. Locally reads from JSONL files.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TraceRecord, TraceEventType } from "./types";
import { getTracesDir } from "../storage/folder-slug";

/**
 * Check if running in a serverless environment (e.g., Vercel)
 */
function isServerlessEnvironment(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Query parameters for filtering traces.
 */
export interface TraceQuery {
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by workspace ID */
  workspaceId?: string;
  /** Filter by file path */
  file?: string;
  /** Filter by event type */
  eventType?: TraceEventType;
  /** Start date (YYYY-MM-DD or ISO 8601) */
  startDate?: string;
  /** End date (YYYY-MM-DD or ISO 8601) */
  endDate?: string;
  /** Maximum number of traces to return */
  limit?: number;
  /** Skip N traces (for pagination) */
  offset?: number;
}

/**
 * Trace statistics for a workspace.
 */
export interface TraceStats {
  totalDays: number;
  totalFiles: number;
  totalRecords: number;
  uniqueSessions: number;
  eventTypes: Record<string, number>;
}

/**
 * TraceReader provides querying capabilities over stored traces.
 *
 * In serverless environments, reads from /tmp/.routa/traces/ since
 * that's the only writable location.
 */
export class TraceReader {
  /** Base directory for trace files (e.g., "/project/.routa/traces") */
  readonly #baseDir: string;

  /**
   * Create a new TraceReader with the given workspace root.
   *
   * In serverless environments, reads from Postgres.
   * Locally reads from `<workspace_root>/.routa/traces/`.
   */
  constructor(workspaceRoot: string) {
    this.#baseDir = path.join(workspaceRoot, ".routa", "traces");
  }

  /**
   * Create a TraceReader with a custom base directory.
   */
  static withBaseDir(baseDir: string): TraceReader {
    // Cross-platform: handle both / and \ separators
    return new TraceReader(baseDir.replace(/[/\\]\.routa[/\\]traces$/, ""));
  }

  /**
   * Query traces based on the provided filter parameters.
   *
   * In serverless, queries Postgres. Locally reads from JSONL files.
   */
  async query(query: TraceQuery = {}): Promise<TraceRecord[]> {
    if (isServerlessEnvironment()) {
      return this.#queryFromDb(query);
    }
    return this.#queryFromFiles(query);
  }

  async #queryFromDb(query: TraceQuery): Promise<TraceRecord[]> {
    try {
      const { getDatabaseDriver, getPostgresDatabase } = await import("../db/index");
      if (getDatabaseDriver() !== "postgres") return [];
      const { PgTraceStore } = await import("../db/pg-trace-store");
      const db = getPostgresDatabase();
      return await new PgTraceStore(db).query(query);
    } catch (err) {
      console.error("[TraceReader] Failed to query from DB:", err);
      return [];
    }
  }

  async #queryFromFiles(query: TraceQuery): Promise<TraceRecord[]> {
    const traces: TraceRecord[] = [];

    // Collect all trace base directories: primary + any repo-specific ones
    const allBaseDirs = await this.#getAllTraceBaseDirs();

    if (allBaseDirs.length === 0) return [];

    for (const baseDir of allBaseDirs) {
      // Get all day directories from this base
      const dayDirs = await this.#listDayDirsFrom(baseDir);

      // Apply date filtering if specified
      const filteredDays = this.#filterDaysByDate(dayDirs, query);

      // Read traces from each day directory
      for (const dayDir of filteredDays) {
        const traceFiles = await this.#listTraceFiles(dayDir);

        for (const traceFile of traceFiles) {
          const content = await fs.readFile(traceFile, "utf-8");

          for (const line of content.split("\n").filter(Boolean)) {
            try {
              const record: TraceRecord = JSON.parse(line);
              if (this.#matchesQuery(record, query)) {
                traces.push(record);
              }
            } catch {
              // Skip invalid lines
            }
          }
        }
      }
    }

    // Sort by timestamp (oldest first for chronological reading) and apply pagination
    traces.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const offset = query.offset ?? 0;
    const limit = query.limit ?? traces.length;

    return traces.slice(offset, offset + limit);
  }

  /**
   * Get a single trace by its ID.
   */
  async getById(id: string): Promise<TraceRecord | null> {
    if (isServerlessEnvironment()) {
      try {
        const { getDatabaseDriver, getPostgresDatabase } = await import("../db/index");
        if (getDatabaseDriver() !== "postgres") return null;
        const { PgTraceStore } = await import("../db/pg-trace-store");
        const db = getPostgresDatabase();
        return await new PgTraceStore(db).getById(id);
      } catch (err) {
        console.error("[TraceReader] Failed to getById from DB:", err);
        return null;
      }
    }

    const allBaseDirs = await this.#getAllTraceBaseDirs();
    if (allBaseDirs.length === 0) return null;

    for (const baseDir of allBaseDirs) {
      const dayDirs = await this.#listDayDirsFrom(baseDir);

      for (const dayDir of dayDirs) {
        const traceFiles = await this.#listTraceFiles(dayDir);

        for (const traceFile of traceFiles) {
          const content = await fs.readFile(traceFile, "utf-8");

          for (const line of content.split("\n").filter(Boolean)) {
            try {
              const record: TraceRecord = JSON.parse(line);
              if (record.id === id) {
                return record;
              }
            } catch {
              // Skip invalid lines
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Export traces matching the query in Agent Trace JSON format.
   *
   * Returns a JSON array of trace records.
   */
  async export(query: TraceQuery = {}): Promise<unknown> {
    const traces = await this.query(query);
    return traces;
  }

  /**
   * Get trace statistics for a workspace.
   */
  async stats(): Promise<TraceStats> {
    const defaultStats: TraceStats = {
      totalDays: 0,
      totalFiles: 0,
      totalRecords: 0,
      uniqueSessions: 0,
      eventTypes: {},
    };

    const allBaseDirs = await this.#getAllTraceBaseDirs();
    if (allBaseDirs.length === 0) return defaultStats;

    const stats: TraceStats = { ...defaultStats, eventTypes: {} };
    const sessions = new Set<string>();
    const seenDays = new Set<string>();

    for (const baseDir of allBaseDirs) {
      const dayDirs = await this.#listDayDirsFrom(baseDir);

      for (const dayDir of dayDirs) {
        seenDays.add(path.basename(dayDir));
        const traceFiles = await this.#listTraceFiles(dayDir);
        stats.totalFiles += traceFiles.length;

        for (const traceFile of traceFiles) {
          const content = await fs.readFile(traceFile, "utf-8");
          const lines = content.split("\n").filter(Boolean);
          stats.totalRecords += lines.length;

          for (const line of lines) {
            try {
              const record: TraceRecord = JSON.parse(line);
              sessions.add(record.sessionId);
              stats.eventTypes[record.eventType] =
                (stats.eventTypes[record.eventType] ?? 0) + 1;
            } catch {
              // Skip invalid lines
            }
          }
        }
      }
    }

    stats.totalDays = seenDays.size;
    stats.uniqueSessions = sessions.size;
    return stats;
  }

  /**
   * Collect all trace base directories: the primary one, the new ~/.routa/ path,
   * and any repo-specific ones under .routa/repos/.
   * This ensures traces from all storage locations are discovered.
   */
  async #getAllTraceBaseDirs(): Promise<string[]> {
    const dirs = new Set<string>();

    // 1. New storage path: ~/.routa/projects/{folder-slug}/traces/
    // Strip .routa/traces suffix (cross-platform: handle both / and \ separators)
    const workspaceRoot = this.#baseDir.replace(/[/\\]\.routa[/\\]traces$/, "").replace(/[/\\]+$/, "");
    const newTraceDir = getTracesDir(workspaceRoot);
    try {
      await fs.access(newTraceDir);
      dirs.add(newTraceDir);
    } catch {
      // New trace dir doesn't exist yet — that's OK
    }

    // 2. Legacy primary trace directory: {project}/.routa/traces/
    try {
      await fs.access(this.#baseDir);
      // Only add if different from the new path (avoid duplicates)
      if (this.#baseDir !== newTraceDir) {
        dirs.add(this.#baseDir);
      }
    } catch {
      // Primary trace dir doesn't exist — that's OK
    }

    // 3. Scan .routa/repos/* for repo-specific trace directories in both
    // the new ~/.routa/projects/{slug}/traces layout and the legacy
    // {repo}/.routa/traces layout.
    const reposDir = path.join(workspaceRoot, ".routa", "repos");
    try {
      const repoEntries = await fs.readdir(reposDir, { withFileTypes: true });
      for (const entry of repoEntries) {
        if (!entry.isDirectory()) continue;

        const repoRoot = path.join(reposDir, entry.name);
        const repoTraceDirs = [
          getTracesDir(repoRoot),
          path.join(repoRoot, ".routa", "traces"),
        ];

        for (const repoTraceDir of repoTraceDirs) {
          try {
            await fs.access(repoTraceDir);
            dirs.add(repoTraceDir);
          } catch {
            // No trace dir at this path — skip
          }
        }
      }
    } catch {
      // No repos directory — that's OK
    }

    return Array.from(dirs);
  }

  /**
   * List all day directories from a specific base dir, sorted newest first.
   */
  async #listDayDirsFrom(baseDir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => path.join(baseDir, e.name));
      return dirs.sort().reverse();
    } catch {
      return [];
    }
  }

  /**
   * List all trace files in a day directory sorted by name.
   */
  async #listTraceFiles(dayDir: string): Promise<string[]> {
    const entries = await fs.readdir(dayDir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => path.join(dayDir, e.name));
    return files.sort().reverse();
  }

  /**
   * Filter day directories by date range.
   */
  #filterDaysByDate(dayDirs: string[], query: TraceQuery): string[] {
    const filtered: string[] = [];

    for (const dayDir of dayDirs) {
      const dayName = path.basename(dayDir);

      if (!this.#isValidDateFormat(dayName)) {
        continue;
      }

      if (query.startDate && dayName < query.startDate) {
        continue;
      }

      if (query.endDate && dayName > query.endDate) {
        continue;
      }

      filtered.push(dayDir);
    }

    return filtered;
  }

  /**
   * Check if a date string is valid YYYY-MM-DD format.
   */
  #isValidDateFormat(dateStr: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  }

  /**
   * Check if a trace record matches the query parameters.
   */
  #matchesQuery(record: TraceRecord, query: TraceQuery): boolean {
    if (query.sessionId && record.sessionId !== query.sessionId) {
      return false;
    }

    if (query.workspaceId && record.workspaceId !== query.workspaceId) {
      return false;
    }

    if (query.file) {
      const fileMatches = record.files?.some((f) => f.path === query.file) ?? false;
      if (!fileMatches) {
        return false;
      }
    }

    if (query.eventType && record.eventType !== query.eventType) {
      return false;
    }

    return true;
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────

const GLOBAL_KEY = "__trace_readers__";

type TraceReaderCache = Map<string, TraceReader>;

function getReaderCache(): TraceReaderCache {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<string, TraceReader>();
  }
  return g[GLOBAL_KEY] as TraceReaderCache;
}

/**
 * Get or create a TraceReader for the given cwd.
 */
export function getTraceReader(cwd: string): TraceReader {
  const cache = getReaderCache();
  let reader = cache.get(cwd);
  if (!reader) {
    reader = new TraceReader(cwd);
    cache.set(cwd, reader);
  }
  return reader;
}
