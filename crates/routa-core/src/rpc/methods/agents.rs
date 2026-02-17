//! RPC methods for agent management.
//!
//! Methods:
//! - `agents.list`         — list agents with optional filters
//! - `agents.get`          — get a single agent by id
//! - `agents.create`       — create a new agent
//! - `agents.delete`       — delete an agent
//! - `agents.updateStatus` — update an agent's status

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::models::agent::{Agent, AgentRole, AgentStatus, ModelTier};
use crate::rpc::error::RpcError;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// agents.list
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListParams {
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub role: Option<String>,
    pub status: Option<String>,
    pub parent_id: Option<String>,
}

fn default_workspace_id() -> String {
    "default".into()
}

#[derive(Debug, Serialize)]
pub struct ListResult {
    pub agents: Vec<Agent>,
}

pub async fn list(state: &AppState, params: ListParams) -> Result<ListResult, RpcError> {
    let agents = if let Some(parent_id) = &params.parent_id {
        state.agent_store.list_by_parent(parent_id).await?
    } else if let Some(role_str) = &params.role {
        let role = AgentRole::from_str(role_str)
            .ok_or_else(|| RpcError::BadRequest(format!("Invalid role: {}", role_str)))?;
        state
            .agent_store
            .list_by_role(&params.workspace_id, &role)
            .await?
    } else if let Some(status_str) = &params.status {
        let status = AgentStatus::from_str(status_str)
            .ok_or_else(|| RpcError::BadRequest(format!("Invalid status: {}", status_str)))?;
        state
            .agent_store
            .list_by_status(&params.workspace_id, &status)
            .await?
    } else {
        state
            .agent_store
            .list_by_workspace(&params.workspace_id)
            .await?
    };

    Ok(ListResult { agents })
}

// ---------------------------------------------------------------------------
// agents.get
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetParams {
    pub id: String,
}

pub async fn get(state: &AppState, params: GetParams) -> Result<Agent, RpcError> {
    state
        .agent_store
        .get(&params.id)
        .await?
        .ok_or_else(|| RpcError::NotFound(format!("Agent {} not found", params.id)))
}

// ---------------------------------------------------------------------------
// agents.create
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateParams {
    pub name: String,
    pub role: String,
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub parent_id: Option<String>,
    pub model_tier: Option<String>,
    pub metadata: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResult {
    pub agent_id: String,
    pub agent: Agent,
}

pub async fn create(state: &AppState, params: CreateParams) -> Result<CreateResult, RpcError> {
    let role = AgentRole::from_str(&params.role)
        .ok_or_else(|| RpcError::BadRequest(format!("Invalid role: {}", params.role)))?;
    let model_tier = params.model_tier.as_deref().and_then(ModelTier::from_str);

    state.workspace_store.ensure_default().await?;

    let agent = Agent::new(
        uuid::Uuid::new_v4().to_string(),
        params.name,
        role,
        params.workspace_id,
        params.parent_id,
        model_tier,
        params.metadata,
    );

    state.agent_store.save(&agent).await?;

    Ok(CreateResult {
        agent_id: agent.id.clone(),
        agent,
    })
}

// ---------------------------------------------------------------------------
// agents.delete
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteParams {
    pub id: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteResult {
    pub deleted: bool,
}

pub async fn delete(state: &AppState, params: DeleteParams) -> Result<DeleteResult, RpcError> {
    state.agent_store.delete(&params.id).await?;
    Ok(DeleteResult { deleted: true })
}

// ---------------------------------------------------------------------------
// agents.updateStatus
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusParams {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct UpdateStatusResult {
    pub updated: bool,
}

pub async fn update_status(
    state: &AppState,
    params: UpdateStatusParams,
) -> Result<UpdateStatusResult, RpcError> {
    let status = AgentStatus::from_str(&params.status)
        .ok_or_else(|| RpcError::BadRequest(format!("Invalid status: {}", params.status)))?;
    state.agent_store.update_status(&params.id, &status).await?;
    Ok(UpdateStatusResult { updated: true })
}
