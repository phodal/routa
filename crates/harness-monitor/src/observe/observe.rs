use crate::observe::repo::RepoContext;
use crate::shared::db::Db;
use crate::shared::models::{AttributionConfidence, DirtyRepoEntry, EntryKind, FileEventRecord};
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
    let submodule_paths = git_submodule_paths(&ctx.repo_root).unwrap_or_default();
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
            out.extend(collect_dirty_entries_for_path(
                &ctx.repo_root,
                &rel_path,
                state_code,
                &submodule_paths,
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
    let submodule_paths = git_submodule_paths(&ctx.repo_root).unwrap_or_default();
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
            for (expanded_rel_path, expanded_state_code, mtime_ms, _entry_kind) in
                collect_dirty_entries_for_path(
                    &ctx.repo_root,
                    &rel_path,
                    state_code,
                    &submodule_paths,
                )
            {
                let abs_path = ctx.repo_root.join(&expanded_rel_path);
                let metadata = std::fs::metadata(&abs_path).ok();
                let (mtime_ms, size_bytes) = metadata
                    .and_then(|m| {
                        m.modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|dur| (Some(dur.as_millis() as i64), Some(m.len() as i64)))
                    })
                    .unwrap_or((mtime_ms, None));

                let should_update = match db
                    .get_file_state(&ctx.repo_root.to_string_lossy(), &expanded_rel_path)?
                {
                    Some((prev_mtime, prev_size, was_dirty)) => {
                        prev_mtime != mtime_ms || prev_size != size_bytes || !was_dirty
                    }
                    None => true,
                };

                if should_update {
                    let _ = db.insert_file_event(&FileEventRecord {
                        id: None,
                        repo_root: ctx.repo_root.to_string_lossy().to_string(),
                        rel_path: expanded_rel_path.clone(),
                        event_kind: expanded_state_code.to_string(),
                        observed_at_ms: now_ms,
                        session_id: None,
                        turn_id: None,
                        task_id: None,
                        confidence: AttributionConfidence::Unknown,
                        source: source.to_string(),
                        metadata_json: json!({ "via": "git-status" }).to_string(),
                    })?;

                    db.update_file_state(
                        &ctx.repo_root.to_string_lossy(),
                        &expanded_rel_path,
                        true,
                        &expanded_state_code,
                        mtime_ms,
                        size_bytes,
                        now_ms,
                        None,
                        None,
                        Some(AttributionConfidence::Unknown),
                        Some(source),
                    )?;

                    changed_paths.push(expanded_rel_path.clone());
                }

                seen.insert(expanded_rel_path);
            }
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

pub fn entry_kind_for_repo_path(repo_root: &Path, rel_path: &str) -> EntryKind {
    let submodule_paths = git_submodule_paths(repo_root).unwrap_or_default();
    entry_kind_for_repo_path_with_submodules(repo_root, rel_path, &submodule_paths)
}

fn collect_dirty_entries_for_path(
    repo_root: &Path,
    rel_path: &str,
    state_code: &str,
    submodule_paths: &HashSet<String>,
) -> Vec<DirtyRepoEntry> {
    let entry_kind = entry_kind_for_repo_path_with_submodules(repo_root, rel_path, submodule_paths);
    let abs_path = repo_root.join(rel_path);
    let mtime_ms = std::fs::metadata(&abs_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|dur| dur.as_millis() as i64);
    let mut entries = vec![(
        rel_path.to_string(),
        state_code.to_string(),
        mtime_ms,
        entry_kind,
    )];

    if entry_kind.is_submodule() {
        entries.extend(collect_submodule_dirty_entries(repo_root, rel_path));
    }

    entries
}

fn entry_kind_for_repo_path_with_submodules(
    repo_root: &Path,
    rel_path: &str,
    submodule_paths: &HashSet<String>,
) -> EntryKind {
    if submodule_paths.contains(rel_path) {
        return EntryKind::Submodule;
    }
    entry_kind_for_path(&repo_root.join(rel_path))
}

fn git_submodule_paths(repo_root: &Path) -> Result<HashSet<String>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("ls-files")
        .arg("--stage")
        .output()
        .context("run git ls-files --stage")?;

    if !output.status.success() {
        return Err(anyhow!("git ls-files --stage failed"));
    }

    let stdout = String::from_utf8(output.stdout).context("decode git ls-files output")?;
    Ok(parse_git_submodule_paths(&stdout))
}

