use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path as FsPath, PathBuf};

use crate::error::ServerError;
use routa_core::acp::SessionLaunchOptions;
use routa_core::git::get_clone_base_dir;
use routa_core::models::{
    get_canvas_generation_contract, get_canvas_sdk_definition_resource_uris,
    CANVAS_SDK_MANIFEST_RESOURCE_URI,
};
use routa_core::orchestration::SpecialistConfig;
use routa_core::storage::get_project_storage_dir;
use routa_core::store::acp_session_store::CreateAcpSessionParams;

use crate::models::artifact::{Artifact, ArtifactStatus, ArtifactType};
use crate::models::canvas_artifact::{
    CanvasArtifactMetadata, CanvasArtifactPayload, CanvasRenderMode, CanvasType,
};
use crate::models::task::{Task, TaskStatus};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(create_canvas).get(list_canvas))
        .route("/specialist", post(create_canvas_from_specialist))
        .route("/specialist/materialize", post(materialize_canvas_source))
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
struct CreateCanvasFromSpecialistBody {
    specialist_id: Option<String>,
    prompt: Option<String>,
    workspace_id: Option<String>,
    title: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    task_id: Option<String>,
    codebase_id: Option<String>,
    repo_path: Option<String>,
    cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MaterializeCanvasBody {
    workspace_id: Option<String>,
    repo_path: Option<String>,
    repo_label: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListCanvasQuery {
    workspace_id: Option<String>,
}

async fn materialize_canvas_source(
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<(axum::http::StatusCode, Json<Value>), ServerError> {
    let Json(raw_body) =
        body.map_err(|_| ServerError::BadRequest("Invalid JSON body".to_string()))?;
    if !raw_body.is_object() {
        return Err(ServerError::BadRequest("Invalid JSON body".to_string()));
    }

    let body: MaterializeCanvasBody = serde_json::from_value(raw_body)
        .map_err(|_| ServerError::BadRequest("Invalid JSON body".to_string()))?;
    let workspace_id = body
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("workspaceId is required".to_string()))?;
    let repo_path = body
        .repo_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("repoPath is required".to_string()))?;
    let source = body
        .source
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ServerError::BadRequest("source is required".to_string()))?;

    let file_path = persist_fitness_canvas_source(repo_path, body.repo_label.as_deref(), source)?;
    let file_name = file_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({
            "workspaceId": workspace_id,
            "filePath": file_path.to_string_lossy(),
            "fileName": file_name,
        })),
    ))
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

    let created = save_canvas_artifact(
        &state,
        SaveCanvasArtifactParams {
            render_mode,
            canvas_type,
            title,
            source,
            data,
            workspace_id,
            task_id: body.task_id,
            codebase_id: body.codebase_id,
            repo_path: body.repo_path,
            agent_id: body.agent_id,
        },
    )
    .await?;

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

