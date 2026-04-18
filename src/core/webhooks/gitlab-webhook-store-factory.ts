/**
 * GitLab Webhook Store Factory
 *
 * Returns the appropriate GitLab webhook store based on the current DB driver.
 * Uses the same singleton pattern as getGitHubWebhookStore().
 */

import type { GitLabWebhookStore } from "../store/gitlab-webhook-store";

const GLOBAL_KEY = "__routa_gitlab_webhook_store__";

export function getGitLabWebhookStore(): GitLabWebhookStore {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    const { getDatabaseDriver } = require("../db/index") as typeof import("../db/index");
    const driver = getDatabaseDriver();

    if (driver === "postgres") {
      const { getPostgresDatabase } = require("../db/index") as typeof import("../db/index");
      const { PgGitLabWebhookStore } = require("../store/gitlab-webhook-store") as typeof import("../store/gitlab-webhook-store");
      const db = getPostgresDatabase();
      g[GLOBAL_KEY] = new PgGitLabWebhookStore(db);
    } else if (driver === "sqlite") {
      try {
        const { getSqliteDatabase } = require("../db/sqlite") as typeof import("../db/sqlite");
        const { SqliteGitLabWebhookStore } = require("../store/gitlab-webhook-store") as typeof import("../store/gitlab-webhook-store");
        const db = getSqliteDatabase();
        g[GLOBAL_KEY] = new SqliteGitLabWebhookStore(db);
      } catch {
        const { InMemoryGitLabWebhookStore } = require("../store/gitlab-webhook-store") as typeof import("../store/gitlab-webhook-store");
        g[GLOBAL_KEY] = new InMemoryGitLabWebhookStore();
      }
    } else {
      const { InMemoryGitLabWebhookStore } = require("../store/gitlab-webhook-store") as typeof import("../store/gitlab-webhook-store");
      g[GLOBAL_KEY] = new InMemoryGitLabWebhookStore();
    }
  }
  return g[GLOBAL_KEY] as GitLabWebhookStore;
}
