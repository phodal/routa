use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use std::process::Command;

#[derive(Clone)]
pub struct GitHubIssueRef {
    pub id: String,
    pub number: i64,
    pub url: String,
    pub state: String,
    pub repo: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssueListItem {
    pub id: String,
    pub number: i64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub url: String,
    pub state: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullListItem {
    pub id: String,
    pub number: i64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub url: String,
    pub state: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    pub draft: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merged_at: Option<String>,
    pub head_ref: String,
    pub base_ref: String,
}

pub fn resolve_github_repo(repo_path: Option<&str>) -> Option<String> {
    let repo_path = repo_path?;
    let output = crate::git::git_command()
        .args(["config", "--get", "remote.origin.url"])
        .current_dir(repo_path)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let remote = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed = crate::git::parse_github_url(&remote)?;
    Some(format!("{}/{}", parsed.owner, parsed.repo))
}

pub fn resolve_github_repo_for_codebase(
    source_url: Option<&str>,
    repo_path: Option<&str>,
) -> Option<String> {
    source_url
        .and_then(crate::git::parse_github_url)
        .map(|parsed| format!("{}/{}", parsed.owner, parsed.repo))
        .or_else(|| resolve_github_repo(repo_path))
}

pub fn resolve_github_token(board_token: Option<&str>) -> Option<String> {
    board_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            std::env::var("GITHUB_TOKEN")
                .ok()
                .filter(|value| !value.is_empty())
        })
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

fn github_token() -> Option<String> {
    resolve_github_token(None)
}

pub fn github_access_status(board_token: Option<&str>) -> (&'static str, bool) {
    if board_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        return ("board", true);
    }

    if std::env::var("GITHUB_TOKEN")
        .ok()
        .filter(|value| !value.is_empty())
        .is_some()
        || std::env::var("GH_TOKEN")
            .ok()
            .filter(|value| !value.is_empty())
            .is_some()
    {
        return ("env", true);
    }

    let output = match Command::new("gh").args(["auth", "token"]).output() {
        Ok(output) => output,
        Err(_) => return ("none", false),
    };

    if !output.status.success() {
        return ("none", false);
    }

    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        ("none", false)
    } else {
        ("gh", true)
    }
}

fn github_request(
    request: reqwest::RequestBuilder,
    token: Option<String>,
) -> reqwest::RequestBuilder {
    let builder = request
        .header(ACCEPT, "application/vnd.github+json")
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "routa-rust-kanban")
        .header("X-GitHub-Api-Version", "2022-11-28");

    match token {
        Some(token) => builder.header(AUTHORIZATION, format!("token {token}")),
        None => builder,
    }
}

