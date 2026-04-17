/**
 * Board-level Branch Rules
 *
 * Follows the established board config pattern (see board-auto-provider.ts,
 * board-session-supervision.ts for reference).
 *
 * Stored as JSON in workspace.metadata["kanbanBranchRules:{boardId}"].
 *
 * These rules define WHAT should happen; the branch resolution engine
 * (resolveBranchPlan) is the single authority that interprets them.
 */

// ─── Rule Types ─────────────────────────────────────────────────────

export type BranchBaseStrategy =
  | "codebase_default"     // Use the codebase's configured default branch
  | "dependency_inherit"   // Walk task.dependencies, use first unmerged dep's branch
  | "fixed";               // Always use a fixed branch name

export type BranchNamingTemplate =
  | "slug_id"              // {prefix}/{slug}-{shortId}  e.g. issue/login-abc123
  | "id_only"              // {prefix}/{shortId}          e.g. issue/abc123
  | "custom";              // User-defined template string

export type BranchCollisionStrategy =
  | "timestamp_suffix"     // Append base36 timestamp  (current default)
  | "increment"            // Append -2, -3, etc.
  | "fail";                // Throw immediately

export type BranchReopenDefaultStrategy =
  | "new"                  // Delete old branch, create new one
  | "reset";               // Keep branch, hard-reset to base

export interface KanbanBranchRules {
  /** Base branch resolution strategy */
  baseBranch: {
    strategy: BranchBaseStrategy;
    /** When strategy="fixed", use this branch name */
    fixedBranch?: string;
  };

  /** Branch naming conventions */
  naming: {
    /** Branch name prefix (e.g. "issue", "feat", "fix") */
    prefix: string;
    /** Naming template */
    template: BranchNamingTemplate;
    /** When template="custom", a pattern with {prefix}, {slug}, {shortId}, {column} placeholders */
    customTemplate?: string;
  };

  /** How to handle branch name collisions (applies to all creation, not just reopen) */
  collisionStrategy: BranchCollisionStrategy;

  /** What happens when a task is reopened */
  reopen: {
    /** Default strategy shown pre-selected in the modal */
    defaultStrategy: BranchReopenDefaultStrategy;
  };

  /** Post-merge lifecycle */
  lifecycle: {
    /** Delete the git branch after its PR is merged */
    deleteBranchOnMerge: boolean;
    /** Remove the worktree record after its PR is merged */
    removeWorktreeOnMerge: boolean;
    /** Rebase all dev-lane worktrees in the same repo after a merge */
    rebaseDownstream: boolean;
    /** Automatically create a Pull Request when a task completes the done-lane automation */
    autoCreatePullRequest: boolean;
  };

  /** Which columns trigger automatic worktree creation */
  triggers: {
    /** Column IDs where entering triggers worktree creation */
    worktreeCreationColumns: string[];
  };
}

// ─── Defaults ───────────────────────────────────────────────────────

export const DEFAULT_BRANCH_RULES: KanbanBranchRules = {
  baseBranch: {
    strategy: "dependency_inherit",
  },
  naming: {
    prefix: "issue",
    template: "slug_id",
  },
  collisionStrategy: "timestamp_suffix",
  reopen: {
    defaultStrategy: "new",
  },
  lifecycle: {
    deleteBranchOnMerge: true,
    removeWorktreeOnMerge: true,
    rebaseDownstream: true,
    autoCreatePullRequest: false,
  },
  triggers: {
    worktreeCreationColumns: ["dev"],
  },
};

// ─── Validation ─────────────────────────────────────────────────────

const VALID_BASE_STRATEGIES = new Set<BranchBaseStrategy>([
  "codebase_default",
  "dependency_inherit",
  "fixed",
]);

const VALID_TEMPLATES = new Set<BranchNamingTemplate>([
  "slug_id",
  "id_only",
  "custom",
]);

const VALID_COLLISION_STRATEGIES = new Set<BranchCollisionStrategy>([
  "timestamp_suffix",
  "increment",
  "fail",
]);

const VALID_REOPEN_STRATEGIES = new Set<BranchReopenDefaultStrategy>([
  "new",
  "reset",
]);

