//! RPC methods for skill management.
//!
//! Methods:
//! - `skills.list`   — list all discovered skills
//! - `skills.get`    — get a single skill by name
//! - `skills.reload` — re-discover skills from the filesystem

use serde::{Deserialize, Serialize};

use crate::rpc::error::RpcError;
use crate::skills::SkillDefinition;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// skills.list
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ListResult {
    pub skills: Vec<SkillDefinition>,
}

pub async fn list(state: &AppState) -> Result<ListResult, RpcError> {
    let skills = state.skill_registry.list_skills();
    Ok(ListResult { skills })
}

// ---------------------------------------------------------------------------
// skills.get
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetParams {
    pub name: String,
}

pub async fn get(state: &AppState, params: GetParams) -> Result<SkillDefinition, RpcError> {
    state
        .skill_registry
        .get_skill(&params.name)
        .ok_or_else(|| RpcError::NotFound(format!("Skill {} not found", params.name)))
}

// ---------------------------------------------------------------------------
// skills.reload
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ReloadResult {
    pub reloaded: bool,
    pub skills: Vec<SkillDefinition>,
}

pub async fn reload(state: &AppState) -> Result<ReloadResult, RpcError> {
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());
    state.skill_registry.reload(&cwd);
    let skills = state.skill_registry.list_skills();
    Ok(ReloadResult {
        reloaded: true,
        skills,
    })
}
