---
title: Git Commit Safety Mechanism
---

# Git Commit Safety Mechanism

**Date**: 2026-04-06
**Status**: Design
**Context**: Prevent test credentials from leaking to production commits

## Problem Analysis

### Root Causes

1. **Application Layer**: `git_commit` tool didn't validate credentials
2. **Test Layer**: Test repos shared credential namespace with production repo
3. **Repository Layer**: No pre-commit hooks to block suspicious commits
4. **CI/CD Layer**: No pipeline validation of commit metadata
5. **Monitoring Layer**: No detection of suspicious commits post-merge

### Attack Surface

```
┌─────────────────────────────────────────────────────────────┐
│ How Test Credentials Can Leak                              │
├─────────────────────────────────────────────────────────────┤
│ 1. AI Agent uses git_commit tool in wrong directory        │
│ 2. Test runs in production repo directory                  │
│ 3. Test crashes without cleanup, leaves git config         │
│ 4. Developer manually runs test code in production repo    │
│ 5. Worktree created from test template                     │
│ 6. Git config --global accidentally set during tests       │
└─────────────────────────────────────────────────────────────┘
```

## Defense in Depth Strategy

```
Layer 1: Prevention (Before Commit)
Layer 2: Detection (At Commit Time)
Layer 3: Rejection (Pre-Push)
Layer 4: Validation (CI/CD)
Layer 5: Monitoring (Post-Merge)
```

## Layer 1: Prevention (Before Commit)

### 1.1 Application-Level Validation ✅ (Already Implemented)

**File**: `src/core/tools/workspace-tools.ts`

```typescript
// Validate before every commit
- Block test@example.com
- Block "Routa Test", "Test", "placeholder"
- Require valid git identity
```

### 1.2 Test Framework Isolation

**Principle**: Tests should NEVER touch production git config

```rust
// Enforce test isolation pattern
pub struct IsolatedGitRepo {
    _temp_dir: TempDir,
    pub path: PathBuf,
}

impl IsolatedGitRepo {
    pub fn new() -> Self {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().to_path_buf();

        // Initialize with LOCAL config only
        run_git(&path, &["init"]);
        run_git(&path, &["config", "--local", "user.name", "Routa Test"]);
        run_git(&path, &["config", "--local", "user.email", "test@example.com"]);

        Self { _temp_dir: temp_dir, path }
    }

    // Prevent access to production repo
    pub fn assert_isolated(&self) {
        assert!(self.path.starts_with(std::env::temp_dir()));
    }
}
```

### 1.3 Environment Detection

```typescript
// Detect if running in test context
function isTestEnvironment(): boolean {
    return (
        process.env.NODE_ENV === 'test' ||
        process.env.VITEST === 'true' ||
        process.env.JEST_WORKER_ID !== undefined ||
        // Rust test detection
        process.env.CARGO_TEST === 'true'
    );
}

// Block test credentials in production context
async function validateGitCommitContext(cwd: string) {
    if (!isTestEnvironment() && isTestCredential(cwd)) {
        throw new Error(
            'Test credentials detected in production environment. ' +
            'This indicates a test isolation failure.'
        );
    }
}
```

## Layer 2: Detection (At Commit Time)

### 2.1 Git Pre-Commit Hook

**File**: `.husky/pre-commit`

```bash
#!/usr/bin/env sh

# Validate commit author before allowing commit
AUTHOR_NAME=$(git config user.name)
AUTHOR_EMAIL=$(git config user.email)

# Block test credentials
if echo "$AUTHOR_EMAIL" | grep -qi "test@example\.com"; then
    echo "❌ COMMIT BLOCKED: Test email detected"
    echo "   Found: $AUTHOR_EMAIL"
    echo ""
    echo "   Configure your real git identity:"
    echo "   git config user.name \"Your Name\""
    echo "   git config user.email \"your.email@example.com\""
    exit 1
fi

if echo "$AUTHOR_NAME" | grep -qi "routa test"; then
    echo "❌ COMMIT BLOCKED: Test name detected"
    echo "   Found: $AUTHOR_NAME"
    exit 1
fi

# Require valid email format
if ! echo "$AUTHOR_EMAIL" | grep -qE "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"; then
    echo "❌ COMMIT BLOCKED: Invalid email format"
    echo "   Found: $AUTHOR_EMAIL"
    exit 1
fi
```

### 2.2 Commit Message Validation



## Layer 3: Rejection (Pre-Push)

### 3.1 Git Pre-Push Hook

**File**: `.husky/pre-push`

