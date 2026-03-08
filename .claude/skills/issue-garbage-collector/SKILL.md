---
name: issue-garbage-collector
description: Cleans up duplicate and outdated issue files in docs/issues/. Use when the issues directory becomes cluttered with redundant entries, or after resolving issues to consolidate knowledge. Identifies duplicates by filename patterns and content similarity, merges related issues, and archives resolved ones.
license: MIT
---

## Garbage Collection Process

### Phase 1: Scan & Index

Build an index of all issue files:

```bash
# List all issue files (excluding template)
ls -la docs/issues/*.md | grep -v _template.md
```

Extract metadata from each file:
- **Filename pattern**: `YYYY-MM-DD-short-description.md`
- **YAML front-matter**: title, status, area, tags
- **Content hash**: For similarity detection

### Phase 2: Detect Duplicates

#### By Filename Similarity

Look for issues with similar descriptions in the filename:

```
2026-03-02-drizzle-migrate-neon-connection-failure.md
2026-03-05-drizzle-neon-connection-timeout.md  # Potential duplicate
```

**Matching rules**:
- Same `area` tag + similar keywords in filename → likely duplicate
- Same date + overlapping description → check content

#### By Content Similarity

Compare issue content:
- Same error messages or stack traces
- Same "Relevant Files" section
- Similar "What Happened" descriptions

### Phase 3: Merge Strategy

When duplicates are found:

1. **Keep the most recent** (by date in filename)
2. **Merge unique context** from older issues into the newer one
3. **Update `related_issues`** in YAML front-matter
4. **Archive or delete** the older duplicate

```bash
# Example: Merge older into newer
# 1. Copy unique observations from older to newer
# 2. Update newer's related_issues
# 3. Remove older file
rm docs/issues/2026-03-02-drizzle-neon-connection-timeout.md
```

### Phase 4: Archive Resolved Issues

For issues with `status: resolved`:

**Option A**: Keep in place (default)
- Resolved issues serve as knowledge base
- Future agents can learn from past solutions

**Option B**: Move to archive (if directory is cluttered)
```bash
mkdir -p docs/issues/archive
mv docs/issues/2026-03-02-resolved-issue.md docs/issues/archive/
```

### Phase 5: Cleanup Report

Generate a summary of actions taken:

```markdown
# Issue Garbage Collection Report

## Duplicates Merged
| Kept | Removed | Reason |
|------|---------|--------|
| 2026-03-05-drizzle-neon.md | 2026-03-02-drizzle-migrate.md | Same root cause |

## Resolved Issues
- 3 issues with `status: resolved` (kept as knowledge base)

## Stale Issues
- 2 issues older than 30 days with `status: open` (flagged for review)

## Actions Taken
- Removed: 2 duplicate files
- Updated: 1 file with merged context
- Archived: 0 files
```

## Decision Matrix

| Condition | Action |
|-----------|--------|
| Same error + same area + different dates | Merge into newer, delete older |
| Similar filename + different content | Keep both, add cross-reference |
| `status: resolved` + older than 14 days | Keep (knowledge base) |
| `status: open` + older than 30 days | Flag for human review |
| `status: wontfix` | Keep for context |

## Execution Checklist

- [ ] Scan all files in `docs/issues/`
- [ ] Build filename similarity index
- [ ] Compare content for potential duplicates
- [ ] Merge duplicates (keep newer, preserve unique context)
- [ ] Update `related_issues` cross-references
- [ ] Generate cleanup report
- [ ] Commit changes with descriptive message

## Tips

- **Don't auto-delete**: Always review before removing
- **Preserve context**: When merging, copy unique observations
- **Cross-reference**: Use `related_issues` to link similar issues
- **Respect resolved**: Resolved issues are valuable knowledge
- **Ask when unsure**: If two issues seem related but different, ask the user

## Safety Rules

1. **Never delete `_template.md`**
2. **Never delete issues with `status: investigating`** (active work)
3. **Always create backup** before bulk operations
4. **Commit incrementally** — one logical change per commit