pub async fn list_github_issues(
    repo: &str,
    state: Option<&str>,
    per_page: Option<usize>,
    board_token: Option<&str>,
) -> Result<Vec<GitHubIssueListItem>, String> {
    let client = reqwest::Client::new();
    let token = resolve_github_token(board_token);
    let per_page = per_page.unwrap_or(50).clamp(1, 100);
    let state = state.unwrap_or("open");
    let url = format!(
        "https://api.github.com/repos/{repo}/issues?state={state}&sort=updated&direction=desc&per_page={per_page}"
    );

    let response = github_request(client.get(url), token)
        .send()
        .await
        .map_err(|error| format!("GitHub issue list failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("GitHub issue list failed: {status} {text}"));
    }

    let data = response
        .json::<Vec<serde_json::Value>>()
        .await
        .map_err(|error| format!("GitHub issue list failed: {error}"))?;

    Ok(data
        .into_iter()
        .filter(|item| item.get("pull_request").is_none())
        .map(|item| GitHubIssueListItem {
            id: item
                .get("id")
                .and_then(|value| value.as_i64())
                .unwrap_or_default()
                .to_string(),
            number: item
                .get("number")
                .and_then(|value| value.as_i64())
                .unwrap_or_default(),
            title: item
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            body: item
                .get("body")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            url: item
                .get("html_url")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            state: item
                .get("state")
                .and_then(|value| value.as_str())
                .unwrap_or("open")
                .to_string(),
            labels: item
                .get("labels")
                .and_then(|value| value.as_array())
                .map(|labels| {
                    labels
                        .iter()
                        .filter_map(|label| {
                            label
                                .get("name")
                                .and_then(|value| value.as_str())
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(str::to_string)
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            assignees: item
                .get("assignees")
                .and_then(|value| value.as_array())
                .map(|assignees| {
                    assignees
                        .iter()
                        .filter_map(|assignee| {
                            assignee
                                .get("login")
                                .and_then(|value| value.as_str())
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(str::to_string)
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            updated_at: item
                .get("updated_at")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        })
        .collect())
}

pub async fn list_github_pulls(
    repo: &str,
    state: Option<&str>,
    per_page: Option<usize>,
    board_token: Option<&str>,
) -> Result<Vec<GitHubPullListItem>, String> {
    let client = reqwest::Client::new();
    let token = resolve_github_token(board_token);
    let per_page = per_page.unwrap_or(50).clamp(1, 100);
    let state = state.unwrap_or("open");
    let url = format!(
        "https://api.github.com/repos/{repo}/pulls?state={state}&sort=updated&direction=desc&per_page={per_page}"
    );

    let response = github_request(client.get(url), token)
        .send()
        .await
        .map_err(|error| format!("GitHub pull request list failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("GitHub pull request list failed: {status} {text}"));
    }

    let data = response
        .json::<Vec<serde_json::Value>>()
        .await
        .map_err(|error| format!("GitHub pull request list failed: {error}"))?;

    Ok(data
        .into_iter()
        .map(|item| GitHubPullListItem {
            id: item
                .get("id")
                .and_then(|value| value.as_i64())
                .unwrap_or_default()
                .to_string(),
            number: item
                .get("number")
                .and_then(|value| value.as_i64())
                .unwrap_or_default(),
            title: item
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            body: item
                .get("body")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            url: item
                .get("html_url")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            state: item
                .get("state")
                .and_then(|value| value.as_str())
                .unwrap_or("open")
                .to_string(),
            labels: item
                .get("labels")
                .and_then(|value| value.as_array())
                .map(|labels| {
                    labels
                        .iter()
                        .filter_map(|label| {
                            label
                                .get("name")
                                .and_then(|value| value.as_str())
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(str::to_string)
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            assignees: item
                .get("assignees")
                .and_then(|value| value.as_array())
                .map(|assignees| {
                    assignees
                        .iter()
                        .filter_map(|assignee| {
                            assignee
                                .get("login")
                                .and_then(|value| value.as_str())
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(str::to_string)
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            updated_at: item
                .get("updated_at")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            draft: item
                .get("draft")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
            merged_at: item
                .get("merged_at")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            head_ref: item
                .get("head")
                .and_then(|value| value.get("ref"))
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            base_ref: item
                .get("base")
                .and_then(|value| value.get("ref"))
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
        })
        .collect())
}

pub async fn create_github_issue(
    repo: &str,
    title: &str,
    body: Option<&str>,
    labels: &[String],
    assignee: Option<&str>,
) -> Result<GitHubIssueRef, String> {
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

    Ok(GitHubIssueRef {
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

pub async fn update_github_issue(
    repo: &str,
    issue_number: i64,
    title: &str,
    body: Option<&str>,
    labels: &[String],
    state: &str,
    assignee: Option<&str>,
) -> Result<(), String> {
    let token = github_token().ok_or_else(|| "GITHUB_TOKEN is not configured.".to_string())?;
    let client = reqwest::Client::new();
    let mut payload = serde_json::json!({
        "title": title,
        "body": body,
        "labels": labels,
        "state": state,
    });

    if let Some(assignee) = assignee {
        payload["assignees"] = serde_json::json!([assignee]);
    }

    let response = github_request(
        client.patch(format!(
            "https://api.github.com/repos/{repo}/issues/{issue_number}"
        )),
        Some(token),
    )
    .json(&payload)
    .send()
    .await
    .map_err(|error| format!("GitHub issue update failed: {error}"))?;

    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        Err(format!("GitHub issue update failed: {status} {text}"))
    }
}

pub fn build_task_issue_body(objective: &str, test_cases: Option<&Vec<String>>) -> String {
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

#[cfg(test)]
mod tests {
    use super::{github_access_status, resolve_github_token};
    use std::env;
    use std::sync::{Mutex, OnceLock};

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

        fn remove(key: &'static str) -> Self {
            let previous = env::var(key).ok();
            // SAFETY: tests serialize env mutations with env_lock().
            unsafe { env::remove_var(key) };
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

    #[test]
    fn github_access_status_prefers_board_token_over_environment() {
        let _env_guard = env_lock().lock().expect("env lock");
        let _github_token = EnvGuard::set("GITHUB_TOKEN", "github_pat_env");
        let _gh_token = EnvGuard::remove("GH_TOKEN");

        assert_eq!(
            github_access_status(Some(" github_pat_board ")),
            ("board", true)
        );
        assert_eq!(
            resolve_github_token(Some(" github_pat_board ")),
            Some("github_pat_board".to_string())
        );
    }

    #[test]
    fn github_access_status_falls_back_to_environment_without_board_token() {
        let _env_guard = env_lock().lock().expect("env lock");
        let _github_token = EnvGuard::set("GITHUB_TOKEN", "github_pat_env");
        let _gh_token = EnvGuard::remove("GH_TOKEN");

        assert_eq!(github_access_status(Some("   ")), ("env", true));
        assert_eq!(
            resolve_github_token(Some("   ")),
            Some("github_pat_env".to_string())
        );
    }
}