async fn create_canvas_from_specialist(
    State(state): State<AppState>,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<(axum::http::StatusCode, Json<Value>), ServerError> {
    let Json(raw_body) =
        body.map_err(|_| ServerError::BadRequest("Invalid JSON body".to_string()))?;
    if !raw_body.is_object() {
        return Err(ServerError::BadRequest("Invalid JSON body".to_string()));
    }

    let body: CreateCanvasFromSpecialistBody = serde_json::from_value(raw_body)
        .map_err(|_| ServerError::BadRequest("Invalid JSON body".to_string()))?;

    let specialist_id = body
        .specialist_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("specialistId is required".to_string()))?;
    let user_prompt = body
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("prompt is required".to_string()))?;
    let workspace_id = body
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("workspaceId is required".to_string()))?
        .to_string();

    let specialist = SpecialistConfig::resolve(specialist_id)
        .ok_or_else(|| ServerError::NotFound(format!("Specialist not found: {specialist_id}")))?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let cwd = body
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            body.repo_path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        })
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|path| path.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| ".".to_string());
    let provider = body
        .provider
        .clone()
        .or_else(|| specialist.default_provider.clone())
        .unwrap_or_else(|| "opencode".to_string());
    let role = specialist.role.as_str().to_string();
    let launch_options = SessionLaunchOptions {
        specialist_id: Some(specialist.id.clone()),
        specialist_system_prompt: build_specialist_system_prompt(&specialist),
        allowed_native_tools: derive_allowed_native_tools(Some(specialist.id.as_str())),
        ..SessionLaunchOptions::default()
    };

    let provider_session_id = match state
        .acp_manager
        .create_session_with_options(
            session_id.clone(),
            cwd.clone(),
            workspace_id.clone(),
            Some(provider.clone()),
            Some(role.clone()),
            body.model.clone(),
            None,
            None,
            None,
            launch_options,
        )
        .await
    {
        Ok((_our_sid, provider_sid)) => provider_sid,
        Err(error) => {
            return Err(ServerError::Internal(format!(
                "Failed to create specialist session: {error}"
            )))
        }
    };

    let persist_result = state
        .acp_session_store
        .create(CreateAcpSessionParams {
            id: &session_id,
            cwd: &cwd,
            branch: None,
            workspace_id: &workspace_id,
            provider: Some(provider.as_str()),
            role: Some(role.as_str()),
            custom_command: None,
            custom_args: None,
            parent_session_id: None,
        })
        .await;
    if let Err(error) = persist_result {
        tracing::warn!(
            "[canvas] Failed to persist specialist session {}: {}",
            session_id,
            error
        );
    } else if let Err(error) = state
        .acp_session_store
        .set_provider_session_id(&session_id, Some(&provider_session_id))
        .await
    {
        tracing::warn!(
            "[canvas] Failed to persist provider session id for {}: {}",
            session_id,
            error
        );
    }

    let result = async {
        let specialist_prompt = build_canvas_specialist_prompt(user_prompt);
        let prompt_result = state
            .acp_manager
            .prompt(&session_id, &specialist_prompt)
            .await
            .map_err(|error| {
                ServerError::Internal(format!("Failed to run specialist prompt: {error}"))
            })?;

        let history = state
            .acp_manager
            .get_session_history(&session_id)
            .await
            .unwrap_or_default();

        let prompt_text = extract_text_from_prompt_result(&prompt_result);
        let history_text = extract_specialist_output_from_history(&history);
        let combined_output = if !prompt_text.trim().is_empty() {
            prompt_text
        } else {
            history_text
        };

        let source =
            if let Some(value) = extract_canvas_source_from_specialist_output(&combined_output) {
                value
            } else {
                return Ok(json!({
                    "error": "Specialist output did not contain usable canvas TSX",
                    "sessionId": session_id,
                    "outputPreview": combined_output.chars().take(500).collect::<String>(),
                    "__status": 422,
                }));
            };

        let default_title = format!("{} Canvas", specialist.name);
        let title = body
            .title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(default_title.as_str())
            .to_string();

        let created = save_canvas_artifact(
            &state,
            SaveCanvasArtifactParams {
                render_mode: CanvasRenderMode::Dynamic,
                canvas_type: None,
                title,
                source: Some(source.clone()),
                data: None,
                workspace_id: workspace_id.clone(),
                task_id: body.task_id.clone(),
                codebase_id: body.codebase_id.clone(),
                repo_path: body.repo_path.clone(),
                agent_id: None,
            },
        )
        .await?;

        Ok::<Value, ServerError>(json!({
            "id": created["id"],
            "renderMode": created["renderMode"],
            "canvasType": created["canvasType"],
            "title": created["title"],
            "taskId": created["taskId"],
            "createdAt": created["createdAt"],
            "sessionId": session_id,
            "viewerUrl": format!("/canvas/{}", created["id"].as_str().unwrap_or_default()),
            "source": source,
        }))
    }
    .await;

    state.acp_manager.kill_session(&session_id).await;
    result.map(|value| {
        let status = value
            .get("__status")
            .and_then(Value::as_u64)
            .map(|code| {
                axum::http::StatusCode::from_u16(code as u16)
                    .unwrap_or(axum::http::StatusCode::CREATED)
            })
            .unwrap_or(axum::http::StatusCode::CREATED);
        let response = if status == axum::http::StatusCode::CREATED {
            value
        } else if let Some(mut record) = value.as_object().cloned() {
            record.remove("__status");
            Value::Object(record)
        } else {
            value
        };
        (status, Json(response))
    })
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

    let payload = parse_canvas_payload(artifact.content.as_deref())
        .ok_or_else(|| ServerError::Internal("Canvas artifact data is corrupted".to_string()))?;

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

