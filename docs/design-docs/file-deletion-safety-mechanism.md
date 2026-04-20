---
title: File Deletion Safety Mechanism
---

# File Deletion Safety Mechanism

**Date**: 2026-04-06  
**Status**: Design + Implementation  
**Purpose**: Prevent accidental mass file deletion (200+ files) in commits

## Problem Statement

AI Agents or human errors could accidentally delete large numbers of files:

- 🔴 Refactoring gone wrong
- 🔴 Incorrect path in `rm -rf` command
- 🔴 Directory structure reorganization mistakes
- 🔴 Git operations misunderstanding (e.g., `git rm -r .`)

**Risk**: Catastrophic data loss if merged to production.

## Design Goals

1. **Prevent** mass deletions (200+ files) from being committed
2. **Allow** legitimate large-scale deletions with explicit confirmation
3. **Provide** clear guidance for fixing violations
4. **Detect** at multiple layers (pre-commit, pre-push, CI/CD)

## Threshold Decision

**Chosen Threshold: 200 files**

Rationale:
- Normal refactoring: Usually < 50 files
- Feature removal: Usually < 100 files
- Directory restructure: 50-150 files
- Mass deletion accident: Often 500+ files

200 files provides safety margin while allowing legitimate operations.

## Implementation Strategy

### Layer 1: Pre-Commit Hook ✅

**When**: Before `git commit` creates commit object  
**What**: Count deleted files in staging area  
**Action**: Block if count ≥ 200

```bash
# In .husky/pre-commit

# Count deleted files in staging area
DELETED_COUNT=$(git diff --cached --diff-filter=D --name-only | wc -l | tr -d ' ')

if [ "$DELETED_COUNT" -ge 200 ]; then
    echo "❌ COMMIT BLOCKED: Mass file deletion detected"
    echo "   Deleted files: $DELETED_COUNT"
    echo "   Threshold: 200 files"
    echo ""
    echo "   If this is intentional, use one of these options:"
    echo "   1. Split into smaller commits (recommended)"
    echo "   2. Use: ALLOW_MASS_DELETE=1 git commit ..."
    echo "   3. Document reason in commit message"
    exit 1
fi
```

### Layer 2: Pre-Push Hook ✅

**When**: Before `git push` sends commits to remote  
**What**: Scan all commits being pushed for mass deletions  
**Action**: Block if any commit has 200+ deletions

```bash
# In .husky/pre-push

while read local_ref local_sha remote_ref remote_sha; do
    RANGE="$remote_sha..$local_sha"
    
    # Check each commit in the push
    for commit in $(git rev-list $RANGE); do
        DELETED=$(git show --diff-filter=D --name-only --format="" $commit | wc -l)
        
        if [ "$DELETED" -ge 200 ]; then
            echo "❌ PUSH BLOCKED: Commit $commit deletes $DELETED files"
            echo "   Threshold: 200 files"
            exit 1
        fi
    done
done
```

### Layer 3: CI/CD Validation ✅

**When**: On Pull Request or push to main  
**What**: Validate all commits in PR/push  
**Action**: Fail CI if mass deletion detected

```yaml
# In .github/workflows/defense.yaml

validate-file-deletions:
  name: 'Gate: File Deletion Safety'
  steps:
    - name: Check for mass file deletions
      run: |
        RANGE="${{ github.event.pull_request.base.sha }}...${{ github.event.pull_request.head.sha }}"
        
        for commit in $(git rev-list $RANGE); do
          DELETED=$(git show --diff-filter=D --name-only --format="" $commit | wc -l)
          
          if [ "$DELETED" -ge 200 ]; then
            echo "::error::Commit $(echo $commit | cut -c1-8) deletes $DELETED files (threshold: 200)"
            exit 1
          fi
        done
```

## Edge Cases & Handling

### Case 1: Legitimate Mass Deletion

**Scenario**: Removing deprecated feature with 500 files

