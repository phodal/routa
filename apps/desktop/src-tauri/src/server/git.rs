//! Git utilities for clone, branch management, and repo inspection.
//! Port of src/core/git/git-utils.ts

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

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
    cwd.join(".routa").join("repos")
}

pub fn repo_to_dir_name(owner: &str, repo: &str) -> String {
    format!("{}--{}", owner, repo)
}

pub fn dir_name_to_repo(dir_name: &str) -> String {
    let parts: Vec<&str> = dir_name.splitn(2, "--").collect();
    if parts.len() == 2 {
        format!("{}/{}", parts[0], parts[1])
    } else {
        dir_name.to_string()
    }
}

pub fn get_current_branch(repo_path: &str) -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(repo_path)
        .output()
        .ok()?;
    if output.status.success() {
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    } else {
        None
    }
}

pub fn list_local_branches(repo_path: &str) -> Vec<String> {
    Command::new("git")
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
    Command::new("git")
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
    let ok = Command::new("git")
        .args(["checkout", branch])
        .current_dir(repo_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if ok {
        return true;
    }
    Command::new("git")
        .args(["checkout", "-b", branch])
        .current_dir(repo_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn fetch_remote(repo_path: &str) -> bool {
    Command::new("git")
        .args(["fetch", "--all", "--prune"])
        .current_dir(repo_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn pull_branch(repo_path: &str) -> Result<(), String> {
    let output = Command::new("git")
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

    if let Ok(o) = Command::new("git")
        .args([
            "rev-list",
            "--left-right",
            "--count",
            &format!("{}...origin/{}", branch, branch),
        ])
        .current_dir(repo_path)
        .output()
    {
        if o.status.success() {
            let text = String::from_utf8_lossy(&o.stdout);
            let parts: Vec<&str> = text.trim().split_whitespace().collect();
            if parts.len() == 2 {
                result.ahead = parts[0].parse().unwrap_or(0);
                result.behind = parts[1].parse().unwrap_or(0);
            }
        }
    }

    if let Ok(o) = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(repo_path)
        .output()
    {
        if o.status.success() {
            result.has_uncommitted_changes =
                !String::from_utf8_lossy(&o.stdout).trim().is_empty();
        }
    }

    result
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

pub fn get_repo_status(repo_path: &str) -> RepoStatus {
    let mut status = RepoStatus {
        clean: true,
        ahead: 0,
        behind: 0,
        modified: 0,
        untracked: 0,
    };

    if let Ok(o) = Command::new("git")
        .args(["status", "--porcelain"])
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

    if let Ok(o) = Command::new("git")
        .args(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
        .current_dir(repo_path)
        .output()
    {
        if o.status.success() {
            let text = String::from_utf8_lossy(&o.stdout);
            let parts: Vec<&str> = text.trim().split_whitespace().collect();
            if parts.len() == 2 {
                status.ahead = parts[0].parse().unwrap_or(0);
                status.behind = parts[1].parse().unwrap_or(0);
            }
        }
    }

    status
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

fn parse_discovered_skill(path: &Path) -> Option<DiscoveredSkill> {
    let content = std::fs::read_to_string(path).ok()?;
    let name = path
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".into());

    let description = content
        .lines()
        .skip_while(|l| l.starts_with('#') || l.trim().is_empty())
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

/// Recursively copy a directory, skipping .git and node_modules.
pub fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
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