```bash
#!/usr/bin/env sh

# Scan all commits being pushed for suspicious authors
REMOTE="$1"
URL="$2"

# Get list of commits to be pushed
while read local_ref local_sha remote_ref remote_sha; do
    if [ "$local_sha" != "0000000000000000000000000000000000000000" ]; then
        # Check commits from remote_sha to local_sha
        RANGE="$remote_sha..$local_sha"

        # Find commits with test credentials
        SUSPICIOUS=$(git log "$RANGE" --format="%H %ae %an" | \
            grep -iE "(test@example\.com|routa test)" || true)

        if [ -n "$SUSPICIOUS" ]; then
            echo "❌ PUSH BLOCKED: Commits with test credentials detected"
            echo ""
            echo "$SUSPICIOUS" | while read hash email name; do
                echo "  Commit: $hash"
                echo "  Author: $name <$email>"
                echo ""
            done
            echo "Fix these commits before pushing:"
            echo "  git rebase -i origin/main"
            echo "  # Mark commits for 'edit', then:"
            echo "  git commit --amend --author=\"Your Name <your@email.com>\""
            exit 1
        fi
    fi
done

echo "✅ Push validation passed"
```

### 3.2 Server-Side Pre-Receive Hook

For self-hosted repositories, add server-side validation:

```bash
#!/bin/bash
# .git/hooks/pre-receive (on server)

while read oldrev newrev refname; do
    # Scan all commits in push
    for commit in $(git rev-list $oldrev..$newrev); do
        AUTHOR_EMAIL=$(git log -1 --format=%ae $commit)
        AUTHOR_NAME=$(git log -1 --format=%an $commit)

        if echo "$AUTHOR_EMAIL" | grep -qi "test@example\.com"; then
            echo "ERROR: Push rejected - commit $commit has test email"
            exit 1
        fi

        if echo "$AUTHOR_NAME" | grep -qi "routa test"; then
            echo "ERROR: Push rejected - commit $commit has test name"
            exit 1
        fi
    done
done
```

## Layer 4: CI/CD Validation

### 4.1 GitHub Actions Validation

**File**: `.github/workflows/defense.yml`

```yaml
jobs:
  validate-commit-metadata:
    name: "Validate Commit Metadata"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history

      - name: Check for test credentials in commits
        run: |
          # Check all commits in PR
          BASE_SHA="${{ github.event.pull_request.base.sha }}"
          HEAD_SHA="${{ github.event.pull_request.head.sha }}"

          if [ -n "$BASE_SHA" ]; then
            RANGE="$BASE_SHA..$HEAD_SHA"
          else
            RANGE="HEAD~10..HEAD"  # Last 10 commits for push
          fi

          echo "Checking commits in range: $RANGE"

          SUSPICIOUS=$(git log "$RANGE" --format="%H %ae %an" | \
            grep -iE "(test@example\.com|routa test|placeholder)" || true)

          if [ -n "$SUSPICIOUS" ]; then
            echo "❌ Test credentials found in commits:"
            echo "$SUSPICIOUS"
            exit 1
          fi

          echo "✅ All commits have valid author metadata"

      - name: Validate email domains
        run: |
          # Optional: enforce company email domain
          INVALID=$(git log "$RANGE" --format="%ae" | \
            grep -vE "@(gmail|github|users.noreply.github|phodal)\.com$" || true)

          if [ -n "$INVALID" ]; then
            echo "⚠️  Warning: Unexpected email domains: $INVALID"
            # Don't fail, just warn
          fi
```

### 4.2 Pre-Merge Validation

```yaml
  block-merge-if-test-credentials:
    name: "Block Merge - Test Credentials"
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4

      - name: Scan PR commits
        id: scan
        run: |
          # More strict for PR merge
          if git log origin/${{ github.base_ref }}..${{ github.sha }} \
             --format="%ae %an" | grep -qiE "(test@example|routa test)"; then
            echo "has_test_creds=true" >> $GITHUB_OUTPUT
          else
            echo "has_test_creds=false" >> $GITHUB_OUTPUT
          fi

      - name: Block merge
        if: steps.scan.outputs.has_test_creds == 'true'
        run: |
          echo "::error::PR contains commits with test credentials"
          echo "::error::These commits must be amended before merge"
          exit 1
```

## Layer 5: Monitoring & Alerts

### 5.1 Post-Merge Detection

```typescript
// scripts/check-commit-history.ts
import { execSync } from 'child_process';

async function scanRecentCommits(days = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const commits = execSync(
        `git log --since="${since.toISOString()}" --format="%H|%ae|%an"`,
        { encoding: 'utf-8' }
    ).trim().split('\n');

    const suspicious = commits.filter(line => {
        const [hash, email, name] = line.split('|');
        return (
            email.includes('test@example.com') ||
            name.toLowerCase().includes('routa test') ||
            name.toLowerCase() === 'test'
        );
    });

    if (suspicious.length > 0) {
        await sendAlert({
            severity: 'HIGH',
            title: 'Test credentials detected in git history',
            commits: suspicious,
            action: 'Review and amend commits immediately'
        });
    }
}
```

### 5.2 Daily Scheduled Check

**File**: `.github/workflows/daily-health-check.yml`

