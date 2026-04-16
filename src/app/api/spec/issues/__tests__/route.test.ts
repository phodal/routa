import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const system = {
  codebaseStore: {
    get: vi.fn(),
    listByWorkspace: vi.fn(),
  },
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

import { GET } from "../route";

async function createTempRepo(): Promise<string> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "routa-spec-route-"));
  await mkdir(path.join(repoRoot, "docs", "issues"), { recursive: true });
  return repoRoot;
}

describe("/api/spec/issues route", () => {
  it("lists issues, normalizes YAML dates, and maps closed items to resolved", async () => {
    const repoRoot = await createTempRepo();

    try {
      await writeFile(
        path.join(repoRoot, "docs", "issues", "2026-04-11-spec-board.md"),
        `---
title: Spec board
date: 2026-04-11
kind: progress_note
status: closed
severity: high
area: ui
tags: [spec, board]
reported_by: codex
related_issues: ["https://github.com/phodal/routa/issues/410"]
github_issue: "410"
github_state: closed
github_url: https://github.com/phodal/routa/issues/410
---

# Spec board

Rendered as markdown.
`,
      );
      await writeFile(
        path.join(repoRoot, "docs", "issues", "2026-04-10-older.md"),
        `---
title: Older issue
date: "2026-04-10"
status: open
severity: medium
---

Older body.
`,
      );
      await writeFile(
        path.join(repoRoot, "docs", "issues", "_template.md"),
        "---\ntitle: Template\n---\n",
      );
      await writeFile(
        path.join(repoRoot, "docs", "issues", "2026-04-09-malformed.md"),
        "not frontmatter",
      );

      const response = await GET(new NextRequest(
        `http://localhost/api/spec/issues?repoPath=${encodeURIComponent(repoRoot)}`,
      ));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.repoRoot).toBe(repoRoot);
      expect(payload.issues).toHaveLength(2);
      expect(payload.issues.map((issue: { filename: string }) => issue.filename)).toEqual([
        "2026-04-11-spec-board.md",
        "2026-04-10-older.md",
      ]);
      expect(payload.issues[0]).toMatchObject({
        title: "Spec board",
        date: "2026-04-11",
        kind: "progress_note",
        status: "resolved",
        severity: "high",
        area: "ui",
        reportedBy: "codex",
        githubIssue: 410,
        githubState: "closed",
        githubUrl: "https://github.com/phodal/routa/issues/410",
        relatedIssues: ["https://github.com/phodal/routa/issues/410"],
      });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns 400 when repoPath is invalid", async () => {
    const missingRepoRoot = path.join(tmpdir(), "routa-spec-route-missing");
    const response = await GET(new NextRequest(
      `http://localhost/api/spec/issues?repoPath=${encodeURIComponent(missingRepoRoot)}`,
    ));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("repoPath");
  });
});
