---
title: "Git workflow UI enhancement summary for Kanban file changes"
date: "2026-04-08"
kind: progress_note
status: resolved
severity: low
area: "ui"
tags: ["kanban", "git", "ui", "summary", "github-sync"]
reported_by: "agent"
related_issues:
  - "https://github.com/phodal/routa/issues/396"
  - "2026-04-08-enhanced-git-workflow-ui-for-kanban-file-changes.md"
github_issue: 396
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/396"
resolved_at: "2026-04-08"
---

# Git Workflow UI Enhancement - Summary

**Date**: 2026-04-08  
**GitHub Issue**: #396  
**Status**: Created  

## What We're Building

Transform the Kanban File Changes Panel from a **read-only file list** into a **full Git workflow UI** inspired by Intent (Augment Code) and Cursor IDE.

## Key Visual Comparison

### Before (Current State)
```
┌─────────────────────────────┐
│ File Changes                │
├─────────────────────────────┤
│ routa-js @ main             │
│   • file1.ts       +10 -5   │
│   • file2.tsx      +23 -8   │
│   • config.ts      +5  -2   │
│                             │
│ (no interactions)           │
└─────────────────────────────┘
```

### After (Target State - Like Cursor/Intent)
```
┌─────────────────────────────────────────────┐
│ 12 files changed in Space                  │
│ feature-branch → main                       │
├─────────────────────────────────────────────┤
│ ● UNSTAGED / NEW          [Auto-commit: ON] │
│   □ file1.ts                     +10 -5     │
│   □ file2.tsx                    +23 -8     │
│                                             │
│ ● STAGED / APPROVED                         │
│   □ config.ts                    +5  -2     │
│   [Commit ↓]  [Export →]                    │
│                                             │
│ ● COMMITS                                   │
│   ⚙️ Run Tests and Verify Build     [↗][↻]  │
│     └─ 📄 build.gradle.kts                  │
│     └─ 📄 Utf8ParsingTest.kt                │
│   ⚙️ fix: Issue reference #538 → #536       │
│   ⚙️ feat: Add Auggie ACP integration       │
│                                             │
│   [Pull 24 Commits ↑] [Rebase onto main ↻] │
│                                             │
│ 🔄 Reset and continue working               │
│ 🚀 Archive and start new space              │
└─────────────────────────────────────────────┘
```

## Core Features to Add

### 1. Three-Section Layout ⭐⭐⭐
- **UNSTAGED / NEW**: Working directory changes
- **STAGED / APPROVED**: Files ready to commit
- **COMMITS**: Commit history with expandable file lists

### 2. Interactive File Operations ⭐⭐⭐
- ✅ Click file → show inline diff preview
- ✅ Checkbox selection for batch operations
- ✅ Stage/unstage individual files
- ✅ Discard changes
- ✅ Right-click context menu

### 3. Git Operations ⭐⭐⭐
- ✅ Commit with message
- ✅ Pull commits from remote
- ✅ Rebase onto target branch
- ✅ Reset branch (soft/hard)
- ✅ Export patches

### 4. Commit History View ⭐⭐
- ✅ List commits from current branch
- ✅ Expandable to show files per commit
- ✅ Click file in commit → view diff
- ✅ Actions: Open in editor, Revert commit

### 5. Keyboard Shortcuts ⭐⭐
- `Cmd/Ctrl + K`: Toggle panel
- `Space`: Stage/unstage selected file
- `Enter`: Show diff
- `↑/↓`: Navigate files
- `Esc`: Close panel

### 6. Auto-commit Mode ⭐
- Toggle to auto-commit changes (for AI workflows)
- Configurable commit message templates

## Implementation Plan

### Phase 1: Foundation (Week 1)
- [ ] Extend data models for staged/unstaged/commits
- [ ] Add backend APIs for Git operations
- [ ] Add endpoints for diff retrieval

### Phase 2: Core UI (Week 2)
- [ ] Build Unstaged section with checkboxes
- [ ] Build Staged section with actions
- [ ] Add file selection state management

### Phase 3: Commits & Diff (Week 3)
- [ ] Build Commits section with expandable items
- [ ] Add inline diff viewer component
- [ ] Integrate diff loading and caching

### Phase 4: Operations (Week 4)
- [ ] Implement stage/unstage/discard
- [ ] Implement commit creation UI
- [ ] Implement pull/rebase/reset buttons

### Phase 5: Polish (Week 5-6)
- [ ] Add keyboard shortcuts
- [ ] Add error handling and retries
- [ ] Add loading states
- [ ] Write E2E tests
- [ ] Documentation

## Success Metrics

- ✅ 80%+ reduction in context switching to external Git tools
- ✅ Users can complete full Git workflow in Kanban board
- ✅ All operations accessible via keyboard
- ✅ Supports both manual and AI agent workflows

## Resources

- **GitHub Issue**: https://github.com/phodal/routa/issues/396
- **Detailed Spec**: `docs/issues/2026-04-08-enhanced-git-workflow-ui-for-kanban-file-changes.md`
- **Intent Analysis**: `docs/references/intent-0.2.11-file-changes-analysis.md`
- **Current Implementation**: `src/app/workspace/[workspaceId]/kanban/kanban-file-changes-panel.tsx`

## Next Steps

1. ✅ Issue created (#396)
2. ⏳ Team review and scope agreement
3. ⏳ Create sub-tasks for each phase
4. ⏳ Design detailed mockups
5. ⏳ Begin Phase 1 implementation
