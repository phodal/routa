import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";

import {
  buildSyncedGitHubIssueDocument,
  findExistingSyncedGitHubIssueFile,
  getSyncedGitHubIssueFilename,
  slugifyGitHubIssueTitle,
  syncGitHubIssueToDirectory,
  type GitHubIssueSyncRecord,
} from "@/core/github/github-issue-sync";

function createIssue(overrides: Partial<GitHubIssueSyncRecord> = {}): GitHubIssueSyncRecord {
  return {
    number: 128,
    title: "Sync GitHub issues to local docs/issues for duplicate detection by Agent",
    body: "# Problem\n\nNeed local context.",
    labels: ["enhancement", "area:devops", "complexity:small"],
    author: "phodal",
    state: "OPEN",
    url: "https://github.com/phodal/routa/issues/128",
    createdAt: "2026-03-13T10:00:00Z",
    updatedAt: "2026-03-13T10:30:00Z",
    ...overrides,
  };
}

describe("github issue sync helpers", () => {
  it("slugifies issue titles consistently", () => {
    expect(slugifyGitHubIssueTitle("HARNESS DETECTOR / Kanban AGENT split???")).toBe(
      "harness-detector-kanban-agent-split",
    );
  });

  it("builds a stable synced filename", () => {
    expect(getSyncedGitHubIssueFilename(createIssue())).toBe(
      "2026-03-13-gh-128-sync-github-issues-to-local-docs-issues-for-duplicate-detection-by-agent.md",
    );
  });

  it("renders local docs/issues content with metadata and original body", () => {
    const content = buildSyncedGitHubIssueDocument(createIssue());

    expect(content).toContain('title: "[GitHub #128] Sync GitHub issues to local docs/issues for duplicate detection by Agent"');
    expect(content).toContain('status: open');
    expect(content).toContain('area: "devops"');
    expect(content).toContain('related_issues: ["https://github.com/phodal/routa/issues/128"]');
    expect(content).toContain("## Original GitHub Body");
    expect(content).toContain("Need local context.");
  });

  it("creates or updates a synced issue file", () => {
    const issuesDir = mkdtempSync(join(tmpdir(), "github-issue-sync-"));
    const result = syncGitHubIssueToDirectory(issuesDir, createIssue());

    expect(result.created).toBe(true);
    expect(result.updated).toBe(true);

    const content = readFileSync(result.absolutePath, "utf-8");
    expect(content).toContain("GitHub issue sync");
    expect(findExistingSyncedGitHubIssueFile(issuesDir, 128)).toBe(result.absolutePath);
  });

  it("renames an existing synced file when the issue title changes", () => {
    const issuesDir = mkdtempSync(join(tmpdir(), "github-issue-sync-"));
    const originalFilename = "2026-03-13-gh-128-old-title.md";
    writeFileSync(join(issuesDir, originalFilename), "old content", "utf-8");

    const result = syncGitHubIssueToDirectory(issuesDir, createIssue({ title: "New title for sync" }));

    expect(result.renamedFrom).toBe(originalFilename);
    expect(result.absolutePath).toMatch(/2026-03-13-gh-128-new-title-for-sync\.md$/);
    expect(readFileSync(result.absolutePath, "utf-8")).toContain("[GitHub #128] New title for sync");
  });
});
