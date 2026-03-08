CREATE TABLE "worktrees" (
    "id"              TEXT PRIMARY KEY NOT NULL,
    "codebase_id"     TEXT NOT NULL REFERENCES "codebases"("id") ON DELETE CASCADE,
    "workspace_id"    TEXT NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "worktree_path"   TEXT NOT NULL,
    "branch"          TEXT NOT NULL,
    "base_branch"     TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'creating',
    "session_id"      TEXT,
    "label"           TEXT,
    "error_message"   TEXT,
    "created_at"      TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    "updated_at"      TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX "idx_worktrees_workspace" ON "worktrees" ("workspace_id");
CREATE INDEX "idx_worktrees_codebase" ON "worktrees" ("codebase_id");
CREATE UNIQUE INDEX "uq_worktrees_codebase_branch" ON "worktrees" ("codebase_id", "branch");
CREATE UNIQUE INDEX "uq_worktrees_path" ON "worktrees" ("worktree_path");
