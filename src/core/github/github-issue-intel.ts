import { execSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export interface GitHubIssueRecord {
  number: number;
  title: string;
  body?: string;
  state: "OPEN" | "CLOSED" | string;
  url: string;
  createdAt?: string;
  updatedAt?: string;
  labels?: Array<{ name: string }>;
  author?: { login: string };
}

export interface DuplicateCandidate {
  number: number;
  title: string;
  url: string;
  state: string;
  score: number;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "when", "into", "after", "issue", "error",
  "task", "bug", "about", "while", "then", "does", "have", "been", "are", "was", "were", "not", "can",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[`*_#()[\]{}:;,.!?/\\|<>="']/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
  );
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const token of a) {
    if (b.has(token)) intersect += 1;
  }
  const union = a.size + b.size - intersect;
  return union > 0 ? intersect / union : 0;
}

export function findDuplicateCandidates(
  target: Pick<GitHubIssueRecord, "title" | "body" | "number">,
  issues: GitHubIssueRecord[],
  maxCandidates = 5,
): DuplicateCandidate[] {
  const targetTokens = tokenize(`${target.title}\n${target.body ?? ""}`);
  return issues
    .filter((issue) => issue.number !== target.number)
    .map((issue) => ({
      issue,
      score: similarity(targetTokens, tokenize(`${issue.title}\n${issue.body ?? ""}`)),
    }))
    .filter((item) => item.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates)
    .map((item) => ({
      number: item.issue.number,
      title: item.issue.title,
      url: item.issue.url,
      state: item.issue.state,
      score: Number(item.score.toFixed(3)),
    }));
}

export function syncGitHubIssues(repo: string, outputFile: string, limit = 200): GitHubIssueRecord[] {
  const cmd = [
    "gh issue list",
    `--repo ${repo}`,
    "--state all",
    `--limit ${limit}`,
    "--json number,title,body,state,url,labels,author,createdAt,updatedAt",
  ].join(" ");

  const raw = execSync(cmd, { encoding: "utf-8", cwd: process.cwd() });
  const issues = JSON.parse(raw) as GitHubIssueRecord[];

  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, JSON.stringify({ repo, syncedAt: new Date().toISOString(), issues }, null, 2), "utf-8");

  return issues;
}

export function loadSyncedGitHubIssues(outputFile: string): GitHubIssueRecord[] {
  const content = readFileSync(outputFile, "utf-8");
  const parsed = JSON.parse(content) as { issues?: GitHubIssueRecord[] };
  return parsed.issues ?? [];
}

export function defaultIssueCachePath(repo: string): string {
  const safeRepo = repo.replace("/", "__");
  return join(process.cwd(), ".cache", "github-issues", `${safeRepo}.json`);
}
