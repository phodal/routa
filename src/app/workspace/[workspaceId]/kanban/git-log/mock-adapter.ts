/**
 * Mock adapter for the Git Log Panel — provides realistic sample data
 * so the UI can be developed and tested without a real git backend.
 */

import type {
  GitLogAdapter,
  GitLogPage,
  GitLogQuery,
  GitRefsResult,
  GitCommitDetail,
  GitCommit,
  GitRef,
  CommitFileChange,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha(n: number): string {
  return n.toString(16).padStart(40, "0");
}

function shortSha(n: number): string {
  return sha(n).slice(0, 7);
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const AUTHORS = [
  { name: "Phodal Huang", email: "phodal@example.com" },
  { name: "Alice Chen", email: "alice@example.com" },
  { name: "Bob Li", email: "bob@example.com" },
  { name: "Carol Wang", email: "carol@example.com" },
  { name: "GitHub Copilot", email: "copilot@users.noreply.github.com" },
];

function pickAuthor(i: number) {
  return AUTHORS[i % AUTHORS.length];
}

const MESSAGES: string[] = [
  "feat: add targeted revision prompt generation and update quality checklist",
  "feat: implement mandatory quality check process and AI review script",
  "feat: enhance quality checklist and writing guidelines for code-based articles",
  "feat: expand article archetypes and quality checklist to enhance clarity",
  "feat: enhance quality checklist and revision patterns to clarify authorial intent",
  "refactor: extract orchestration shell from kanban-tab",
  "fix: correct dark mode styling in session panel header",
  "chore: upgrade dependencies to latest stable versions",
  "feat: add infinite scroll to commit list component",
  "fix: resolve race condition in ACP provider warmup",
  "feat: implement branch selector with remote tracking",
  "docs: update ARCHITECTURE.md with new domain boundaries",
  "test: add characterization tests for kanban workflow",
  "feat: add Git log panel skeleton with mock adapter",
  "refactor: split long route handler into workflow branches",
  "fix: handle empty repository state gracefully",
  "feat: add commit graph lane calculation",
  "chore: clean up unused imports across kanban module",
  "feat: implement file diff preview in commit detail panel",
  "fix: prevent duplicate provider registration on reconnect",
  "Merge branch 'feature/git-log-panel' into main",
  "Merge pull request #376 from phodal/issue/dependency-upgrade",
  "feat: add search toolbar with text and hash filtering",
  "refactor: abstract git data layer behind adapter interface",
  "fix: correct i18n key for empty state message",
  "feat: add tag support to refs tree panel",
  "chore: remove deprecated API endpoints",
  "feat: implement commit detail with changed files list",
  "fix: restore scroll position after branch switch",
  "test: add unit tests for graph edge calculation",
];

function buildMockRefs(): { refs: GitRef[]; head: GitRef } {
  const head: GitRef = {
    name: "main",
    kind: "head",
    commitSha: sha(1),
    isCurrent: true,
  };

  const localBranches: GitRef[] = [
    { name: "main", kind: "local", commitSha: sha(1), isCurrent: true },
    { name: "feature/git-log-panel", kind: "local", commitSha: sha(3) },
    { name: "issue/dependency-upgrade", kind: "local", commitSha: sha(8) },
    { name: "fix/dark-mode-header", kind: "local", commitSha: sha(12) },
    { name: "refactor/kanban-split", kind: "local", commitSha: sha(15) },
  ];

  const remoteBranches: GitRef[] = [
    { name: "main", kind: "remote", remote: "origin", commitSha: sha(1) },
    { name: "feature/git-log-panel", kind: "remote", remote: "origin", commitSha: sha(4) },
    { name: "issue/dependency-upgrade", kind: "remote", remote: "origin", commitSha: sha(8) },
    { name: "develop", kind: "remote", remote: "origin", commitSha: sha(5) },
    { name: "release/v2.1", kind: "remote", remote: "upstream", commitSha: sha(10) },
  ];

  const tags: GitRef[] = [
    { name: "v2.0.0", kind: "tag", commitSha: sha(20) },
    { name: "v2.0.1", kind: "tag", commitSha: sha(14) },
    { name: "v2.1.0-rc.1", kind: "tag", commitSha: sha(5) },
  ];

  return { refs: [...localBranches, ...remoteBranches, ...tags], head };
}

function buildMockCommits(): GitCommit[] {
  const { refs } = buildMockRefs();
  const refsBySha = new Map<string, GitRef[]>();
  for (const r of refs) {
    const list = refsBySha.get(r.commitSha) ?? [];
    list.push(r);
    refsBySha.set(r.commitSha, list);
  }

  return Array.from({ length: MESSAGES.length }, (_, i) => {
    const idx = i + 1;
    const author = pickAuthor(i);
    const isMerge = MESSAGES[i].startsWith("Merge");
    const parents = isMerge
      ? [sha(idx + 1), sha(idx + 2)]
      : idx < MESSAGES.length
        ? [sha(idx + 1)]
        : [];

    // Simple lane assignment: main lane 0, merge commits lane 1
    const lane = isMerge ? 1 : 0;

    return {
      sha: sha(idx),
      shortSha: shortSha(idx),
      message: MESSAGES[i],
      summary: MESSAGES[i].split("\n")[0],
      authorName: author.name,
      authorEmail: author.email,
      authoredAt: daysAgo(i),
      parents,
      refs: refsBySha.get(sha(idx)) ?? [],
      lane,
      graphEdges: isMerge
        ? [
            { fromLane: 1, toLane: 0, isMerge: true },
            { fromLane: 1, toLane: 1 },
          ]
        : [{ fromLane: 0, toLane: 0 }],
    };
  });
}

const MOCK_FILE_CHANGES: Record<string, CommitFileChange[]> = {};

function getOrCreateFileChanges(commitSha: string): CommitFileChange[] {
  if (MOCK_FILE_CHANGES[commitSha]) return MOCK_FILE_CHANGES[commitSha];

  const hash = Number.parseInt(commitSha.slice(0, 8), 16);
  const count = (hash % 5) + 1;
  const files: CommitFileChange[] = [];

  const paths = [
    "src/app/workspace/kanban/kanban-tab.tsx",
    "src/client/components/button.tsx",
    "src/i18n/locales/en.ts",
    "src/i18n/locales/zh.ts",
    "crates/routa-server/src/api/mod.rs",
    "docs/ARCHITECTURE.md",
    "package.json",
    "src/core/git/git-utils.ts",
    "src/app/api/clone/branches/route.ts",
    "tailwind.config.ts",
  ];

  const statuses: CommitFileChange["status"][] = [
    "modified",
    "added",
    "deleted",
    "modified",
    "renamed",
  ];

  for (let i = 0; i < count; i++) {
    files.push({
      path: paths[(hash + i) % paths.length],
      status: statuses[(hash + i) % statuses.length],
      additions: ((hash + i * 7) % 80) + 1,
      deletions: ((hash + i * 3) % 40),
      ...(statuses[(hash + i) % statuses.length] === "renamed"
        ? { previousPath: paths[(hash + i + 1) % paths.length] }
        : {}),
    });
  }

  MOCK_FILE_CHANGES[commitSha] = files;
  return files;
}

// ---------------------------------------------------------------------------
// Mock Adapter
// ---------------------------------------------------------------------------

const allCommits = buildMockCommits();
const allRefsData = buildMockRefs();

export class MockGitAdapter implements GitLogAdapter {
  async getRefs(_repoPath: string): Promise<GitRefsResult> {
    const { refs, head } = allRefsData;
    return {
      head,
      local: refs.filter((r) => r.kind === "local"),
      remote: refs.filter((r) => r.kind === "remote"),
      tags: refs.filter((r) => r.kind === "tag"),
    };
  }

  async getLog(query: GitLogQuery): Promise<GitLogPage> {
    let filtered = [...allCommits];

    // Branch filter
    if (query.branches && query.branches.length > 0) {
      const branchShas = new Set(
        allRefsData.refs
          .filter((r) => query.branches!.includes(r.name))
          .map((r) => r.commitSha),
      );
      // In mock: just show commits whose sha matches any branch ref, plus all with lower index
      if (branchShas.size > 0) {
        const maxIdx = Math.max(
          ...Array.from(branchShas).map((s) =>
            allCommits.findIndex((c) => c.sha === s),
          ),
        );
        filtered = allCommits.slice(maxIdx >= 0 ? maxIdx : 0);
      }
    }

    // Text search
    if (query.search) {
      const q = query.search.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.summary.toLowerCase().includes(q) ||
          c.sha.startsWith(q) ||
          c.shortSha.startsWith(q) ||
          c.authorName.toLowerCase().includes(q),
      );
    }

    const total = filtered.length;
    const skip = query.skip ?? 0;
    const limit = query.limit ?? 30;
    const page = filtered.slice(skip, skip + limit);

    return {
      commits: page,
      total,
      hasMore: skip + limit < total,
    };
  }

  async getCommitDetail(
    _repoPath: string,
    commitSha: string,
  ): Promise<GitCommitDetail> {
    const commit = allCommits.find((c) => c.sha === commitSha) ?? allCommits[0];
    return {
      commit,
      files: getOrCreateFileChanges(commitSha),
    };
  }
}
