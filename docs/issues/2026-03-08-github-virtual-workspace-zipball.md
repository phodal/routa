---
title: "GitHub Virtual Workspace - Zipball-based Repo Browsing for Serverless"
date: "2026-03-08"
status: resolved
severity: medium
area: "workspace"
tags: ["enhancement", "serverless", "github-integration", "vercel"]
reported_by: "Augment Agent"
related_issues: []
---

# GitHub Virtual Workspace — Zipball-based Repo Browsing

## What Happened

Currently, codebases in Routa require a local `repoPath` on disk. The `/api/clone` route uses `git clone` which causes several issues:

1. **Fails on serverless (Vercel)** — read-only filesystem, no `git` binary available
2. **Slow for read-only scenarios** — full clone with history is overkill for code review
3. **Disk space requirements** — proportional to repo size, problematic on serverless

The skills catalog already downloads GitHub zips for skill installation, but this pattern isn't available for general codebase/workspace browsing.

## Expected Behavior

Users should be able to:
- Import GitHub repos directly without local git clone
- Browse and review code on serverless deployments (Vercel)
- Use minimal disk space (or in-memory storage) for read-only operations
- Access both public and private repos (with GITHUB_TOKEN)

## Reproduction Context

- Environment: web (Vercel serverless deployment)
- Trigger: Attempt to clone a repo via `/api/clone` on Vercel
- Result: Fails due to read-only filesystem and missing git binary

## Why This Might Happen

- Serverless environments (Vercel, AWS Lambda) have read-only filesystems except `/tmp`
- Git binary is not available in standard Node.js runtime containers
- Current architecture assumes local filesystem with git installed
- No alternative code browsing mechanism exists for serverless

## Relevant Files

- `src/app/api/clone/route.ts` — Current git clone implementation
- `src/app/api/skills/catalog/route.ts` — Existing zipball download pattern
- `src/core/models/codebase.ts` — Codebase model definition
- `src/core/db/schema.ts` — Database schema

## Observations

- Skills catalog already successfully uses GitHub zipball API: `https://api.github.com/repos/{owner}/{repo}/zipball/{ref}`
- AdmZip library is already in dependencies for zip extraction
- `/tmp` directory is writable on most serverless platforms (with size limits)

## Root Cause Analysis

The current implementation has a hard dependency on:
1. Local filesystem with write permissions
2. Git binary availability
3. Full repository history (not needed for read-only browsing)

This makes it incompatible with serverless deployments where these assumptions don't hold.

## Resolution

### Proposed Solution: GitHub Virtual Workspace

Add a **GitHub Virtual Workspace** capability that downloads a repo's zipball and provides a virtual filesystem for browsing.

#### Architecture

```
POST /api/github/import { owner, repo, ref? }
  ↓
1. Download zipball from GitHub API
2. Extract to /tmp/routa-gh/{owner}--{repo}/ (or in-memory)
3. Build file index (VirtualFileTree)
4. Store index in memory/DB for fast lookup
5. Return workspace-compatible codebase entry

GET /api/github/tree?owner=X&repo=Y&ref=Z
  → { tree: VirtualFileEntry[] }

GET /api/github/file?owner=X&repo=Y&path=Z
  → { content: string, path: string }

GET /api/github/search?owner=X&repo=Y&q=Z
  → { files: FileMatch[] }
```

#### Key Design Decisions

1. **Dual storage strategy**: 
   - Extract to `/tmp` on serverless
   - Extract to `.routa/repos/` on desktop
   - Fallback to in-memory `Map<path, Buffer>` if writes fail

2. **Codebase model extension**: 
   - Add `sourceType?: "local" | "github"`
   - Add `sourceUrl?: string`
   - `repoPath` becomes the extracted temp path for GitHub sources

3. **Reuse existing patterns**: 
   - Follow zip download + AdmZip extraction from `skills/catalog/route.ts`

4. **File index for performance**: 
   - Build `VirtualFileTree` on import
   - Avoid re-scanning filesystem on each operation

5. **TTL-based cleanup**: 
   - GitHub workspace extractions get TTL (default 1h)
   - Cleanup function runs on access to evict stale entries

#### Changes Required

- `src/core/github/github-workspace.ts` — Core logic: download, extract, index
- `src/app/api/github/import/route.ts` — Import endpoint
- `src/app/api/github/tree/route.ts` — File tree endpoint
- `src/app/api/github/file/route.ts` — File content endpoint
- `src/app/api/github/search/route.ts` — File search endpoint
- `src/core/models/codebase.ts` — Add `sourceType` / `sourceUrl` fields
- Schema migration for `codebases` table (both Postgres and SQLite)

#### Non-Goals (v1)

- Writing back to GitHub (PRs, commits)
- Branch switching after import (re-import with different ref)
- Incremental updates (always full re-download)
- Private repo support without token (GITHUB_TOKEN env var required)

## References

- Existing zipball pattern: `src/app/api/skills/catalog/route.ts`
- GitHub API: https://docs.github.com/en/rest/repos/contents#download-a-repository-archive-zip

## Resolution

Resolved by the later GitHub virtual workspace implementation.

Evidence in the current repository:

- `src/core/github/github-workspace.ts` now implements zipball download, extraction to `/tmp`, in-memory registry/cache behavior, file indexing, tree browsing, file reads, search, and TTL cleanup.
- `src/app/api/github/import/route.ts` implements `POST /api/github/import`.
- The repository also exposes:
  - `GET /api/github`
  - `GET /api/github/tree`
  - `GET /api/github/file`
  - `GET /api/github/search`
- `src/core/models/codebase.ts` and the DB schemas now include `sourceType` and `sourceUrl`.
- `src/app/api/clone/route.ts` now explicitly falls back to GitHub zipball import when `git clone` is unavailable or fails.
- `docs/product-specs/FEATURE_TREE.md` lists the GitHub virtual workspace endpoints as shipped product surface.

This means the issue is no longer a proposal-only gap. The capability exists and is integrated into both the API surface and the codebase model.
