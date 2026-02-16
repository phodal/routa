/**
 * Database Connection — Neon Serverless + Drizzle ORM
 *
 * Connection is lazy-initialized and cached for the lifetime of the process.
 * In Next.js dev mode, the instance survives HMR via globalThis.
 *
 * Required env var: DATABASE_URL (Neon connection string)
 */

import { neon } from "@neondatabase/serverless";
import { drizzle, NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Database = NeonHttpDatabase<typeof schema>;

const GLOBAL_KEY = "__routa_db__";

export function getDatabase(): Database {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL environment variable is required. " +
        "Set it in .env.local for local dev or in Vercel project settings for production."
      );
    }
    const sql = neon(databaseUrl);
    g[GLOBAL_KEY] = drizzle(sql, { schema });
  }
  return g[GLOBAL_KEY] as Database;
}

/**
 * Check if a database URL is configured.
 * Used by the system factory to decide between Postgres and InMemory stores.
 */
export function isDatabaseConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}
