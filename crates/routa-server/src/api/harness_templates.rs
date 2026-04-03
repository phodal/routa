use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use routa_core::harness_template;
use serde::Deserialize;
use serde_json::Value;

use crate::api::repo_context::{json_error, resolve_repo_root, RepoContextQuery};
use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(get_template_list))
        .route("/validate", get(get_template_validate))
        .route("/doctor", get(get_template_doctor))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateValidateQuery {
    #[serde(flatten)]
    pub context: RepoContextQuery,
    pub template_id: Option<String>,
}

async fn get_template_list(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "缺少 harness 上下文，请提供 workspaceId / codebaseId / repoPath 之一",
    )
    .await
    .map_err(map_context_error)?;

    let report =
        harness_template::list_templates(&repo_root).map_err(map_domain_error("模板列表"))?;

    to_json_response(report, "模板列表")
}

async fn get_template_validate(
    State(state): State<AppState>,
    Query(query): Query<TemplateValidateQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.context.workspace_id.as_deref(),
        query.context.codebase_id.as_deref(),
        query.context.repo_path.as_deref(),
        "缺少 harness 上下文，请提供 workspaceId / codebaseId / repoPath 之一",
    )
    .await
    .map_err(map_context_error)?;

    let template_id = query.template_id.as_deref().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json_error(
                "缺少 templateId 参数",
                "templateId is required".to_string(),
            )),
        )
    })?;

    let report = harness_template::validate_template(&repo_root, template_id)
        .map_err(map_domain_error("模板验证"))?;

    to_json_response(report, "模板验证")
}

async fn get_template_doctor(
    State(state): State<AppState>,
    Query(query): Query<RepoContextQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let repo_root = resolve_repo_root(
        &state,
        query.workspace_id.as_deref(),
        query.codebase_id.as_deref(),
        query.repo_path.as_deref(),
        "缺少 harness 上下文，请提供 workspaceId / codebaseId / repoPath 之一",
    )
    .await
    .map_err(map_context_error)?;

    let report = harness_template::doctor(&repo_root).map_err(map_domain_error("模板检查"))?;

    to_json_response(report, "模板检查")
}

fn to_json_response<T: serde::Serialize>(
    value: T,
    label: &str,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    Ok(Json(serde_json::to_value(value).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json_error(&format!("序列化{label}失败"), error.to_string())),
        )
    })?))
}

fn map_context_error(error: ServerError) -> (StatusCode, Json<Value>) {
    match error {
        ServerError::BadRequest(details) => (
            StatusCode::BAD_REQUEST,
            Json(json_error("Harness template 上下文无效", details)),
        ),
        other => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json_error("读取 Harness template 失败", other.to_string())),
        ),
    }
}

fn map_domain_error(label: &'static str) -> impl Fn(String) -> (StatusCode, Json<Value>) + Clone {
    move |error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json_error(&format!("读取 Harness {label}失败"), error)),
        )
    }
}
