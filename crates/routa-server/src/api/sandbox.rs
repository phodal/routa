//! Sandbox API routes — Docker-based isolated code execution.
//!
//! Implements the REST API described in:
//! https://amirmalik.net/2025/03/07/code-sandboxes-for-llm-ai-agents
//!
//! # Endpoints
//!
//! | Method | Path                          | Description                  |
//! |--------|-------------------------------|------------------------------|
//! | GET    | `/sandboxes`                  | List all sandboxes           |
//! | POST   | `/sandboxes`                  | Create a new sandbox         |
//! | GET    | `/sandboxes/{id}`             | Get sandbox info             |
//! | POST   | `/sandboxes/{id}/execute`     | Execute code (NDJSON stream) |
//! | DELETE | `/sandboxes/{id}`             | Delete a sandbox             |

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::Response,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;

use crate::error::ServerError;
use crate::sandbox::{
    policy::{SandboxPermissionConstraints, SandboxPolicyContext, SandboxPolicyWorktree},
    types::{CreateSandboxRequest, ExecuteRequest, ResolvedCreateSandboxRequest},
};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_sandboxes))
        .route("/explain", post(explain_policy))
        .route("/", post(create_sandbox))
        .route("/{id}", get(get_sandbox))
        .route(
            "/{id}/permissions/explain",
            post(explain_permission_constraints),
        )
        .route(
            "/{id}/permissions/apply",
            post(apply_permission_constraints),
        )
        .route("/{id}/execute", post(execute_code))
        .route("/{id}", delete(delete_sandbox))
}

// ── GET /sandboxes ────────────────────────────────────────────────────────────

/// List all active sandbox containers.
async fn list_sandboxes(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let sandboxes = state.sandbox_manager.list_sandboxes().await;
    Ok(Json(json!({ "sandboxes": sandboxes })))
}

// ── POST /sandboxes ───────────────────────────────────────────────────────────

/// Create a new sandbox container.
async fn create_sandbox(
    State(state): State<AppState>,
    Json(body): Json<CreateSandboxRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), ServerError> {
    let resolved = resolve_create_request(&state, body).await?;
    let info = state
        .sandbox_manager
        .create_sandbox(resolved)
        .await
        .map_err(ServerError::Internal)?;

    Ok((StatusCode::CREATED, Json(json!(info))))
}

async fn explain_policy(
    State(state): State<AppState>,
    Json(body): Json<CreateSandboxRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let resolved = resolve_create_request(&state, body).await?;
    let policy = resolved.policy.ok_or_else(|| {
        ServerError::BadRequest("Sandbox policy is required for /api/sandboxes/explain".to_string())
    })?;

    Ok(Json(json!({ "policy": policy })))
}

// ── GET /sandboxes/{id} ───────────────────────────────────────────────────────

