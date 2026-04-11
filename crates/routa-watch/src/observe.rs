use crate::db::Db;
use crate::models::{AttributionConfidence, DirtyRepoEntry, EntryKind, FileEventRecord};
use crate::repo::RepoContext;
use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use serde_json::json;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug)]
pub struct Snapshot {
    pub changed_paths: Vec<String>,
}

pub fn scan_repo(ctx: &RepoContext) -> Result<Vec<DirtyRepoEntry>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&ctx.repo_root)
        .arg("status")
        .arg("--porcelain")
        .arg("--untracked-files=all")
        .output()
        .context("run git status")?;
    if !output.status.success() {
        return Err(anyhow!("git status failed"));
    }

    let mut out = Vec::new();
    let lines = String::from_utf8(output.stdout).context("decode git status output")?;
    for line in lines.lines() {
        if line.len() < 4 {
            continue;
        }
        let index_code = &line[0..1];
        let worktree_code = &line[1..2];
        let path_part = line.get(3..).unwrap_or("");
        let (state_code, path_raws) = classify_status(index_code, worktree_code, path_part);
        for rel in path_raws {
            if rel.is_empty() {
                continue;
            }
            let rel_path = normalize_rel_path(&ctx.repo_root, &ctx.repo_root.join(&rel), &rel)?;
            let abs_path = ctx.repo_root.join(&rel_path);
            let mtime_ms = std::fs::metadata(abs_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|dur| dur.as_millis() as i64);
            out.push((
                rel_path.clone(),
                state_code.to_string(),
                mtime_ms,
                entry_kind_for_path(&ctx.repo_root.join(&rel_path)),
            ));
        }
    }
    Ok(out)
}

pub fn poll_repo(
    ctx: &RepoContext,
    db: &Db,
    source: &str,
    inference_window_ms: i64,
) -> Result<Snapshot> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&ctx.repo_root)
        .arg("status")
        .arg("--porcelain")
        .arg("--untracked-files=all")
        .output()
        .context("run git status")?;
    if !output.status.success() {
        return Err(anyhow!("git status failed"));
    }

    let now_ms = Utc::now().timestamp_millis();
    let mut seen = HashSet::new();
    let mut changed_paths = Vec::new();

    let lines = String::from_utf8(output.stdout).context("decode git status output")?;
    for line in lines.lines() {
        if line.len() < 4 {
            continue;
        }
        let index_code = &line[0..1];
        let worktree_code = &line[1..2];
        let path_part = line.get(3..).unwrap_or("");
        let (state_code, path_raws) = classify_status(index_code, worktree_code, path_part);

        for rel in path_raws {
            if rel.is_empty() {
                continue;
            }
            let rel_path = normalize_rel_path(&ctx.repo_root, &ctx.repo_root.join(&rel), &rel)?;
            let abs_path = ctx.repo_root.join(&rel_path);
            let metadata = std::fs::metadata(&abs_path).ok();
            let (mtime_ms, size_bytes) = metadata
                .and_then(|m| {
                    m.modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|dur| (Some(dur.as_millis() as i64), Some(m.len() as i64)))
                })
                .unwrap_or((None, None));

            let should_update =
                match db.get_file_state(&ctx.repo_root.to_string_lossy(), &rel_path)? {
                    Some((prev_mtime, prev_size, was_dirty)) => {
                        prev_mtime != mtime_ms || prev_size != size_bytes || !was_dirty
                    }
                    None => true,
                };

            if should_update {
                let _ = db.insert_file_event(&FileEventRecord {
                    id: None,
                    repo_root: ctx.repo_root.to_string_lossy().to_string(),
                    rel_path: rel_path.clone(),
                    event_kind: state_code.to_string(),
                    observed_at_ms: now_ms,
                    session_id: None,
                    turn_id: None,
                    confidence: AttributionConfidence::Unknown,
                    source: source.to_string(),
                    metadata_json: json!({ "via": "git-status" }).to_string(),
                })?;

                db.update_file_state(
                    &ctx.repo_root.to_string_lossy(),
                    &rel_path,
                    true,
                    state_code,
                    mtime_ms,
                    size_bytes,
                    now_ms,
                    None,
                    None,
                    Some(AttributionConfidence::Unknown),
                    Some(source),
                )?;

                changed_paths.push(rel_path.clone());
            }

            seen.insert(rel_path);
        }
    }

    let mut current: Vec<String> = seen.into_iter().collect();
    current.sort_unstable();
    db.set_file_clean_missing(&ctx.repo_root.to_string_lossy(), &current, now_ms)?;

    if let Some(session_id) = db.pick_active_session(
        &ctx.repo_root.to_string_lossy(),
        now_ms,
        inference_window_ms,
    )? {
        let _ = db.mark_inferred_sessions(
            &ctx.repo_root.to_string_lossy(),
            now_ms,
            inference_window_ms,
            &session_id,
        )?;
    }

    Ok(Snapshot { changed_paths })
}

fn classify_status(
    index_code: &str,
    worktree_code: &str,
    raw: &str,
) -> (&'static str, Vec<String>) {
    let code = match (index_code, worktree_code) {
        (" ", "M") | ("M", " ") | ("M", "M") => "modify",
        ("A", " ") | (" ", "A") => "add",
        ("D", " ") | (" ", "D") => "delete",
        ("R", _) | (_, "R") => "rename",
        ("C", _) | (_, "C") => "copy",
        ("?", "?") => "untracked",
        _ => "modify",
    };

    if raw.contains(" -> ") {
        let parts: Vec<&str> = raw.split(" -> ").collect();
        let from = normalize_path(parts[0]);
        let to = normalize_path(parts.get(1).copied().unwrap_or(""));
        if to.is_empty() {
            (code, vec![from])
        } else {
            (code, vec![to, from])
        }
    } else {
        (code, vec![normalize_path(raw)])
    }
}

fn normalize_path(path: &str) -> String {
    path.trim().trim_matches('"').replace('\\', "/")
}

fn normalize_rel_path(
    repo_root: &Path,
    absolute_or_relative: &Path,
    fallback: &str,
) -> Result<String> {
    let abs = if absolute_or_relative.is_absolute() {
        absolute_or_relative.to_path_buf()
    } else {
        repo_root.join(absolute_or_relative)
    };
    let rel = abs
        .strip_prefix(repo_root)
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|_| PathBuf::from(fallback));
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

pub fn entry_kind_for_path(path: &Path) -> EntryKind {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => EntryKind::Directory,
        _ => EntryKind::File,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn detects_plain_directories() {
        let dir = tempdir().expect("tempdir");
        let nested = dir.path().join("skills").join("developer-onboarding");
        std::fs::create_dir_all(&nested).expect("directory");

        assert_eq!(entry_kind_for_path(&nested), EntryKind::Directory);
    }

    #[cfg(unix)]
    #[test]
    fn follows_symlinked_directories() {
        use std::os::unix::fs::symlink;

        let dir = tempdir().expect("tempdir");
        let target = dir
            .path()
            .join(".agents")
            .join("skills")
            .join("developer-onboarding");
        std::fs::create_dir_all(&target).expect("target directory");
        let link = dir
            .path()
            .join(".kiro")
            .join("skills")
            .join("developer-onboarding");
        std::fs::create_dir_all(link.parent().expect("link parent")).expect("link parent");
        symlink(&target, &link).expect("symlink");

        assert_eq!(entry_kind_for_path(&link), EntryKind::Directory);
    }
}
