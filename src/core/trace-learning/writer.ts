/**
 * RunOutcomeWriter - Append-only JSONL writer for normalized run outcomes.
 *
 * Storage: docs/fitness/trace-learning/outcomes.jsonl
 *
 * This writer is separate from TraceWriter because:
 * 1. Outcomes are high-level session summaries, not low-level trace events
 * 2. Outcomes are used for learning/playbook generation, not real-time debugging
 * 3. Outcomes are stored in the repo (docs/) for version control and sharing
 */

import type { RunOutcome } from "./types";
import path from "path";
import fs from "fs/promises";

/**
 * Get the directory for trace learning data.
 * Default: docs/fitness/trace-learning/
 */
function getTraceLearningDir(repoRoot: string): string {
  return path.join(repoRoot, "docs", "fitness", "trace-learning");
}

/**
 * Get the outcomes file path.
 * Default: docs/fitness/trace-learning/outcomes.jsonl
 */
function getOutcomesPath(repoRoot: string): string {
  return path.join(getTraceLearningDir(repoRoot), "outcomes.jsonl");
}

/**
 * RunOutcomeWriter appends normalized run outcomes to a JSONL file
 * for pattern detection and learning.
 */
export class RunOutcomeWriter {
  private repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  /**
   * Ensure the trace-learning directory exists.
   */
  private async ensureDir(): Promise<void> {
    const dir = getTraceLearningDir(this.repoRoot);
    await fs.mkdir(dir, { recursive: true });
  }

  /**
   * Append a run outcome to the outcomes.jsonl file.
   */
  async append(outcome: RunOutcome): Promise<void> {
    await this.ensureDir();
    const filePath = getOutcomesPath(this.repoRoot);
    const line = JSON.stringify(outcome) + "\n";
    await fs.appendFile(filePath, line, "utf-8");
  }

  /**
   * Append a run outcome safely - logs errors but never throws.
   */
  async appendSafe(outcome: RunOutcome): Promise<void> {
    try {
      await this.append(outcome);
    } catch (err) {
      console.error("[RunOutcomeWriter] Failed to append outcome:", err);
    }
  }

  /**
   * Read all outcomes from the file.
   */
  async readAll(): Promise<RunOutcome[]> {
    const filePath = getOutcomesPath(this.repoRoot);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const outcomes: RunOutcome[] = [];
      for (const line of content.split("\n")) {
        if (line.trim()) {
          try {
            outcomes.push(JSON.parse(line));
          } catch (err) {
            console.error("[RunOutcomeWriter] Failed to parse outcome line:", err);
          }
        }
      }
      return outcomes;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return []; // File doesn't exist yet
      }
      throw err;
    }
  }

  /**
   * Filter outcomes by task type.
   */
  async readByTaskType(taskType: string): Promise<RunOutcome[]> {
    const all = await this.readAll();
    return all.filter((o) => o.taskType === taskType);
  }

  /**
   * Filter outcomes by outcome status.
   */
  async readByStatus(status: string): Promise<RunOutcome[]> {
    const all = await this.readAll();
    return all.filter((o) => o.outcome === status);
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────

const GLOBAL_KEY = "__run_outcome_writers__";

type WriterCache = Map<string, RunOutcomeWriter>;

function getWriterCache(): WriterCache {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<string, RunOutcomeWriter>();
  }
  return g[GLOBAL_KEY] as WriterCache;
}

/**
 * Get or create a RunOutcomeWriter for the given repo root.
 */
export function getRunOutcomeWriter(repoRoot: string): RunOutcomeWriter {
  const cache = getWriterCache();
  let writer = cache.get(repoRoot);
  if (!writer) {
    writer = new RunOutcomeWriter(repoRoot);
    cache.set(repoRoot, writer);
  }
  return writer;
}
