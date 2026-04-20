---
title: "Enhanced Git workflow UI for Kanban file changes panel"
date: "2026-04-08"
status: resolved
severity: medium
area: "ui"
tags: ["kanban", "git", "ui", "workflow", "github-sync"]
reported_by: "agent"
related_issues:
  - "https://github.com/phodal/routa/issues/396"
  - "2026-04-08-git-workflow-ui-summary.md"
github_issue: 396
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/396"
resolved_at: "2026-04-08"
---

# Enhanced Git Workflow UI for Kanban File Changes Panel

**Date**: 2026-04-08  
**Status**: Open  
**Priority**: High  
**Epic**: Kanban Board - File Changes Management  
**Inspired by**: Intent 0.2.11 (Augment Code), Cursor IDE

## Problem Statement

The current `KanbanFileChangesPanel` only displays basic file change information without interactive Git workflow capabilities. Users cannot:

1. Stage/unstage individual files or groups
2. View commit history with expandable file lists
3. Perform Git operations (commit, reset, rebase, pull)
4. Review changes in different contexts (unstaged vs staged vs commits)
5. Interact with files to see diffs inline

This limits the Kanban board's effectiveness as a complete workspace management tool.

## Current State

**File**: `src/app/workspace/[workspaceId]/kanban/kanban-file-changes-panel.tsx`

**Current Features**:
- ✅ Display changed files grouped by repository
- ✅ Show file status badges (M, A, D, R, etc.)
- ✅ Display additions/deletions count
- ✅ Collapsible repository sections
- ✅ Branch and sync status

**Missing Features**:
- ❌ No stage/unstage actions
- ❌ No commit list view
- ❌ No Git operations (commit, reset, pull, rebase)
- ❌ No inline diff preview when clicking files
- ❌ No batch operations
- ❌ No keyboard shortcuts

## Proposed Solution

### UI Redesign - Three-Section Layout

Based on the provided screenshots and Intent's architecture:

```
┌─────────────────────────────────────────────────────────────┐
│ Header: "12 files changed in Space"                        │
│ Branch: integrate-auggie-acp-agent → master                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ● UNSTAGED / NEW                        [Auto-commit: ON]  │
│   ┌─────────────────────────────────────────────────────┐ │
│   │ □ file1.ts                           +10 -5         │ │
│   │ □ file2.tsx                          +23 -8         │ │
│   └─────────────────────────────────────────────────────┘ │
│                                                             │
│ ● STAGED / APPROVED                                         │
│   ┌─────────────────────────────────────────────────────┐ │
│   │ □ config.ts                          +5 -2          │ │
│   └─────────────────────────────────────────────────────┘ │
│                                                             │
│   [Commit ↓]  [Export →]                                   │
│                                                             │
│ ● COMMITS                                                   │
│   ┌─────────────────────────────────────────────────────┐ │
│   │ ⚙️ Run Tests and Verify Build              [↗] [↻] │ │
│   │   └─ 📄 build.gradle.kts                            │ │
│   │   └─ 📄 Utf8ParsingTest.kt                          │ │
│   │                                                      │ │
│   │ ⚙️ fix: Change issue reference #538 → #536          │ │
│   │                                                      │ │
│   │ ⚙️ feat: Add Auggie ACP agent integration           │ │
│   └─────────────────────────────────────────────────────┘ │
│                                                             │
│   [Pull 24 Commits ↑]  [Rebase onto master ↻]             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ 🔄 Reset and continue working                              │
│    Reset branch to master and keep working                 │
│                                                             │
│ 🚀 Archive and start new space                             │
│    Continue working on this repo in a fresh workspace      │
└─────────────────────────────────────────────────────────────┘
```

### Core Features to Implement

#### 1. **Three-State File Management**

**UNSTAGED / NEW**
- Display all working directory changes
- Checkbox selection for batch operations
- Click file → show inline diff preview
- Right-click → context menu (stage, discard, open in editor)
- Auto-commit toggle

**STAGED / APPROVED**
- Display staged files ready for commit
- Checkbox selection
- Click file → show diff preview
- Right-click → unstage option

**COMMITS**
- Display commit history (from current branch)
- Expandable to show files in each commit
- Each commit shows:
  - Commit icon (⚙️)
  - Short message
  - Actions: [Open ↗] [Revert ↻]
- Click commit → expand to show changed files
- Click file in commit → show commit diff for that file

