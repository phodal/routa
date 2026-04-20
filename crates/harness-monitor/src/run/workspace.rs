#![allow(dead_code)]

use crate::shared::ids::{RunId, TaskId, WorkspaceId};
use serde::{Deserialize, Serialize};

/// State of a git worktree workspace owned by a managed run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceState {
    Provisioning,
    Ready,
    Dirty,
    Validated,
    Archived,
    Corrupted,
}

impl WorkspaceState {
    pub fn as_str(&self) -> &'static str {
        match self {
            WorkspaceState::Provisioning => "provisioning",
            WorkspaceState::Ready => "ready",
            WorkspaceState::Dirty => "dirty",
            WorkspaceState::Validated => "validated",
            WorkspaceState::Archived => "archived",
            WorkspaceState::Corrupted => "corrupted",
        }
    }

    pub fn is_healthy(&self) -> bool {
        matches!(
            self,
            WorkspaceState::Ready | WorkspaceState::Dirty | WorkspaceState::Validated
        )
    }
}

/// A workspace manages a worktree and its lifecycle for one or more runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: WorkspaceId,
    pub repo_root: String,
    pub base_branch: String,
    /// Path to `git worktree` for managed runs, or repo root for unmanaged.
    pub worktree_path: String,
    pub state: WorkspaceState,
    pub owned_runs: Vec<RunId>,
    pub dirty_files: Vec<String>,
    pub integrity_warnings: Vec<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

impl Workspace {
    /// True when the workspace has uncommitted mutations.
    pub fn has_drift(&self) -> bool {
        !self.dirty_files.is_empty() || !self.integrity_warnings.is_empty()
    }
}

/// Lightweight summary used in views / policy inputs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSummary {
    pub id: WorkspaceId,
    pub task_id: Option<TaskId>,
    pub state: WorkspaceState,
    pub dirty_file_count: usize,
    pub integrity_warning_count: usize,
}
