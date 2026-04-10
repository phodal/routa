use anyhow::{Context, Result};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct RepoContext {
    pub repo_root: PathBuf,
    pub git_dir: PathBuf,
    pub db_path: PathBuf,
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
    let start_dir = path_opt
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .context("determine working directory")?;

    let repo_root = detect_repo_root(&start_dir)?;
    let git_dir = detect_git_dir(&start_dir)?;
    let db_path = if let Some(db_path) = db_path_opt {
        PathBuf::from(db_path)
    } else {
        let git_db_dir = git_dir.join("agentwatch");
        match std::fs::create_dir_all(&git_db_dir) {
            Ok(_) => git_db_dir.join("agentwatch.db"),
            Err(err) => {
                let fallback = fallback_db_path(&repo_root).context("resolve fallback db path")?;
                std::fs::create_dir_all(fallback.parent().unwrap()).with_context(|| {
                    format!("create fallback db directory {:?}", fallback.parent())
                })?;
                eprintln!(
                    "agentwatch warning: cannot write .git/agentwatch ({:?}), fallback to {:?}: {}",
                    git_db_dir, fallback, err
                );
                fallback
            }
        }
    };

    Ok(RepoContext {
        repo_root,
        git_dir,
        db_path,
    })
}

fn fallback_db_path(repo_root: &Path) -> Result<PathBuf> {
    let base = std::env::var("AGENTWATCH_DB_DIR")
        .ok()
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::cache_dir())
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .context("resolve fallback cache path")?;
    let mut hasher = DefaultHasher::new();
    repo_root.to_string_lossy().hash(&mut hasher);
    let marker = format!("{:x}", hasher.finish());
    Ok(base
        .join("agentwatch")
        .join("repos")
        .join(marker)
        .join("agentwatch.db"))
}
