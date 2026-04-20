//! VCS context provider for Agent Trace.
//!
//! Populates TraceVcs with Git information (revision, branch, repo_root).

use super::types::TraceVcs;
use crate::git::git_command;
use std::path::Path;

/// Get VCS context for a workspace directory.
/// Returns Git information if the directory is a git repository.
pub fn get_vcs_context(cwd: &str) -> Option<TraceVcs> {
    let cwd_path = Path::new(cwd);

    // Check if this is a git repository
    if !is_git_repo(cwd_path) {
        return None;
    }

    // Get current commit (revision)
    let revision = get_git_revision(cwd_path);

    // Get current branch
    let branch = get_git_branch(cwd_path);

    // Get repo root
    let repo_root = get_git_repo_root(cwd_path);

    // Only return Vcs context if we have at least some info
    if revision.is_some() || branch.is_some() || repo_root.is_some() {
        Some(TraceVcs {
            revision,
            branch,
            repo_root,
        })
    } else {
        None
    }
}

/// Lightweight VCS context that only gets branch name.
/// Useful for hot paths where full context is too expensive.
pub fn get_vcs_context_light(cwd: &str) -> Option<TraceVcs> {
    let cwd_path = Path::new(cwd);
    let branch = get_git_branch(cwd_path)?;

    Some(TraceVcs {
        revision: None,
        branch: Some(branch),
        repo_root: None,
    })
}

/// Check if a directory is a git repository.
fn is_git_repo(cwd: &Path) -> bool {
    git_command()
        .args(["rev-parse", "--git-dir"])
        .current_dir(cwd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Get the current git revision (commit SHA).
fn get_git_revision(cwd: &Path) -> Option<String> {
    git_command()
        .args(["rev-parse", "HEAD"])
        .current_dir(cwd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Get the current git branch name.
fn get_git_branch(cwd: &Path) -> Option<String> {
    let output = git_command()
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(cwd)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() || branch == "HEAD" {
        None
    } else {
        Some(branch)
    }
}

/// Get the git repository root directory.
fn get_git_repo_root(cwd: &Path) -> Option<String> {
    git_command()
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(cwd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}
