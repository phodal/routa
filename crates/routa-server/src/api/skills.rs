use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_skills).post(reload_skills))
}

#[derive(Debug, Deserialize)]
struct ListSkillsQuery {
    name: Option<String>,
}

async fn list_skills(
    State(state): State<AppState>,
    Query(query): Query<ListSkillsQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    if let Some(name) = &query.name {
        let skill = state.skill_registry.get_skill(name);
        return Ok(Json(serde_json::json!({ "skill": skill })));
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
    Ok(Json(serde_json::json!({ "skills": skills, "reloaded": true })))
}