fn parse_git_submodule_paths(output: &str) -> HashSet<String> {
    output
        .lines()
        .filter_map(|line| {
            if !line.starts_with("160000 ") {
                return None;
            }
            line.split_once('\t')
                .map(|(_, path)| path.replace('\\', "/"))
        })
        .collect()
}

fn collect_submodule_dirty_entries(repo_root: &Path, rel_path: &str) -> Vec<DirtyRepoEntry> {
    let submodule_root = repo_root.join(rel_path);
    let output = Command::new("git")
        .arg("-C")
        .arg(&submodule_root)
        .arg("status")
        .arg("--porcelain")
        .arg("--untracked-files=all")
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    let mut entries = Vec::new();
    let lines = String::from_utf8_lossy(&output.stdout);
    for line in lines.lines() {
        if line.len() < 4 {
            continue;
        }
        let index_code = &line[0..1];
        let worktree_code = &line[1..2];
        let path_part = line.get(3..).unwrap_or("");
        let (state_code, path_raws) = classify_status(index_code, worktree_code, path_part);
        for nested_rel in path_raws {
            if nested_rel.is_empty() {
                continue;
            }
            let prefixed_rel = format!("{}/{}", rel_path.trim_end_matches('/'), nested_rel);
            let nested_abs = submodule_root.join(&nested_rel);
            let mtime_ms = std::fs::metadata(&nested_abs)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|dur| dur.as_millis() as i64);
            let entry_kind = entry_kind_for_path(&nested_abs);
            entries.push((prefixed_rel, state_code.to_string(), mtime_ms, entry_kind));
        }
    }

    entries
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

    #[test]
    fn detects_git_submodules_from_index_mode() {
        let dir = tempdir().expect("tempdir");
        Command::new("git")
            .args(["init", "--no-bare"])
            .arg(dir.path())
            .output()
            .expect("init repo");
        let modules = dir.path().join("tools").join("entrix");
        std::fs::create_dir_all(&modules).expect("create submodule path");

        Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .arg("update-index")
            .arg("--add")
            .arg("--cacheinfo")
            .arg("160000")
            .arg("a745c6f9664e4525be45e02582e7dc970158ec74")
            .arg("tools/entrix")
            .output()
            .expect("register gitlink");

        assert_eq!(
            entry_kind_for_repo_path(dir.path(), "tools/entrix"),
            EntryKind::Submodule
        );
    }

    #[test]
    fn expands_dirty_submodule_children() {
        let dir = tempdir().expect("tempdir");
        Command::new("git")
            .args(["init", "--no-bare"])
            .arg(dir.path())
            .output()
            .expect("init repo");
        let submodule_root = dir.path().join("tools").join("entrix");
        std::fs::create_dir_all(submodule_root.join("entrix").join("reporters"))
            .expect("create nested dirs");
        Command::new("git")
            .args(["init", "--no-bare"])
            .arg(&submodule_root)
            .output()
            .expect("init submodule repo");
        std::fs::write(
            submodule_root
                .join("entrix")
                .join("reporters")
                .join("visual.py"),
            "print('dirty')\n",
        )
        .expect("write dirty file");
        Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .arg("update-index")
            .arg("--add")
            .arg("--cacheinfo")
            .arg("160000")
            .arg("a745c6f9664e4525be45e02582e7dc970158ec74")
            .arg("tools/entrix")
            .output()
            .expect("register gitlink");

        let submodule_paths = git_submodule_paths(dir.path()).expect("submodule paths");
        let entries =
            collect_dirty_entries_for_path(dir.path(), "tools/entrix", "modify", &submodule_paths);
        let paths = entries
            .into_iter()
            .map(|(path, _, _, _)| path)
            .collect::<Vec<_>>();

        assert!(paths.contains(&"tools/entrix".to_string()));
        assert!(paths.contains(&"tools/entrix/entrix/reporters/visual.py".to_string()));
    }

    #[test]
    fn parse_git_submodule_paths_reads_gitlinks() {
        let parsed = parse_git_submodule_paths(
            "100644 abcdef 0\tREADME.md\n160000 a745c6f9664e4525be45e02582e7dc970158ec74 0\ttools/entrix\n",
        );

        assert!(parsed.contains("tools/entrix"));
        assert!(!parsed.contains("README.md"));
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
