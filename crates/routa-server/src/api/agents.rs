use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::error::ServerError;
use crate::models::agent::{Agent, AgentRole, AgentStatus, ModelTier};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_agents).post(create_agent))
        .route("/{id}", get(get_agent_by_path).delete(delete_agent))
        .route("/{id}/status", post(update_agent_status))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListAgentsQuery {
    /// If provided, returns a single agent (Next.js compatible: GET /api/agents?id=xxx)
    id: Option<String>,
    workspace_id: Option<String>,
    role: Option<String>,
    status: Option<String>,
    parent_id: Option<String>,
    #[allow(dead_code)]
    summary: Option<String>,
}

async fn list_agents(
    State(state): State<AppState>,
    Query(query): Query<ListAgentsQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    // Next.js compatible: GET /api/agents?id=xxx returns single agent
    if let Some(id) = &query.id {
        let agent = state.agent_store.get(id).await?;
        return Ok(Json(serde_json::json!(agent)));
    }

    let workspace_id = query.workspace_id.as_deref().unwrap_or("default");

    let agents = if let Some(parent_id) = &query.parent_id {
        state.agent_store.list_by_parent(parent_id).await?
    } else if let Some(role_str) = &query.role {
        let role = AgentRole::from_str(role_str)
            .ok_or_else(|| ServerError::BadRequest(format!("Invalid role: {}", role_str)))?;
        state.agent_store.list_by_role(workspace_id, &role).await?
    } else if let Some(status_str) = &query.status {
        let status = AgentStatus::from_str(status_str)
            .ok_or_else(|| ServerError::BadRequest(format!("Invalid status: {}", status_str)))?;
        state
            .agent_store
            .list_by_status(workspace_id, &status)
            .await?
    } else {
        state.agent_store.list_by_workspace(workspace_id).await?
    };

    Ok(Json(serde_json::json!({ "agents": agents })))
}

/// GET /api/agents/{id} — REST-style single agent lookup
async fn get_agent_by_path(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<Agent>, ServerError> {
    state
        .agent_store
        .get(&id)
        .await?
        .map(Json)
        .ok_or_else(|| ServerError::NotFound(format!("Agent {} not found", id)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAgentRequest {
    name: String,
    role: String,
    workspace_id: Option<String>,
    parent_id: Option<String>,
    model_tier: Option<String>,
    metadata: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateAgentResponse {
    agent_id: String,
    agent: Agent,
}

async fn create_agent(
    State(state): State<AppState>,
    Json(body): Json<CreateAgentRequest>,
) -> Result<Json<CreateAgentResponse>, ServerError> {
    let role = AgentRole::from_str(&body.role)
        .ok_or_else(|| ServerError::BadRequest(format!("Invalid role: {}", body.role)))?;
    let model_tier = body
        .model_tier
        .as_deref()
        .and_then(ModelTier::from_str);
    let workspace_id = body.workspace_id.unwrap_or_else(|| "default".to_string());

    state.workspace_store.ensure_default().await?;

    let agent = Agent::new(
        uuid::Uuid::new_v4().to_string(),
        body.name,
        role,
        workspace_id,
        body.parent_id,
        model_tier,
        body.metadata,
    );

    state.agent_store.save(&agent).await?;

    Ok(Json(CreateAgentResponse {
        agent_id: agent.id.clone(),
        agent,
    }))
}

async fn delete_agent(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    state.agent_store.delete(&id).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

#[derive(Debug, Deserialize)]
struct UpdateStatusRequest {
    status: String,
}

async fn update_agent_status(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<UpdateStatusRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let status = AgentStatus::from_str(&body.status)
        .ok_or_else(|| ServerError::BadRequest(format!("Invalid status: {}", body.status)))?;
    state.agent_store.update_status(&id, &status).await?;
    Ok(Json(serde_json::json!({ "updated": true })))
}