struct SaveCanvasArtifactParams {
    render_mode: CanvasRenderMode,
    canvas_type: Option<CanvasType>,
    title: String,
    source: Option<String>,
    data: Option<Value>,
    workspace_id: String,
    task_id: Option<String>,
    codebase_id: Option<String>,
    repo_path: Option<String>,
    agent_id: Option<String>,
}

async fn save_canvas_artifact(
    state: &AppState,
    params: SaveCanvasArtifactParams,
) -> Result<Value, ServerError> {
    let task_id = resolve_canvas_task_id(
        state,
        &params.workspace_id,
        &params.title,
        params.task_id.as_deref(),
        params.codebase_id.as_deref(),
    )
    .await?;

    let payload = CanvasArtifactPayload {
        metadata: CanvasArtifactMetadata {
            render_mode: params.render_mode.clone(),
            canvas_type: params.canvas_type.clone(),
            title: params.title.clone(),
            schema_version: 1,
            generated_at: Utc::now(),
            workspace_id: Some(params.workspace_id.clone()),
            codebase_id: params.codebase_id.clone(),
            repo_path: params.repo_path.clone(),
        },
        source: params.source,
        data: params.data,
    };

    let now = Utc::now();
    let artifact = Artifact {
        id: uuid::Uuid::new_v4().to_string(),
        artifact_type: ArtifactType::Canvas,
        task_id: task_id.clone(),
        workspace_id: params.workspace_id,
        provided_by_agent_id: params.agent_id,
        requested_by_agent_id: None,
        request_id: None,
        content: Some(serde_json::to_string(&payload).map_err(|error| {
            ServerError::Internal(format!("Failed to encode canvas payload: {error}"))
        })?),
        context: Some(format!("Canvas: {}", params.title)),
        status: ArtifactStatus::Provided,
        expires_at: None,
        metadata: Some(std::collections::BTreeMap::from([
            (
                "renderMode".to_string(),
                params.render_mode.as_str().to_string(),
            ),
            (
                "canvasType".to_string(),
                params
                    .canvas_type
                    .as_ref()
                    .map(CanvasType::as_str)
                    .unwrap_or("")
                    .to_string(),
            ),
            ("title".to_string(), params.title.clone()),
            ("schemaVersion".to_string(), "1".to_string()),
        ])),
        created_at: now,
        updated_at: now,
    };

    state.artifact_store.save(&artifact).await?;

    Ok(json!({
        "id": artifact.id,
        "renderMode": params.render_mode.as_str(),
        "canvasType": payload.metadata.canvas_type.as_ref().map(CanvasType::as_str),
        "title": params.title,
        "taskId": task_id,
        "createdAt": artifact.created_at.to_rfc3339(),
    }))
}

fn build_specialist_system_prompt(specialist: &SpecialistConfig) -> Option<String> {
    specialist.system_prompt_with_reminder()
}

fn derive_allowed_native_tools(specialist_id: Option<&str>) -> Option<Vec<String>> {
    if specialist_id == Some("team-agent-lead") {
        return Some(Vec::new());
    }

    None
}

