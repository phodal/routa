use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::ServerError;
use crate::models::artifact::{Artifact, ArtifactStatus, ArtifactType};
use crate::models::canvas_artifact::{
    CanvasArtifactMetadata, CanvasArtifactPayload, CanvasRenderMode, CanvasType,
};
use crate::models::task::{Task, TaskStatus};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(create_canvas).get(list_canvas))
        .route("/{id}", get(get_canvas).delete(delete_canvas))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCanvasBody {
    render_mode: Option<String>,
    canvas_type: Option<String>,
    title: Option<String>,
    source: Option<String>,
    data: Option<Value>,
    workspace_id: Option<String>,
    task_id: Option<String>,
    codebase_id: Option<String>,
    repo_path: Option<String>,
    agent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListCanvasQuery {
    workspace_id: Option<String>,
}

async fn create_canvas(
    State(state): State<AppState>,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<(axum::http::StatusCode, Json<Value>), ServerError> {
    let Json(raw_body) =
        body.map_err(|_| ServerError::BadRequest("Invalid JSON body".to_string()))?;
    if !raw_body.is_object() {
        return Err(ServerError::BadRequest("Invalid JSON body".to_string()));
    }

    let body: CreateCanvasBody = serde_json::from_value(raw_body)
        .map_err(|_| ServerError::BadRequest("Invalid JSON body".to_string()))?;

    let render_mode = body
        .render_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("dynamic");
    let render_mode = CanvasRenderMode::from_str(render_mode).ok_or_else(|| {
        ServerError::BadRequest(
            "Invalid renderMode. Expected one of: dynamic, prebuilt".to_string(),
        )
    })?;

    let title = body
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("title is required".to_string()))?
        .to_string();

    let workspace_id = body
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("workspaceId is required".to_string()))?
        .to_string();

    let (canvas_type, source, data) = match render_mode {
        CanvasRenderMode::Dynamic => {
            let source = body
                .source
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    ServerError::BadRequest(
                        "source (TSX string) is required for dynamic renderMode".to_string(),
                    )
                })?
                .to_string();
            (None, Some(source), None)
        }
        CanvasRenderMode::Prebuilt => {
            let canvas_type = body
                .canvas_type
                .as_deref()
                .and_then(CanvasType::from_str)
                .ok_or_else(|| {
                    ServerError::BadRequest(
                        "canvasType is required for prebuilt mode. Expected one of: fitness_overview"
                            .to_string(),
                    )
                })?;
            let data = body.data.ok_or_else(|| {
                ServerError::BadRequest("data is required for prebuilt renderMode".to_string())
            })?;
            (Some(canvas_type), None, Some(data))
        }
    };

    let task_id = resolve_canvas_task_id(
        &state,
        &workspace_id,
        &title,
        body.task_id.as_deref(),
        body.codebase_id.as_deref(),
    )
    .await?;

    let payload = CanvasArtifactPayload {
        metadata: CanvasArtifactMetadata {
            render_mode: render_mode.clone(),
            canvas_type: canvas_type.clone(),
            title: title.clone(),
            schema_version: 1,
            generated_at: Utc::now(),
            workspace_id: Some(workspace_id.clone()),
            codebase_id: body.codebase_id.clone(),
            repo_path: body.repo_path.clone(),
        },
        source,
        data,
    };

    let now = Utc::now();
    let artifact = Artifact {
        id: uuid::Uuid::new_v4().to_string(),
        artifact_type: ArtifactType::Canvas,
        task_id: task_id.clone(),
        workspace_id: workspace_id.clone(),
        provided_by_agent_id: body.agent_id,
        requested_by_agent_id: None,
        request_id: None,
        content: Some(
            serde_json::to_string(&payload)
                .map_err(|error| ServerError::Internal(format!("Failed to encode canvas payload: {error}")))?,
        ),
        context: Some(format!("Canvas: {title}")),
        status: ArtifactStatus::Provided,
        expires_at: None,
        metadata: Some(std::collections::BTreeMap::from([
            ("renderMode".to_string(), render_mode.as_str().to_string()),
            (
                "canvasType".to_string(),
                canvas_type
                    .as_ref()
                    .map(CanvasType::as_str)
                    .unwrap_or("")
                    .to_string(),
            ),
            ("title".to_string(), title.clone()),
            ("schemaVersion".to_string(), "1".to_string()),
        ])),
        created_at: now,
        updated_at: now,
    };

    state.artifact_store.save(&artifact).await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({
            "id": artifact.id,
            "renderMode": render_mode.as_str(),
            "canvasType": canvas_type.as_ref().map(CanvasType::as_str),
            "title": title,
            "taskId": task_id,
            "createdAt": artifact.created_at.to_rfc3339(),
        })),
    ))
}

