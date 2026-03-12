import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ISSUES = 300;

export interface GitHubIssueLite {
  id: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  user?: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalIssueSnapshot {
  repo: string;
  syncedAt: string;
  issues: GitHubIssueLite[];
}

export interface DuplicateCandidate {
  issueNumber: number;
  title: string;
  htmlUrl: string;
  score: number;
  reason: string;
}

const memoryCache = new Map<string, { syncedAtMs: number; snapshot: LocalIssueSnapshot }>();

function snapshotDir(): string {
  const configured = process.env.ROUTA_GITHUB_ISSUE_SYNC_DIR;
  if (configured?.trim()) return configured;

  const fallback = path.join(process.cwd(), ".routa", "github-issues");
  if (process.cwd()) return fallback;
  return path.join(os.tmpdir(), "routa-github-issues");
}

function snapshotPath(repo: string): string {
  const safeRepo = repo.replace(/[^a-zA-Z0-9._-]+/g, "--");
  return path.join(snapshotDir(), `${safeRepo}.json`);
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "routa-github-issue-maintainer",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchIssues(repo: string, token: string, state: "open" | "all" = "open"): Promise<GitHubIssueLite[]> {
  const results: GitHubIssueLite[] = [];

  for (let page = 1; page <= 3; page += 1) {
    const url = new URL(`https://api.github.com/repos/${repo}/issues`);
    url.searchParams.set("state", state);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "updated");
    url.searchParams.set("direction", "desc");

    const response = await fetch(url, { headers: headers(token) });
    if (!response.ok) {
      throw new Error(`GitHub issue sync failed (${repo}): ${response.status} ${await response.text()}`);
    }

    const pageItems = await response.json() as Array<Record<string, unknown>>;
    const issues = pageItems
      .filter((item) => !item.pull_request)
      .map((item) => ({
        id: Number(item.id),
        number: Number(item.number),
        title: typeof item.title === "string" ? item.title : "",
        body: typeof item.body === "string" ? item.body : "",
        state: item.state === "closed" ? "closed" : "open",
        labels: Array.isArray(item.labels)
          ? item.labels
            .map((label) => (typeof label === "object" && label && "name" in label && typeof label.name === "string") ? label.name : "")
            .filter(Boolean)
          : [],
        assignees: Array.isArray(item.assignees)
          ? item.assignees
            .map((assignee) => (typeof assignee === "object" && assignee && "login" in assignee && typeof assignee.login === "string") ? assignee.login : "")
            .filter(Boolean)
          : [],
        user: typeof item.user === "object" && item.user && "login" in item.user && typeof item.user.login === "string"
          ? item.user.login
          : undefined,
        htmlUrl: typeof item.html_url === "string" ? item.html_url : "",
        createdAt: typeof item.created_at === "string" ? item.created_at : "",
        updatedAt: typeof item.updated_at === "string" ? item.updated_at : "",
      } satisfies GitHubIssueLite));

    results.push(...issues);
    if (pageItems.length < 100 || results.length >= MAX_ISSUES) break;
  }

  return results.slice(0, MAX_ISSUES);
}

export async function syncGitHubIssuesToLocal(options: {
  repo: string;
  token: string;
  state?: "open" | "all";
}): Promise<LocalIssueSnapshot> {
  const issues = await fetchIssues(options.repo, options.token, options.state ?? "open");
  const snapshot: LocalIssueSnapshot = {
    repo: options.repo,
    syncedAt: new Date().toISOString(),
    issues,
  };

  await fs.mkdir(snapshotDir(), { recursive: true });
  await fs.writeFile(snapshotPath(options.repo), JSON.stringify(snapshot, null, 2), "utf-8");
  memoryCache.set(options.repo, { syncedAtMs: Date.now(), snapshot });
  return snapshot;
}

export async function loadLocalIssueSnapshot(repo: string): Promise<LocalIssueSnapshot | null> {
  const cached = memoryCache.get(repo);
  if (cached && Date.now() - cached.syncedAtMs <= CACHE_TTL_MS) {
    return cached.snapshot;
  }

  try {
    const raw = await fs.readFile(snapshotPath(repo), "utf-8");
    const parsed = JSON.parse(raw) as LocalIssueSnapshot;
    if (!parsed || parsed.repo !== repo || !Array.isArray(parsed.issues)) return null;
    memoryCache.set(repo, { syncedAtMs: Date.now(), snapshot: parsed });
    return parsed;
  } catch {
    return null;
  }
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap / Math.max(a.size, b.size);
}

export function findDuplicateIssueCandidates(options: {
  currentIssue: Pick<GitHubIssueLite, "number" | "title" | "body">;
  issues: GitHubIssueLite[];
  limit?: number;
}): DuplicateCandidate[] {
  const titleTokens = tokenize(options.currentIssue.title);
  const bodyTokens = tokenize(options.currentIssue.body ?? "");

  const ranked = options.issues
    .filter((issue) => issue.number !== options.currentIssue.number)
    .map((issue) => {
      const issueTitleTokens = tokenize(issue.title);
      const issueBodyTokens = tokenize(issue.body ?? "");
      const titleScore = overlapScore(titleTokens, issueTitleTokens);
      const bodyScore = overlapScore(bodyTokens, issueBodyTokens);
      const hasPrefixMatch = options.currentIssue.title.toLowerCase().includes(issue.title.toLowerCase())
        || issue.title.toLowerCase().includes(options.currentIssue.title.toLowerCase());
      const score = hasPrefixMatch ? Math.max(titleScore, 0.95) : (titleScore * 0.8 + bodyScore * 0.2);

      return {
        issueNumber: issue.number,
        title: issue.title,
        htmlUrl: issue.htmlUrl,
        score,
        reason: hasPrefixMatch ? "title contains similar phrase" : `title=${titleScore.toFixed(2)}, body=${bodyScore.toFixed(2)}`,
      };
    })
    .filter((candidate) => candidate.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 5);

  return ranked;
}

export function buildMaintainerIssueTriagePrompt(options: {
  issue: GitHubIssueLite;
  duplicateCandidates: DuplicateCandidate[];
  snapshotSyncedAt?: string;
}): string {
  const duplicatesBlock = options.duplicateCandidates.length > 0
    ? options.duplicateCandidates
      .map((dupe, index) => `${index + 1}. #${dupe.issueNumber} ${dupe.title} (${dupe.reason}, score=${dupe.score.toFixed(2)}) ${dupe.htmlUrl}`)
      .join("\n")
    : "No strong duplicate candidates found in local synced issues.";

  return [
    "You are a maintainer-assistant backend agent for GitHub Issues.",
    "Goal: reduce maintainer workload by triaging this new issue with repository context.",
    "",
    "Must-do checklist:",
    "1) Judge if this issue duplicates existing issues. If yes, recommend adding label `duplicated` and mention target issue numbers.",
    "2) Cross-check likely related code paths and decide whether issue is valid.",
    "3) If answer is known from existing behavior/docs, draft a direct maintainer response.",
    "4) If not directly answerable, tag likely maintainer owners (by code area) and give analysis direction only.",
    "5) Add a short periodic-review note: how this issue should be revisited for future duplicate sweeps.",
    "",
    `Synced local issue snapshot time: ${options.snapshotSyncedAt ?? "unknown"}`,
    "",
    `New issue #${options.issue.number}: ${options.issue.title}`,
    `${options.issue.htmlUrl}`,
    options.issue.body ? `Body:\n${options.issue.body}` : "Body: (empty)",
    "",
    "Duplicate candidates from local synced issues:",
    duplicatesBlock,
    "",
    "Output format:",
    "- Duplicate assessment",
    "- Technical validity assessment",
    "- Maintainer reply draft",
    "- Suggested owners & analysis direction",
    "- Periodic review note",
  ].join("\n");
}
