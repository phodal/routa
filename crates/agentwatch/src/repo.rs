use anyhow::{Context, Result};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct RepoContext {
    pub repo_root: PathBuf,
    pub git_dir: PathBuf,
    pub db_path: PathBuf,
    pub runtime_event_path: PathBuf,
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
        match ensure_writable_db_path(&git_db_dir.join("agentwatch.db")) {
            Ok(_) => git_db_dir.join("agentwatch.db"),
            Err(err) => {
                let fallback = fallback_db_path(&repo_root).context("resolve fallback db path")?;
                let fallback_parent = fallback.parent().context("fallback db has no parent")?;
                std::fs::create_dir_all(fallback_parent).with_context(|| {
                    format!("create fallback db directory {:?}", fallback_parent)
                })?;
                eprintln!(
                    "agentwatch warning: cannot write {:?}, fallback to {:?}: {}",
                    git_db_dir.join("agentwatch.db"),
                    fallback,
                    err
                );
                fallback
            }
        }
    };

    Ok(RepoContext {
        runtime_event_path: runtime_event_path(&repo_root),
        repo_root,
        git_dir,
        db_path,
    })
}

pub fn resolve_runtime(path_opt: Option<&str>) -> Result<RepoContext> {
    let start_dir = path_opt
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .context("determine working directory")?;
    let repo_root = detect_repo_root(&start_dir)?;
    let git_dir = detect_git_dir(&start_dir)?;
    Ok(RepoContext {
        runtime_event_path: runtime_event_path(&repo_root),
        repo_root,
        git_dir,
        db_path: PathBuf::new(),
    })
}

pub fn runtime_event_path(repo_root: &Path) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    repo_root.to_string_lossy().hash(&mut hasher);
    let marker = format!("{:x}", hasher.finish());
    PathBuf::from("/tmp")
        .join("agentwatch")
        .join("runtime")
        .join(format!("{marker}.jsonl"))
}

fn fallback_db_path(repo_root: &Path) -> Result<PathBuf> {
    let mut hasher = DefaultHasher::new();
    repo_root.to_string_lossy().hash(&mut hasher);
    let marker = format!("{:x}", hasher.finish());

    let mut candidate_bases = Vec::new();
    if let Ok(custom_base) = std::env::var("AGENTWATCH_DB_DIR") {
        if !custom_base.trim().is_empty() {
            candidate_bases.push(PathBuf::from(custom_base));
        }
    }
    if let Some(cache_dir) = dirs::cache_dir() {
        candidate_bases.push(cache_dir);
    }
    if let Some(home_dir) = std::env::var_os("HOME").map(PathBuf::from) {
        candidate_bases.push(home_dir.join(".cache"));
    }
    candidate_bases.push(PathBuf::from("/tmp"));

    for base in &candidate_bases {
        let candidate = base
            .join("agentwatch")
            .join("repos")
            .join(&marker)
            .join("agentwatch.db");
        let parent = candidate
            .parent()
            .context("fallback db path has no parent")?;
        if std::fs::create_dir_all(parent).is_ok() {
            return Ok(candidate);
        }
    }

    anyhow::bail!(
        "could not create a writable fallback database directory from {:?}",
        candidate_bases
    );
}

fn ensure_writable_db_path(path: &Path) -> Result<()> {
    if path.as_os_str().is_empty() {
        anyhow::bail!("invalid sqlite db path");
    }

    let parent = path.parent().context("db path has no parent")?;
    std::fs::create_dir_all(parent).with_context(|| format!("create db directory {:?}", parent))?;

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