```yaml
name: Daily Repository Health Check

on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM daily
  workflow_dispatch:

jobs:
  check-git-history:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Scan last 30 days for test credentials
        run: |
          SUSPICIOUS=$(git log --since="30 days ago" --format="%H %ae %an" | \
            grep -iE "(test@example\.com|routa test)" || true)

          if [ -n "$SUSPICIOUS" ]; then
            echo "⚠️  Test credentials found in recent history:"
            echo "$SUSPICIOUS"

            # Create GitHub issue
            gh issue create \
              --title "🚨 Test credentials detected in git history" \
              --body "Found commits with test credentials in last 30 days" \
              --label "security,git-hygiene"
          fi
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Implementation Roadmap

### Phase 1: Immediate (Already Done ✅)
- ✅ Application-level validation in `git_commit` tool
- ✅ Test isolation with `--local` config
- ✅ RAII cleanup with `TempDir`

### Phase 2: Git Hooks (High Priority)
- [ ] Add pre-commit hook to block test credentials
- [ ] Add pre-push hook to scan commit history
- [ ] Update `.husky/` hooks with validation

### Phase 3: CI/CD Gates (High Priority)
- [ ] Add commit metadata validation to Defense workflow
- [ ] Add pre-merge validation for PRs
- [ ] Block merge if test credentials detected

### Phase 4: Monitoring (Medium Priority)
- [ ] Daily scheduled health check
- [ ] Alert on suspicious commits
- [ ] Auto-create issues for violations

### Phase 5: Test Framework (Medium Priority)
- [ ] Create `IsolatedGitRepo` helper in Rust
- [ ] Create `createTestRepo()` helper in TypeScript
- [ ] Enforce usage in test guidelines

## Configuration

### Blocked Patterns

**File**: `scripts/git-safety-config.json`

```json
{
  "blockedEmails": [
    "test@example.com",
    "noreply@test.com",
    "placeholder@example.com"
  ],
  "blockedNames": [
    "routa test",
    "test",
    "placeholder",
    "example user"
  ],
  "allowedDomains": [
    "gmail.com",
    "github.com",
    "users.noreply.github.com"
  ],
  "strictMode": false
}
```

## Testing the Safety Mechanism

### Manual Test

```bash
# 1. Try to commit with test credentials
cd /tmp
mkdir test-safety
cd test-safety
git init
git config --local user.name "Routa Test"
git config --local user.email "test@example.com"
echo "test" > file.txt
git add file.txt
git commit -m "test"  # Should be BLOCKED by pre-commit hook

# 2. Try to use git_commit tool with test creds
# Should fail with validation error
```

### Automated Test

```typescript
// tests/git-safety.test.ts
describe('Git Safety Mechanism', () => {
    it('blocks commits with test email', async () => {
        const tempRepo = createTempRepo();
        await execAsync('git config --local user.email test@example.com', { cwd: tempRepo });

        await expect(
            commitTool.execute({ message: 'test', cwd: tempRepo })
        ).rejects.toThrow('suspicious test value');
    });

    it('blocks commits with test name', async () => {
        const tempRepo = createTempRepo();
        await execAsync('git config --local user.name "Routa Test"', { cwd: tempRepo });

        await expect(
            commitTool.execute({ message: 'test', cwd: tempRepo })
        ).rejects.toThrow('suspicious test value');
    });
});
```

## Metrics & KPIs

Track effectiveness of the safety mechanism:

- **Commits blocked at pre-commit**: Count of local blocks
- **Commits blocked at pre-push**: Count of push blocks
- **CI failures due to credentials**: Count of CI blocks
- **Leakage incidents**: Count of test credentials in main branch
- **Mean time to detection**: Time from commit to detection
- **Mean time to remediation**: Time from detection to fix

**Target**: Zero test credentials in main branch history after implementation.

## Emergency Response

If test credentials are detected in main:

1. **Immediate**: Create incident issue
2. **Assess**: Determine scope (how many commits, which branches)
3. **Decide**: Rewrite history or accept and move forward
4. **Fix**: If rewriting, coordinate with all contributors
5. **Prevent**: Ensure all layers are active
6. **Review**: Post-mortem to strengthen mechanism

## Summary

This defense-in-depth approach provides **5 layers of protection**:

1. ✅ **Prevention**: Application validates before commit
2. 🔄 **Detection**: Git hooks block at commit time
3. 🔄 **Rejection**: Pre-push hooks scan history
4. 🔄 **Validation**: CI/CD enforces in pipeline
5. 🔄 **Monitoring**: Daily scans detect escapees

**Key Principle**: Make it impossible for test credentials to reach production, not just unlikely.

## References

- Issue: `docs/issues/2026-04-06-test-git-credentials-leak.md`
- Implementation: Commits a75a2901, 160c9600
- Git Hooks: `.husky/pre-commit`, `.husky/pre-push`
- CI/CD: `.github/workflows/defense.yml`