async fn list_canvas(
    State(state): State<AppState>,
    Query(query): Query<ListCanvasQuery>,
) -> Result<Json<Value>, ServerError> {
    let workspace_id = query
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ServerError::BadRequest("workspaceId query parameter is required".to_string())
        })?;

    let mut artifacts = state.artifact_store.list_by_workspace(workspace_id).await?;
    artifacts.retain(|artifact| artifact.artifact_type == ArtifactType::Canvas);
    artifacts.sort_by(|left, right| right.created_at.cmp(&left.created_at));

    let items = artifacts
        .into_iter()
        .map(|artifact| {
            let payload = parse_canvas_payload(artifact.content.as_deref());
            json!({
                "id": artifact.id,
                "renderMode": payload
                    .as_ref()
                    .map(|item| item.metadata.render_mode.as_str())
                    .unwrap_or("prebuilt"),
                "canvasType": payload
                    .as_ref()
                    .and_then(|item| item.metadata.canvas_type.as_ref())
                    .map(CanvasType::as_str),
                "title": payload
                    .as_ref()
                    .map(|item| item.metadata.title.clone())
                    .or(artifact.context)
                    .unwrap_or_else(|| "Untitled".to_string()),
                "generatedAt": payload
                    .as_ref()
                    .map(|item| item.metadata.generated_at.to_rfc3339())
                    .unwrap_or_else(|| artifact.created_at.to_rfc3339()),
                "createdAt": artifact.created_at.to_rfc3339(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(json!({ "canvasArtifacts": items })))
}

async fn get_canvas(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ServerError> {
    let artifact = state
        .artifact_store
        .get(&id)
        .await?
        .filter(|artifact| artifact.artifact_type == ArtifactType::Canvas)
        .ok_or_else(|| ServerError::NotFound("Canvas artifact not found".to_string()))?;

    let payload = parse_canvas_payload(artifact.content.as_deref()).ok_or_else(|| {
        ServerError::Internal("Canvas artifact data is corrupted".to_string())
    })?;

    Ok(Json(json!({
        "id": artifact.id,
        "renderMode": payload.metadata.render_mode.as_str(),
        "canvasType": payload.metadata.canvas_type.as_ref().map(CanvasType::as_str),
        "title": payload.metadata.title,
        "schemaVersion": payload.metadata.schema_version,
        "generatedAt": payload.metadata.generated_at.to_rfc3339(),
        "source": payload.source,
        "data": payload.data,
        "workspaceId": artifact.workspace_id,
        "createdAt": artifact.created_at.to_rfc3339(),
    })))
}

async fn delete_canvas(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ServerError> {
    let artifact = state
        .artifact_store
        .get(&id)
        .await?
        .filter(|artifact| artifact.artifact_type == ArtifactType::Canvas)
        .ok_or_else(|| ServerError::NotFound("Canvas artifact not found".to_string()))?;

    state.artifact_store.delete(&artifact.id).await?;
    Ok(Json(json!({ "deleted": true })))
}

async fn resolve_canvas_task_id(
    state: &AppState,
    workspace_id: &str,
    title: &str,
    task_id: Option<&str>,
    codebase_id: Option<&str>,
) -> Result<String, ServerError> {
    if state.workspace_store.get(workspace_id).await?.is_none() {
        return Err(ServerError::BadRequest(format!(
            "Workspace not found: {workspace_id}"
        )));
    }

    if let Some(task_id) = task_id.map(str::trim).filter(|value| !value.is_empty()) {
        let task = state
            .task_store
            .get(task_id)
            .await?
            .ok_or_else(|| ServerError::BadRequest(format!("Task not found: {task_id}")))?;
        if task.workspace_id != workspace_id {
            return Err(ServerError::BadRequest(format!(
                "taskId {task_id} does not belong to workspace {workspace_id}"
            )));
        }
        return Ok(task.id);
    }

    let mut task = Task::new(
        uuid::Uuid::new_v4().to_string(),
        format!("Canvas artifact: {title}"),
        format!("Backing task for canvas artifact \"{title}\"."),
        workspace_id.to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    );
    task.status = TaskStatus::Completed;
    task.column_id = None;
    task.labels = vec!["canvas".to_string()];
    if let Some(codebase_id) = codebase_id.map(str::trim).filter(|value| !value.is_empty()) {
        task.codebase_ids = vec![codebase_id.to_string()];
    }

    state.task_store.save(&task).await?;
    Ok(task.id)
}

fn parse_canvas_payload(content: Option<&str>) -> Option<CanvasArtifactPayload> {
    serde_json::from_str(content?).ok()
}
