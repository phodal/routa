//! Clone Progress API - /api/clone/progress
//!
//! POST /api/clone/progress - Clone a repo with SSE progress streaming

use axum::{
    response::sse::{Event, Sse},
    routing::post,
    Json, Router,
};
use serde::Deserialize;
use std::convert::Infallible;
use std::pin::Pin;

use crate::git;
use crate::state::AppState;

type SseStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<Event, Infallible>> + Send>>;

pub fn router() -> Router<AppState> {
    Router::new().route("/", post(clone_with_progress))
}

/// Parse git error output and return a user-friendly message
fn parse_git_error(stderr: &str, exit_code: Option<i32>) -> String {
    let stderr_lower = stderr.to_lowercase();

    // Auth errors
    if stderr_lower.contains("authentication failed")
        || stderr_lower.contains("could not read username")
        || stderr_lower.contains("could not read password")
        || stderr_lower.contains("terminal prompts disabled")
    {
        return "Git credentials not configured. Set up a credential manager or use SSH."
            .to_string();
    }

    // SSH auth errors
    if stderr_lower.contains("permission denied (publickey)")
        || stderr_lower.contains("host key verification failed")
    {
        return "SSH key not configured. Set up SSH keys or switch to HTTPS.".to_string();
    }

    // Repository not found (exit code 128 often means this)
    if stderr_lower.contains("repository") && stderr_lower.contains("not found") {
        return "Repository not found or you don't have access.".to_string();
    }

    // HTTP errors
    if stderr_lower.contains("the requested url returned error: 401")
        || stderr_lower.contains("the requested url returned error: 403")
    {
        return "Access denied. Check your credentials or repository permissions.".to_string();
    }

    if stderr_lower.contains("the requested url returned error: 404") {
        return "Repository not found. Check the URL and your access permissions.".to_string();
    }

    // Network errors
    if stderr_lower.contains("could not resolve host")
        || stderr_lower.contains("network is unreachable")
        || stderr_lower.contains("connection refused")
    {
        return "Network error. Check your internet connection.".to_string();
    }

    // SSL/TLS errors
    if stderr_lower.contains("ssl certificate problem") {
        return "SSL certificate error. Check your network or proxy settings.".to_string();
    }

    // Rate limiting
    if stderr_lower.contains("rate limit") {
        return "API rate limit exceeded. Please try again later.".to_string();
    }

    // If we have stderr content, extract the "fatal:" line
    if let Some(fatal_line) = stderr.lines().find(|l| l.starts_with("fatal:")) {
        return fatal_line.trim_start_matches("fatal:").trim().to_string();
    }

    // Fallback: include stderr content if available
    if !stderr.trim().is_empty() {
        let first_line = stderr.lines().next().unwrap_or("").trim();
        if !first_line.is_empty() {
            return format!("Clone failed: {first_line}");
        }
    }

    // Last resort: just show the exit code
    format!("Clone failed with exit code {}", exit_code.unwrap_or(-1))
}

#[derive(Debug, Deserialize)]
struct CloneProgressRequest {
    url: Option<String>,
}

