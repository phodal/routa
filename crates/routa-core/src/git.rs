//! Git utilities for clone, branch management, and repo inspection.
//! Port of src/core/git/git-utils.ts

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

const GIT_LOG_SEARCH_SCAN_LIMIT: usize = 2000;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn git_command() -> Command {
    #[cfg(windows)]
    {
        let mut command = Command::new("git");
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(windows))]
    {
        Command::new("git")
    }
}

pub fn git_tokio_command() -> tokio::process::Command {
    #[cfg(windows)]
    {
        let mut command = tokio::process::Command::new("git");
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(windows))]
    {
        tokio::process::Command::new("git")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedGitHubUrl {
    pub owner: String,
    pub repo: String,
}

/// Parse a GitHub URL or owner/repo shorthand.
pub fn parse_github_url(url: &str) -> Option<ParsedGitHubUrl> {
    let trimmed = url.trim();

    let patterns = [
        r"^https?://github\.com/([^/]+)/([^/\s#?.]+)",
        r"^git@github\.com:([^/]+)/([^/\s#?.]+)",
        r"^github\.com/([^/]+)/([^/\s#?.]+)",
    ];

    for pattern in &patterns {
        if let Ok(re) = Regex::new(pattern) {
            if let Some(caps) = re.captures(trimmed) {
                let owner = caps.get(1)?.as_str().to_string();
                let repo = caps.get(2)?.as_str().trim_end_matches(".git").to_string();
                return Some(ParsedGitHubUrl { owner, repo });
            }
        }
    }

    if let Ok(re) = Regex::new(r"^([a-zA-Z0-9\-_]+)/([a-zA-Z0-9\-_.]+)$") {
        if let Some(caps) = re.captures(trimmed) {
            if !trimmed.contains('\\') && !trimmed.contains(':') {
                let owner = caps.get(1)?.as_str().to_string();
                let repo = caps.get(2)?.as_str().to_string();
                return Some(ParsedGitHubUrl { owner, repo });
            }
        }
    }

    None
}

/// Base directory for cloned repos.
pub fn get_clone_base_dir() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.parent().is_none() {
        if let Some(home) = dirs::home_dir() {
            return home.join(".routa").join("repos");
        }
    }
    cwd.join(".routa").join("repos")
}

pub fn repo_to_dir_name(owner: &str, repo: &str) -> String {
    format!("{owner}--{repo}")
}

pub fn dir_name_to_repo(dir_name: &str) -> String {
    let parts: Vec<&str> = dir_name.splitn(2, "--").collect();
    if parts.len() == 2 {
        format!("{}/{}", parts[0], parts[1])
    } else {
        dir_name.to_string()
    }
}

