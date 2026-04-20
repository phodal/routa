use std::path::{Path, PathBuf};
use std::time::Duration;

use axum::{extract::Query, http::StatusCode, routing::get, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::process::Command;

use crate::state::AppState;

const GRAPH_ANALYZE_TIMEOUT_MS: u64 = 30_000;

pub fn router() -> Router<AppState> {
    Router::new().route("/analyze", get(analyze_graph))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphAnalyzeQuery {
    repo_root: Option<String>,
    lang: Option<String>,
    depth: Option<String>,
}

async fn analyze_graph(
    Query(query): Query<GraphAnalyzeQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let Some(repo_root) = query.repo_root.as_deref().map(str::trim) else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "repoRoot parameter is required" })),
        ));
    };

    if repo_root.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "repoRoot parameter is required" })),
        ));
    }

    let repo_root_path = Path::new(repo_root);
    if !repo_root_path.exists() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Directory does not exist: {repo_root}") })),
        ));
    }

    let lang = query.lang.as_deref().unwrap_or("auto");
    let depth = query.depth.as_deref().unwrap_or("fast");
    let cli = find_routa_cli();
    let mut command = Command::new(&cli);
    command.args([
        "graph", "analyze", "-d", repo_root, "-l", lang, "--depth", depth, "-f", "json",
    ]);

    let output = tokio::time::timeout(
        Duration::from_millis(GRAPH_ANALYZE_TIMEOUT_MS),
        command.output(),
    )
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": "Internal server error",
                "details": format!(
                    "routa-cli execution timed out after {GRAPH_ANALYZE_TIMEOUT_MS}ms"
                ),
            })),
        )
    })?
    .map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": "Internal server error",
                "details": error.to_string(),
            })),
        )
    })?;

    if !output.status.success() {
        let details = String::from_utf8_lossy(&output.stderr);
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": "Failed to analyze dependency graph",
                "details": if details.trim().is_empty() {
                    "Unknown error".to_string()
                } else {
                    details.to_string()
                },
            })),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let graph = serde_json::from_str::<Value>(&stdout).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": "Failed to parse graph analysis output",
                "details": error.to_string(),
            })),
        )
    })?;

    Ok(Json(graph))
}

fn find_routa_cli() -> String {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let candidates = [
        cwd.join("target").join("release").join("routa"),
        cwd.join("target").join("debug").join("routa"),
    ];

    for candidate in candidates {
        if candidate.is_file() {
            return candidate.to_string_lossy().to_string();
        }
    }

    crate::shell_env::which("routa").unwrap_or_else(|| "routa".to_string())
}

#[cfg(test)]
mod tests {
    use super::find_routa_cli;

    #[test]
    fn falls_back_to_routa_binary_name_when_local_build_is_missing() {
        let cli = find_routa_cli();
        assert!(!cli.trim().is_empty());
    }
}
