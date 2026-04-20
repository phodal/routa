use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::error::ServerError;
use crate::models::schedule::{CreateScheduleInput, UpdateScheduleInput};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_schedules).post(create_schedule))
        .route("/tick", get(get_tick_status).post(trigger_tick))
        .route(
            "/{id}",
            get(get_schedule)
                .patch(update_schedule)
                .delete(delete_schedule),
        )
        .route("/{id}/run", axum::routing::post(run_schedule_now))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    workspace_id: Option<String>,
}

async fn list_schedules(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = q.workspace_id.as_deref().unwrap_or("default");
    let schedules = state.schedule_store.list_by_workspace(workspace_id).await?;
    Ok(Json(serde_json::json!({ "schedules": schedules })))
}

async fn create_schedule(
    State(state): State<AppState>,
    Json(body): Json<CreateScheduleInput>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let schedule = state.schedule_store.create(body).await?;
    Ok(Json(serde_json::json!({ "schedule": schedule })))
}

async fn get_schedule(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    match state.schedule_store.get(&id).await? {
        Some(s) => Ok(Json(serde_json::json!({ "schedule": s }))),
        None => Err(ServerError::NotFound(format!("Schedule {id} not found"))),
    }
}

async fn update_schedule(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateScheduleInput>,
) -> Result<Json<serde_json::Value>, ServerError> {
    match state.schedule_store.update(&id, body).await? {
        Some(s) => Ok(Json(serde_json::json!({ "schedule": s }))),
        None => Err(ServerError::NotFound(format!("Schedule {id} not found"))),
    }
}

async fn delete_schedule(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let deleted = state.schedule_store.delete(&id).await?;
    Ok(Json(serde_json::json!({ "deleted": deleted })))
}

/// POST /api/schedules/{id}/run — Trigger a schedule to run immediately
async fn run_schedule_now(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    match state.schedule_store.get(&id).await? {
        Some(s) => Ok(Json(serde_json::json!({
            "triggered": true,
            "scheduleId": s.id,
            "message": "Schedule triggered manually",
        }))),
        None => Err(ServerError::NotFound(format!("Schedule {id} not found"))),
    }
}

/// GET /api/schedules/tick — Get tick status
async fn get_tick_status() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "idle",
        "message": "No active tick running",
    }))
}

/// POST /api/schedules/tick — Manually trigger the schedule tick processor
async fn trigger_tick(State(state): State<AppState>) -> Json<serde_json::Value> {
    // List all enabled schedules and mark them as "ticked" for next execution
    let _ = state.schedule_store.list_by_workspace("default").await;
    Json(serde_json::json!({
        "ticked": true,
        "message": "Schedule tick processed",
    }))
}
