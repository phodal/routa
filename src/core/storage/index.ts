/**
 * Storage Module — Unified storage layer for sessions and traces.
 *
 * Provides factory functions that return the appropriate provider
 * based on the current environment (local vs serverless).
 */

export * from "./types";
export * from "./folder-slug";
export * from "./jsonl-writer";
export * from "./local-session-provider";
export * from "./local-trace-provider";
export * from "./remote-session-provider";
export * from "./remote-trace-provider";
export * from "./migration-tool";
export * from "./history-compactor";
export * from "./tool-call-context-writer";
export * from "./agent-memory-writer";

import { LocalSessionProvider } from "./local-session-provider";
import { LocalTraceProvider } from "./local-trace-provider";
import { RemoteSessionProvider } from "./remote-session-provider";
import { RemoteTraceProvider } from "./remote-trace-provider";
import { MigrationTool } from "./migration-tool";
import type { SessionStorageProvider, TraceStorageProvider } from "./types";

function isServerless(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Get the appropriate session storage provider.
 *
 * - Serverless (Vercel): RemoteSessionProvider (Postgres)
 * - Desktop/Local: LocalSessionProvider (JSONL files in ~/.routa/)
 */
export function getSessionStorageProvider(
  projectPath: string
): SessionStorageProvider {
  if (isServerless()) {
    const { getDatabaseDriver, getPostgresDatabase } = require("../db/index");
    if (getDatabaseDriver() === "postgres") {
      const db = getPostgresDatabase();
      return new RemoteSessionProvider(db);
    }
  }
  return new LocalSessionProvider(projectPath);
}

/**
 * Get the appropriate trace storage provider.
 *
 * - Serverless (Vercel): RemoteTraceProvider (Postgres)
 * - Desktop/Local: LocalTraceProvider (JSONL files in ~/.routa/)
 */
export function getTraceStorageProvider(
  projectPath: string
): TraceStorageProvider {
  if (isServerless()) {
    const { getDatabaseDriver, getPostgresDatabase } = require("../db/index");
    if (getDatabaseDriver() === "postgres") {
      const db = getPostgresDatabase();
      return new RemoteTraceProvider(db);
    }
  }
  return new LocalTraceProvider(projectPath);
}

/**
 * Run trace migration on startup (safe to call multiple times).
 */
export async function runMigrationIfNeeded(
  projectPath: string
): Promise<void> {
  if (isServerless()) return; // No local migration needed in serverless
  const tool = new MigrationTool(projectPath);
  await tool.migrateTraces();
}
