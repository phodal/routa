# Git Workflow UI Implementation Progress

**Issue**: #396  
**Started**: 2026-04-08  
**Target**: 6 weeks (6 phases)

## Overall Status

- [x] Phase 1: Data Model + Backend APIs (Week 1) ✅ **COMPLETE**
- [x] Phase 2: Core UI (Unstaged/Staged sections) (Week 2) ✅ **COMPLETE**
- [ ] Phase 3: Commits section + Diff viewer (Week 3) 🔜 **NEXT**
- [ ] Phase 4: Git operations + Shortcuts (Week 4)
- [ ] Phase 5: Polish + Testing (Week 5)
- [ ] Phase 6: Documentation + Release (Week 6)

---

## Phase 1: Data Model + Backend APIs ✅

### Completed (2026-04-08)

**Commits**:
- `631b2cac` - feat(kanban): extend file changes types for git workflow UI (Phase 1)
- `5e55b9f2` - feat(kanban): add git workflow API endpoints (Phase 1 backend)
- `e1ecca69` - feat(kanban): add Rust backend for git workflow operations (Phase 1)

**TypeScript Types** (`src/app/workspace/[workspaceId]/kanban/kanban-file-changes-types.ts`):
- [x] Extended `KanbanFileChangeItem` with:
  - `source?: 'agent' | 'manual' | 'git' | 'worktree'`
  - `timestamp?: number`
  - `staged?: boolean`
  - `selected?: boolean`
- [x] Extended `KanbanRepoChanges` with:
  - `unstagedFiles?: KanbanFileChangeItem[]`
  - `stagedFiles?: KanbanFileChangeItem[]`
  - `commits?: KanbanCommitInfo[]`
  - `targetBranch?: string`
  - `ahead?: number`, `behind?: number`
- [x] Added `KanbanCommitInfo` interface (extends `KanbanCommitChangeItem`)
- [x] Added Git operation request/response types:
  - `StageFilesRequest`, `UnstageFilesRequest`, `DiscardChangesRequest`
  - `CreateCommitRequest`, `PullCommitsRequest`
  - `RebaseRequest`, `ResetBranchRequest`
  - `GitOperationResponse`

**Node.js Backend** (`src/core/git/git-operations.ts`):
- [x] `stageFiles(repoPath, files)` - Stage files
- [x] `unstageFiles(repoPath, files)` - Unstage files
- [x] `discardChanges(repoPath, files)` - Discard changes (destructive)
- [x] `createCommit(repoPath, message, files?)` - Create commit, returns SHA
- [x] `pullCommits(repoPath, remote?, branch?)` - Pull from remote
- [x] `rebaseBranch(repoPath, onto)` - Rebase onto target
- [x] `resetBranch(repoPath, to, mode)` - Reset branch (soft/hard)
- [x] `getCommitList(repoPath, options)` - Get commit history
- [x] `CommitInfo` interface

**Node.js API Routes** (`src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/`):
- [x] `POST /stage` - Stage files
- [x] `POST /unstage` - Unstage files
- [x] `POST /commit` - Create commit
- [x] `GET /commits` - Get commit list (with limit, since query params)

**Rust Backend** (`crates/routa-core/src/git.rs`):
- [x] `stage_files(repo_path, files)` - Stage files
- [x] `unstage_files(repo_path, files)` - Unstage files  
- [x] `discard_changes(repo_path, files)` - Discard changes
- [x] `create_commit(repo_path, message, files?)` - Create commit, returns SHA
- [x] `pull_commits(repo_path, remote?, branch?)` - Pull from remote
- [x] `rebase_branch(repo_path, onto)` - Rebase onto target
- [x] `reset_branch(repo_path, to, mode)` - Reset branch
- [x] `get_commit_list(repo_path, limit?, since?)` - Get commit history
- [x] `CommitInfo` struct

**Rust API** (`crates/routa-server/src/api/git.rs`):
- [x] Same 4 endpoints as Node.js API
- [x] Registered in `codebases.rs` router

---

## Phase 2: Core UI (Unstaged/Staged sections) 🔄

### Target

**UI Components** (`src/app/workspace/[workspaceId]/kanban/`):
- [ ] Create `KanbanFileChangesSectionHeader.tsx`
  - Section title (UNSTAGED / STAGED)
  - File count badge
  - Actions (select all, collapse/expand)
- [ ] Create `KanbanFileChangeFileRow.tsx`
  - Checkbox for selection
  - File icon based on status
  - File path with syntax
  - Status badge (M, A, D, R, etc.)
  - +/- stats
  - onClick handler for diff preview
  - Hover actions
- [ ] Create `KanbanUnstagedSection.tsx`
  - Render unstaged files list
  - Auto-commit toggle
  - Batch actions (stage selected, discard selected)
- [ ] Create `KanbanStagedSection.tsx`
  - Render staged files list
  - [Commit] button
  - [Export] button
  - Batch actions (unstage selected)
- [ ] Update `KanbanFileChangesPanel.tsx`
  - Add state for selectedFiles, activeDiffFile
  - Add handlers for stage/unstage/select
  - Integrate UnstagedSection and StagedSection
  - Call new API endpoints

**Data Fetching**:
- [ ] Update backend to return `unstagedFiles` and `stagedFiles` separately
- [ ] Implement client-side API hooks for stage/unstage

### Notes

- Keep FileRow clickable to show inline diff (Phase 3)
- Checkboxes enable batch operations
- Follow existing patterns from `kanban-file-changes-panel.tsx`

---

## Remaining Phases (Preview)

### Phase 3: Commits Section + Diff Viewer
- Commits list with expandable file lists
- Inline diff viewer component
- Diff caching

### Phase 4: Git Operations + Shortcuts
- Implement all Git operation buttons
- Keyboard shortcuts (Cmd+K, Space, Enter, etc.)
- Error handling and retry logic

### Phase 5: Polish + Testing
- Loading states
- Optimistic updates
- E2E tests
- Error toasts

### Phase 6: Documentation + Release
- Update user docs
- API documentation
- Migration guide
- Release notes

---

## References

- Issue: #396
- Design Doc: `docs/issues/2026-04-08-enhanced-git-workflow-ui-for-kanban-file-changes.md`
- Intent Analysis: `docs/references/intent-0.2.11-file-changes-analysis.md`
