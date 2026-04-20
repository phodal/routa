---
title: "Test git credentials leaked into production commits before commit validation"
date: "2026-04-06"
status: investigating
severity: medium
area: "git"
tags: ["git", "credentials", "commit", "safety", "cleanup"]
reported_by: "agent"
related_issues: []
---

# Test Git Credentials Leaking to Production Commits

**Date**: 2026-04-06  
**Severity**: Medium  
**Status**: Fixed (prevention), Cleanup pending

## Problem

Test git credentials (`Routa Test <test@example.com>`) were appearing in production commits on real branches, including commits that were pushed to the repository.

### Root Cause

The `git_commit` tool in `workspace-tools.ts` did not validate git user configuration before creating commits. When AI agents used this tool:

1. If the agent operated in a directory with test git config (e.g., a test repo that wasn't properly cleaned up)
2. Or if somehow test config leaked to the user's repo
3. The commit would be created with whatever `user.name` and `user.email` were set in that directory

This resulted in at least **12 production commits** with test credentials across multiple branches.

## Affected Commits

```
d72a6631 - docs: add project summary and demo report (feat/evolution-pattern-extraction)
dd1c71de - update (origin/issue-283-implementation-plan)
10fce88f - initial
b615af8a - fix(kanban): recover session metadata and collapse task prompts
ac71f2db - feat(kanban): compact session run status with icons
c7561e65 - fix(acp): persist selected provider across pages
86038855 - fix(kanban): preserve provider on github imports
0bf08b86 - fix(chat): keep send visible for opencode composer
02e8b0ed - fix(kanban): preserve customized review automation
71a46319 - fix(db): ensure default sqlite workspace exists
abaf8c09 - update (pr-289)
3a5e3612 - initial
```

## Fix Applied

### 1. Git Commit Validation (commit: a75a2901)

Added validation to `src/core/tools/workspace-tools.ts` `gitCommit()` function:

- ✅ Check git `user.name` and `user.email` before committing
- ✅ Block commits with test/placeholder credentials:
  - `test@example.com`
  - `Routa Test`
  - `Test`
  - `placeholder`
- ✅ Return clear error message with instructions to configure git identity
- ✅ Include author info in success result for auditability

### 2. Test Repository Scoping (commit: a75a2901)

Updated all test files to use `--local` flag when setting git config:

- `crates/routa-core/src/trace/vcs.rs`
- `crates/routa-server/tests/rust_api_end_to_end.rs`
- `crates/routa-core/src/git.rs`
- `src/core/review/__tests__/review-analysis.test.ts`

This ensures test credentials are scoped to the temporary test repository only and cannot leak to other repositories.

### 3. RAII Test Cleanup (commit: 6fb9add0)

Improved test repository cleanup using Rust's RAII pattern:

- ✅ Use `TempDir` instead of manual `fs::remove_dir_all`
- ✅ Automatic cleanup even on test panic or early return
- ✅ Prevents `/tmp` directory pollution from failed tests

**Before**: Manual cleanup only on successful test completion
```rust
let repo_path = random_repo_path();
// ... test code ...
let _ = fs::remove_dir_all(&repo_path); // May not run if test panics
```

**After**: Automatic cleanup via RAII
```rust
let (_temp_dir, repo_path) = create_temp_repo();
// ... test code ...
// _temp_dir automatically cleaned when it goes out of scope
```

## Cleanup Options

### Option 1: Leave as-is (Recommended)

- Commits are on feature branches and old PRs
- Most are not in main branch history
- Git history rewrite is risky and affects collaborators
- The author metadata is cosmetic and doesn't affect functionality

### Option 2: Rewrite History (High Risk)

If absolutely necessary to clean up author information:

```bash
# WARNING: Only for commits not yet pushed to main
git filter-branch --env-filter '
if [ "$GIT_AUTHOR_EMAIL" = "test@example.com" ]; then
    export GIT_AUTHOR_NAME="Your Name"
    export GIT_AUTHOR_EMAIL="your.email@example.com"
    export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
    export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
fi
' --tag-name-filter cat -- --branches --tags
```

**Do NOT rewrite main branch history** - this will cause issues for all contributors.

### Option 3: Amend Recent Commits

For very recent commits not yet pushed:

```bash
git commit --amend --author="Your Name <your.email@example.com>" --no-edit
```

## Prevention

Going forward, this issue is prevented by:

1. ✅ Validating git identity before every commit
2. ✅ Blocking test credentials
3. ✅ Providing clear error messages
4. ✅ All test repos use `--local` config scope
5. ✅ RAII-based automatic cleanup of test repositories

## Recommendation

**Accept the cosmetic issue** - the commits are valid code changes, just with incorrect author metadata. Focus on preventing future occurrences (already implemented).

If any of these commits are in PR branches that need to be merged to main, consider:
- Squash merge (GitHub default) - this will use the merger's credentials
- Or amend just before merge if absolutely necessary

## Related Files

- `src/core/tools/workspace-tools.ts` - Git commit tool with validation
- Test files using git config in Rust and TypeScript
- `.git/config` - User's actual git configuration (verified correct)

## Verification

Run this to confirm no new test commits can be created:

```bash
# This should fail with a clear error message
cd /tmp
mkdir test-repo && cd test-repo
git init
git config --local user.name "Routa Test"
git config --local user.email "test@example.com"
echo "test" > test.txt
git add test.txt

# Try using the git_commit tool through MCP/ACP
# It should reject the commit with a validation error
```
