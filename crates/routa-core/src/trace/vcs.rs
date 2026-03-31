//! VCS context provider for Agent Trace.
//!
//! Populates TraceVcs with Git information (revision, branch, repo_root).

use super::types::TraceVcs;
use std::path::Path;
use std::process::Command;

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
    Command::new("git")
        .args(["rev-parse", "--git-dir"])
        .current_dir(cwd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Get the current git revision (commit SHA).
fn get_git_revision(cwd: &Path) -> Option<String> {
    Command::new("git")
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
    let output = Command::new("git")
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
    Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(cwd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use tempfile::TempDir;

    fn run_git(cwd: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .status()
            .expect("git command should execute");
        assert!(
            status.success(),
            "git {:?} failed in {}",
            args,
            cwd.display()
        );
    }

    fn create_test_repo() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().expect("temp dir should be created");
        let repo_path = temp_dir.path().join("repo");
        std::fs::create_dir(&repo_path).expect("repo dir should be created");

        run_git(&repo_path, &["init", "-b", "main"]);
        run_git(&repo_path, &["config", "user.name", "Routa Test"]);
        run_git(&repo_path, &["config", "user.email", "test@example.com"]);
        std::fs::write(repo_path.join("README.md"), "test repo\n")
            .expect("fixture file should be written");
        run_git(&repo_path, &["add", "README.md"]);
        run_git(
            &repo_path,
            &[
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-m",
                "Initial commit",
            ],
        );

        (temp_dir, repo_path)
    }

    #[test]
    fn test_get_vcs_context_in_git_repo() {
        let (_temp_dir, repo_path) = create_test_repo();
        let result = get_vcs_context(repo_path.to_str().expect("repo path should be valid UTF-8"));
        let repo_root = repo_path
            .canonicalize()
            .expect("repo path should canonicalize");

        assert!(result.is_some());
        let vcs = result.unwrap();
        assert_eq!(vcs.branch.as_deref(), Some("main"));
        assert!(vcs.revision.is_some());
        // Compare paths by parsing and canonicalizing to handle Windows extended paths (\\?\)
        let vcs_root = std::path::PathBuf::from(vcs.repo_root.as_deref().unwrap_or(""));
        let vcs_root_canonical = vcs_root.canonicalize().unwrap_or(vcs_root);
        assert_eq!(vcs_root_canonical, repo_root);
    }

    #[test]
    fn test_vcs_context_light() {
        let (_temp_dir, repo_path) = create_test_repo();
        let result =
            get_vcs_context_light(repo_path.to_str().expect("repo path should be valid UTF-8"));

        assert!(result.is_some());
        let vcs = result.unwrap();
        assert_eq!(vcs.branch.as_deref(), Some("main"));
        assert!(vcs.revision.is_none());
        assert!(vcs.repo_root.is_none());
    }
}