pub fn is_git_repository(repo_path: &str) -> bool {
    git_command()
        .args(["rev-parse", "--git-dir"])
        .current_dir(repo_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn is_bare_git_repository(repo_path: &str) -> bool {
    git_command()
        .args(["rev-parse", "--is-bare-repository"])
        .current_dir(repo_path)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .is_some_and(|output| String::from_utf8_lossy(&output.stdout).trim() == "true")
}

pub fn get_current_branch(repo_path: &str) -> Option<String> {
    let output = git_command()
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(repo_path)
        .output()
        .ok()?;
    if output.status.success() {
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    } else {
        None
    }
}

pub fn list_local_branches(repo_path: &str) -> Vec<String> {
    git_command()
        .args(["branch", "--format=%(refname:short)"])
        .current_dir(repo_path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

pub fn list_remote_branches(repo_path: &str) -> Vec<String> {
    git_command()
        .args(["branch", "-r", "--format=%(refname:short)"])
        .current_dir(repo_path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty() && !l.contains("HEAD"))
                .map(|l| l.trim_start_matches("origin/").to_string())
                .collect()
        })
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoBranchInfo {
    pub current: String,
    pub branches: Vec<String>,
}

pub fn get_branch_info(repo_path: &str) -> RepoBranchInfo {
    RepoBranchInfo {
        current: get_current_branch(repo_path).unwrap_or_else(|| "unknown".into()),
        branches: list_local_branches(repo_path),
    }
}

pub fn checkout_branch(repo_path: &str, branch: &str) -> bool {
    let ok = git_command()
        .args(["checkout", branch])
        .current_dir(repo_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if ok {
        return true;
    }
    git_command()
        .args(["checkout", "-b", branch])
        .current_dir(repo_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn delete_branch(repo_path: &str, branch: &str) -> Result<(), String> {
    let current_branch = get_current_branch(repo_path).unwrap_or_default();
    if current_branch == branch {
        return Err(format!("Cannot delete the current branch '{branch}'"));
    }

    if !list_local_branches(repo_path)
        .iter()
        .any(|candidate| candidate == branch)
    {
        return Err(format!("Branch '{branch}' not found"));
    }

    let output = git_command()
        .args(["branch", "-D", branch])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

pub fn fetch_remote(repo_path: &str) -> bool {
    git_command()
        .args(["fetch", "--all", "--prune"])
        .current_dir(repo_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn pull_branch(repo_path: &str) -> Result<(), String> {
    let output = git_command()
        .args(["pull", "--ff-only"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchStatus {
    pub ahead: i32,
    pub behind: i32,
    pub has_uncommitted_changes: bool,
}

pub fn get_branch_status(repo_path: &str, branch: &str) -> BranchStatus {
    let mut result = BranchStatus {
        ahead: 0,
        behind: 0,
        has_uncommitted_changes: false,
    };

    // Build the range string separately to ensure proper handling of branch names with slashes
    let range = format!("{branch}...origin/{branch}");

    if let Ok(o) = git_command()
        .args(["rev-list", "--left-right", "--count", &range])
        .current_dir(repo_path)
        .output()
    {
        if o.status.success() {
            let text = String::from_utf8_lossy(&o.stdout);
            let parts: Vec<&str> = text.split_whitespace().collect();
            if parts.len() == 2 {
                result.ahead = parts[0].parse().unwrap_or(0);
                result.behind = parts[1].parse().unwrap_or(0);
            }
        }
        // Silently ignore errors - upstream may not exist or branch may not be on remote
    }

    if let Ok(o) = git_command()
        .args(["status", "--porcelain", "-uall"])
        .current_dir(repo_path)
        .output()
    {
        if o.status.success() {
            result.has_uncommitted_changes = !String::from_utf8_lossy(&o.stdout).trim().is_empty();
        }
    }

    result
}

pub fn reset_local_changes(repo_path: &str) -> Result<(), String> {
    let reset_output = git_command()
        .args(["reset", "--hard", "HEAD"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !reset_output.status.success() {
        return Err(String::from_utf8_lossy(&reset_output.stderr)
            .trim()
            .to_string());
    }

    let clean_output = git_command()
        .args(["clean", "-fd"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !clean_output.status.success() {
        return Err(String::from_utf8_lossy(&clean_output.stderr)
            .trim()
            .to_string());
    }

    Ok(())
}

fn validate_git_paths(files: &[String]) -> Result<(), String> {
    for file in files {
        if file.trim().is_empty() {
            return Err("File path cannot be empty".to_string());
        }

        let path = Path::new(file);
        if path.is_absolute() {
            return Err(format!("Absolute file paths are not allowed: {file}"));
        }

        if path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err(format!(
                "File paths must stay within the repository root: {file}"
            ));
        }
    }

    Ok(())
}

// ============================================================================
// Git Workflow Operations (for enhanced kanban file changes UI)
// ============================================================================

/// Stage files in the Git index
pub fn stage_files(repo_path: &str, files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    validate_git_paths(files)?;

    let mut args = vec!["add", "--"];
    args.extend(files.iter().map(|s| s.as_str()));

    let output = git_command()
        .args(&args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(())
}

/// Unstage files from the Git index (keep working directory changes)
pub fn unstage_files(repo_path: &str, files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    validate_git_paths(files)?;

    let mut args = vec!["restore", "--staged", "--"];
    args.extend(files.iter().map(|s| s.as_str()));

    let output = git_command()
        .args(&args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(())
}

/// Discard changes to files in working directory
/// WARNING: This is destructive and cannot be undone
pub fn discard_changes(repo_path: &str, files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    validate_git_paths(files)?;

    let mut tracked_files: Vec<&str> = Vec::new();
    let mut untracked_files: Vec<&str> = Vec::new();

    for file in files {
        let output = git_command()
            .args(["ls-files", "--error-unmatch", "--", file.as_str()])
            .current_dir(repo_path)
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            tracked_files.push(file.as_str());
        } else {
            untracked_files.push(file.as_str());
        }
    }

    if !tracked_files.is_empty() {
        let mut restore_args = vec!["restore", "--"];
        restore_args.extend(tracked_files);

        let restore_output = git_command()
            .args(&restore_args)
            .current_dir(repo_path)
            .output()
            .map_err(|e| e.to_string())?;

        if !restore_output.status.success() {
            return Err(String::from_utf8_lossy(&restore_output.stderr)
                .trim()
                .to_string());
        }
    }

    if !untracked_files.is_empty() {
        let mut clean_args = vec!["clean", "-f", "--"];
        clean_args.extend(untracked_files);

        let clean_output = git_command()
            .args(&clean_args)
            .current_dir(repo_path)
            .output()
            .map_err(|e| e.to_string())?;

        if !clean_output.status.success() {
            return Err(String::from_utf8_lossy(&clean_output.stderr)
                .trim()
                .to_string());
        }
    }

    Ok(())
}

/// Create a commit with the given message
/// If files are provided, stages them first
/// Returns the SHA of the created commit
pub fn create_commit(
    repo_path: &str,
    message: &str,
    files: Option<&[String]>,
) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }

    // Stage specific files if provided
    if let Some(file_list) = files {
        validate_git_paths(file_list)?;
        stage_files(repo_path, file_list)?;
    }

    // Check if there are staged changes
    let check_output = git_command()
        .args(["diff", "--cached", "--name-only"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if check_output.stdout.is_empty() {
        return Err("No staged changes to commit".to_string());
    }

    // Create the commit
    let commit_output = git_command()
        .args(["commit", "-m", message])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !commit_output.status.success() {
        return Err(String::from_utf8_lossy(&commit_output.stderr)
            .trim()
            .to_string());
    }

    // Get the commit SHA
    let sha_output = git_command()
        .args(["rev-parse", "HEAD"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&sha_output.stdout)
        .trim()
        .to_string())
}

/// Pull commits from remote
pub fn pull_commits(
    repo_path: &str,
    remote: Option<&str>,
    branch: Option<&str>,
) -> Result<(), String> {
    let remote_name = remote.unwrap_or("origin");
    let mut args = vec!["pull", remote_name];

    if let Some(branch_name) = branch {
        args.push(branch_name);
    }

    let output = git_command()
        .args(&args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(())
}

/// Rebase current branch onto target branch
pub fn rebase_branch(repo_path: &str, onto: &str) -> Result<(), String> {
    let output = git_command()
        .args(["rebase", onto])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(())
}

/// Reset branch to a specific commit or branch
/// mode: "soft" keeps changes staged, "hard" discards all changes
pub fn reset_branch(
    repo_path: &str,
    to: &str,
    mode: &str,
    confirm_destructive: bool,
) -> Result<(), String> {
    let reset_mode = match mode {
        "hard" => "--hard",
        "soft" => "--soft",
        other => {
            return Err(format!(
                "Invalid reset mode '{other}'. Expected 'soft' or 'hard'"
            ))
        }
    };

    if mode == "hard" && !confirm_destructive {
        return Err("Hard reset requires explicit destructive confirmation".to_string());
    }

    let output = git_command()
        .args(["reset", reset_mode, to])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(())
}

pub fn has_local_branch(repo_path: &str, branch: &str) -> bool {
    git_command()
        .args(["rev-parse", "--verify", &format!("refs/heads/{branch}")])
        .current_dir(repo_path)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub fn checkout_existing_branch(repo_path: &str, branch: &str) -> Result<(), String> {
    let output = git_command()
        .args(["checkout", branch])
        .current_dir(repo_path)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub additions: i32,
    pub deletions: i32,
    pub parents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitRefKind {
    Head,
    Local,
    Remote,
    Tag,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitLogRef {
    pub name: String,
    pub remote: Option<String>,
    pub kind: GitRefKind,
    pub commit_sha: String,
    pub is_current: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphEdge {
    pub from_lane: i32,
    pub to_lane: i32,
    pub is_merge: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogCommit {
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub parents: Vec<String>,
    pub refs: Vec<GitLogRef>,
    pub lane: Option<i32>,
    pub graph_edges: Option<Vec<GitGraphEdge>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogPage {
    pub commits: Vec<GitLogCommit>,
    pub total: usize,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefsResult {
    pub head: Option<GitLogRef>,
    pub local: Vec<GitLogRef>,
    pub remote: Vec<GitLogRef>,
    pub tags: Vec<GitLogRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CommitFileChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFileChange {
    pub path: String,
    pub previous_path: Option<String>,
    pub status: CommitFileChangeKind,
    pub additions: i32,
    pub deletions: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetail {
    pub commit: GitLogCommit,
    pub files: Vec<GitCommitFileChange>,
    pub patch: Option<String>,
}

fn git_refs_map(refs: &GitRefsResult) -> HashMap<String, Vec<GitLogRef>> {
    let mut map: HashMap<String, Vec<GitLogRef>> = HashMap::new();

    for git_ref in refs
        .head
        .iter()
        .cloned()
        .chain(refs.local.iter().cloned())
        .chain(refs.remote.iter().cloned())
        .chain(refs.tags.iter().cloned())
    {
        map.entry(git_ref.commit_sha.clone())
            .or_default()
            .push(git_ref);
    }

    map
}

fn parse_git_log_records(
    output: &str,
    ref_map: &HashMap<String, Vec<GitLogRef>>,
) -> Vec<GitLogCommit> {
    output
        .split('\0')
        .map(str::trim)
        .filter(|record| !record.is_empty())
        .filter_map(|record| {
            let parts: Vec<&str> = record.split('\u{001f}').collect();
            if parts.len() < 7 {
                return None;
            }

            let sha = parts[0].trim();
            let short_sha = parts[1].trim();
            let summary = parts[2].trim();
            let author_name = parts[3].trim();
            let author_email = parts[4].trim();
            let authored_at = parts[5].trim();
            let parents: Vec<String> = parts[6].split_whitespace().map(str::to_string).collect();

            if sha.is_empty()
                || short_sha.is_empty()
                || summary.is_empty()
                || author_name.is_empty()
                || authored_at.is_empty()
            {
                return None;
            }

            let lane = if parents.len() > 1 { 1 } else { 0 };
            let graph_edges = if parents.len() > 1 {
                vec![
                    GitGraphEdge {
                        from_lane: 1,
                        to_lane: 0,
                        is_merge: Some(true),
                    },
                    GitGraphEdge {
                        from_lane: 1,
                        to_lane: 1,
                        is_merge: None,
                    },
                ]
            } else {
                vec![GitGraphEdge {
                    from_lane: 0,
                    to_lane: 0,
                    is_merge: None,
                }]
            };

            Some(GitLogCommit {
                sha: sha.to_string(),
                short_sha: short_sha.to_string(),
                message: summary.to_string(),
                summary: summary.to_string(),
                author_name: author_name.to_string(),
                author_email: author_email.to_string(),
                authored_at: authored_at.to_string(),
                parents,
                refs: ref_map.get(sha).cloned().unwrap_or_default(),
                lane: Some(lane),
                graph_edges: Some(graph_edges),
            })
        })
        .collect()
}

fn git_log_matches_search(commit: &GitLogCommit, query: &str) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }

    [
        commit.sha.as_str(),
        commit.short_sha.as_str(),
        commit.summary.as_str(),
        commit.author_name.as_str(),
        commit.author_email.as_str(),
    ]
    .iter()
    .any(|value| value.to_lowercase().contains(&query))
}

fn git_commit_file_status(code: &str) -> CommitFileChangeKind {
    match code.chars().next().unwrap_or('M') {
        'A' => CommitFileChangeKind::Added,
        'D' => CommitFileChangeKind::Deleted,
        'R' => CommitFileChangeKind::Renamed,
        'C' => CommitFileChangeKind::Copied,
        _ => CommitFileChangeKind::Modified,
    }
}

pub fn list_git_refs(repo_path: &str) -> Result<GitRefsResult, String> {
    let current_branch = get_current_branch(repo_path);

    let local_output = git_command()
        .args([
            "for-each-ref",
            "--format=%(refname:short)%09%(objectname)",
            "refs/heads/",
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|error| error.to_string())?;

    if !local_output.status.success() {
        return Err(String::from_utf8_lossy(&local_output.stderr)
            .trim()
            .to_string());
    }

    let local: Vec<GitLogRef> = String::from_utf8_lossy(&local_output.stdout)
        .lines()
        .filter_map(|line| {
            let (name, sha) = line.split_once('\t')?;
            let name = name.trim();
            let sha = sha.trim();
            if name.is_empty() || sha.is_empty() {
                return None;
            }

            Some(GitLogRef {
                name: name.to_string(),
                remote: None,
                kind: GitRefKind::Local,
                commit_sha: sha.to_string(),
                is_current: Some(current_branch.as_deref() == Some(name)),
            })
        })
        .collect();

    let head = local
        .iter()
        .find(|git_ref| git_ref.is_current == Some(true))
        .map(|git_ref| {
            let mut head_ref = git_ref.clone();
            head_ref.kind = GitRefKind::Head;
            head_ref.is_current = Some(true);
            head_ref
        });

    let remote_output = git_command()
        .args([
            "for-each-ref",
            "--format=%(refname:short)%09%(objectname)",
            "refs/remotes/",
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|error| error.to_string())?;

    let remote = if remote_output.status.success() {
        String::from_utf8_lossy(&remote_output.stdout)
            .lines()
            .filter_map(|line| {
                let (full_name, sha) = line.split_once('\t')?;
                let full_name = full_name.trim();
                let sha = sha.trim();
                if full_name.is_empty()
                    || sha.is_empty()
                    || full_name.ends_with("/HEAD")
                    || !full_name.contains('/')
                {
                    return None;
                }

                let (remote, name) = full_name.split_once('/')?;
                if remote.is_empty() || name.is_empty() {
                    return None;
                }

                Some(GitLogRef {
                    name: name.to_string(),
                    remote: Some(remote.to_string()),
                    kind: GitRefKind::Remote,
                    commit_sha: sha.to_string(),
                    is_current: None,
                })
            })
            .collect()
    } else {
        Vec::new()
    };

    let tag_output = git_command()
        .args([
            "for-each-ref",
            "--format=%(refname:short)%09%(*objectname)%09%(objectname)",
            "refs/tags/",
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|error| error.to_string())?;

    let tags = if tag_output.status.success() {
        String::from_utf8_lossy(&tag_output.stdout)
            .lines()
            .filter_map(|line| {
                let mut parts = line.split('\t');
                let name = parts.next()?.trim();
                let deref_sha = parts.next().unwrap_or_default().trim();
                let sha = if deref_sha.is_empty() {
                    parts.next().unwrap_or_default().trim()
                } else {
                    deref_sha
                };
                if name.is_empty() || sha.is_empty() {
                    return None;
                }

                Some(GitLogRef {
                    name: name.to_string(),
                    remote: None,
                    kind: GitRefKind::Tag,
                    commit_sha: sha.to_string(),
                    is_current: None,
                })
            })
            .collect()
    } else {
        Vec::new()
    };

    Ok(GitRefsResult {
        head,
        local,
        remote,
        tags,
    })
}

pub fn get_git_log_page(
    repo_path: &str,
    branches: Option<&[String]>,
    search: Option<&str>,
    limit: Option<usize>,
    skip: Option<usize>,
) -> Result<GitLogPage, String> {
    let refs = list_git_refs(repo_path)?;
    let ref_map = git_refs_map(&refs);
    let limit = limit.unwrap_or(40).min(200);
    let skip = skip.unwrap_or(0);
    let search = search.unwrap_or("").trim().to_string();
    let branch_filters: Vec<String> = branches
        .unwrap_or(&[])
        .iter()
        .map(|branch| branch.trim())
        .filter(|branch| !branch.is_empty())
        .map(str::to_string)
        .collect();
    let has_branch_filters = !branch_filters.is_empty();
    let should_scan_for_search = !search.is_empty();

    let mut command = git_command();
    command.args([
        "--no-pager",
        "log",
        "--date-order",
        "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%P%x00",
    ]);

    if should_scan_for_search {
        command.arg(format!("--max-count={GIT_LOG_SEARCH_SCAN_LIMIT}"));
    } else {
        command.arg(format!("--skip={skip}"));
        command.arg(format!("--max-count={}", limit + 1));
    }

    if has_branch_filters {
        for branch in &branch_filters {
            command.arg(branch);
        }
    } else {
        command.arg("--all");
    }

    let output = command
        .current_dir(repo_path)
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Ok(GitLogPage {
            commits: Vec::new(),
            total: 0,
            has_more: false,
        });
    }

    let parsed_commits = parse_git_log_records(&String::from_utf8_lossy(&output.stdout), &ref_map);

    if should_scan_for_search {
        let filtered_commits: Vec<GitLogCommit> = parsed_commits
            .into_iter()
            .filter(|commit| git_log_matches_search(commit, &search))
            .collect();
        let commits = filtered_commits
            .iter()
            .skip(skip)
            .take(limit)
            .cloned()
            .collect::<Vec<_>>();
        let total = filtered_commits.len();

        return Ok(GitLogPage {
            commits,
            total,
            has_more: skip + limit < total,
        });
    }

    let total = {
        let mut count_command = git_command();
        count_command.args(["rev-list", "--count"]);
        if has_branch_filters {
            for branch in &branch_filters {
                count_command.arg(branch);
            }
        } else {
            count_command.arg("--all");
        }

        match count_command.current_dir(repo_path).output() {
            Ok(count_output) if count_output.status.success() => {
                String::from_utf8_lossy(&count_output.stdout)
                    .trim()
                    .parse::<usize>()
                    .unwrap_or(parsed_commits.len())
            }
            _ => parsed_commits.len(),
        }
    };

    let has_more = parsed_commits.len() > limit;
    let commits = parsed_commits.into_iter().take(limit).collect();

    Ok(GitLogPage {
        commits,
        total,
        has_more,
    })
}

pub fn get_git_commit_detail(repo_path: &str, sha: &str) -> Result<GitCommitDetail, String> {
    let refs = list_git_refs(repo_path)?;
    let ref_map = git_refs_map(&refs);

    let metadata_output = git_command()
        .args([
            "--no-pager",
            "show",
            "-s",
            "--format=%H%x00%h%x00%s%x00%B%x00%an%x00%ae%x00%aI%x00%P",
            sha,
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|error| error.to_string())?;

    if !metadata_output.status.success() {
        return Err(String::from_utf8_lossy(&metadata_output.stderr)
            .trim()
            .to_string());
    }

    let metadata = String::from_utf8_lossy(&metadata_output.stdout);
    let parts: Vec<&str> = metadata.split('\0').collect();
    if parts.len() < 8 {
        return Err("Failed to parse commit metadata".to_string());
    }

    let sha = parts[0].trim().to_string();
    let short_sha = parts[1].trim().to_string();
    let summary = parts[2].trim().to_string();
    let message = parts[3].trim().to_string();
    let author_name = parts[4].trim().to_string();
    let author_email = parts[5].trim().to_string();
    let authored_at = parts[6].trim().to_string();
    let parents = parts[7]
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();

    let name_status_output = git_command()
        .args(["show", "--format=", "--name-status", sha.as_str()])
        .current_dir(repo_path)
        .output()
        .map_err(|error| error.to_string())?;

    if !name_status_output.status.success() {
        return Err(String::from_utf8_lossy(&name_status_output.stderr)
            .trim()
            .to_string());
    }

    let numstat_output = git_command()
        .args(["show", "--format=", "--numstat", sha.as_str()])
        .current_dir(repo_path)
        .output()
        .map_err(|error| error.to_string())?;

    if !numstat_output.status.success() {
        return Err(String::from_utf8_lossy(&numstat_output.stderr)
            .trim()
            .to_string());
    }

    let mut file_stats = HashMap::new();
    for line in String::from_utf8_lossy(&numstat_output.stdout).lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }

        let additions = if parts[0] == "-" {
            0
        } else {
            parts[0].parse::<i32>().unwrap_or(0)
        };
        let deletions = if parts[1] == "-" {
            0
        } else {
            parts[1].parse::<i32>().unwrap_or(0)
        };
        file_stats.insert(parts[2].to_string(), (additions, deletions));
    }

    let files = String::from_utf8_lossy(&name_status_output.stdout)
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 2 {
                return None;
            }

            let status = git_commit_file_status(parts[0]);
            let (path, previous_path) = if matches!(
                status,
                CommitFileChangeKind::Renamed | CommitFileChangeKind::Copied
            ) && parts.len() >= 3
            {
                (parts[2].to_string(), Some(parts[1].to_string()))
            } else {
                (parts[1].to_string(), None)
            };

            let key = previous_path.clone().unwrap_or_else(|| path.clone());
            let (additions, deletions) = file_stats.get(&key).copied().unwrap_or_default();

            Some(GitCommitFileChange {
                path,
                previous_path,
                status,
                additions,
                deletions,
            })
        })
        .collect();

    let commit = GitLogCommit {
        sha: sha.clone(),
        short_sha,
        message,
        summary,
        author_name,
        author_email,
        authored_at,
        parents: parents.clone(),
        refs: ref_map.get(&sha).cloned().unwrap_or_default(),
        lane: Some(if parents.len() > 1 { 1 } else { 0 }),
        graph_edges: Some(if parents.len() > 1 {
            vec![
                GitGraphEdge {
                    from_lane: 1,
                    to_lane: 0,
                    is_merge: Some(true),
                },
                GitGraphEdge {
                    from_lane: 1,
                    to_lane: 1,
                    is_merge: None,
                },
            ]
        } else {
            vec![GitGraphEdge {
                from_lane: 0,
                to_lane: 0,
                is_merge: None,
            }]
        }),
    };

    Ok(GitCommitDetail {
        commit,
        files,
        patch: None,
    })
}

/// Get commit history from current branch
pub fn get_commit_list(
    repo_path: &str,
    limit: Option<usize>,
    since: Option<&str>,
) -> Result<Vec<CommitInfo>, String> {
    let limit_str = limit.unwrap_or(20).to_string();
    let mut args = vec![
        "log",
        "--format=%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1f%P%x1d",
        "--numstat",
        "-n",
        &limit_str,
    ];

    let since_str;
    if let Some(since_value) = since {
        since_str = format!("--since={since_value}");
        args.push(&since_str);
    }

    let output = git_command()
        .args(&args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let mut commits = Vec::new();
    for record in String::from_utf8_lossy(&output.stdout)
        .split('\u{001e}')
        .map(str::trim)
        .filter(|record| !record.is_empty())
    {
        let Some((header, stats_section)) = record.split_once('\u{001d}') else {
            continue;
        };

        let parts: Vec<&str> = header.split('\u{001f}').collect();
        if parts.len() < 8 {
            continue;
        }

        let sha = parts[0].trim().to_string();
        let short_sha = parts[1].trim().to_string();
        let author_name = parts[2].trim().to_string();
        let author_email = parts[3].trim().to_string();
        let authored_at = parts[4].trim().to_string();
        let subject = parts[5].trim().to_string();
        let body = parts[6].trim().to_string();
        let parents_str = parts[7].trim();
        let parents: Vec<String> = if parents_str.is_empty() {
            Vec::new()
        } else {
            parents_str
                .split_whitespace()
                .map(|value| value.to_string())
                .collect()
        };

        let message = if body.is_empty() {
            subject.clone()
        } else {
            format!("{subject}\n\n{body}")
        };

        let mut additions = 0;
        let mut deletions = 0;

        for stat_line in stats_section
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
        {
            let stat_parts: Vec<&str> = stat_line.split('\t').collect();
            if stat_parts.len() >= 2 {
                if stat_parts[0] != "-" {
                    additions += stat_parts[0].parse::<i32>().unwrap_or(0);
                }
                if stat_parts[1] != "-" {
                    deletions += stat_parts[1].parse::<i32>().unwrap_or(0);
                }
            }
        }

        commits.push(CommitInfo {
            sha,
            short_sha,
            message,
            summary: subject,
            author_name,
            author_email,
            authored_at,
            additions,
            deletions,
            parents,
        });
    }

    Ok(commits)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub clean: bool,
    pub ahead: i32,
    pub behind: i32,
    pub modified: i32,
    pub untracked: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileChangeStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Typechange,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChange {
    pub path: String,
    pub status: FileChangeStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoChanges {
    pub branch: String,
    pub status: RepoStatus,
    pub files: Vec<GitFileChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoCommitChange {
    pub sha: String,
    pub short_sha: String,
    pub summary: String,
    pub author_name: String,
    pub authored_at: String,
    pub additions: i32,
    pub deletions: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoFileDiff {
    pub path: String,
    pub status: FileChangeStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
    pub patch: String,
    pub additions: i32,
    pub deletions: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoCommitDiff {
    pub sha: String,
    pub short_sha: String,
    pub summary: String,
    pub author_name: String,
    pub authored_at: String,
    pub patch: String,
    pub additions: i32,
    pub deletions: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalRelatedFile {
    pub path: String,
    pub score: f64,
    pub source_files: Vec<String>,
    pub related_commits: Vec<String>,
}

#[derive(Default)]
struct HistoricalCandidateAggregate {
    hits: u32,
    source_files: BTreeSet<String>,
    related_commits: BTreeSet<String>,
}

#[derive(Debug, Clone)]
struct BlameChunk {
    commit: String,
    start: u32,
    end: u32,
}

pub fn get_repo_status(repo_path: &str) -> RepoStatus {
    let mut status = RepoStatus {
        clean: true,
        ahead: 0,
        behind: 0,
        modified: 0,
        untracked: 0,
    };

    if let Ok(o) = git_command()
        .args(["status", "--porcelain", "-uall"])
        .current_dir(repo_path)
        .output()
    {
        if o.status.success() {
            let text = String::from_utf8_lossy(&o.stdout);
            let lines: Vec<&str> = text.lines().filter(|l| !l.is_empty()).collect();
            status.modified = lines.iter().filter(|l| !l.starts_with("??")).count() as i32;
            status.untracked = lines.iter().filter(|l| l.starts_with("??")).count() as i32;
            status.clean = lines.is_empty();
        }
    }

    if let Ok(o) = git_command()
        .args(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
        .current_dir(repo_path)
        .output()
    {
        if o.status.success() {
            let text = String::from_utf8_lossy(&o.stdout);
            let parts: Vec<&str> = text.split_whitespace().collect();
            if parts.len() == 2 {
                status.ahead = parts[0].parse().unwrap_or(0);
                status.behind = parts[1].parse().unwrap_or(0);
            }
        }
    }

    status
}

fn map_porcelain_status(code: &str) -> FileChangeStatus {
    if code == "??" {
        return FileChangeStatus::Untracked;
    }

    let mut chars = code.chars();
    let index_status = chars.next().unwrap_or(' ');
    let worktree_status = chars.next().unwrap_or(' ');

    if index_status == 'U' || worktree_status == 'U' || code == "AA" || code == "DD" {
        return FileChangeStatus::Conflicted;
    }
    if index_status == 'R' || worktree_status == 'R' {
        return FileChangeStatus::Renamed;
    }
    if index_status == 'C' || worktree_status == 'C' {
        return FileChangeStatus::Copied;
    }
    if index_status == 'A' || worktree_status == 'A' {
        return FileChangeStatus::Added;
    }
    if index_status == 'D' || worktree_status == 'D' {
        return FileChangeStatus::Deleted;
    }
    if index_status == 'T' || worktree_status == 'T' {
        return FileChangeStatus::Typechange;
    }
    FileChangeStatus::Modified
}

pub fn parse_git_status_porcelain(output: &str) -> Vec<GitFileChange> {
    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            if line.len() < 3 {
                return None;
            }

            let code = &line[0..2];
            if code == "!!" {
                return None;
            }

            let raw_path = line[3..].trim().to_string();
            let status = map_porcelain_status(code);

            if matches!(status, FileChangeStatus::Renamed | FileChangeStatus::Copied)
                && raw_path.contains(" -> ")
            {
                let parts: Vec<&str> = raw_path.splitn(2, " -> ").collect();
                if parts.len() == 2 {
                    return Some(GitFileChange {
                        path: parts[1].to_string(),
                        previous_path: Some(parts[0].to_string()),
                        status,
                    });
                }
            }

            Some(GitFileChange {
                path: raw_path,
                previous_path: None,
                status,
            })
        })
        .collect()
}

pub fn get_repo_changes(repo_path: &str) -> RepoChanges {
    let branch = get_current_branch(repo_path).unwrap_or_else(|| "unknown".into());
    let status = get_repo_status(repo_path);
    let files = git_command()
        .args(["status", "--porcelain", "-uall"])
        .current_dir(repo_path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| parse_git_status_porcelain(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default();

    RepoChanges {
        branch,
        status,
        files,
    }
}

fn has_git_ref(repo_path: &str, git_ref: &str) -> bool {
    git_command()
        .args(["rev-parse", "--verify", git_ref])
        .current_dir(repo_path)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub fn resolve_base_ref(repo_path: &str, base_branch: Option<&str>) -> Option<String> {
    let normalized_base_branch = base_branch.map(str::trim).filter(|value| !value.is_empty());
    let candidates = [
        normalized_base_branch.map(|branch| format!("origin/{branch}")),
        normalized_base_branch.map(str::to_string),
        Some("origin/main".to_string()),
        Some("main".to_string()),
        Some("origin/master".to_string()),
        Some("master".to_string()),
    ];

    candidates
        .into_iter()
        .flatten()
        .find(|candidate| has_git_ref(repo_path, candidate))
}

fn git_output_in_repo(repo_path: &str, args: &[&str]) -> Option<String> {
    git_command()
        .args(args)
        .current_dir(repo_path)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn get_remote_url(repo_path: &str) -> Option<String> {
    git_output_in_repo(repo_path, &["config", "--get", "remote.origin.url"]).and_then(|output| {
        let trimmed = output.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub fn count_commits_since_ref(repo_path: &str, base_ref: &str) -> usize {
    let range = format!("{base_ref}..HEAD");
    git_output_in_repo(repo_path, &["rev-list", "--count", range.as_str()])
        .and_then(|output| output.trim().parse::<usize>().ok())
        .unwrap_or(0)
}

fn count_numstat_totals(numstat: &str) -> (i32, i32) {
    numstat
        .lines()
        .fold((0, 0), |(additions, deletions), line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 3 {
                return (additions, deletions);
            }

            let next_additions = if parts[0] == "-" {
                additions
            } else {
                additions + parts[0].parse::<i32>().unwrap_or(0)
            };
            let next_deletions = if parts[1] == "-" {
                deletions
            } else {
                deletions + parts[1].parse::<i32>().unwrap_or(0)
            };

            (next_additions, next_deletions)
        })
}

pub fn get_repo_commit_changes(
    repo_path: &str,
    base_ref: &str,
    max_count: Option<usize>,
) -> Vec<RepoCommitChange> {
    let max_count = std::cmp::max(max_count.unwrap_or(20), 1);
    let range = format!("{base_ref}..HEAD");
    let max_count_str = max_count.to_string();
    let output = match git_output_in_repo(
        repo_path,
        &[
            "log",
            "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI",
            range.as_str(),
            "-n",
            max_count_str.as_str(),
        ],
    ) {
        Some(output) => output,
        None => return Vec::new(),
    };

    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\u{001f}').collect();
            if parts.len() < 5 {
                return None;
            }

            let sha = parts[0].trim();
            let short_sha = parts[1].trim();
            let summary = parts[2].trim();
            let author_name = parts[3].trim();
            let authored_at = parts[4].trim();

            if sha.is_empty()
                || short_sha.is_empty()
                || summary.is_empty()
                || author_name.is_empty()
                || authored_at.is_empty()
            {
                return None;
            }

            let numstat = git_output_in_repo(
                repo_path,
                &[
                    "--no-pager",
                    "show",
                    "--format=",
                    "--numstat",
                    "--find-renames",
                    "--find-copies",
                    sha,
                ],
            )
            .unwrap_or_default();
            let (additions, deletions) = count_numstat_totals(&numstat);

            Some(RepoCommitChange {
                sha: sha.to_string(),
                short_sha: short_sha.to_string(),
                summary: summary.to_string(),
                author_name: author_name.to_string(),
                authored_at: authored_at.to_string(),
                additions,
                deletions,
            })
        })
        .collect()
}

fn count_diff_patch_lines(patch: &str) -> (i32, i32) {
    let mut additions = 0;
    let mut deletions = 0;

    for line in patch.lines() {
        if line.starts_with("+++ ") || line.starts_with("--- ") {
            continue;
        }
        if line.starts_with('+') {
            additions += 1;
        } else if line.starts_with('-') {
            deletions += 1;
        }
    }

    (additions, deletions)
}

fn build_synthetic_added_diff(repo_path: &str, file: &GitFileChange) -> String {
    let file_path = Path::new(repo_path).join(&file.path);
    let content = std::fs::read_to_string(&file_path).unwrap_or_default();
    let additions = content
        .lines()
        .map(|line| format!("+{line}"))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{count} @@\n{body}",
        path = file.path,
        count = content.lines().count(),
        body = additions
    )
}

fn build_synthetic_rename_diff(file: &GitFileChange) -> String {
    let previous_path = file.previous_path.clone().unwrap_or_default();
    format!(
        "diff --git a/{previous_path} b/{path}\nsimilarity index 100%\nrename from {previous_path}\nrename to {path}\n",
        previous_path = previous_path,
        path = file.path
    )
}

pub fn get_repo_file_diff(repo_path: &str, file: &GitFileChange) -> RepoFileDiff {
    let patch = [
        vec![
            "--no-pager",
            "diff",
            "--no-ext-diff",
            "--find-renames",
            "--find-copies",
            "--",
            file.path.as_str(),
        ],
        vec![
            "--no-pager",
            "diff",
            "--no-ext-diff",
            "--find-renames",
            "--find-copies",
            "--cached",
            "--",
            file.path.as_str(),
        ],
        vec![
            "--no-pager",
            "diff",
            "--no-ext-diff",
            "--find-renames",
            "--find-copies",
            "HEAD",
            "--",
            file.path.as_str(),
        ],
    ]
    .iter()
    .filter_map(|args| git_output_in_repo(repo_path, args))
    .find(|candidate| !candidate.trim().is_empty())
    .unwrap_or_else(|| {
        if matches!(
            file.status,
            FileChangeStatus::Untracked | FileChangeStatus::Added
        ) {
            build_synthetic_added_diff(repo_path, file)
        } else if matches!(file.status, FileChangeStatus::Renamed) && file.previous_path.is_some() {
            build_synthetic_rename_diff(file)
        } else {
            String::new()
        }
    });

    let (additions, deletions) = count_diff_patch_lines(&patch);
    RepoFileDiff {
        path: file.path.clone(),
        status: file.status.clone(),
        previous_path: file.previous_path.clone(),
        patch,
        additions,
        deletions,
    }
}

pub fn get_repo_commit_diff(repo_path: &str, sha: &str) -> RepoCommitDiff {
    let summary =
        git_output_in_repo(repo_path, &["show", "-s", "--format=%s", sha]).unwrap_or_default();
    let short_sha =
        git_output_in_repo(repo_path, &["rev-parse", "--short", sha]).unwrap_or_default();
    let author_name =
        git_output_in_repo(repo_path, &["show", "-s", "--format=%an", sha]).unwrap_or_default();
    let authored_at =
        git_output_in_repo(repo_path, &["show", "-s", "--format=%aI", sha]).unwrap_or_default();
    let patch = git_output_in_repo(
        repo_path,
        &[
            "--no-pager",
            "show",
            "--no-ext-diff",
            "--find-renames",
            "--find-copies",
            "--format=medium",
            "--unified=3",
            sha,
        ],
    )
    .unwrap_or_default();
    let (additions, deletions) = count_diff_patch_lines(&patch);

    RepoCommitDiff {
        sha: sha.to_string(),
        short_sha: short_sha.trim().to_string(),
        summary: summary.trim().to_string(),
        author_name: author_name.trim().to_string(),
        authored_at: authored_at.trim().to_string(),
        patch,
        additions,
        deletions,
    }
}

fn git_output_at_path(repo_root: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_command()
        .args(args)
        .current_dir(repo_root)
        .output()
        .map_err(|err| format!("Failed to run git {}: {}", args.join(" "), err))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

/// Build historical co-change context for a review diff range.
///
/// The output is intentionally compact and best-effort friendly for review payloads.
pub fn compute_historical_related_files(
    repo_root: &Path,
    diff_range: &str,
    head: &str,
    max_results: usize,
) -> Result<Vec<HistoricalRelatedFile>, String> {
    let changed_files: Vec<String> =
        git_output_at_path(repo_root, &["diff", "--name-only", diff_range])?
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect();

    if changed_files.is_empty() {
        return Ok(Vec::new());
    }

    let source_files: Vec<String> = changed_files.into_iter().take(8).collect();
    let changed_file_set: BTreeSet<String> = source_files.iter().cloned().collect();
    let mut candidate_map: HashMap<String, HistoricalCandidateAggregate> = HashMap::new();
    let mut blame_cache: HashMap<String, Vec<BlameChunk>> = HashMap::new();
    let mut commit_paths_cache: HashMap<String, Vec<String>> = HashMap::new();

    for source_file in &source_files {
        if !file_exists_at_revision(repo_root, head, source_file) {
            continue;
        }

        let line_samples = collect_interesting_lines(repo_root, diff_range, source_file)?;
        if line_samples.is_empty() {
            continue;
        }

        let blame_chunks = load_blame_chunks(repo_root, head, source_file, &mut blame_cache)?;
        if blame_chunks.is_empty() {
            continue;
        }

        let mut interesting_commits: Vec<(String, u32)> =
            collect_interesting_commits(&blame_chunks, &line_samples)
                .into_iter()
                .collect();
        interesting_commits
            .sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
        interesting_commits.truncate(8);

        for (commit_sha, hits) in interesting_commits {
            let changed_in_commit =
                load_changed_files_for_commit(repo_root, &commit_sha, &mut commit_paths_cache)?;

            for candidate_path in changed_in_commit {
                if candidate_path.is_empty()
                    || candidate_path == *source_file
                    || changed_file_set.contains(&candidate_path)
                {
                    continue;
                }

                let entry = candidate_map.entry(candidate_path).or_default();
                entry.hits = entry.hits.saturating_add(hits);
                entry.source_files.insert(source_file.clone());
                entry.related_commits.insert(commit_sha.clone());
            }
        }
    }

    if candidate_map.is_empty() {
        return Ok(Vec::new());
    }

    let mut related_files: Vec<HistoricalRelatedFile> = candidate_map
        .into_iter()
        .map(|(path, aggregate)| HistoricalRelatedFile {
            path,
            score: aggregate.hits as f64,
            source_files: aggregate.source_files.into_iter().collect(),
            related_commits: aggregate.related_commits.into_iter().collect(),
        })
        .collect();

    related_files.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| right.source_files.len().cmp(&left.source_files.len()))
            .then_with(|| left.path.cmp(&right.path))
    });

    if max_results > 0 && related_files.len() > max_results {
        related_files.truncate(max_results);
    }

    Ok(related_files)
}

fn file_exists_at_revision(repo_root: &Path, revision: &str, file_path: &str) -> bool {
    git_command()
        .args(["cat-file", "-e", &format!("{revision}:{file_path}")])
        .current_dir(repo_root)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn collect_interesting_lines(
    repo_root: &Path,
    diff_range: &str,
    file_path: &str,
) -> Result<Vec<u32>, String> {
    let raw_diff = git_output_at_path(
        repo_root,
        &["diff", "--unified=0", diff_range, "--", file_path],
    )?;
    if raw_diff.is_empty() {
        return Ok(Vec::new());
    }

    let hunk_pattern = Regex::new(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
        .map_err(|err| format!("Failed to compile diff hunk regex: {err}"))?;
    let mut interesting_lines = BTreeSet::new();

    for line in raw_diff.lines() {
        let Some(captures) = hunk_pattern.captures(line) else {
            continue;
        };

        let start = captures
            .get(1)
            .and_then(|value| value.as_str().parse::<u32>().ok())
            .unwrap_or(0);
        let count = captures
            .get(2)
            .and_then(|value| value.as_str().parse::<u32>().ok())
            .unwrap_or(1);
        let span = if count == 0 { 1 } else { count };
        let end = start.saturating_add(span.saturating_sub(1));

        for line_number in [start.saturating_sub(1), start, end, end.saturating_add(1)] {
            if line_number > 0 {
                interesting_lines.insert(line_number);
            }
        }
    }

    Ok(interesting_lines.into_iter().collect())
}

fn load_blame_chunks(
    repo_root: &Path,
    revision: &str,
    file_path: &str,
    cache: &mut HashMap<String, Vec<BlameChunk>>,
) -> Result<Vec<BlameChunk>, String> {
    let cache_key = format!("{revision}:{file_path}");
    if let Some(chunks) = cache.get(&cache_key) {
        return Ok(chunks.clone());
    }

    let raw_blame = match git_output_at_path(
        repo_root,
        &["blame", "--incremental", revision, "--", file_path],
    ) {
        Ok(output) => output,
        Err(_) => {
            cache.insert(cache_key, Vec::new());
            return Ok(Vec::new());
        }
    };

    let header_pattern = Regex::new(r"^([0-9a-f]{40}) \d+ (\d+) (\d+)$")
        .map_err(|err| format!("Failed to compile blame regex: {err}"))?;
    let mut chunks = Vec::new();
    let mut current_chunk: Option<BlameChunk> = None;

    for line in raw_blame.lines() {
        if let Some(captures) = header_pattern.captures(line) {
            let commit = captures
                .get(1)
                .map(|value| value.as_str().to_string())
                .unwrap_or_default();
            let start = captures
                .get(2)
                .and_then(|value| value.as_str().parse::<u32>().ok())
                .unwrap_or(0);
            let num_lines = captures
                .get(3)
                .and_then(|value| value.as_str().parse::<u32>().ok())
                .unwrap_or(0);
            current_chunk = Some(BlameChunk {
                commit,
                start,
                end: start.saturating_add(num_lines),
            });
            continue;
        }

        if line.starts_with("filename ") {
            if let Some(chunk) = current_chunk.take() {
                chunks.push(chunk);
            }
        }
    }

    chunks.sort_by(|left, right| left.start.cmp(&right.start));
    cache.insert(cache_key, chunks.clone());
    Ok(chunks)
}

fn collect_interesting_commits(
    blame_chunks: &[BlameChunk],
    line_numbers: &[u32],
) -> HashMap<String, u32> {
    let mut commit_hits = HashMap::new();

    for line_number in line_numbers {
        if let Some(chunk) = blame_chunks
            .iter()
            .find(|candidate| *line_number >= candidate.start && *line_number < candidate.end)
        {
            *commit_hits.entry(chunk.commit.clone()).or_insert(0) += 1;
        }
    }

    commit_hits
}

fn load_changed_files_for_commit(
    repo_root: &Path,
    commit: &str,
    cache: &mut HashMap<String, Vec<String>>,
) -> Result<Vec<String>, String> {
    if let Some(files) = cache.get(commit) {
        return Ok(files.clone());
    }

    let raw_files = match git_output_at_path(
        repo_root,
        &[
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-only",
            "-r",
            "-m",
            commit,
        ],
    ) {
        Ok(output) => output,
        Err(_) => {
            cache.insert(commit.to_string(), Vec::new());
            return Ok(Vec::new());
        }
    };

    let files: Vec<String> = raw_files
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    cache.insert(commit.to_string(), files.clone());
    Ok(files)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClonedRepoInfo {
    pub name: String,
    pub path: String,
    pub dir_name: String,
    pub branch: String,
    pub branches: Vec<String>,
    pub status: RepoStatus,
}

/// List all cloned repos with branch and status info.
pub fn list_cloned_repos() -> Vec<ClonedRepoInfo> {
    let base_dir = get_clone_base_dir();
    if !base_dir.exists() {
        return vec![];
    }

    let entries = match std::fs::read_dir(&base_dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };

    entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let full_path = e.path();
            let dir_name = e.file_name().to_string_lossy().to_string();
            let path_str = full_path.to_string_lossy().to_string();
            let branch_info = get_branch_info(&path_str);
            let repo_status = get_repo_status(&path_str);
            ClonedRepoInfo {
                name: dir_name_to_repo(&dir_name),
                path: path_str,
                dir_name,
                branch: branch_info.current,
                branches: branch_info.branches,
                status: repo_status,
            }
        })
        .collect()
}

/// Discover skills from a given path (looks for SKILL.md files in well-known subdirectories).
pub fn discover_skills_from_path(repo_path: &Path) -> Vec<DiscoveredSkill> {
    let dirs_to_check = [
        "skills",
        ".agents/skills",
        ".opencode/skills",
        ".claude/skills",
    ];

    let mut result = Vec::new();

    for dir in &dirs_to_check {
        let skill_dir = repo_path.join(dir);
        if skill_dir.is_dir() {
            scan_skill_dir(&skill_dir, &mut result);
        }
    }

    // Also check root-level SKILL.md
    let root_skill = repo_path.join("SKILL.md");
    if root_skill.is_file() {
        if let Some(skill) = parse_discovered_skill(&root_skill) {
            result.push(skill);
        }
    }

    result
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSkill {
    pub name: String,
    pub description: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compatibility: Option<String>,
}

fn scan_skill_dir(dir: &Path, out: &mut Vec<DiscoveredSkill>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let skill_file = path.join("SKILL.md");
            if skill_file.is_file() {
                if let Some(skill) = parse_discovered_skill(&skill_file) {
                    out.push(skill);
                }
            }
        }
    }
}

/// YAML frontmatter structure for discovered skills.
#[derive(Debug, serde::Deserialize)]
struct SkillFrontmatter {
    name: String,
    description: String,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    compatibility: Option<String>,
}

fn parse_discovered_skill(path: &Path) -> Option<DiscoveredSkill> {
    let content = std::fs::read_to_string(path).ok()?;

    // Try YAML frontmatter first
    if let Some((fm_str, _body)) = extract_frontmatter_str(&content) {
        if let Ok(fm) = serde_yaml::from_str::<SkillFrontmatter>(&fm_str) {
            return Some(DiscoveredSkill {
                name: fm.name,
                description: fm.description,
                source: path.to_string_lossy().to_string(),
                license: fm.license,
                compatibility: fm.compatibility,
            });
        }
    }

    // Fallback: directory name + first paragraph
    let name = path
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".into());

    let description = content
        .lines()
        .skip_while(|l| l.starts_with('#') || l.starts_with("---") || l.trim().is_empty())
        .take_while(|l| !l.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    Some(DiscoveredSkill {
        name,
        description: if description.is_empty() {
            "No description".into()
        } else {
            description
        },
        source: path.to_string_lossy().to_string(),
        license: None,
        compatibility: None,
    })
}

#[cfg(test)]
mod status_tests {
    use super::{parse_git_status_porcelain, FileChangeStatus};

    #[test]
    fn parse_git_status_porcelain_maps_statuses() {
        let output = " M src/app.ts\nA  src/new.ts\nD  src/old.ts\nR  src/was.ts -> src/now.ts\n?? scratch.txt\nUU merge.txt\n";
        let files = parse_git_status_porcelain(output);

        assert_eq!(files.len(), 6);
        assert_eq!(files[0].status, FileChangeStatus::Modified);
        assert_eq!(files[1].status, FileChangeStatus::Added);
        assert_eq!(files[2].status, FileChangeStatus::Deleted);
        assert_eq!(files[3].status, FileChangeStatus::Renamed);
        assert_eq!(files[3].previous_path.as_deref(), Some("src/was.ts"));
        assert_eq!(files[3].path, "src/now.ts");
        assert_eq!(files[4].status, FileChangeStatus::Untracked);
        assert_eq!(files[5].status, FileChangeStatus::Conflicted);
    }
}

/// Extract YAML frontmatter from between `---` delimiters.
fn extract_frontmatter_str(contents: &str) -> Option<(String, String)> {
    let mut lines = contents.lines();
    if !matches!(lines.next(), Some(line) if line.trim() == "---") {
        return None;
    }

    let mut frontmatter_lines: Vec<&str> = Vec::new();
    let mut body_start = false;
    let mut body_lines: Vec<&str> = Vec::new();

    for line in lines {
        if !body_start {
            if line.trim() == "---" {
                body_start = true;
            } else {
                frontmatter_lines.push(line);
            }
        } else {
            body_lines.push(line);
        }
    }

    if frontmatter_lines.is_empty() || !body_start {
        return None;
    }

    Some((frontmatter_lines.join("\n"), body_lines.join("\n")))
}

// ─── Git Worktree Operations ────────────────────────────────────────────

/// Base directory for worktrees: ~/.routa/worktrees/
pub fn get_worktree_base_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".routa")
        .join("worktrees")
}

/// Default worktree root for a workspace: ~/.routa/workspace/{workspaceId}
pub fn get_default_workspace_worktree_root(workspace_id: &str) -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".routa")
        .join("workspace")
        .join(workspace_id)
}

/// Sanitize a branch name for use as a directory name.
pub fn branch_to_safe_dir_name(branch: &str) -> String {
    branch
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Prune stale worktree references.
pub fn worktree_prune(repo_path: &str) -> Result<(), String> {
    let output = git_command()
        .args(["worktree", "prune"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Add a new git worktree. If `create_branch` is true, creates a new branch.
pub fn worktree_add(
    repo_path: &str,
    worktree_path: &str,
    branch: &str,
    base_branch: &str,
    create_branch: bool,
) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(worktree_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let args = if create_branch {
        vec![
            "worktree".to_string(),
            "add".to_string(),
            "-b".to_string(),
            branch.to_string(),
            worktree_path.to_string(),
            base_branch.to_string(),
        ]
    } else {
        vec![
            "worktree".to_string(),
            "add".to_string(),
            worktree_path.to_string(),
            branch.to_string(),
        ]
    };

    let output = git_command()
        .args(&args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Remove a git worktree.
pub fn worktree_remove(repo_path: &str, worktree_path: &str, force: bool) -> Result<(), String> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(worktree_path);

    let output = git_command()
        .args(&args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeListEntry {
    pub path: String,
    pub head: String,
    pub branch: String,
}

/// List all worktrees for a repository.
pub fn worktree_list(repo_path: &str) -> Vec<WorktreeListEntry> {
    let output = match git_command()
        .args(["worktree", "list", "--porcelain"])
        .current_dir(repo_path)
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return vec![],
    };

    let text = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();
    let mut current_path = String::new();
    let mut current_head = String::new();
    let mut current_branch = String::new();

    for line in text.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            if !current_path.is_empty() {
                entries.push(WorktreeListEntry {
                    path: std::mem::take(&mut current_path),
                    head: std::mem::take(&mut current_head),
                    branch: std::mem::take(&mut current_branch),
                });
            }
            current_path = p.to_string();
        } else if let Some(h) = line.strip_prefix("HEAD ") {
            current_head = h.to_string();
        } else if let Some(b) = line.strip_prefix("branch ") {
            // "refs/heads/branch-name" -> "branch-name"
            current_branch = b.strip_prefix("refs/heads/").unwrap_or(b).to_string();
        }
    }

    // Push last entry
    if !current_path.is_empty() {
        entries.push(WorktreeListEntry {
            path: current_path,
            head: current_head,
            branch: current_branch,
        });
    }

    entries
}

/// Check if a local branch exists.
pub fn branch_exists(repo_path: &str, branch: &str) -> bool {
    git_command()
        .args(["branch", "--list", branch])
        .current_dir(repo_path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(false)
}

/// Recursively copy a directory, skipping .git and node_modules.
pub fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    // Internal helper for copying already-resolved local skill directories.
    // nosemgrep: rust.actix.path-traversal.tainted-path.tainted-path
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if src_path.is_dir() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str == ".git" || name_str == "node_modules" {
                continue;
            }
            copy_dir_recursive(&src_path, &dest_path)?;
        } else {
            std::fs::copy(&src_path, &dest_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn parse_github_url_supports_multiple_formats() {
        let https = parse_github_url("https://github.com/phodal/routa-js.git").unwrap();
        assert_eq!(https.owner, "phodal");
        assert_eq!(https.repo, "routa-js");

        let ssh = parse_github_url("git@github.com:owner/repo-name.git").unwrap();
        assert_eq!(ssh.owner, "owner");
        assert_eq!(ssh.repo, "repo-name");

        let shorthand = parse_github_url("foo/bar.baz").unwrap();
        assert_eq!(shorthand.owner, "foo");
        assert_eq!(shorthand.repo, "bar.baz");

        assert!(parse_github_url(r"C:\tmp\repo").is_none());
    }

    #[test]
    fn repo_dir_name_conversions_are_stable() {
        let dir = repo_to_dir_name("org", "project");
        assert_eq!(dir, "org--project");
        assert_eq!(dir_name_to_repo(&dir), "org/project");
        assert_eq!(dir_name_to_repo("no-separator"), "no-separator");
    }

    #[test]
    fn frontmatter_extraction_requires_both_delimiters() {
        let content = "---\nname: demo\ndescription: hello\n---\nbody";
        let (fm, body) = extract_frontmatter_str(content).unwrap();
        assert!(fm.contains("name: demo"));
        assert_eq!(body, "body");

        assert!(extract_frontmatter_str("name: x\n---\nbody").is_none());
        assert!(extract_frontmatter_str("---\nname: x\nbody").is_none());
    }

    #[test]
    fn parse_discovered_skill_supports_frontmatter_and_fallback() {
        let temp = tempdir().unwrap();
        let skill_dir = temp.path().join("skills").join("demo");
        fs::create_dir_all(&skill_dir).unwrap();

        let fm_skill = skill_dir.join("SKILL.md");
        fs::write(
            &fm_skill,
            "---\nname: Demo Skill\ndescription: Does demo things\nlicense: MIT\ncompatibility: rust\n---\n# Body\n",
        )
        .unwrap();

        let parsed = parse_discovered_skill(&fm_skill).unwrap();
        assert_eq!(parsed.name, "Demo Skill");
        assert_eq!(parsed.description, "Does demo things");
        assert_eq!(parsed.license.as_deref(), Some("MIT"));
        assert_eq!(parsed.compatibility.as_deref(), Some("rust"));

        let fallback_dir = temp.path().join("skills").join("fallback-skill");
        fs::create_dir_all(&fallback_dir).unwrap();
        let fallback_file = fallback_dir.join("SKILL.md");
        fs::write(
            &fallback_file,
            "# Title\n\nFirst line of fallback description.\nSecond line.\n\n## Next section\n",
        )
        .unwrap();

        let fallback = parse_discovered_skill(&fallback_file).unwrap();
        assert_eq!(fallback.name, "fallback-skill");
        assert_eq!(
            fallback.description,
            "First line of fallback description. Second line."
        );
        assert!(fallback.license.is_none());
        assert!(fallback.compatibility.is_none());
    }

    #[test]
    fn discover_skills_from_path_scans_known_locations_and_root() {
        let temp = tempdir().unwrap();

        let skill_paths = [
            temp.path().join("skills").join("a").join("SKILL.md"),
            temp.path()
                .join(".agents/skills")
                .join("b")
                .join("SKILL.md"),
            temp.path()
                .join(".opencode/skills")
                .join("c")
                .join("SKILL.md"),
            temp.path()
                .join(".claude/skills")
                .join("d")
                .join("SKILL.md"),
            temp.path().join("SKILL.md"),
        ];

        for path in &skill_paths {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
        }

        fs::write(
            &skill_paths[0],
            "---\nname: skill-a\ndescription: from skills\n---\n",
        )
        .unwrap();
        fs::write(
            &skill_paths[1],
            "---\nname: skill-b\ndescription: from agents\n---\n",
        )
        .unwrap();
        fs::write(
            &skill_paths[2],
            "---\nname: skill-c\ndescription: from opencode\n---\n",
        )
        .unwrap();
        fs::write(
            &skill_paths[3],
            "---\nname: skill-d\ndescription: from claude\n---\n",
        )
        .unwrap();
        fs::write(
            &skill_paths[4],
            "---\nname: root-skill\ndescription: from root\n---\n",
        )
        .unwrap();

        let discovered = discover_skills_from_path(temp.path());
        let mut names = discovered.into_iter().map(|s| s.name).collect::<Vec<_>>();
        names.sort();
        assert_eq!(
            names,
            vec![
                "root-skill".to_string(),
                "skill-a".to_string(),
                "skill-b".to_string(),
                "skill-c".to_string(),
                "skill-d".to_string()
            ]
        );
    }

    #[test]
    fn branch_to_safe_dir_name_replaces_unsafe_chars() {
        assert_eq!(
            branch_to_safe_dir_name("feature/new ui@2026"),
            "feature-new-ui-2026"
        );
        assert_eq!(branch_to_safe_dir_name("release-1.2.3"), "release-1.2.3");
    }

    #[test]
    fn copy_dir_recursive_skips_git_and_node_modules() {
        let temp = tempdir().unwrap();
        let src = temp.path().join("src");
        let dest = temp.path().join("dest");

        fs::create_dir_all(src.join(".git")).unwrap();
        fs::create_dir_all(src.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(src.join("nested")).unwrap();

        fs::write(src.join(".git/config"), "ignored").unwrap();
        fs::write(src.join("node_modules/pkg/index.js"), "ignored").unwrap();
        fs::write(src.join("nested/kept.txt"), "hello").unwrap();
        fs::write(src.join("root.txt"), "root").unwrap();

        copy_dir_recursive(&src, &dest).unwrap();

        assert!(dest.join("root.txt").is_file());
        assert!(dest.join("nested/kept.txt").is_file());
        assert!(!dest.join(".git").exists());
        assert!(!dest.join("node_modules").exists());
    }

    #[test]
    fn detects_and_checks_out_existing_local_branches() {
        let temp = tempdir().unwrap();
        let repo = temp.path();

        let init = git_command()
            .args(["init", "-b", "main"])
            .current_dir(repo)
            .output()
            .unwrap();
        assert!(init.status.success());

        let config_name = git_command()
            .args(["config", "user.name", "Test User"])
            .current_dir(repo)
            .output()
            .unwrap();
        assert!(config_name.status.success());

        let config_email = git_command()
            .args(["config", "user.email", "test@example.com"])
            .current_dir(repo)
            .output()
            .unwrap();
        assert!(config_email.status.success());

        fs::write(repo.join("README.md"), "hello\n").unwrap();
        let add = git_command()
            .args(["add", "README.md"])
            .current_dir(repo)
            .output()
            .unwrap();
        assert!(add.status.success());

        let commit = git_command()
            .args(["commit", "-m", "init"])
            .current_dir(repo)
            .output()
            .unwrap();
        assert!(commit.status.success());

        let branch = git_command()
            .args(["branch", "feature/test"])
            .current_dir(repo)
            .output()
            .unwrap();
        assert!(branch.status.success());

        let repo_path = repo.to_str().unwrap();
        assert!(has_local_branch(repo_path, "main"));
        assert!(has_local_branch(repo_path, "feature/test"));
        assert!(!has_local_branch(repo_path, "missing"));

        checkout_existing_branch(repo_path, "feature/test").unwrap();
        assert_eq!(
            get_current_branch(repo_path).as_deref(),
            Some("feature/test")
        );
    }
}
