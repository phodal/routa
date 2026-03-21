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
    if cwd.parent().is_none() {
        if let Some(home) = dirs::home_dir() {
            return home.join(".routa").join("repos");
        }
    }
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
            let parts: Vec<&str> = text.split_whitespace().collect();
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
            result.has_uncommitted_changes = !String::from_utf8_lossy(&o.stdout).trim().is_empty();
        }
    }

    result
}

pub fn reset_local_changes(repo_path: &str) -> Result<(), String> {
    let reset_output = Command::new("git")
        .args(["reset", "--hard", "HEAD"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !reset_output.status.success() {
        return Err(String::from_utf8_lossy(&reset_output.stderr)
            .trim()
            .to_string());
    }

    let clean_output = Command::new("git")
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
            let parts: Vec<&str> = text.split_whitespace().collect();
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
    let output = Command::new("git")
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

    let output = Command::new("git")
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

    let output = Command::new("git")
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
    let output = match Command::new("git")
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
    Command::new("git")
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
}