**Solution**: Use bypass flag with clear commit message

```bash
# Option 1: Environment variable bypass
ALLOW_MASS_DELETE=1 git commit -m "feat: remove deprecated auth v1

Removing deprecated authentication v1 system:
- 487 files deleted
- Migration guide: docs/migration/auth-v1-to-v2.md
- Reason: No users on v1 for 6 months

ALLOW_MASS_DELETE: Intentional mass deletion"

# Option 2: Split into logical commits
git commit -m "feat: remove deprecated auth v1 - step 1/3 (handlers)"
git commit -m "feat: remove deprecated auth v1 - step 2/3 (models)"
git commit -m "feat: remove deprecated auth v1 - step 3/3 (tests)"
```

### Case 2: Directory Rename (Git sees as delete + add)

**Scenario**: Moving `src/old-structure/` to `src/new-structure/`

**Detection**: Git detects renames, not pure deletions

```bash
# Git is smart about renames
git mv src/old-structure src/new-structure
git commit -m "refactor: reorganize directory structure"

# This shows as renames (R), not deletions (D)
git show --name-status
# R100  src/old-structure/file.ts -> src/new-structure/file.ts
```

**Impact**: Won't trigger deletion check (uses `--diff-filter=D`)

### Case 3: Generated Files Cleanup

**Scenario**: Removing `node_modules` or build artifacts

**Prevention**: These should be in `.gitignore`, never committed

```bash
# If accidentally committed
git rm -r --cached node_modules
git commit -m "fix: remove accidentally committed node_modules"

# Will trigger if 200+ files, which is correct
# Because this was a mistake that needs attention
```

## Configuration

### Thresholds

**File**: `scripts/safety-config.json` (future enhancement)

```json
{
  "deletion": {
    "threshold": 200,
    "bypassVar": "ALLOW_MASS_DELETE",
    "requireJustification": true
  }
}
```

### Bypass Mechanisms

1. **Environment Variable**: `ALLOW_MASS_DELETE=1`
2. **Commit Message**: Include `ALLOW_MASS_DELETE: reason`
3. **Emergency**: `SKIP_HOOKS=1` (bypasses all checks)

### Exemptions

Files/directories that don't count toward threshold:

- Generated files (if in `.gitignore` but tracked)
- Lock files updates (single file, many lines)
- Auto-generated documentation

**Implementation**: Not needed initially, can add if false positives occur.

## Testing Strategy

### Unit Test: Pre-Commit Hook

```bash
# Create test repo with 250 deleted files
cd /tmp
mkdir test-deletion-limit
cd test-deletion-limit
git init

# Create 250 files
for i in {1..250}; do echo "file $i" > "file$i.txt"; done
git add .
git commit -m "initial"

# Delete them all
git rm file*.txt

# Try to commit (should be blocked)
cp /path/to/routa/.husky/pre-commit .git/hooks/
git commit -m "delete files"
# Expected: ❌ COMMIT BLOCKED
```

### Integration Test: CI/CD

Create PR with mass deletion, verify CI blocks it.

## Metrics

Track over time:
- **Blocks triggered**: Count of blocked commits
- **Bypasses used**: Count of `ALLOW_MASS_DELETE` usage
- **False positives**: Legitimate operations blocked
- **False negatives**: Mass deletions that passed

**Target**: < 1 false positive per month

## Related Mechanisms

- Git Commit Safety (test credentials)
- File Budget Limits (per-commit change size)
- Branch Protection Rules

## Implementation Checklist

- [x] Design document
- [ ] Update `.husky/pre-commit`
- [ ] Update `.husky/pre-push`
- [ ] Update `.github/workflows/defense.yaml`
- [ ] Add tests
- [ ] Update documentation

## References

- Previous incident: docs/issues/2026-04-06-test-git-credentials-leak.md
- Git safety design: docs/design-docs/git-commit-safety-mechanism.md