function normalizeString<T extends string>(
  value: unknown,
  valid: Set<T>,
  fallback: T,
): T {
  return valid.has(value as T) ? (value as T) : fallback;
}

function normalizeStringOptional(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : undefined;
  return trimmed || undefined;
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const filtered = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return filtered.length > 0 ? filtered : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Recursively partial — allows callers to specify only the fields they care
 * about at any nesting depth.
 */
type DeepPartial<T> = { [K in keyof T]?: DeepPartial<T[K]> };

export function normalizeBranchRules(
  raw: DeepPartial<KanbanBranchRules> | undefined,
): KanbanBranchRules {
  if (!raw) return { ...DEFAULT_BRANCH_RULES };

  const base = raw.baseBranch ?? {};
  const naming = raw.naming ?? {};
  const reopen = raw.reopen ?? {};
  const lifecycle = raw.lifecycle ?? {};
  const triggers = raw.triggers ?? {};

  return {
    baseBranch: {
      strategy: normalizeString(base.strategy, VALID_BASE_STRATEGIES, DEFAULT_BRANCH_RULES.baseBranch.strategy),
      fixedBranch: normalizeStringOptional(base.fixedBranch),
    },
    naming: {
      prefix: typeof naming.prefix === "string" && naming.prefix.trim()
        ? naming.prefix.trim()
        : DEFAULT_BRANCH_RULES.naming.prefix,
      template: normalizeString(naming.template, VALID_TEMPLATES, DEFAULT_BRANCH_RULES.naming.template),
      customTemplate: normalizeStringOptional(naming.customTemplate),
    },
    reopen: {
      defaultStrategy: normalizeString(reopen.defaultStrategy, VALID_REOPEN_STRATEGIES, DEFAULT_BRANCH_RULES.reopen.defaultStrategy),
    },
    collisionStrategy: normalizeString(raw.collisionStrategy, VALID_COLLISION_STRATEGIES, DEFAULT_BRANCH_RULES.collisionStrategy),
    lifecycle: {
      deleteBranchOnMerge: normalizeBoolean(lifecycle.deleteBranchOnMerge, DEFAULT_BRANCH_RULES.lifecycle.deleteBranchOnMerge),
      removeWorktreeOnMerge: normalizeBoolean(lifecycle.removeWorktreeOnMerge, DEFAULT_BRANCH_RULES.lifecycle.removeWorktreeOnMerge),
      rebaseDownstream: normalizeBoolean(lifecycle.rebaseDownstream, DEFAULT_BRANCH_RULES.lifecycle.rebaseDownstream),
      autoCreatePullRequest: normalizeBoolean(lifecycle.autoCreatePullRequest, DEFAULT_BRANCH_RULES.lifecycle.autoCreatePullRequest),
    },
    triggers: {
      worktreeCreationColumns: normalizeStringArray(triggers.worktreeCreationColumns, DEFAULT_BRANCH_RULES.triggers.worktreeCreationColumns),
    },
  };
}

// ─── Storage helpers ────────────────────────────────────────────────

function metadataKey(boardId: string): string {
  return `kanbanBranchRules:${boardId}`;
}

export function getKanbanBranchRules(
  metadata: Record<string, string> | undefined,
  boardId: string,
): KanbanBranchRules {
  const raw = metadata?.[metadataKey(boardId)];
  if (!raw) {
    return { ...DEFAULT_BRANCH_RULES };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<KanbanBranchRules>;
    return normalizeBranchRules(parsed);
  } catch {
    return { ...DEFAULT_BRANCH_RULES };
  }
}

export function setKanbanBranchRules(
  metadata: Record<string, string> | undefined,
  boardId: string,
  rules: DeepPartial<KanbanBranchRules> | undefined,
): Record<string, string> {
  const normalized = normalizeBranchRules(rules);
  return {
    ...(metadata ?? {}),
    [metadataKey(boardId)]: JSON.stringify(normalized),
  };
}

export function getDefaultBranchRules(): KanbanBranchRules {
  return { ...DEFAULT_BRANCH_RULES };
}
