use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::process::Command;
use std::time::Duration;

use chrono::Utc;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};

use crate::git::{git_command, parse_github_url};
use crate::kanban::task_to_card;
use crate::models::task::{Task, TaskCreationSource};
use crate::rpc::error::RpcError;
use crate::state::AppState;

use super::shared::{
    default_workspace_id, emit_kanban_workspace_event, ensure_column_exists,
    next_position_in_column, resolve_board,
};

const DEFAULT_GITHUB_API_BASE_URL: &str = "https://api.github.com";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIssueFromCardParams {
    pub card_id: String,
    pub repo: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssueRef {
    pub id: String,
    pub number: i64,
    pub url: String,
    pub state: String,
    pub repo: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIssueFromCardResult {
    pub card_id: String,
    pub issue: GitHubIssueRef,
    pub card: crate::kanban::KanbanCard,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncGitHubIssuesParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub board_id: Option<String>,
    pub column_id: Option<String>,
    pub repo: Option<String>,
    pub codebase_id: Option<String>,
    pub state: Option<String>,
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncGitHubIssuesResult {
    pub repo: String,
    pub board_id: String,
    pub column_id: String,
    pub dry_run: bool,
    pub created: usize,
    pub updated: usize,
    pub skipped: usize,
    pub tasks: Vec<SyncTaskSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTaskSummary {
    pub card_id: String,
    pub github_number: i64,
    pub title: String,
    pub action: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct GitHubIssueListItem {
    id: String,
    number: i64,
    title: String,
    body: Option<String>,
    url: String,
    state: String,
    labels: Vec<String>,
    assignees: Vec<String>,
}

pub async fn create_issue_from_card(
    state: &AppState,
    params: CreateIssueFromCardParams,
) -> Result<CreateIssueFromCardResult, RpcError> {
    let mut task = state
        .task_store
        .get(&params.card_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Card {} not found", params.card_id)))?;

    if task.github_number.is_some() || task.github_url.is_some() {
        return Err(RpcError::BadRequest(format!(
            "Card {} is already linked to GitHub issue {}",
            task.id,
            task.github_number
                .map(|value| format!("#{value}"))
                .unwrap_or_else(|| task
                    .github_url
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string()))
        )));
    }

    let repo = resolve_repo_for_task(state, &task, params.repo.as_deref()).await?;
    let issue = create_github_issue(
        &repo,
        &task.title,
        &build_task_github_issue_body(&task),
        &task.labels,
        task.assignee.as_deref(),
    )
    .await?;

    task.github_id = Some(issue.id.clone());
    task.github_number = Some(issue.number);
    task.github_url = Some(issue.url.clone());
    task.github_repo = Some(issue.repo.clone());
    task.github_state = Some(issue.state.clone());
    task.github_synced_at = Some(Utc::now());
    task.last_sync_error = None;
    task.updated_at = Utc::now();

    state.task_store.save(&task).await?;
    emit_kanban_workspace_event(
        state,
        &task.workspace_id,
        "task",
        "updated",
        Some(&task.id),
        "system",
    )
    .await;

    Ok(CreateIssueFromCardResult {
        card_id: task.id.clone(),
        issue,
        card: task_to_card(&task),
    })
}

pub async fn sync_github_issues(
    state: &AppState,
    params: SyncGitHubIssuesParams,
) -> Result<SyncGitHubIssuesResult, RpcError> {
    let board = resolve_board(state, &params.workspace_id, params.board_id.as_deref()).await?;
    let column_id = params.column_id.unwrap_or_else(|| "backlog".to_string());
    ensure_column_exists(&board, &column_id)?;

    let repo = resolve_sync_repo(
        state,
        &params.workspace_id,
        params.repo.as_deref(),
        params.codebase_id.as_deref(),
    )
    .await?;
    let state_filter = parse_issue_state(params.state.as_deref())?;
    let issues = list_github_issues(&repo, state_filter).await?;
    let mut existing_tasks = state
        .task_store
        .list_by_workspace(&params.workspace_id)
        .await?;
    let mut existing_by_issue = BTreeMap::new();

    for task in &existing_tasks {
        if let (Some(task_repo), Some(issue_number)) =
            (task.github_repo.as_deref(), task.github_number)
        {
            existing_by_issue.insert(format!("{task_repo}#{issue_number}"), task.id.clone());
        }
    }

    let mut created = 0;
    let mut updated = 0;
    let mut skipped = 0;
    let mut summaries = Vec::new();

    for issue in issues {
        let key = format!("{repo}#{}", issue.number);
        if let Some(task_id) = existing_by_issue.get(&key) {
            let Some(existing_task) = existing_tasks.iter_mut().find(|task| task.id == *task_id)
            else {
                skipped += 1;
                continue;
            };

            let did_change = apply_github_issue_to_task(existing_task, &issue, false);
            if did_change {
                if !params.dry_run {
                    state.task_store.save(existing_task).await?;
                    emit_kanban_workspace_event(
                        state,
                        &existing_task.workspace_id,
                        "task",
                        "updated",
                        Some(&existing_task.id),
                        "system",
                    )
                    .await;
                }
                updated += 1;
                summaries.push(SyncTaskSummary {
                    card_id: existing_task.id.clone(),
                    github_number: issue.number,
                    title: issue.title.clone(),
                    action: "updated".to_string(),
                });
            } else {
                skipped += 1;
                summaries.push(SyncTaskSummary {
                    card_id: existing_task.id.clone(),
                    github_number: issue.number,
                    title: issue.title.clone(),
                    action: "skipped".to_string(),
                });
            }
            continue;
        }

        let mut task = Task::new(
            uuid::Uuid::new_v4().to_string(),
            issue.title.clone(),
            normalize_issue_objective(issue.body.as_deref(), &issue.title),
            params.workspace_id.clone(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        task.creation_source = Some(TaskCreationSource::Manual);
        task.board_id = Some(board.id.clone());
        task.column_id = Some(column_id.clone());
        task.position =
            next_position_in_column(state, &board.workspace_id, &board.id, &column_id).await?;
        task.labels = issue.labels.clone();
        task.assignee = issue.assignees.first().cloned();
        if let Some(codebase_id) = params.codebase_id.as_ref() {
            task.codebase_ids = vec![codebase_id.clone()];
        }
        apply_github_issue_to_task(&mut task, &issue, true);

        if !params.dry_run {
            state.task_store.save(&task).await?;
            emit_kanban_workspace_event(
                state,
                &task.workspace_id,
                "task",
                "created",
                Some(&task.id),
                "system",
            )
            .await;
            existing_tasks.push(task.clone());
            existing_by_issue.insert(key, task.id.clone());
        }

        created += 1;
        summaries.push(SyncTaskSummary {
            card_id: task.id.clone(),
            github_number: issue.number,
            title: issue.title.clone(),
            action: "created".to_string(),
        });
    }

    Ok(SyncGitHubIssuesResult {
        repo,
        board_id: board.id,
        column_id,
        dry_run: params.dry_run,
        created,
        updated,
        skipped,
        tasks: summaries,
    })
}

fn apply_github_issue_to_task(
    task: &mut Task,
    issue: &GitHubIssueListItem,
    overwrite_empty_only: bool,
) -> bool {
    let mut changed = false;
    let next_objective = normalize_issue_objective(issue.body.as_deref(), &issue.title);

    if task.title != issue.title {
        task.title = issue.title.clone();
        changed = true;
    }
    if task.objective != next_objective {
        task.objective = next_objective;
        changed = true;
    }

    let merged_labels = if overwrite_empty_only && !task.labels.is_empty() {
        task.labels.clone()
    } else {
        merge_labels(&task.labels, &issue.labels)
    };
    if task.labels != merged_labels {
        task.labels = merged_labels;
        changed = true;
    }

    let next_assignee = if overwrite_empty_only && task.assignee.is_some() {
        task.assignee.clone()
    } else {
        issue.assignees.first().cloned()
    };
    if task.assignee != next_assignee {
        task.assignee = next_assignee;
        changed = true;
    }

    changed |= set_optional_string(&mut task.github_id, Some(issue.id.clone()));
    changed |= set_optional_i64(&mut task.github_number, Some(issue.number));
    changed |= set_optional_string(&mut task.github_url, Some(issue.url.clone()));
    changed |= set_optional_string(
        &mut task.github_repo,
        extract_repo_from_issue_url(&issue.url),
    );
    changed |= set_optional_string(&mut task.github_state, Some(issue.state.clone()));

    if task.last_sync_error.take().is_some() {
        changed = true;
    }
    task.github_synced_at = Some(Utc::now());
    task.updated_at = Utc::now();
    changed
}

fn merge_labels(existing: &[String], incoming: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut labels = Vec::new();
    for value in existing.iter().chain(incoming.iter()) {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            labels.push(trimmed.to_string());
        }
    }
    labels
}

fn normalize_issue_objective(body: Option<&str>, fallback_title: &str) -> String {
    let trimmed = body.unwrap_or_default().trim();
    if trimmed.is_empty() {
        fallback_title.trim().to_string()
    } else {
        trimmed.to_string()
    }
}

fn build_task_github_issue_body(task: &Task) -> String {
    let mut sections = Vec::new();
    let objective = task.objective.trim();
    if !objective.is_empty() {
        sections.push(objective.to_string());
    }

    let test_cases = task
        .test_cases
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if !test_cases.is_empty() {
        sections.push(
            std::iter::once("## Test Cases".to_string())
                .chain(test_cases.into_iter().map(|value| format!("- {value}")))
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }

    sections.join("\n\n")
}

async fn resolve_repo_for_task(
    state: &AppState,
    task: &Task,
    explicit_repo: Option<&str>,
) -> Result<String, RpcError> {
    if let Some(repo) = explicit_repo {
        return normalize_repo(repo);
    }
    if let Some(repo) = task.github_repo.clone() {
        return normalize_repo(&repo);
    }

    for codebase_id in &task.codebase_ids {
        if let Some(codebase) = state.codebase_store.get(codebase_id).await? {
            if let Some(repo) =
                resolve_repo_from_codebase(&codebase.source_url, &codebase.repo_path)
            {
                return Ok(repo);
            }
        }
    }

    if let Some(codebase) = state.codebase_store.get_default(&task.workspace_id).await? {
        if let Some(repo) = resolve_repo_from_codebase(&codebase.source_url, &codebase.repo_path) {
            return Ok(repo);
        }
    }

    Err(RpcError::BadRequest(
        "Selected task is not linked to a GitHub repository. Pass --repo owner/repo.".to_string(),
    ))
}

async fn resolve_sync_repo(
    state: &AppState,
    workspace_id: &str,
    explicit_repo: Option<&str>,
    codebase_id: Option<&str>,
) -> Result<String, RpcError> {
    if let Some(repo) = explicit_repo {
        return normalize_repo(repo);
    }

    if let Some(codebase_id) = codebase_id {
        let codebase = state
            .codebase_store
            .get(codebase_id)
            .await?
            .ok_or_else(|| RpcError::NotFound(format!("Codebase {codebase_id} not found")))?;
        return resolve_repo_from_codebase(&codebase.source_url, &codebase.repo_path).ok_or_else(
            || {
                RpcError::BadRequest(
                    "Selected codebase is not linked to a GitHub repository.".to_string(),
                )
            },
        );
    }

    let codebase = state
        .codebase_store
        .get_default(workspace_id)
        .await?
        .ok_or_else(|| {
            RpcError::BadRequest("No default codebase linked to this workspace.".to_string())
        })?;
    resolve_repo_from_codebase(&codebase.source_url, &codebase.repo_path).ok_or_else(|| {
        RpcError::BadRequest("Selected codebase is not linked to a GitHub repository.".to_string())
    })
}

fn resolve_repo_from_codebase(source_url: &Option<String>, repo_path: &str) -> Option<String> {
    source_url
        .as_deref()
        .and_then(parse_github_url)
        .map(|value| format!("{}/{}", value.owner, value.repo))
        .or_else(|| resolve_repo_from_remote(repo_path))
}

fn resolve_repo_from_remote(repo_path: &str) -> Option<String> {
    let output = git_command()
        .args(["config", "--get", "remote.origin.url"])
        .current_dir(repo_path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let remote = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse_github_url(&remote).map(|value| format!("{}/{}", value.owner, value.repo))
}

fn normalize_repo(repo: &str) -> Result<String, RpcError> {
    let parsed = parse_github_url(repo).ok_or_else(|| {
        RpcError::BadRequest(format!(
            "Invalid GitHub repository: {repo}. Expected owner/repo or a GitHub URL."
        ))
    })?;
    Ok(format!("{}/{}", parsed.owner, parsed.repo))
}

fn extract_repo_from_issue_url(url: &str) -> Option<String> {
    let parsed = parse_github_url(url)?;
    Some(format!("{}/{}", parsed.owner, parsed.repo))
}

fn parse_issue_state(value: Option<&str>) -> Result<&'static str, RpcError> {
    match value.unwrap_or("open").trim() {
        "open" => Ok("open"),
        "closed" => Ok("closed"),
        "all" => Ok("all"),
        other => Err(RpcError::BadRequest(format!(
            "state must be one of: open, closed, all; got {other}"
        ))),
    }
}

async fn list_github_issues(repo: &str, state: &str) -> Result<Vec<GitHubIssueListItem>, RpcError> {
    let client = github_client()?;
    let url = format!(
        "{}/repos/{repo}/issues?state={state}&sort=updated&direction=desc&per_page=100",
        github_api_base_url()
    );
    let mut request = client
        .get(url)
        .header(ACCEPT, "application/vnd.github+json");
    if let Some(token) = github_token() {
        request = request.header(AUTHORIZATION, format!("token {token}"));
    }

    let response = request
        .send()
        .await
        .map_err(|error| RpcError::Internal(format!("GitHub issue list failed: {error}")))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(RpcError::BadRequest(format!(
            "GitHub issue list failed: {status} {body}"
        )));
    }

    let payload = response
        .json::<Vec<serde_json::Value>>()
        .await
        .map_err(|error| {
            RpcError::Internal(format!("Failed to parse GitHub issue list: {error}"))
        })?;

    let mut issues = Vec::new();
    for item in payload {
        if item.get("pull_request").is_some() {
            continue;
        }
        let Some(id_value) = item.get("id").and_then(|value| value.as_i64()) else {
            continue;
        };
        let Some(number) = item.get("number").and_then(|value| value.as_i64()) else {
            continue;
        };
        let Some(title) = item.get("title").and_then(|value| value.as_str()) else {
            continue;
        };
        let Some(url) = item.get("html_url").and_then(|value| value.as_str()) else {
            continue;
        };
        let state = item
            .get("state")
            .and_then(|value| value.as_str())
            .unwrap_or("open")
            .to_string();
        let labels = item
            .get("labels")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.get("name").and_then(|value| value.as_str()))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        let assignees = item
            .get("assignees")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.get("login").and_then(|value| value.as_str()))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        issues.push(GitHubIssueListItem {
            id: id_value.to_string(),
            number,
            title: title.to_string(),
            body: item
                .get("body")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            url: url.to_string(),
            state,
            labels,
            assignees,
        });
    }

    Ok(issues)
}

async fn create_github_issue(
    repo: &str,
    title: &str,
    body: &str,
    labels: &[String],
    assignee: Option<&str>,
) -> Result<GitHubIssueRef, RpcError> {
    let token = github_token().ok_or_else(|| {
        RpcError::BadRequest(
            "GITHUB_TOKEN is not configured and gh auth token is unavailable.".to_string(),
        )
    })?;
    let client = github_client()?;
    let url = format!("{}/repos/{repo}/issues", github_api_base_url());

    let mut payload = serde_json::json!({
        "title": title,
        "body": body,
    });
    if !labels.is_empty() {
        payload["labels"] = serde_json::json!(labels);
    }
    if let Some(assignee) = assignee.map(str::trim).filter(|value| !value.is_empty()) {
        payload["assignees"] = serde_json::json!([assignee]);
    }

    let response = client
        .post(url)
        .header(ACCEPT, "application/vnd.github+json")
        .header(AUTHORIZATION, format!("token {token}"))
        .json(&payload)
        .send()
        .await
        .map_err(|error| RpcError::Internal(format!("GitHub issue create failed: {error}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(RpcError::BadRequest(format!(
            "GitHub issue create failed: {status} {body}"
        )));
    }

    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| {
            RpcError::Internal(format!("Failed to parse created GitHub issue: {error}"))
        })?;
    let id = payload
        .get("id")
        .and_then(|value| value.as_i64())
        .ok_or_else(|| RpcError::Internal("GitHub issue response missing id".to_string()))?;
    let number = payload
        .get("number")
        .and_then(|value| value.as_i64())
        .ok_or_else(|| RpcError::Internal("GitHub issue response missing number".to_string()))?;
    let url = payload
        .get("html_url")
        .and_then(|value| value.as_str())
        .ok_or_else(|| RpcError::Internal("GitHub issue response missing html_url".to_string()))?;
    let state = payload
        .get("state")
        .and_then(|value| value.as_str())
        .unwrap_or("open")
        .to_string();

    Ok(GitHubIssueRef {
        id: id.to_string(),
        number,
        url: url.to_string(),
        state,
        repo: repo.to_string(),
    })
}

fn github_client() -> Result<reqwest::Client, RpcError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .default_headers(
            [
                (
                    USER_AGENT,
                    "routa-core-kanban-github".parse().map_err(|error| {
                        RpcError::Internal(format!("Invalid GitHub user agent: {error}"))
                    })?,
                ),
                (
                    CONTENT_TYPE,
                    "application/json".parse().map_err(|error| {
                        RpcError::Internal(format!("Invalid GitHub content type: {error}"))
                    })?,
                ),
            ]
            .into_iter()
            .collect(),
        )
        .build()
        .map_err(|error| RpcError::Internal(format!("Failed to build GitHub client: {error}")))
}

fn github_api_base_url() -> String {
    env::var("ROUTA_GITHUB_API_BASE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_GITHUB_API_BASE_URL.to_string())
}

fn github_token() -> Option<String> {
    let env_token = env::var("GITHUB_TOKEN")
        .ok()
        .or_else(|| env::var("GH_TOKEN").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if env_token.is_some() {
        return env_token;
    }

    let output = Command::new("gh").args(["auth", "token"]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

fn set_optional_string(target: &mut Option<String>, next: Option<String>) -> bool {
    if *target != next {
        *target = next;
        true
    } else {
        false
    }
}

fn set_optional_i64(target: &mut Option<i64>, next: Option<i64>) -> bool {
    if *target != next {
        *target = next;
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::models::codebase::{Codebase, CodebaseSourceType};
    use crate::models::kanban::default_kanban_board;
    use crate::models::workspace::Workspace;
    use crate::state::{AppState, AppStateInner};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvGuard {
        key: &'static str,
        previous: Option<String>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let previous = env::var(key).ok();
            // SAFETY: tests serialize env mutations with env_lock().
            unsafe { env::set_var(key, value) };
            Self { key, previous }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            // SAFETY: tests serialize env mutations with env_lock().
            unsafe {
                match &self.previous {
                    Some(previous) => env::set_var(self.key, previous),
                    None => env::remove_var(self.key),
                }
            }
        }
    }

    async fn setup_state() -> AppState {
        let db = Database::open_in_memory().expect("in-memory db should open");
        let state: AppState = Arc::new(AppStateInner::new(db));
        state
            .workspace_store
            .save(&Workspace::new(
                "default".to_string(),
                "Default Workspace".to_string(),
                None,
            ))
            .await
            .expect("workspace should save");
        let board = default_kanban_board("default".to_string());
        state
            .kanban_store
            .create(&board)
            .await
            .expect("board should create");
        state
    }

    async fn save_default_codebase(state: &AppState, source_url: &str) {
        state
            .codebase_store
            .save(&Codebase::new(
                "codebase-1".to_string(),
                "default".to_string(),
                "/tmp/repo".to_string(),
                Some("main".to_string()),
                Some("Primary".to_string()),
                true,
                Some(CodebaseSourceType::Github),
                Some(source_url.to_string()),
            ))
            .await
            .expect("codebase should save");
    }

    fn spawn_single_response_server(
        assertions: impl Fn(String) + Send + 'static,
        body: &'static str,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let addr = listener.local_addr().expect("local addr");
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept should succeed");
            let mut request = Vec::new();
            let mut headers_done = false;
            let mut content_length = 0usize;

            loop {
                let mut chunk = [0u8; 1024];
                let read = stream.read(&mut chunk).expect("read should succeed");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
                if !headers_done {
                    if let Some(idx) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                        headers_done = true;
                        let header_text = String::from_utf8_lossy(&request[..idx + 4]).to_string();
                        content_length = header_text
                            .lines()
                            .find_map(|line| {
                                let lower = line.to_ascii_lowercase();
                                lower
                                    .strip_prefix("content-length:")
                                    .and_then(|value| value.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if request.len() >= idx + 4 + content_length {
                            break;
                        }
                    }
                } else if let Some(idx) =
                    request.windows(4).position(|window| window == b"\r\n\r\n")
                {
                    if request.len() >= idx + 4 + content_length {
                        break;
                    }
                }
            }

            assertions(String::from_utf8_lossy(&request).to_string());
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("response should write");
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn create_issue_from_card_links_existing_task() {
        let _lock = env_lock().lock().expect("env lock");
        let state = setup_state().await;
        save_default_codebase(&state, "https://github.com/acme/platform").await;

        let mut task = Task::new(
            "task-1".to_string(),
            "Ship CLI sync".to_string(),
            "Implement issue 492".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            Some(vec!["CLI can create issue link".to_string()]),
            None,
            None,
        );
        task.board_id = Some("default-board".to_string());
        task.column_id = Some("todo".to_string());
        task.labels = vec!["cli".to_string(), "kanban".to_string()];
        task.codebase_ids = vec!["codebase-1".to_string()];
        state.task_store.save(&task).await.expect("task save");

        let base_url = spawn_single_response_server(
            |request| {
                assert!(request.starts_with("POST /repos/acme/platform/issues HTTP/1.1"));
                assert!(request.contains("authorization: token test-token"));
                assert!(request.contains("\"title\":\"Ship CLI sync\""));
                assert!(request.contains("CLI can create issue link"));
            },
            r#"{"id":42,"number":77,"html_url":"https://github.com/acme/platform/issues/77","state":"open"}"#,
        );
        let _base = EnvGuard::set("ROUTA_GITHUB_API_BASE_URL", &base_url);
        let _token = EnvGuard::set("GITHUB_TOKEN", "test-token");

        let result = create_issue_from_card(
            &state,
            CreateIssueFromCardParams {
                card_id: "task-1".to_string(),
                repo: None,
            },
        )
        .await
        .expect("create issue should succeed");

        assert_eq!(result.issue.number, 77);
        let saved = state
            .task_store
            .get("task-1")
            .await
            .expect("task get")
            .expect("task exists");
        assert_eq!(saved.github_number, Some(77));
        assert_eq!(saved.github_repo.as_deref(), Some("acme/platform"));
    }

    #[tokio::test]
    async fn sync_github_issues_creates_and_updates_tasks() {
        let _lock = env_lock().lock().expect("env lock");
        let state = setup_state().await;
        save_default_codebase(&state, "https://github.com/acme/platform").await;

        let mut existing = Task::new(
            "task-existing".to_string(),
            "Old title".to_string(),
            "Old body".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        existing.board_id = Some("default-board".to_string());
        existing.column_id = Some("todo".to_string());
        existing.github_id = Some("2".to_string());
        existing.github_number = Some(2);
        existing.github_repo = Some("acme/platform".to_string());
        existing.github_url = Some("https://github.com/acme/platform/issues/2".to_string());
        existing.github_state = Some("open".to_string());
        existing.labels = vec!["local".to_string()];
        state
            .task_store
            .save(&existing)
            .await
            .expect("existing task save");

        let base_url = spawn_single_response_server(
            |request| {
                assert!(request.starts_with("GET /repos/acme/platform/issues?state=all&sort=updated&direction=desc&per_page=100 HTTP/1.1"));
            },
            r#"[
              {"id":1,"number":1,"title":"New issue","body":"Imported body","html_url":"https://github.com/acme/platform/issues/1","state":"open","labels":[{"name":"bug"}],"assignees":[{"login":"alice"}]},
              {"id":2,"number":2,"title":"Fresh title","body":"Fresh body","html_url":"https://github.com/acme/platform/issues/2","state":"closed","labels":[{"name":"server"}],"assignees":[]}
            ]"#,
        );
        let _base = EnvGuard::set("ROUTA_GITHUB_API_BASE_URL", &base_url);
        let _token = EnvGuard::set("GITHUB_TOKEN", "test-token");

        let result = sync_github_issues(
            &state,
            SyncGitHubIssuesParams {
                workspace_id: "default".to_string(),
                board_id: Some("default-board".to_string()),
                column_id: Some("backlog".to_string()),
                repo: Some("acme/platform".to_string()),
                codebase_id: Some("codebase-1".to_string()),
                state: Some("all".to_string()),
                dry_run: false,
            },
        )
        .await
        .expect("sync should succeed");

        assert_eq!(result.created, 1);
        assert_eq!(result.updated, 1);

        let tasks = state
            .task_store
            .list_by_workspace("default")
            .await
            .expect("list should succeed");
        assert_eq!(tasks.len(), 2);
        let created = tasks
            .iter()
            .find(|task| task.github_number == Some(1))
            .expect("created task");
        assert_eq!(created.title, "New issue");
        assert_eq!(created.assignee.as_deref(), Some("alice"));
        assert_eq!(created.labels, vec!["bug".to_string()]);

        let updated = tasks
            .iter()
            .find(|task| task.github_number == Some(2))
            .expect("updated task");
        assert_eq!(updated.title, "Fresh title");
        assert_eq!(updated.objective, "Fresh body");
        assert_eq!(updated.github_state.as_deref(), Some("closed"));
        assert!(updated.labels.contains(&"local".to_string()));
        assert!(updated.labels.contains(&"server".to_string()));
    }

    #[tokio::test]
    async fn sync_github_issues_dry_run_does_not_mutate_store() {
        let _lock = env_lock().lock().expect("env lock");
        let state = setup_state().await;
        save_default_codebase(&state, "https://github.com/acme/platform").await;

        let base_url = spawn_single_response_server(
            |_request| {},
            r#"[{"id":1,"number":11,"title":"Dry run issue","body":"","html_url":"https://github.com/acme/platform/issues/11","state":"open","labels":[],"assignees":[]}]"#,
        );
        let _base = EnvGuard::set("ROUTA_GITHUB_API_BASE_URL", &base_url);
        let _token = EnvGuard::set("GITHUB_TOKEN", "test-token");

        let result = sync_github_issues(
            &state,
            SyncGitHubIssuesParams {
                workspace_id: "default".to_string(),
                board_id: Some("default-board".to_string()),
                column_id: Some("backlog".to_string()),
                repo: Some("acme/platform".to_string()),
                codebase_id: Some("codebase-1".to_string()),
                state: Some("open".to_string()),
                dry_run: true,
            },
        )
        .await
        .expect("dry run should succeed");

        assert_eq!(result.created, 1);
        assert!(result.dry_run);
        let tasks = state
            .task_store
            .list_by_workspace("default")
            .await
            .expect("list should succeed");
        assert!(tasks.is_empty());
    }
}
