use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::path::Path;

use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(list_skills).post(reload_skills))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListSkillsQuery {
    name: Option<String>,
    repo_path: Option<String>,
}

async fn list_skills(
    State(state): State<AppState>,
    Query(query): Query<ListSkillsQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    if let Some(name) = &query.name {
        if let Some(skill) = state.skill_registry.get_skill(name) {
            return Ok(Json(skill_response(
                &skill.name,
                &skill.description,
                &skill.content,
                skill.license.as_deref(),
                skill.compatibility.as_deref(),
                &skill.metadata,
            )));
        }

        if let Some(repo_path) = query.repo_path.as_deref() {
            let discovered = routa_core::git::discover_skills_from_path(Path::new(repo_path));
            if let Some(skill) = discovered
                .into_iter()
                .find(|candidate| candidate.name == *name)
            {
                let content = read_skill_body(&skill.source)?;
                return Ok(Json(skill_response(
                    &skill.name,
                    &skill.description,
                    &content,
                    skill.license.as_deref(),
                    skill.compatibility.as_deref(),
                    &std::collections::HashMap::new(),
                )));
            }
        }

        return Err(ServerError::NotFound(format!(
            "Skill not found: {}{}",
            name,
            query
                .repo_path
                .as_deref()
                .map(|repo_path| format!(" (also searched in {})", repo_path))
                .unwrap_or_default()
        )));
    }

    let skills = state.skill_registry.list_skills();
    Ok(Json(serde_json::json!({ "skills": skills })))
}

async fn reload_skills(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());
    state.skill_registry.reload(&cwd);
    let skills = state.skill_registry.list_skills();
    Ok(Json(
        serde_json::json!({ "skills": skills, "reloaded": true }),
    ))
}

fn skill_response(
    name: &str,
    description: &str,
    content: &str,
    license: Option<&str>,
    compatibility: Option<&str>,
    metadata: &std::collections::HashMap<String, String>,
) -> serde_json::Value {
    serde_json::json!({
        "name": name,
        "description": description,
        "content": content,
        "license": license,
        "compatibility": compatibility,
        "metadata": metadata,
    })
}

fn read_skill_body(source_path: &str) -> Result<String, ServerError> {
    let raw = std::fs::read_to_string(source_path)
        .map_err(|error| ServerError::Internal(format!("Failed to read skill file: {}", error)))?;

    Ok(strip_frontmatter(&raw))
}

fn strip_frontmatter(raw: &str) -> String {
    let mut lines = raw.lines();
    if !matches!(lines.next(), Some(line) if line.trim() == "---") {
        return raw.to_string();
    }

    for line in &mut lines {
        if line.trim() == "---" {
            return lines.collect::<Vec<_>>().join("\n").trim().to_string();
        }
    }

    raw.to_string()
}
