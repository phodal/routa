---
name: release
description: Automate the Routa release preparation workflow from version sync through release note and blog generation. Use when the user wants to prepare, publish, or dry-run a Routa release.
license: MIT
compatibility: Requires node, git, and optional ACP provider access for AI changelog summaries.
metadata:
  short-description: Prepare Routa release artifacts and guide the final publish flow
allowed-tools:
  - Bash
  - Read
  - Write
---

Prepare Routa releases with the existing repo scripts. Keep the workflow deterministic until human confirmation is needed for commit, tag, or push.

## When to use

- The user asks to release Routa, publish a version, prepare release notes, or generate a release blog post.
- The task needs synchronized version bumps plus `docs/releases/` artifacts.

## Workflow

1. Confirm the target version and whether the user wants a dry run or an actual publish.
2. If a release summary already exists, pass it with `--summary-file`. If the user wants AI-generated summary copy, add `--ai` and optionally `--ai-provider <name>`.
3. Run the helper:

```bash
node scripts/release/prepare-release-artifacts.mjs <version>
node scripts/release/prepare-release-artifacts.mjs <version> --from <previous-tag> --ai --ai-provider claude
```

4. Review the generated files:
   - `docs/releases/v<version>-release-notes.md`
   - `docs/releases/v<version>-changelog.md`
   - `dist/release/changelog-summary-prompt.json`
5. If the user only wants preparation, stop after review and validation.
6. If the user wants to publish, continue with either:

```bash
./scripts/release/publish.sh <version>
```

or the manual flow documented in `docs/release-guide.md`.

## Guardrails

- Do not tag or push without explicit user confirmation.
- Do not discard unrelated worktree changes.
- Prefer `docs/releases/v<version>-release-notes.md` as the blog/release-note source of truth after generation.
- If `git status --porcelain` is not clean and the task is a real publish, call that out before invoking `publish.sh`.

## References

- Read `references/release-workflow.md` for the step-by-step release decision tree.
- Read `docs/release-guide.md` when the task needs the full publish or verification checklist.
