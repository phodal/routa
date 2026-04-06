use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::Value;
use tokio::process::Command;
use tokio::time::timeout;

use crate::api::repo_context::{json_error, resolve_repo_root, ResolveRepoRootOptions};
use crate::state::AppState;

const GRAPH_ANALYZE_TIMEOUT_MS: u64 = 30_000;
const GRAPH_LANG_VALUES: &[&str] = &["auto", "rust", "typescript", "java"];
const GRAPH_DEPTH_VALUES: &[&str] = &["fast", "normal"];

pub fn router() -> Router<AppState> {
    Router::new().route("/analyze", get(analyze_graph))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphAnalyzeQuery {
    workspace_id: Option<String>,
    codebase_id: Option<String>,
    repo_path: Option<String>,
    repo_root: Option<String>,
    lang: Option<String>,
    depth: Option<String>,
}

async fn analyze_graph(
    State(state): State<AppState>,
    Query(query): Query<GraphAnalyzeQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_path = query.repo_path.as_deref().or(query.repo_root.as_deref());
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        repo_path,
        "缺少 graph 分析上下文，请提供 workspaceId / codebaseId / repoPath / repoRoot 之一",
        ResolveRepoRootOptions {
            prefer_current_repo_for_default_workspace: true,
        },
    )
    .await
    .map_err(map_context_error(
        "Graph 分析上下文无效",
        "Graph 分析调用失败",
    ))?;

    let lang = normalize_graph_lang(query.lang.as_deref()).map_err(|details| {
        (
            StatusCode::BAD_REQUEST,
            Json(json_error("Invalid graph language", details)),
        )
    })?;
    let depth = normalize_graph_depth(query.depth.as_deref()).map_err(|details| {
        (
            StatusCode::BAD_REQUEST,
            Json(json_error("Invalid graph depth", details)),
        )
    })?;

    let payload = run_graph_command(&repo_root, &lang, &depth)
        .await
        .map_err(|details| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json_error("Failed to analyze dependency graph", details)),
            )
        })?;

    Ok(Json(payload))
}

fn normalize_graph_lang(value: Option<&str>) -> Result<String, String> {
    let lang = value.unwrap_or("auto").trim().to_ascii_lowercase();
    if GRAPH_LANG_VALUES.contains(&lang.as_str()) {
        Ok(lang)
    } else {
        Err(format!(
            "expected one of [{}], got {lang}",
            GRAPH_LANG_VALUES.join(", ")
        ))
    }
}

fn normalize_graph_depth(value: Option<&str>) -> Result<String, String> {
    let depth = value.unwrap_or("fast").trim().to_ascii_lowercase();
    if GRAPH_DEPTH_VALUES.contains(&depth.as_str()) {
        Ok(depth)
    } else {
        Err(format!(
            "expected one of [{}], got {depth}",
            GRAPH_DEPTH_VALUES.join(", ")
        ))
    }
}

async fn run_graph_command(repo_root: &Path, lang: &str, depth: &str) -> Result<Value, String> {
    let app_root = std::env::current_dir()
        .map_err(|error| format!("failed to determine app root for graph analysis: {error}"))?;
    let mut command = build_graph_command(&app_root, repo_root, lang, depth);
    command
        .current_dir(&app_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = timeout(
        Duration::from_millis(GRAPH_ANALYZE_TIMEOUT_MS),
        command.output(),
    )
    .await
    .map_err(|_| {
        format!(
            "graph analysis command timed out after {}ms",
            GRAPH_ANALYZE_TIMEOUT_MS
        )
    })?
    .map_err(|error| format!("graph analysis command failed to execute: {error}"))?;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let details = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(format!(
            "graph analysis command failed (exit {}): {}",
            output.status.code().unwrap_or(1),
            details
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json_text = extract_json_output(&stdout)?;
    serde_json::from_str(&json_text)
        .map_err(|error| format!("failed to parse graph analysis output: {error}"))
}

fn build_graph_command(app_root: &Path, repo_root: &Path, lang: &str, depth: &str) -> Command {
    let graph_args = vec![
        "graph".to_string(),
        "analyze".to_string(),
        "-d".to_string(),
        repo_root.display().to_string(),
        "-l".to_string(),
        lang.to_string(),
        "--depth".to_string(),
        depth.to_string(),
        "-f".to_string(),
        "json".to_string(),
    ];

    if let Some(binary) = resolve_local_routa_binary(app_root) {
        let mut command = Command::new(binary);
        command.args(&graph_args);
        command
    } else {
        let mut cargo_args = vec![
            "run".to_string(),
            "-p".to_string(),
            "routa-cli".to_string(),
            "--".to_string(),
        ];
        cargo_args.extend(graph_args);
        let mut command = Command::new("cargo");
        command.args(cargo_args);
        command
    }
}

fn resolve_local_routa_binary(app_root: &Path) -> Option<PathBuf> {
    let candidates = [
        app_root.join("target/release/routa"),
        app_root.join("target/debug/routa"),
    ];
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn extract_json_output(raw: &str) -> Result<String, String> {
    let candidate = raw.trim();
    if candidate.is_empty() {
        return Err("Command produced no output".to_string());
    }
    if serde_json::from_str::<Value>(candidate).is_ok() {
        return Ok(candidate.to_string());
    }
    for (index, ch) in candidate.char_indices().rev() {
        if ch != '{' {
            continue;
        }
        let snippet = candidate[index..].trim();
        if snippet.ends_with('}') && serde_json::from_str::<Value>(snippet).is_ok() {
            return Ok(snippet.to_string());
        }
    }
    Err("Unable to parse command JSON output".to_string())
}

fn map_context_error(
    client_error: &'static str,
    server_error: &'static str,
) -> impl Fn(crate::error::ServerError) -> (StatusCode, Json<Value>) {
    move |error| match error {
        crate::error::ServerError::BadRequest(message) => (
            StatusCode::BAD_REQUEST,
            Json(json_error(client_error, message)),
        ),
        other => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json_error(server_error, other.to_string())),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_graph_depth, normalize_graph_lang, resolve_local_routa_binary};
    use tempfile::tempdir;

    #[test]
    fn accepts_supported_graph_langs() {
        assert_eq!(normalize_graph_lang(Some("rust")).expect("lang"), "rust");
        assert_eq!(normalize_graph_lang(None).expect("default"), "auto");
        assert!(normalize_graph_lang(Some("python")).is_err());
    }

    #[test]
    fn accepts_supported_graph_depths() {
        assert_eq!(
            normalize_graph_depth(Some("normal")).expect("depth"),
            "normal"
        );
        assert_eq!(normalize_graph_depth(None).expect("default"), "fast");
        assert!(normalize_graph_depth(Some("deep")).is_err());
    }

    #[test]
    fn resolves_local_binary_when_present() {
        let temp = tempdir().expect("tempdir");
        let target_dir = temp.path().join("target/debug");
        std::fs::create_dir_all(&target_dir).expect("target dir");
        let binary = target_dir.join("routa");
        std::fs::write(&binary, "stub").expect("write binary");

        let resolved = resolve_local_routa_binary(temp.path()).expect("binary");
        assert_eq!(resolved, binary);
    }
}