#### 2. **Git Operations**

**Primary Actions**:
- `Commit ↓` - Create commit from staged files
- `Export →` - Export changes/patches
- `Pull X Commits ↑` - Pull from remote
- `Rebase onto {branch} ↻` - Rebase current branch

**Workflow Actions**:
- `Reset and continue working` - Reset to target branch, keep working dir
- `Archive and start new space` - Create new workspace from fresh checkout

#### 3. **Interactive File Actions**

**Single File Actions**:
- Stage/Unstage (drag & drop or button)
- Discard changes
- Open in editor
- Copy path

**Batch Operations**:
- Select multiple files via checkboxes
- Stage all selected
- Unstage all selected
- Discard all selected

#### 4. **Inline Diff Preview**

When clicking a file in UNSTAGED/STAGED:
- Show diff viewer in expansion panel
- Syntax highlighted
- Line numbers
- +/- indicators
- Ability to stage/unstage individual hunks

#### 5. **Keyboard Shortcuts**

- `Cmd/Ctrl + K` - Toggle file changes panel
- `Space` - Stage/unstage selected file
- `Enter` - Show diff for selected file
- `↑/↓` - Navigate files
- `Cmd/Ctrl + A` - Select all files in current section
- `Esc` - Close panel or collapse diff

## Technical Implementation

### Phase 1: Data Model Extension

**Extend existing types**:

```typescript
// kanban-file-changes-types.ts
export interface KanbanFileChangeItem {
  path: string;
  status: KanbanFileChangeStatus;
  previousPath?: string;
  additions?: number;
  deletions?: number;
  source?: 'agent' | 'manual' | 'git' | 'worktree';  // NEW
  timestamp?: number;  // NEW
  staged?: boolean;  // NEW
  selected?: boolean;  // NEW - for UI state
}

export interface KanbanCommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  authoredAt: string;
  additions: number;
  deletions: number;
  files?: KanbanFileChangeItem[];  // NEW - files in this commit
  expanded?: boolean;  // NEW - UI state
}

export interface KanbanRepoChanges {
  // existing fields...
  unstagedFiles: KanbanFileChangeItem[];  // NEW - split from files
  stagedFiles: KanbanFileChangeItem[];    // NEW
  commits: KanbanCommitInfo[];             // NEW
  currentBranch: string;                   // NEW
  targetBranch?: string;                   // NEW - for PR/merge context
  ahead: number;                           // NEW - commits ahead of remote
  behind: number;                          // NEW - commits behind remote
}
```

### Phase 2: Backend API Extensions

**New endpoints needed**:

```typescript
// File operations
POST /api/workspaces/:workspaceId/repos/:codebaseId/stage
  body: { files: string[] }

POST /api/workspaces/:workspaceId/repos/:codebaseId/unstage
  body: { files: string[] }

POST /api/workspaces/:workspaceId/repos/:codebaseId/discard
  body: { files: string[] }

// Commit operations
GET  /api/workspaces/:workspaceId/repos/:codebaseId/commits
  query: { limit?: number, since?: string }

POST /api/workspaces/:workspaceId/repos/:codebaseId/commit
  body: { message: string, files?: string[] }

GET  /api/workspaces/:workspaceId/repos/:codebaseId/commits/:sha/files

// Git workflow operations
POST /api/workspaces/:workspaceId/repos/:codebaseId/pull
POST /api/workspaces/:workspaceId/repos/:codebaseId/rebase
  body: { onto: string }

POST /api/workspaces/:workspaceId/repos/:codebaseId/reset
  body: { to: string, mode: 'soft' | 'hard' }

// Diff preview
GET  /api/workspaces/:workspaceId/repos/:codebaseId/diff
  query: { path: string, staged?: boolean }

GET  /api/workspaces/:workspaceId/repos/:codebaseId/commits/:sha/diff
  query: { path: string }
```

### Phase 3: UI Component Architecture

**Component Breakdown**:

```
KanbanFileChangesPanel (main container)
├─ FileChangesHeader
│  ├─ BranchIndicator
│  └─ SummaryStats
├─ UnstagedSection
│  ├─ SectionHeader (with Auto-commit toggle)
│  ├─ FileList
│  │  └─ FileRow[] (with checkbox + onClick)
│  └─ InlineDiffViewer (conditional)
├─ StagedSection
│  ├─ SectionHeader
│  ├─ FileList
│  │  └─ FileRow[]
│  └─ ActionButtons (Commit, Export)
├─ CommitsSection
│  ├─ SectionHeader
│  ├─ CommitList
│  │  └─ CommitItem[] (expandable)
│  │     └─ FileList (files in commit)
│  └─ GitOperationButtons (Pull, Rebase)
└─ WorkflowActions
   ├─ ResetAction
   └─ ArchiveAction
```