fn sanitize_segment(value: &str) -> String {
    let normalized = value.trim().to_ascii_lowercase().replace(['/', '\\'], "-");
    let sanitized = normalized
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    sanitized
        .trim_matches('-')
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn strip_managed_clone_root(repo_path: &FsPath) -> Option<PathBuf> {
    let mut root = PathBuf::new();
    let mut components = repo_path.components().peekable();

    while let Some(component) = components.next() {
        let name = component.as_os_str().to_str()?;
        if name == ".routa" {
            let Some(next_component) = components.peek() else {
                break;
            };
            if next_component.as_os_str() == "repos" {
                return Some(if root.as_os_str().is_empty() {
                    PathBuf::from(std::path::MAIN_SEPARATOR.to_string())
                } else {
                    root
                });
            }
        }
        root.push(component.as_os_str());
    }

    None
}

fn derive_repo_segment(repo_path: &str, repo_label: Option<&str>) -> String {
    let candidate = repo_label
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            FsPath::new(repo_path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(repo_path)
        });
    let sanitized = sanitize_segment(candidate);
    if sanitized.is_empty() {
        "canvas".to_string()
    } else {
        sanitized
    }
}

fn resolve_canvas_storage_root(repo_path: &str) -> PathBuf {
    let resolved_repo_path = if FsPath::new(repo_path).is_absolute() {
        PathBuf::from(repo_path)
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(repo_path)
    };
    if let Some(root) = strip_managed_clone_root(&resolved_repo_path) {
        return root;
    }
    let clone_base_dir = get_clone_base_dir();
    if resolved_repo_path == clone_base_dir || resolved_repo_path.starts_with(&clone_base_dir) {
        return clone_base_dir
            .parent()
            .and_then(|path| path.parent())
            .map(PathBuf::from)
            .unwrap_or(clone_base_dir);
    }
    resolved_repo_path
}

fn build_fitness_canvas_file_name(repo_path: &str, repo_label: Option<&str>) -> String {
    format!(
        "{}-fitness-overview.canvas.tsx",
        derive_repo_segment(repo_path, repo_label)
    )
}

fn get_stored_fitness_canvas_path(repo_path: &str, repo_label: Option<&str>) -> PathBuf {
    let storage_root = resolve_canvas_storage_root(repo_path);
    let storage_root_str = storage_root.to_string_lossy().to_string();
    get_project_storage_dir(&storage_root_str)
        .join("canvases")
        .join(build_fitness_canvas_file_name(repo_path, repo_label))
}

fn persist_fitness_canvas_source(
    repo_path: &str,
    repo_label: Option<&str>,
    source: &str,
) -> Result<PathBuf, ServerError> {
    let file_path = get_stored_fitness_canvas_path(repo_path, repo_label);
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            ServerError::Internal(format!("Failed to create canvas directory: {error}"))
        })?;
    }
    let normalized_source = format!("{}\n", source.trim());
    std::fs::write(&file_path, normalized_source).map_err(|error| {
        ServerError::Internal(format!("Failed to persist canvas source: {error}"))
    })?;
    Ok(file_path)
}

fn build_canvas_sdk_prompt_section() -> Vec<String> {
    let mut lines = vec![
        "Canvas SDK access:".to_string(),
        format!(
            "- Prefer MCP tool `read_canvas_sdk_resource` with uri `{CANVAS_SDK_MANIFEST_RESOURCE_URI}`."
        ),
        "- If your provider supports native MCP resource reads, you may read that same URI directly instead.".to_string(),
        "- That manifest is the authoritative Canvas SDK index for this session.".to_string(),
        "- Then read only the defs resources you actually need from its `definitionResources` list, preferably through `read_canvas_sdk_resource`.".to_string(),
        "- Import only from `@canvas-sdk` or `react`.".to_string(),
        "- If a symbol or prop is not present in those resources, do not invent it.".to_string(),
        "- Example definition resources:".to_string(),
    ];
    for uri in get_canvas_sdk_definition_resource_uris()
        .into_iter()
        .take(3)
    {
        lines.push(format!("  - `{uri}`"));
    }
    lines.push("- If neither direct resource reads nor the helper tool are available, stay conservative and use only the symbols named in the manifest.".to_string());
    lines
}

