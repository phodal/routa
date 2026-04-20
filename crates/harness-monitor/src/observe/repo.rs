use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

const APP_SLUG: &str = "harness-monitor";
const DB_FILE_NAME: &str = "harness-monitor.db";
static GIT_CAPABILITY: OnceLock<Result<(), String>> = OnceLock::new();

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct RepoContext {
    pub repo_root: PathBuf,
    pub git_dir: PathBuf,
    pub db_path: PathBuf,
    pub runtime_event_path: PathBuf,
    pub runtime_socket_path: PathBuf,
    pub runtime_info_path: PathBuf,
    pub runtime_tcp_addr: String,
}

pub fn git_capability() -> Result<()> {
    GIT_CAPABILITY
        .get_or_init(|| {
            let output = Command::new("git")
                .arg("--version")
                .output()
                .map_err(|err| err.to_string())?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let detail = if !stderr.is_empty() {
                    stderr
                } else if !stdout.is_empty() {
                    stdout
                } else {
                    "git probe failed".to_string()
                };
                return Err(detail);
            }
            Ok(())
        })
        .clone()
        .map_err(|err| anyhow::anyhow!("git unavailable: {err}"))
}

pub fn detect_repo_root(start_dir: &Path) -> Result<PathBuf> {
    let output = Command::new("git")
        .arg("-C")
        .arg(start_dir)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()
        .context("run git rev-parse --show-toplevel")?;

    if !output.status.success() {
        anyhow::bail!("not inside a git repository");
    }

    let root = String::from_utf8(output.stdout)
        .context("decode git root output")?
        .trim()
        .to_string();
    if root.is_empty() {
        anyhow::bail!("empty git root output");
    }

    Ok(PathBuf::from(root))
}

pub fn detect_git_dir(start_dir: &Path) -> Result<PathBuf> {
    let output = Command::new("git")
        .arg("-C")
        .arg(start_dir)
        .arg("rev-parse")
        .arg("--git-dir")
        .output()
        .context("run git rev-parse --git-dir")?;

    if !output.status.success() {
        anyhow::bail!("not inside a git repository");
    }

    let dir = String::from_utf8(output.stdout)
        .context("decode git dir output")?
        .trim()
        .to_string();
    if dir.is_empty() {
        anyhow::bail!("empty git dir output");
    }

    let git_dir = if Path::new(&dir).is_absolute() {
        PathBuf::from(dir)
    } else {
        start_dir.join(dir)
    };

    Ok(git_dir)
}

pub fn resolve(path_opt: Option<&str>, db_path_opt: Option<&str>) -> Result<RepoContext> {
    git_capability()?;
    let start_dir = path_opt
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .context("determine working directory")?;

    let repo_root = detect_repo_root(&start_dir)?;
    let git_dir = detect_git_dir(&start_dir)?;
    let db_path = if let Some(db_path) = db_path_opt {
        PathBuf::from(db_path)
    } else {
        resolve_default_db_path(&repo_root)?
    };

    Ok(RepoContext {
        runtime_event_path: runtime_event_path(&repo_root),
        runtime_socket_path: runtime_socket_path(&repo_root),
        runtime_info_path: runtime_info_path(&repo_root),
        runtime_tcp_addr: runtime_tcp_addr(&repo_root),
        repo_root,
        git_dir,
        db_path,
    })
}

pub fn resolve_runtime(path_opt: Option<&str>) -> Result<RepoContext> {
    git_capability()?;
    let start_dir = path_opt
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .context("determine working directory")?;
    let repo_root = detect_repo_root(&start_dir)?;
    let git_dir = detect_git_dir(&start_dir)?;
    Ok(RepoContext {
        runtime_event_path: runtime_event_path(&repo_root),
        runtime_socket_path: runtime_socket_path(&repo_root),
        runtime_info_path: runtime_info_path(&repo_root),
        runtime_tcp_addr: runtime_tcp_addr(&repo_root),
        repo_root,
        git_dir,
        db_path: PathBuf::new(),
    })
}

pub fn runtime_event_path(repo_root: &Path) -> PathBuf {
    runtime_runtime_dir(repo_root).join("events.jsonl")
}

#[cfg(test)]
pub fn runtime_fitness_artifact_dir(repo_root: &Path) -> PathBuf {
    runtime_runtime_dir(repo_root)
        .join("artifacts")
        .join("fitness")
}