async fn clone_with_progress(
    Json(body): Json<CloneProgressRequest>,
) -> Result<Sse<SseStream>, axum::http::StatusCode> {
    let url = match body.url.as_deref() {
        Some(u) if !u.is_empty() => u.to_string(),
        _ => return Err(axum::http::StatusCode::BAD_REQUEST),
    };

    let parsed = match git::parse_github_url(&url) {
        Some(p) => p,
        None => return Err(axum::http::StatusCode::BAD_REQUEST),
    };

    let repo_name = git::repo_to_dir_name(&parsed.owner, &parsed.repo);
    let base_dir = git::get_clone_base_dir();
    let _ = std::fs::create_dir_all(&base_dir);
    let target_dir = base_dir.join(&repo_name);
    let target_str = target_dir.to_string_lossy().to_string();

    // If already exists, return immediately
    if target_dir.exists() {
        let info = git::get_branch_info(&target_str);
        let data = serde_json::json!({
            "phase": "done",
            "success": true,
            "path": target_str,
            "name": format!("{}/{}", parsed.owner, parsed.repo),
            "branch": info.current,
            "branches": info.branches,
            "existed": true,
        });
        let stream: SseStream = Box::pin(tokio_stream::once(Ok::<_, Infallible>(
            Event::default().data(data.to_string()),
        )));
        return Ok(Sse::new(stream));
    }

    let clone_url = format!("https://github.com/{}/{}.git", parsed.owner, parsed.repo);

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(64);

    tokio::spawn(async move {
        let _ = tx
            .send(Ok(Event::default().data(
                serde_json::json!({"phase":"starting","percent":0,"message":"Starting clone..."})
                    .to_string(),
            )))
            .await;

        let child = tokio::process::Command::new("git")
            .args(["clone", "--progress", &clone_url, &target_str])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();

        let mut child = match child {
            Ok(c) => c,
            Err(e) => {
                let _ = tx
                    .send(Ok(Event::default().data(
                        serde_json::json!({"phase":"error","error": e.to_string()}).to_string(),
                    )))
                    .await;
                return;
            }
        };

        // Collect stderr output for error reporting
        let mut stderr_buf = String::new();

        // git clone writes progress to stderr
        if let Some(stderr) = child.stderr.take() {
            let reader = tokio::io::BufReader::new(stderr);
            let mut lines = tokio::io::AsyncBufReadExt::lines(reader);

            let phase_re = regex::Regex::new(
                r"(Counting objects|Compressing objects|Receiving objects|Resolving deltas):\s+(\d+)%",
            );
            while let Ok(Some(text)) = lines.next_line().await {
                // Accumulate all stderr for error reporting
                stderr_buf.push_str(&text);
                stderr_buf.push('\n');

                if let Ok(ref re) = phase_re {
                    if let Some(caps) = re.captures(&text) {
                        let phase_name = match caps.get(1).map(|m| m.as_str()) {
                            Some("Counting objects") => "counting",
                            Some("Compressing objects") => "compressing",
                            Some("Receiving objects") => "receiving",
                            Some("Resolving deltas") => "resolving",
                            _ => "progress",
                        };
                        let percent: i32 = caps
                            .get(2)
                            .and_then(|m| m.as_str().parse().ok())
                            .unwrap_or(0);
                        let _ = tx
                            .send(Ok(Event::default().data(
                                serde_json::json!({
                                    "phase": phase_name,
                                    "percent": percent,
                                    "message": text.trim(),
                                })
                                .to_string(),
                            )))
                            .await;
                    }
                }
            }
        }

        let status = child.wait().await;
        match status {
            Ok(s) if s.success() => {
                let _ = std::process::Command::new("git")
                    .args(["fetch", "--all"])
                    .current_dir(&target_str)
                    .output();

                let info = git::get_branch_info(&target_str);
                let _ = tx
                    .send(Ok(Event::default().data(
                        serde_json::json!({
                            "phase": "done",
                            "success": true,
                            "path": target_str,
                            "name": format!("{}/{}", parsed.owner, parsed.repo),
                            "branch": info.current,
                            "branches": info.branches,
                            "existed": false,
                        })
                        .to_string(),
                    )))
                    .await;
            }
            Ok(s) => {
                // Parse error message from stderr
                let error_msg = parse_git_error(&stderr_buf, s.code());
                let _ = tx
                    .send(Ok(Event::default().data(
                        serde_json::json!({
                            "phase": "error",
                            "error": error_msg,
                        })
                        .to_string(),
                    )))
                    .await;
            }
            Err(e) => {
                let _ = tx
                    .send(Ok(Event::default().data(
                        serde_json::json!({"phase":"error","error": e.to_string()}).to_string(),
                    )))
                    .await;
            }
        }
    });

    let stream: SseStream = Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx));
    Ok(Sse::new(stream))
}