### Phase 4: State Management

**Add to KanbanFileChangesPanel**:

```typescript
const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
const [activeDiffFile, setActiveDiffFile] = useState<{
  path: string;
  staged: boolean;
  commitSha?: string;
} | null>(null);
const [diffCache, setDiffCache] = useState<Record<string, string>>({});
const [loadingDiff, setLoadingDiff] = useState(false);
const [autoCommit, setAutoCommit] = useState(false);
```

### Phase 5: Integration Points

**Rust Backend Integration**:
- Use existing `git2` crate for Git operations
- Implement staging/unstaging via `git2::Index`
- Implement commit creation via `git2::Repository::commit`
- Parse commit history via `git2::Revwalk`
- Generate diffs via `git2::Diff`

**File watching**:
- Extend existing file watcher to detect staging area changes
- Invalidate cache when `.git/index` changes
- Auto-refresh commit list when new commits detected

## UI/UX Considerations

### Visual Design Principles

1. **Clear State Indication**
   - Different colors for unstaged (amber) vs staged (green) vs commits (blue)
   - Icon system: ⚙️ for commits, checkboxes for files
   - Badges for status (M, A, D, R)

2. **Progressive Disclosure**
   - Commits collapsed by default
   - Diff viewers shown on demand
   - "Show all files" for long lists

3. **Feedback & Loading States**
   - Optimistic updates for stage/unstage
   - Loading spinners for diff fetching
   - Success/error toasts for Git operations

4. **Accessibility**
   - Keyboard navigation throughout
   - ARIA labels for all interactive elements
   - Focus management when opening/closing sections

### Error Handling

- Show inline errors for failed Git operations
- Retry mechanism for network operations
- Graceful degradation if Git repository is in bad state
- Clear error messages with suggested actions

## Testing Strategy

### Unit Tests

- File staging/unstaging logic
- Commit list parsing
- Diff caching
- Selection state management

### Integration Tests

- Stage files → commit → verify in commit list
- Expand commit → click file → view diff
- Batch operations (select multiple → stage all)
- Keyboard shortcuts

### E2E Tests

- Full workflow: unstaged → staged → commit → view history
- Reset workflow
- Pull and rebase operations
- Cross-repo operations (multi-codebase tasks)

## Success Metrics

- ✅ Users can stage/unstage files without leaving Kanban board
- ✅ Users can view commit history and file diffs inline
- ✅ Users can perform basic Git operations (commit, pull, reset)
- ✅ 80%+ reduction in context switching to external Git tools
- ✅ All operations accessible via keyboard shortcuts

## References

### Inspiration Sources

1. **Intent 0.2.11** (Augment Code)
   - Analysis: `docs/references/intent-0.2.11-file-changes-analysis.md`
   - Key features: Multi-view change management, navigation history, agent integration

2. **Cursor IDE** (Screenshots provided)
   - Three-section layout (Unstaged/Staged/Commits)
   - Expandable commits with file lists
   - Clear Git operation buttons
   - Clean visual hierarchy

3. **VS Code Source Control**
   - Inline diff viewers
   - Stage/unstage hunks
   - Commit input with validation

### Related Issues

- Initial file tracking: (link to original file changes implementation)
- Kanban board file changes panel: (current implementation)

### Implementation Timeline

**Week 1**: Data model + Backend APIs
**Week 2**: Core UI components (Unstaged/Staged sections)
**Week 3**: Commits section + Diff viewer
**Week 4**: Git operations + Keyboard shortcuts
**Week 5**: Polish + Testing
**Week 6**: Documentation + Release

## Open Questions

1. Should we support interactive rebase UI?
2. How to handle merge conflicts in the panel?
3. Should "Auto-commit" create commits automatically on file changes?
4. Support for stash operations?
5. Cherry-pick UI?

---

**Next Steps**:
1. Review this issue for scope agreement
2. Create sub-tasks for each phase
3. Design detailed mockups
4. Implement Phase 1 (data model)