/// Get information about a specific sandbox.
async fn get_sandbox(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let info = state
        .sandbox_manager
        .get_sandbox(&id)
        .await
        .ok_or_else(|| ServerError::NotFound(format!("Sandbox not found: {id}")))?;

    Ok(Json(json!(info)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionConstraintRequest {
    constraints: SandboxPermissionConstraints,
}

async fn explain_permission_constraints(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<PermissionConstraintRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let resolved = mutate_sandbox_policy(&state, &id, body.constraints).await?;
    Ok(Json(json!({ "policy": resolved.policy })))
}

async fn apply_permission_constraints(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<PermissionConstraintRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let resolved = mutate_sandbox_policy(&state, &id, body.constraints).await?;
    let info = state
        .sandbox_manager
        .recreate_sandbox(&id, resolved)
        .await
        .map_err(ServerError::Internal)?;

    Ok(Json(json!(info)))
}

// ── POST /sandboxes/{id}/execute ──────────────────────────────────────────────

/// Execute code inside a sandbox and stream back the results as NDJSON.
///
/// The response is a stream of newline-delimited JSON objects, each one being a
/// `SandboxOutputEvent` (`{"text": "..."}`, `{"image": "..."}`, or `{"error": "..."}`).
async fn execute_code(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ExecuteRequest>,
) -> Result<Response<Body>, ServerError> {
    let upstream = state
        .sandbox_manager
        .execute_in_sandbox(&id, body)
        .await
        .map_err(|e| {
            // Distinguish "not found" from other errors.
            if e.contains("not found") || e.contains("not Found") {
                ServerError::NotFound(e)
            } else {
                ServerError::Internal(e)
            }
        })?;

    // Convert reqwest streaming bytes into an axum streaming body.
    let byte_stream = upstream.bytes_stream();
    let body = Body::from_stream(byte_stream);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-ndjson")
        .body(body)
        .map_err(|e| ServerError::Internal(e.to_string()))
}

// ── DELETE /sandboxes/{id} ────────────────────────────────────────────────────

/// Stop and remove a sandbox container.
async fn delete_sandbox(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    state
        .sandbox_manager
        .delete_sandbox(&id)
        .await
        .map_err(|e| {
            if e.contains("not found") {
                ServerError::NotFound(e)
            } else {
                ServerError::Internal(e)
            }
        })?;

    Ok(Json(json!({ "message": format!("Sandbox {id} deleted") })))
}

async fn resolve_create_request(
    state: &AppState,
    body: CreateSandboxRequest,
) -> Result<ResolvedCreateSandboxRequest, ServerError> {
    let policy = match body.policy {
        Some(policy) if !policy.is_empty() => {
            let context = resolve_policy_context(state, &policy).await?;
            Some(policy.resolve(context).map_err(ServerError::BadRequest)?)
        }
        _ => None,
    };

    Ok(ResolvedCreateSandboxRequest {
        lang: body.lang,
        policy,
    })
}

async fn mutate_sandbox_policy(
    state: &AppState,
    sandbox_id: &str,
    constraints: SandboxPermissionConstraints,
) -> Result<ResolvedCreateSandboxRequest, ServerError> {
    if constraints.is_empty() {
        return Err(ServerError::BadRequest(
            "Permission constraints cannot be empty.".to_string(),
        ));
    }

    let sandbox = state
        .sandbox_manager
        .get_sandbox(sandbox_id)
        .await
        .ok_or_else(|| ServerError::NotFound(format!("Sandbox not found: {sandbox_id}")))?;
    let current_policy = sandbox.effective_policy.ok_or_else(|| {
        ServerError::BadRequest(
            "Permission constraints require a workspace-aware sandbox policy.".to_string(),
        )
    })?;

    let next_input = current_policy
        .to_input()
        .apply_permission_constraints(&constraints);
    let context = resolve_policy_context(state, &next_input).await?;
    let next_policy = next_input
        .resolve(context)
        .map_err(ServerError::BadRequest)?;

    Ok(ResolvedCreateSandboxRequest {
        lang: sandbox.lang,
        policy: Some(next_policy),
    })
}

async fn resolve_policy_context(
    state: &AppState,
    policy: &crate::sandbox::policy::SandboxPolicyInput,
) -> Result<Option<SandboxPolicyContext>, ServerError> {
    let workspace_id = policy.workspace_id.clone();
    let codebase_id = policy.codebase_id.clone();

    if workspace_id.is_none() && codebase_id.is_none() {
        return Ok(None);
    }

    let mut context = SandboxPolicyContext {
        workspace_id,
        codebase_id,
        workspace_root: None,
        available_worktrees: Vec::new(),
    };

    if let Some(codebase_id) = context.codebase_id.clone() {
        let codebase = state
            .codebase_store
            .get(&codebase_id)
            .await?
            .ok_or_else(|| ServerError::NotFound(format!("Codebase {codebase_id} not found")))?;

        if let Some(workspace_id) = &context.workspace_id {
            if workspace_id != &codebase.workspace_id {
                return Err(ServerError::BadRequest(format!(
                    "Codebase {codebase_id} does not belong to workspace {workspace_id}"
                )));
            }
        }

        context.workspace_id = Some(codebase.workspace_id.clone());
        context.workspace_root = Some(std::path::PathBuf::from(&codebase.repo_path));
        context.available_worktrees = state
            .worktree_store
            .list_by_codebase(&codebase_id)
            .await?
            .into_iter()
            .filter(|worktree| worktree.status == "active")
            .map(|worktree| SandboxPolicyWorktree {
                id: worktree.id,
                codebase_id: worktree.codebase_id,
                worktree_path: worktree.worktree_path,
                branch: worktree.branch,
            })
            .collect();
        return Ok(Some(context));
    }

    if let Some(workspace_id) = context.workspace_id.clone() {
        state
            .workspace_store
            .get(&workspace_id)
            .await?
            .ok_or_else(|| ServerError::NotFound(format!("Workspace {workspace_id} not found")))?;

        if let Some(codebase) = state.codebase_store.get_default(&workspace_id).await? {
            context.codebase_id = Some(codebase.id);
            context.workspace_root = Some(std::path::PathBuf::from(codebase.repo_path));
        }

        context.available_worktrees = state
            .worktree_store
            .list_by_workspace(&workspace_id)
            .await?
            .into_iter()
            .filter(|worktree| worktree.status == "active")
            .map(|worktree| SandboxPolicyWorktree {
                id: worktree.id,
                codebase_id: worktree.codebase_id,
                worktree_path: worktree.worktree_path,
                branch: worktree.branch,
            })
            .collect();
    }

    Ok(Some(context))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::state::AppStateInner;
    use routa_core::{
        db::Database,
        models::{codebase::Codebase, workspace::Workspace, worktree::Worktree},
        sandbox::{
            CreateSandboxRequest, SandboxCapability, SandboxLinkedWorktreeMode, SandboxNetworkMode,
            SandboxPolicyInput,
        },
    };

    use super::resolve_create_request;

    #[tokio::test]
    async fn resolve_create_request_loads_trusted_workspace_config_from_default_codebase() {
        let temp = tempfile::tempdir().expect("tempdir should exist");
        let repo = temp.path().join("repo");
        let output = repo.join("output");
        let base_env = repo.join(".env.base");
        std::fs::create_dir_all(&output).expect("output directory should exist");
        std::fs::create_dir_all(repo.join(".routa")).expect("config directory should exist");
        std::fs::write(&base_env, "BASE_TOKEN=base\n").expect("base env file should exist");
        std::fs::write(
            repo.join(".routa").join("sandbox.json"),
            r#"{"networkMode":"none","readWritePaths":["output"],"envFile":".env.base","capabilities":["workspaceWrite","linkedWorktreeRead"]}"#,
        )
        .expect("workspace config should exist");
        let review_wt = temp.path().join("wt-review");
        std::fs::create_dir_all(&review_wt).expect("worktree directory should exist");

        let db = Database::open_in_memory().expect("db should open");
        let state = Arc::new(AppStateInner::new(db));
        state
            .workspace_store
            .save(&Workspace::new(
                "ws-1".to_string(),
                "Workspace".to_string(),
                None,
            ))
            .await
            .expect("workspace should save");
        state
            .codebase_store
            .save(&Codebase::new(
                "cb-1".to_string(),
                "ws-1".to_string(),
                repo.to_string_lossy().to_string(),
                Some("main".to_string()),
                Some("default".to_string()),
                true,
                None,
                None,
            ))
            .await
            .expect("codebase should save");
        let mut worktree = Worktree::new(
            "wt-1".to_string(),
            "cb-1".to_string(),
            "ws-1".to_string(),
            review_wt.to_string_lossy().to_string(),
            "review".to_string(),
            "main".to_string(),
            Some("Review".to_string()),
        );
        worktree.status = "active".to_string();
        state
            .worktree_store
            .save(&worktree)
            .await
            .expect("worktree should save");

        let resolved = resolve_create_request(
            &state,
            CreateSandboxRequest {
                lang: "python".to_string(),
                policy: Some(SandboxPolicyInput {
                    workspace_id: Some("ws-1".to_string()),
                    linked_worktree_mode: Some(SandboxLinkedWorktreeMode::All),
                    trust_workspace_config: true,
                    ..Default::default()
                }),
            },
        )
        .await
        .expect("request should resolve");

        let policy = resolved.policy.expect("policy should be resolved");
        assert_eq!(policy.network_mode, SandboxNetworkMode::None);
        assert!(policy
            .capabilities
            .iter()
            .any(|cap| cap.capability == SandboxCapability::LinkedWorktreeRead && cap.enabled));
        assert!(policy.read_write_paths.contains(
            &std::fs::canonicalize(&output)
                .expect("output should canonicalize")
                .to_string_lossy()
                .to_string()
        ));
        assert_eq!(policy.env_files.len(), 1);
        assert_eq!(
            policy.env_files[0].path,
            std::fs::canonicalize(&base_env)
                .expect("env file should canonicalize")
                .to_string_lossy()
                .to_string()
        );
        assert_eq!(policy.linked_worktrees.len(), 1);
        assert_eq!(policy.linked_worktrees[0].id, "wt-1");
        assert_eq!(
            policy
                .workspace_config
                .expect("workspace config metadata should exist")
                .reason,
            "loaded"
        );
    }
}