fn build_canvas_specialist_prompt(user_prompt: &str) -> String {
    let contract = get_canvas_generation_contract();
    let default_export_forms = format_or_list(&contract.output.default_export_forms);
    let allowed_modules = format_or_list(&contract.imports.allowed_modules);
    let forbidden_globals = format_or_list(&contract.runtime.forbidden_globals);
    let forbidden_shell_chrome = format_or_list(&contract.layout.forbidden_shell_chrome);
    let mut lines = vec![contract.prompt.artifact_description.clone()];

    if contract.prompt.require_source_only {
        lines.push("Return only the TSX source.".to_string());
    }
    if !contract.prompt.allow_markdown_code_fences {
        lines.push("Do not include markdown code fences.".to_string());
    }
    if !contract.prompt.allow_prose {
        lines.push(
            "Do not include explanations, notes, or prose before or after the code.".to_string(),
        );
    }

    lines.extend([
        format!("The source must {default_export_forms}."),
        "Prefer a self-contained component with inline styles.".to_string(),
        format!("If you import anything, you may only import from {allowed_modules}."),
        format!("Do not use browser globals or side effects such as {forbidden_globals}."),
        format!(
            "Do not render fake shell chrome such as {forbidden_shell_chrome} unless the prompt explicitly asks for it."
        ),
        format!(
            "Keep the composition {}; avoid {}.",
            contract.style.principles.join(", "),
            contract.style.forbidden_patterns.join(", ")
        ),
        String::new(),
    ]);
    lines.extend(build_canvas_sdk_prompt_section());
    lines.extend([
        String::new(),
        "User request:".to_string(),
        user_prompt.trim().to_string(),
    ]);

    lines.join("\n")
}

fn format_or_list(values: &[String]) -> String {
    let quoted = values
        .iter()
        .map(|value| format!("`{value}`"))
        .collect::<Vec<_>>();

    match quoted.as_slice() {
        [] => String::new(),
        [single] => single.clone(),
        [left, right] => format!("{left} or {right}"),
        _ => format!(
            "{}, or {}",
            quoted[..quoted.len() - 1].join(", "),
            quoted[quoted.len() - 1]
        ),
    }
}

fn extract_text_from_prompt_result(value: &Value) -> String {
    fn collect(value: &Value, parts: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                if let Some(text) = map.get("text").and_then(Value::as_str) {
                    parts.push(text.to_string());
                }
                if let Some(delta) = map.get("delta").and_then(Value::as_str) {
                    parts.push(delta.to_string());
                }
                for nested in map.values() {
                    collect(nested, parts);
                }
            }
            Value::Array(items) => {
                for item in items {
                    collect(item, parts);
                }
            }
            _ => {}
        }
    }

    let mut parts = Vec::new();
    collect(value, &mut parts);
    parts.join("").trim().to_string()
}

fn extract_text_from_process_output_line(data: &str) -> Option<String> {
    for marker in ["Agent message (non-delta) received: \"", "delta: \""] {
        if let Some(start) = data.find(marker) {
            let tail = &data[start + marker.len()..];
            if let Some(end) = tail.rfind('"') {
                let quoted = format!("\"{}\"", &tail[..end]);
                return serde_json::from_str::<String>(&quoted)
                    .ok()
                    .or_else(|| Some(tail[..end].replace("\\n", "\n").replace("\\\"", "\"")));
            }
        }
    }

    None
}

