use axum::{
    extract::{Query, State},
    Json,
};
use routa_core::git::{FileChangeStatus, GitFileChange};
use routa_core::models::task::Task;

use crate::error::ServerError;
use crate::state::AppState;

use super::dto::{TaskChangeCommitQuery, TaskChangeFileQuery, TaskChangeStatsQuery};

/// Extract repository label from path
pub fn repo_label_from_path(repo_path: &str) -> String {
    repo_path
        .trim_end_matches(std::path::MAIN_SEPARATOR)
        .rsplit(std::path::MAIN_SEPARATOR)
        .find(|segment| !segment.is_empty())
        .unwrap_or(repo_path)
        .to_string()
}

/// Parse file change status from string
fn parse_file_change_status(status: &str) -> FileChangeStatus {
    match status.trim().to_ascii_lowercase().as_str() {
        "added" => FileChangeStatus::Added,
        "deleted" => FileChangeStatus::Deleted,
        "renamed" => FileChangeStatus::Renamed,
        "copied" => FileChangeStatus::Copied,
        "untracked" => FileChangeStatus::Untracked,
        "typechange" => FileChangeStatus::Typechange,
        "conflicted" => FileChangeStatus::Conflicted,
        _ => FileChangeStatus::Modified,
    }
}

/// Resolve repository path for a task (worktree or codebase)
async fn resolve_task_repo_path(state: &AppState, task: &Task) -> Result<String, ServerError> {
    let worktree = match task.worktree_id.as_ref() {
        Some(worktree_id) => state.worktree_store.get(worktree_id).await?,
        None => None,
    };
    let codebase_id = worktree
        .as_ref()
        .map(|item| item.codebase_id.clone())
        .or_else(|| task.codebase_ids.first().cloned())
        .unwrap_or_default();
    let codebase = if codebase_id.is_empty() {
        None
    } else {
        state.codebase_store.get(&codebase_id).await?
    };

    Ok(worktree
        .as_ref()
        .map(|item| item.worktree_path.clone())
        .or_else(|| codebase.as_ref().map(|item| item.repo_path.clone()))
        .unwrap_or_default())
}

/// Load task and resolve its repository path
async fn load_task_and_repo_path(
    state: &AppState,
    task_id: &str,
) -> Result<(Task, String), ServerError> {
    let task = state
        .task_store
        .get(task_id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {task_id} not found")))?;
    let repo_path = resolve_task_repo_path(state, &task).await?;
    Ok((task, repo_path))
}

/// GET /api/tasks/:id/changes - Get task repository changes
pub async fn get_task_changes(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let task = state
        .task_store
        .get(&id)
        .await?
        .ok_or_else(|| ServerError::NotFound(format!("Task {id} not found")))?;

    let worktree = match task.worktree_id.as_ref() {
        Some(worktree_id) => state.worktree_store.get(worktree_id).await?,
        None => None,
    };
    let codebase_id = worktree
        .as_ref()
        .map(|item| item.codebase_id.clone())
        .or_else(|| task.codebase_ids.first().cloned())
        .unwrap_or_default();
    let codebase = if codebase_id.is_empty() {
        None
    } else {
        state.codebase_store.get(&codebase_id).await?
    };
    let repo_path = worktree
        .as_ref()
        .map(|item| item.worktree_path.clone())
        .or_else(|| codebase.as_ref().map(|item| item.repo_path.clone()))
        .unwrap_or_default();
    let label = codebase
        .as_ref()
        .and_then(|item| item.label.clone())
        .unwrap_or_else(|| {
            repo_label_from_path(if repo_path.is_empty() {
                "repo"
            } else {
                &repo_path
            })
        });
    let branch = worktree
        .as_ref()
        .map(|item| item.branch.clone())
        .or_else(|| codebase.as_ref().and_then(|item| item.branch.clone()))
        .unwrap_or_else(|| "unknown".to_string());
    let target_branch = worktree
        .as_ref()
        .map(|item| item.base_branch.clone())
        .or_else(|| codebase.as_ref().and_then(|item| item.branch.clone()));
    let remote_url = codebase
        .as_ref()
        .and_then(|item| item.source_url.clone())
        .or_else(|| {
            if repo_path.is_empty() {
                None
            } else {
                crate::git::get_remote_url(&repo_path)
            }
        });
    let base_ref = if repo_path.is_empty() {
        None
    } else {
        crate::git::resolve_base_ref(&repo_path, target_branch.as_deref())
    };
    let source = if worktree.is_some() {
        "worktree"
    } else {
        "repo"
    };

    if repo_path.is_empty() {
        return Ok(Json(serde_json::json!({
            "changes": {
                "codebaseId": codebase_id,
                "repoPath": "",
                "label": label,
                "branch": branch,
                "status": { "clean": true, "ahead": 0, "behind": 0, "modified": 0, "untracked": 0 },
                "files": [],
                "mode": "worktree",
                "baseRef": base_ref,
                "remoteUrl": remote_url,
                "commits": [],
                "currentBranch": branch,
                "targetBranch": target_branch,
                "ahead": 0,
                "behind": 0,
                "source": source,
                "worktreeId": worktree.as_ref().map(|item| item.id.clone()),
                "worktreePath": worktree.as_ref().map(|item| item.worktree_path.clone()),
                "error": "No repository or worktree linked to this task",
            }
        })));
    }

    if !crate::git::is_git_repository(&repo_path) {
        return Ok(Json(serde_json::json!({
            "changes": {
                "codebaseId": codebase_id,
                "repoPath": repo_path,
                "label": label,
                "branch": branch,
                "status": { "clean": true, "ahead": 0, "behind": 0, "modified": 0, "untracked": 0 },
                "files": [],
                "mode": "worktree",
                "baseRef": base_ref,
                "remoteUrl": remote_url,
                "commits": [],
                "currentBranch": branch,
                "targetBranch": target_branch,
                "ahead": 0,
                "behind": 0,
                "source": source,
                "worktreeId": worktree.as_ref().map(|item| item.id.clone()),
                "worktreePath": worktree.as_ref().map(|item| item.worktree_path.clone()),
                "error": "Repository is missing or not a git repository",
            }
        })));
    }

    let changes = crate::git::get_repo_changes(&repo_path);
    let commits = if let Some(resolved_base_ref) = base_ref.as_deref() {
        let commit_count = crate::git::count_commits_since_ref(&repo_path, resolved_base_ref);
        if commit_count > 0 {
            crate::git::get_repo_commit_changes(&repo_path, resolved_base_ref, Some(commit_count))
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    Ok(Json(serde_json::json!({
        "changes": {
            "codebaseId": codebase_id,
            "repoPath": repo_path,
            "label": label,
            "branch": changes.branch,
            "status": changes.status,
            "files": changes.files,
            "mode": if commits.is_empty() { "worktree" } else { "commits" },
            "baseRef": base_ref,
            "remoteUrl": remote_url,
            "commits": commits,
            "currentBranch": changes.branch,
            "targetBranch": target_branch,
            "ahead": changes.status.ahead,
            "behind": changes.status.behind,
            "source": source,
            "worktreeId": worktree.as_ref().map(|item| item.id.clone()),
            "worktreePath": worktree.as_ref().map(|item| item.worktree_path.clone()),
        }
    })))
}

/// GET /api/tasks/:id/changes/file - Get file diff for a task change
pub async fn get_task_change_file(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Query(query): Query<TaskChangeFileQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let (_task, repo_path) = load_task_and_repo_path(&state, &id).await?;
    let path = query
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("Missing file path or status".to_string()))?;
    let status = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("Missing file path or status".to_string()))?;

    if repo_path.is_empty() || !crate::git::is_git_repository(&repo_path) {
        return Err(ServerError::BadRequest(
            "Repository is missing or not a git repository".to_string(),
        ));
    }

    let diff = crate::git::get_repo_file_diff(
        &repo_path,
        &GitFileChange {
            path: path.to_string(),
            status: parse_file_change_status(status),
            previous_path: query.previous_path.and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            }),
        },
    );

    Ok(Json(serde_json::json!({ "diff": diff })))
}

