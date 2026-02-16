import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/core/db/sqlite-schema.ts",
  out: "./drizzle-sqlite",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.SQLITE_DB_PATH ?? "routa.db",
  },
});