fn extract_update_text(update: &serde_json::Map<String, Value>) -> Option<String> {
    if let Some(text) = update
        .get("data")
        .and_then(Value::as_str)
        .and_then(extract_text_from_process_output_line)
    {
        return Some(text);
    }
    if let Some(text) = update.get("delta").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    if let Some(text) = update
        .get("content")
        .and_then(|value| value.get("text"))
        .and_then(Value::as_str)
    {
        return Some(text.to_string());
    }
    if let Some(text) = update.get("content").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    if let Some(text) = update.get("text").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    if let Some(text) = update.get("message").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    if let Some(text) = update
        .get("message")
        .and_then(|value| value.get("text"))
        .and_then(Value::as_str)
    {
        return Some(text.to_string());
    }
    if let Some(items) = update.get("content").and_then(Value::as_array) {
        let output = items
            .iter()
            .map(|item| {
                item.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| item.get("content").and_then(Value::as_str))
                    .unwrap_or("")
            })
            .collect::<String>();
        if !output.is_empty() {
            return Some(output);
        }
    }
    None
}

fn extract_tool_call_canvas_candidate(update: &serde_json::Map<String, Value>) -> Option<String> {
    let session_update = update
        .get("sessionUpdate")
        .and_then(Value::as_str)
        .unwrap_or("");
    if session_update != "tool_call" && session_update != "tool_call_update" {
        return None;
    }

    let kind = update.get("kind").and_then(Value::as_str).unwrap_or("");
    let title = update
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    if kind != "edit" && title != "write" && title != "edit" {
        return None;
    }

    let raw_input = update.get("rawInput").and_then(Value::as_object)?;
    for key in ["content", "new_string", "text", "source"] {
        if let Some(value) = raw_input.get(key).and_then(Value::as_str) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    None
}

fn extract_specialist_output_from_history(history: &[Value]) -> String {
    let mut direct_output = String::new();
    let mut process_output = String::new();

    for entry in history {
        let Some(update) = entry
            .get("params")
            .and_then(|params| params.get("update"))
            .and_then(Value::as_object)
        else {
            continue;
        };

        let session_update = update
            .get("sessionUpdate")
            .and_then(Value::as_str)
            .unwrap_or("");
        match session_update {
            "agent_message" | "agent_message_chunk" | "agent_chunk" => {
                if let Some(text) = extract_update_text(update) {
                    direct_output.push_str(&text);
                }
            }
            "process_output" => {
                if let Some(text) = extract_update_text(update) {
                    process_output.push_str(&text);
                }
            }
            _ => {}
        }
    }

    if direct_output.trim().is_empty() {
        if !process_output.trim().is_empty() {
            return process_output.trim().to_string();
        }
    } else {
        return direct_output.trim().to_string();
    }

    for entry in history.iter().rev() {
        let Some(update) = entry
            .get("params")
            .and_then(|params| params.get("update"))
            .and_then(Value::as_object)
        else {
            continue;
        };

        if let Some(candidate) = extract_tool_call_canvas_candidate(update) {
            return candidate;
        }
    }

    String::new()
}

fn extract_canvas_source_from_specialist_output(output: &str) -> Option<String> {
    let normalized = output.trim();
    if normalized.is_empty() {
        return None;
    }

    let contract = get_canvas_generation_contract();
    let source_from_json = serde_json::from_str::<Value>(normalized)
        .ok()
        .and_then(|value| {
            contract
                .output
                .json_source_keys
                .iter()
                .find_map(|key| value.get(key).and_then(Value::as_str))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        });
    let candidate = source_from_json.unwrap_or_else(|| {
        let fenced = regex::Regex::new(r"```(?:tsx|jsx|typescript|javascript)?\s*([\s\S]*?)```")
            .ok()
            .and_then(|re| {
                re.captures(normalized)
                    .and_then(|caps| caps.get(1))
                    .map(|value| value.as_str().trim().to_string())
            });
        fenced.unwrap_or_else(|| normalized.to_string())
    });

    let start_index = [
        "import ",
        "export default",
        "function Canvas(",
        "const Canvas =",
    ]
    .iter()
    .filter_map(|marker| candidate.find(marker))
    .min();
    let trimmed = start_index
        .map(|index| candidate[index..].trim().to_string())
        .unwrap_or(candidate);

    if trimmed.contains("export default") {
        return Some(trimmed);
    }
    if trimmed.starts_with("function Canvas(") {
        return Some(format!("export default {trimmed}"));
    }
    if trimmed.starts_with("const Canvas =") {
        return Some(format!("{trimmed}\n\nexport default Canvas;"));
    }

    None
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Mutex, OnceLock};

    fn current_dir_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn build_canvas_specialist_prompt_constrains_output_shape() {
        let prompt = build_canvas_specialist_prompt("Create a status card.");

        assert!(prompt.contains("Return only the TSX source."));
        assert!(prompt.contains("fake shell chrome"));
        assert!(prompt.contains("@canvas-sdk/*"));
        assert!(prompt.contains("read_canvas_sdk_resource"));
        assert!(prompt.contains(CANVAS_SDK_MANIFEST_RESOURCE_URI));
        assert!(prompt.contains("Create a status card."));
    }

    #[test]
    fn extract_canvas_source_from_tool_call_history() {
        let history = vec![json!({
            "params": {
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "kind": "edit",
                    "title": "write",
                    "rawInput": {
                        "content": "export default function Canvas(){ return <div>Tool</div>; }"
                    }
                }
            }
        })];

        let output = extract_specialist_output_from_history(&history);
        let source = extract_canvas_source_from_specialist_output(&output)
            .expect("expected canvas source from tool call");

        assert_eq!(
            source,
            "export default function Canvas(){ return <div>Tool</div>; }"
        );
    }

    #[test]
    fn extract_canvas_source_from_fenced_output() {
        let output = r#"
Here is the component:

```tsx
export default function Canvas() {
  return <div>Hello</div>;
}
```
"#;

        let source = extract_canvas_source_from_specialist_output(output)
            .expect("expected TSX source from fenced block");
        assert!(source.contains("export default function Canvas()"));
        assert!(source.contains("<div>Hello</div>"));
    }

    #[test]
    fn extract_canvas_source_from_json_payload() {
        let output = json!({
            "source": "export default function Canvas(){ return <div>JSON</div>; }"
        })
        .to_string();

        let source = extract_canvas_source_from_specialist_output(&output)
            .expect("expected TSX source from JSON");
        assert_eq!(
            source,
            "export default function Canvas(){ return <div>JSON</div>; }"
        );
    }

    #[test]
    fn upgrade_bare_canvas_function_to_default_export() {
        let output = r#"
function Canvas() {
  return <div>Ready</div>;
}
"#;

        let source = extract_canvas_source_from_specialist_output(output)
            .expect("expected normalized Canvas component");
        assert!(source.starts_with("export default function Canvas()"));
    }

    #[test]
    fn return_none_when_output_has_no_canvas_component() {
        assert!(extract_canvas_source_from_specialist_output("I cannot do that.").is_none());
    }

    #[test]
    fn stores_managed_clone_canvases_under_project_storage_root() {
        let _guard = current_dir_lock().lock().unwrap();
        let original_cwd = std::env::current_dir().expect("current dir");
        let temp_dir = tempfile::tempdir().expect("temp dir");
        std::env::set_current_dir(temp_dir.path()).expect("switch cwd");

        let clone_repo_path = temp_dir
            .path()
            .join(".routa")
            .join("repos")
            .join("phodal--routa");
        let expected_path = get_project_storage_dir(temp_dir.path().to_string_lossy().as_ref())
            .join("canvases")
            .join("phodal-routa-fitness-overview.canvas.tsx");
        let source = "export default function Canvas(){ return <div>Clone</div>; }";

        let file_path = persist_fitness_canvas_source(
            clone_repo_path.to_string_lossy().as_ref(),
            Some("phodal/routa"),
            source,
        )
        .expect("persist managed clone canvas");

        assert_eq!(file_path, expected_path);
        assert_eq!(
            std::fs::read_to_string(file_path).unwrap(),
            format!("{source}\n")
        );

        std::env::set_current_dir(original_cwd).expect("restore cwd");
    }
}