/// GET /api/tasks/:id/changes/commit - Get commit diff
pub async fn get_task_change_commit(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Query(query): Query<TaskChangeCommitQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let (_task, repo_path) = load_task_and_repo_path(&state, &id).await?;
    let sha = query
        .sha
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("Missing commit sha".to_string()))?;

    if repo_path.is_empty() || !crate::git::is_git_repository(&repo_path) {
        return Err(ServerError::BadRequest(
            "Repository is missing or not a git repository".to_string(),
        ));
    }

    let diff = crate::git::get_repo_commit_diff(&repo_path, sha);
    Ok(Json(serde_json::json!({ "diff": diff })))
}

/// GET /api/tasks/:id/changes/stats - Get change stats for multiple files
pub async fn get_task_change_stats(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Query(query): Query<TaskChangeStatsQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let (_task, repo_path) = load_task_and_repo_path(&state, &id).await?;
    let paths_param = query
        .paths
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("Missing 'paths' query parameter".to_string()))?;

    let requested_paths: Vec<String> = paths_param
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect();
    if requested_paths.is_empty() {
        return Err(ServerError::BadRequest(
            "No valid paths provided".to_string(),
        ));
    }
    if requested_paths.len() > 100 {
        return Err(ServerError::BadRequest(
            "Too many paths requested. Maximum 100 per request.".to_string(),
        ));
    }

    if repo_path.is_empty() || !crate::git::is_git_repository(&repo_path) {
        return Err(ServerError::BadRequest(
            "Repository is missing or not a git repository".to_string(),
        ));
    }

    let statuses: Vec<String> = query
        .statuses
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect();

    let stats: Vec<serde_json::Value> = requested_paths
        .iter()
        .enumerate()
        .map(|(index, path)| {
            let diff = crate::git::get_repo_file_diff(
                &repo_path,
                &GitFileChange {
                    path: path.clone(),
                    status: parse_file_change_status(
                        statuses
                            .get(index)
                            .map(String::as_str)
                            .unwrap_or("modified"),
                    ),
                    previous_path: None,
                },
            );
            serde_json::json!({
                "path": path,
                "additions": diff.additions,
                "deletions": diff.deletions,
            })
        })
        .collect();

    let successful = stats
        .iter()
        .filter(|entry| entry.get("error").is_none())
        .count();

    Ok(Json(serde_json::json!({
        "stats": stats,
        "requested": requested_paths.len(),
        "successful": successful,
    })))
}