pub fn runtime_fitness_mailbox_dir(repo_root: &Path) -> PathBuf {
    runtime_runtime_dir(repo_root)
        .join("mailbox")
        .join("fitness")
        .join("new")
}

pub fn runtime_socket_path(repo_root: &Path) -> PathBuf {
    runtime_runtime_dir(repo_root).join("events.sock")
}

pub fn runtime_info_path(repo_root: &Path) -> PathBuf {
    runtime_runtime_dir(repo_root).join("service.json")
}

pub fn runtime_tcp_addr(repo_root: &Path) -> String {
    let port = runtime_port(repo_root);
    format!("127.0.0.1:{port}")
}

fn runtime_runtime_dir(repo_root: &Path) -> PathBuf {
    let marker = runtime_marker(repo_root);
    PathBuf::from("/tmp")
        .join(APP_SLUG)
        .join("runtime")
        .join(marker)
}

fn runtime_marker(repo_root: &Path) -> String {
    let digest = Sha256::digest(repo_root.to_string_lossy().as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn runtime_port(repo_root: &Path) -> u16 {
    let digest = Sha256::digest(repo_root.to_string_lossy().as_bytes());
    let seed = u16::from_be_bytes([digest[0], digest[1]]);
    43000 + (seed % 10000)
}

fn resolve_default_db_path(repo_root: &Path) -> Result<PathBuf> {
    let mut attempted = Vec::new();
    for candidate in db_path_candidates(repo_root) {
        match ensure_writable_db_path(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(err) => attempted.push((candidate, err.to_string())),
        }
    }

    anyhow::bail!("could not create a writable database path: {attempted:?}");
}

fn db_path_candidates(repo_root: &Path) -> Vec<PathBuf> {
    let marker = runtime_marker(repo_root);
    let mut candidate_bases = Vec::new();
    if let Ok(custom_base) = std::env::var("HARNESS_MONITOR_DB_DIR") {
        if !custom_base.trim().is_empty() {
            candidate_bases.push(PathBuf::from(custom_base));
        }
    }
    if let Ok(custom_base) = std::env::var("ROUTA_WATCH_DB_DIR") {
        if !custom_base.trim().is_empty() {
            candidate_bases.push(PathBuf::from(custom_base));
        }
    }
    if let Ok(custom_base) = std::env::var("AGENTWATCH_DB_DIR") {
        if !custom_base.trim().is_empty() {
            candidate_bases.push(PathBuf::from(custom_base));
        }
    }
    if let Some(data_dir) = dirs::data_local_dir() {
        candidate_bases.push(data_dir);
    }
    if let Some(cache_dir) = dirs::cache_dir() {
        candidate_bases.push(cache_dir);
    }
    if let Some(home_dir) = std::env::var_os("HOME").map(PathBuf::from) {
        candidate_bases.push(home_dir.join(".local").join("share"));
        candidate_bases.push(home_dir.join(".cache"));
    }
    candidate_bases.push(PathBuf::from("/tmp"));

    let mut candidates = Vec::new();
    for base in candidate_bases {
        let candidate = scoped_db_path(&base, &marker);
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }

    candidates
}

fn scoped_db_path(base: &Path, marker: &str) -> PathBuf {
    base.join(APP_SLUG)
        .join("repos")
        .join(marker)
        .join(DB_FILE_NAME)
}

fn ensure_writable_db_path(path: &Path) -> Result<()> {
    if path.as_os_str().is_empty() {
        anyhow::bail!("invalid sqlite db path");
    }

    let parent = path.parent().context("db path has no parent")?;
    std::fs::create_dir_all(parent).with_context(|| format!("create db directory {parent:?}"))?;

    match std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
    {
        Ok(_) => Ok(()),
        Err(err) => match err.kind() {
            ErrorKind::PermissionDenied | ErrorKind::ReadOnlyFilesystem => {
                Err(anyhow::anyhow!("permission denied writing sqlite db"))
            }
            _ => Err(err.into()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoped_db_path_uses_repo_scoped_safe_directory() {
        let path = scoped_db_path(Path::new("/safe-base"), "repo-marker");

        assert_eq!(
            path,
            PathBuf::from("/safe-base/harness-monitor/repos/repo-marker/harness-monitor.db")
        );
        assert!(!path.to_string_lossy().contains("/.git/"));
    }
}
