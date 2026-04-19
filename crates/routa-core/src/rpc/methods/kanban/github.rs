use chrono::Utc;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::process::Command;

use crate::kanban::KanbanCard;
use crate::models::task::Task;
use crate::rpc::error::RpcError;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubIssueInfo {
    pub id: String,
    pub number: i64,
    pub url: String,
    pub state: String,
    pub repo: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGithubIssueParams {
    pub card_id: String,
    pub repo: String,
    #[serde(default)]
    pub labels: Vec<String>,
    pub assignee: Option<String>,
    pub title: Option<String>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGithubIssueResult {
    pub card: KanbanCard,
    pub issue: GithubIssueInfo,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncGithubIssueParams {
    pub card_id: String,
    pub repo: Option<String>,
    pub issue_number: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncGithubIssueResult {
    pub card: KanbanCard,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue: Option<GithubIssueInfo>,
}

fn github_token() -> Option<String> {
    std::env::var("GITHUB_TOKEN")
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            std::env::var("GH_TOKEN")
                .ok()
                .filter(|value| !value.is_empty())
        })
        .or_else(|| {
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
        })
}

fn github_request(
    request: reqwest::RequestBuilder,
    token: Option<String>,
) -> reqwest::RequestBuilder {
    let builder = request
        .header(ACCEPT, "application/vnd.github+json")
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "routa-kanban-cli")
        .header("X-GitHub-Api-Version", "2022-11-28");

    match token {
        Some(token) => builder.header(AUTHORIZATION, format!("token {token}")),
        None => builder,
    }
}

fn build_task_issue_body(objective: &str, test_cases: Option<&Vec<String>>) -> String {
    let normalized_test_cases: Vec<&str> = test_cases
        .into_iter()
        .flatten()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect();

    if normalized_test_cases.is_empty() {
        return objective.trim().to_string();
    }

    let mut sections = Vec::new();
    if !objective.trim().is_empty() {
        sections.push(objective.trim().to_string());
    }
    sections.push(format!(
        "## Test Cases\n{}",
        normalized_test_cases
            .into_iter()
            .map(|value| format!("- {value}"))
            .collect::<Vec<_>>()
            .join("\n")
    ));
    sections.join("\n\n")
}

async fn github_create_issue(
    repo: &str,
    title: &str,
    body: Option<&str>,
    labels: &[String],
    assignee: Option<&str>,
) -> Result<GithubIssueInfo, String> {
    let token = github_token().ok_or_else(|| "GITHUB_TOKEN is not configured.".to_string())?;
    let client = reqwest::Client::new();
    let mut payload = serde_json::json!({
        "title": title,
        "body": body,
        "labels": labels,
    });

    if let Some(assignee) = assignee {
        payload["assignees"] = serde_json::json!([assignee]);
    }

    let response = github_request(
        client.post(format!("https://api.github.com/repos/{repo}/issues")),
        Some(token),
    )
    .json(&payload)
    .send()
    .await
    .map_err(|error| format!("GitHub issue create failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("GitHub issue create failed: {status} {text}"));
    }

    let data = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("GitHub issue create failed: {error}"))?;

    Ok(GithubIssueInfo {
        id: data
            .get("id")
            .and_then(|value| value.as_i64())
            .unwrap_or_default()
            .to_string(),
        number: data
            .get("number")
            .and_then(|value| value.as_i64())
            .unwrap_or_default(),
        url: data
            .get("html_url")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        state: data
            .get("state")
            .and_then(|value| value.as_str())
            .unwrap_or("open")
            .to_string(),
        repo: repo.to_string(),
    })
}

async fn github_get_issue(repo: &str, issue_number: i64) -> Result<GithubIssueInfo, String> {
    let token = github_token().ok_or_else(|| "GITHUB_TOKEN is not configured.".to_string())?;
    let client = reqwest::Client::new();
    let response = github_request(
        client.get(format!(
            "https://api.github.com/repos/{repo}/issues/{issue_number}"
        )),
        Some(token),
    )
    .send()
    .await
    .map_err(|error| format!("GitHub issue fetch failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("GitHub issue fetch failed: {status} {text}"));
    }

    let data = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("GitHub issue fetch failed: {error}"))?;

    Ok(GithubIssueInfo {
        id: data
            .get("id")
            .and_then(|value| value.as_i64())
            .unwrap_or_default()
            .to_string(),
        number: data
            .get("number")
            .and_then(|value| value.as_i64())
            .unwrap_or_default(),
        url: data
            .get("html_url")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        state: data
            .get("state")
            .and_then(|value| value.as_str())
            .unwrap_or("open")
            .to_string(),
        repo: repo.to_string(),
    })
}

fn normalize_issue_body(task: &Task, body: Option<String>) -> String {
    body.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
    .or_else(|| {
        Some(build_task_issue_body(
            &task.objective,
            task.test_cases.as_ref(),
        ))
    })
    .unwrap_or_else(|| task.objective.clone())
}

pub async fn create_github_issue(
    state: &AppState,
    params: CreateGithubIssueParams,
) -> Result<CreateGithubIssueResult, RpcError> {
    let mut task = state
        .task_store
        .get(&params.card_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Card {} not found", params.card_id)))?;

    let title = params
        .title
        .as_deref()
        .unwrap_or(&task.title)
        .trim()
        .to_string();
    if title.is_empty() {
        return Err(RpcError::BadRequest(
            "Issue title cannot be blank".to_string(),
        ));
    }

    let body = normalize_issue_body(&task, params.body.clone());
    let issue = github_create_issue(
        &params.repo,
        &title,
        Some(body.as_str()),
        &params.labels,
        params.assignee.as_deref(),
    )
    .await
    .map_err(RpcError::BadRequest)?;

    task.github_id = Some(issue.id.clone());
    task.github_number = Some(issue.number);
    task.github_url = Some(issue.url.clone());
    task.github_repo = Some(issue.repo.clone());
    task.github_state = Some(issue.state.clone());
    task.github_synced_at = Some(Utc::now());
    state.task_store.save(&task).await?;

    Ok(CreateGithubIssueResult {
        card: crate::kanban::task_to_card(&task),
        issue,
    })
}

pub async fn sync_github_issue(
    state: &AppState,
    params: SyncGithubIssueParams,
) -> Result<SyncGithubIssueResult, RpcError> {
    let mut task = state
        .task_store
        .get(&params.card_id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Card {} not found", params.card_id)))?;
    let repo = params
        .repo
        .or_else(|| task.github_repo.clone())
        .ok_or_else(|| RpcError::BadRequest("repo is required".to_string()))?;
    let issue_number = params
        .issue_number
        .or(task.github_number)
        .ok_or_else(|| RpcError::BadRequest("issueNumber is required".to_string()))?;

    let issue = github_get_issue(&repo, issue_number)
        .await
        .map_err(RpcError::BadRequest)?;

    task.github_id = Some(issue.id.clone());
    task.github_number = Some(issue.number);
    task.github_url = Some(issue.url.clone());
    task.github_repo = Some(issue.repo.clone());
    task.github_state = Some(issue.state.clone());
    task.github_synced_at = Some(Utc::now());
    state.task_store.save(&task).await?;

    Ok(SyncGithubIssueResult {
        card: crate::kanban::task_to_card(&task),
        issue: Some(issue),
    })
}
