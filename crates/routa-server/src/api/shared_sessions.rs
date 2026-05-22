use std::{convert::Infallible, pin::Pin, time::Duration};

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::sse::{Event, Sse},
    routing::get,
    Json, Router,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::state::AppState;

mod store;

type SharedSseStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<Event, Infallible>> + Send>>;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_shared_sessions).post(create_shared_session))
        .route(
            "/{shared_session_id}",
            get(get_shared_session).delete(close_shared_session),
        )
        .route(
            "/{shared_session_id}/join",
            axum::routing::post(join_shared_session),
        )
        .route(
            "/{shared_session_id}/leave",
            axum::routing::post(leave_shared_session),
        )
        .route(
            "/{shared_session_id}/participants",
            get(list_shared_session_participants),
        )
        .route(
            "/{shared_session_id}/messages",
            get(list_shared_session_messages).post(send_shared_session_message),
        )
        .route(
            "/{shared_session_id}/prompts",
            axum::routing::post(send_shared_session_prompt),
        )
        .route(
            "/{shared_session_id}/approvals/{approval_id}",
            axum::routing::post(respond_shared_prompt_approval),
        )
        .route("/{shared_session_id}/stream", get(shared_session_stream))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListSharedSessionsQuery {
    workspace_id: Option<String>,
    host_session_id: Option<String>,
    status: Option<store::SharedSessionStatus>,
}

async fn list_shared_sessions(
    Query(query): Query<ListSharedSessionsQuery>,
) -> store::HandlerResult<Json<Value>> {
    let mut shared_store = store::shared_session_store().write().await;
    shared_store.expire_sessions();

    let mut sessions: Vec<store::SharedSession> = shared_store
        .sessions
        .values()
        .filter(|session| {
            if let Some(ws) = &query.workspace_id {
                if &session.workspace_id != ws {
                    return false;
                }
            }
            if let Some(host_session_id) = &query.host_session_id {
                if &session.host_session_id != host_session_id {
                    return false;
                }
            }
            if let Some(status) = &query.status {
                if &session.status != status {
                    return false;
                }
            }
            true
        })
        .cloned()
        .collect();
    sessions.sort_by_key(|session| std::cmp::Reverse(session.created_at));

    Ok(Json(json!({
        "sessions": sessions
            .iter()
            .map(|session| store::session_to_json(session, false))
            .collect::<Vec<_>>(),
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSharedSessionRequest {
    host_session_id: String,
    host_user_id: String,
    host_display_name: Option<String>,
    mode: Option<store::SharedSessionMode>,
    workspace_id: Option<String>,
    expires_in_minutes: Option<i64>,
}

async fn create_shared_session(
    State(state): State<AppState>,
    Json(body): Json<CreateSharedSessionRequest>,
) -> store::HandlerResult<(StatusCode, Json<Value>)> {
    if body.host_session_id.trim().is_empty() {
        return Err(store::into_http_error(store::ApiErr::bad_request(
            "MISSING_HOST_SESSION_ID",
            "hostSessionId is required.",
        )));
    }
    if body.host_user_id.trim().is_empty() {
        return Err(store::into_http_error(store::ApiErr::bad_request(
            "MISSING_HOST_USER_ID",
            "hostUserId is required.",
        )));
    }

    let host_session = state
        .acp_manager
        .get_session(&body.host_session_id)
        .await
        .ok_or_else(|| {
            store::into_http_error(store::ApiErr::not_found(
                "HOST_SESSION_NOT_FOUND",
                format!("Host session not found: {}", body.host_session_id),
            ))
        })?;

    let expires_at = body.expires_in_minutes.and_then(|minutes| {
        if minutes <= 0 {
            None
        } else {
            Some(Utc::now() + chrono::Duration::minutes(minutes))
        }
    });

    let mode = body
        .mode
        .unwrap_or(store::SharedSessionMode::PromptWithApproval);
    let session = store::SharedSession {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id: body
            .workspace_id
            .unwrap_or_else(|| host_session.workspace_id.clone()),
        host_user_id: body.host_user_id.trim().to_string(),
        host_session_id: body.host_session_id.clone(),
        approval_required: mode == store::SharedSessionMode::PromptWithApproval,
        mode,
        invite_token: uuid::Uuid::new_v4().simple().to_string(),
        created_at: Utc::now(),
        expires_at,
        status: store::SharedSessionStatus::Active,
    };
    let host_participant = store::SharedSessionParticipant {
        id: uuid::Uuid::new_v4().to_string(),
        shared_session_id: session.id.clone(),
        user_id: body.host_user_id.trim().to_string(),
        display_name: body.host_display_name.clone(),
        role: store::SharedSessionRole::Host,
        access_token: uuid::Uuid::new_v4().simple().to_string(),
        joined_at: Utc::now(),
        left_at: None,
    };

    {
        let mut shared_store = store::shared_session_store().write().await;
        shared_store.expire_sessions();
        shared_store
            .sessions
            .insert(session.id.clone(), session.clone());
        shared_store.insert_participant(host_participant.clone());
        shared_store.emit_session_event(
            &session.id,
            "shared_session_created",
            json!({ "session": store::session_to_json(&session, false) }),
        );
        shared_store.emit_session_event(
            &session.id,
            "participant_joined",
            json!({ "participant": store::participant_to_json(&host_participant, false) }),
        );
    }

    if let Some(rx) = state.acp_manager.subscribe(&session.host_session_id).await {
        store::spawn_host_notification_forwarder(session.id.clone(), rx);
    }

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "session": store::session_to_json(&session, true),
            "inviteToken": session.invite_token,
            "hostParticipant": store::participant_to_json(&host_participant, true),
        })),
    ))
}

async fn get_shared_session(
    Path(shared_session_id): Path<String>,
) -> store::HandlerResult<Json<Value>> {
    let shared_store = store::shared_session_store().read().await;
    let Some(session) = shared_store.sessions.get(&shared_session_id) else {
        return Err(store::into_http_error(store::ApiErr::not_found(
            "SESSION_NOT_FOUND",
            "Shared session not found.",
        )));
    };

    if session.status != store::SharedSessionStatus::Active {
        return Err(store::into_http_error(store::ApiErr::conflict(
            "SESSION_INACTIVE",
            format!("Shared session is {:?}.", session.status),
        )));
    }

    let participants = shared_store
        .list_participants(&shared_session_id)
        .iter()
        .map(|participant| store::participant_to_json(participant, false))
        .collect::<Vec<_>>();
    let approvals = shared_store
        .list_approvals(&shared_session_id)
        .iter()
        .map(store::approval_to_json)
        .collect::<Vec<_>>();

    Ok(Json(json!({
        "session": store::session_to_json(session, false),
        "participants": participants,
        "approvals": approvals,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParticipantAuthRequest {
    participant_id: String,
    participant_token: String,
}

async fn close_shared_session(
    Path(shared_session_id): Path<String>,
    Json(body): Json<ParticipantAuthRequest>,
) -> store::HandlerResult<Json<Value>> {
    let mut shared_store = store::shared_session_store().write().await;
    shared_store.expire_sessions();
    let participant = shared_store
        .authenticate_participant(
            &shared_session_id,
            &body.participant_id,
            &body.participant_token,
        )
        .map_err(store::into_http_error)?
        .clone();
    if participant.role != store::SharedSessionRole::Host {
        return Err(store::into_http_error(store::ApiErr::forbidden(
            "HOST_REQUIRED",
            "Only host can close the shared session.",
        )));
    }
    shared_store.finalize_session(&shared_session_id, store::SharedSessionStatus::Closed);
    let session = shared_store
        .sessions
        .get(&shared_session_id)
        .cloned()
        .ok_or_else(|| {
            store::into_http_error(store::ApiErr::not_found(
                "SESSION_NOT_FOUND",
                "Shared session not found.",
            ))
        })?;

    Ok(Json(json!({
        "closed": true,
        "session": store::session_to_json(&session, false),
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinSharedSessionRequest {
    invite_token: String,
    user_id: String,
    display_name: Option<String>,
    role: Option<store::SharedSessionRole>,
}

async fn join_shared_session(
    Path(shared_session_id): Path<String>,
    Json(body): Json<JoinSharedSessionRequest>,
) -> store::HandlerResult<Json<Value>> {
    if body.user_id.trim().is_empty() {
        return Err(store::into_http_error(store::ApiErr::bad_request(
            "MISSING_USER_ID",
            "userId is required.",
        )));
    }

    let mut shared_store = store::shared_session_store().write().await;
    shared_store.expire_sessions();
    let session = shared_store
        .ensure_active_session(&shared_session_id)
        .map_err(store::into_http_error)?
        .clone();

    if session.invite_token != body.invite_token {
        return Err(store::into_http_error(store::ApiErr::forbidden(
            "INVALID_INVITE_TOKEN",
            "Invite token is invalid.",
        )));
    }

    if let Some(existing) =
        shared_store.find_active_participant_by_user_id(&shared_session_id, &body.user_id)
    {
        return Ok(Json(json!({
            "session": store::session_to_json(&session, false),
            "participant": store::participant_to_json(&existing, true),
        })));
    }

    let role = match body.role.unwrap_or(store::SharedSessionRole::Collaborator) {
        store::SharedSessionRole::Host => store::SharedSessionRole::Collaborator,
        value => value,
    };
    let participant = store::SharedSessionParticipant {
        id: uuid::Uuid::new_v4().to_string(),
        shared_session_id: shared_session_id.clone(),
        user_id: body.user_id.trim().to_string(),
        display_name: body.display_name.clone(),
        role,
        access_token: uuid::Uuid::new_v4().simple().to_string(),
        joined_at: Utc::now(),
        left_at: None,
    };
    shared_store.insert_participant(participant.clone());
    shared_store.emit_session_event(
        &shared_session_id,
        "participant_joined",
        json!({ "participant": store::participant_to_json(&participant, false) }),
    );

    Ok(Json(json!({
        "session": store::session_to_json(&session, false),
        "participant": store::participant_to_json(&participant, true),
    })))
}

async fn leave_shared_session(
    Path(shared_session_id): Path<String>,
    Json(body): Json<ParticipantAuthRequest>,
) -> store::HandlerResult<Json<Value>> {
    let mut shared_store = store::shared_session_store().write().await;
    shared_store.expire_sessions();
    let mut participant = shared_store
        .authenticate_participant(
            &shared_session_id,
            &body.participant_id,
            &body.participant_token,
        )
        .map_err(store::into_http_error)?
        .clone();

    if participant.left_at.is_none() {
        participant.left_at = Some(Utc::now());
        shared_store
            .participants
            .insert(participant.id.clone(), participant.clone());
        shared_store.emit_session_event(
            &shared_session_id,
            "participant_left",
            json!({ "participant": store::participant_to_json(&participant, false) }),
        );
    }

    Ok(Json(json!({
        "participant": store::participant_to_json(&participant, false),
    })))
}

async fn list_shared_session_participants(
    Path(shared_session_id): Path<String>,
) -> store::HandlerResult<Json<Value>> {
    let mut shared_store = store::shared_session_store().write().await;
    shared_store.expire_sessions();
    shared_store
        .ensure_active_session(&shared_session_id)
        .map_err(store::into_http_error)?;

    let participants = shared_store
        .list_participants(&shared_session_id)
        .iter()
        .map(|participant| store::participant_to_json(participant, false))
        .collect::<Vec<_>>();

    Ok(Json(json!({ "participants": participants })))
}

async fn list_shared_session_messages(
    Path(shared_session_id): Path<String>,
) -> store::HandlerResult<Json<Value>> {
    let mut shared_store = store::shared_session_store().write().await;
    shared_store.expire_sessions();
    shared_store
        .ensure_active_session(&shared_session_id)
        .map_err(store::into_http_error)?;

    let messages = shared_store
        .list_messages(&shared_session_id)
        .iter()
        .map(store::message_to_json)
        .collect::<Vec<_>>();

    Ok(Json(json!({ "messages": messages })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageRequest {
    participant_id: String,
    participant_token: String,
    text: String,
}

async fn send_shared_session_message(
    Path(shared_session_id): Path<String>,
    Json(body): Json<SendMessageRequest>,
) -> store::HandlerResult<Json<Value>> {
    let text = body.text.trim();
    if text.is_empty() {
        return Err(store::into_http_error(store::ApiErr::bad_request(
            "EMPTY_MESSAGE",
            "Message text cannot be empty.",
        )));
    }

    let mut shared_store = store::shared_session_store().write().await;
    shared_store.expire_sessions();
    let session = shared_store
        .ensure_active_session(&shared_session_id)
        .map_err(store::into_http_error)?
        .clone();
    let participant = shared_store
        .authenticate_participant(
            &shared_session_id,
            &body.participant_id,
            &body.participant_token,
        )
        .map_err(store::into_http_error)?
        .clone();

    if !store::can_comment(&session.mode, &participant.role) {
        return Err(store::into_http_error(store::ApiErr::forbidden(
            "COMMENT_NOT_ALLOWED",
            "Message sending is not allowed in current mode.",
        )));
    }

    let message = store::SharedSessionMessage {
        id: uuid::Uuid::new_v4().to_string(),
        shared_session_id: shared_session_id.clone(),
        participant_id: participant.id.clone(),
        author_user_id: participant.user_id.clone(),
        kind: "comment".to_string(),
        text: text.to_string(),
        created_at: Utc::now(),
        approval_id: None,
    };
    shared_store.append_message(message.clone());
    shared_store.emit_session_event(
        &shared_session_id,
        "message_created",
        json!({
            "message": store::message_to_json(&message),
            "participant": store::participant_to_json(&participant, false),
        }),
    );

    Ok(Json(json!({
        "message": store::message_to_json(&message),
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendPromptRequest {
    participant_id: String,
    participant_token: String,
    prompt: String,
}

async fn send_shared_session_prompt(
    State(state): State<AppState>,
    Path(shared_session_id): Path<String>,
    Json(body): Json<SendPromptRequest>,
) -> store::HandlerResult<Json<Value>> {
    let prompt = body.prompt.trim();
    if prompt.is_empty() {
        return Err(store::into_http_error(store::ApiErr::bad_request(
            "EMPTY_PROMPT",
            "Prompt cannot be empty.",
        )));
    }

    let (response_status, response_approval, dispatch) = {
        let mut shared_store = store::shared_session_store().write().await;
        shared_store.expire_sessions();

        let session = shared_store
            .ensure_active_session(&shared_session_id)
            .map_err(store::into_http_error)?
            .clone();
        let participant = shared_store
            .authenticate_participant(
                &shared_session_id,
                &body.participant_id,
                &body.participant_token,
            )
            .map_err(store::into_http_error)?
            .clone();

        if !store::can_prompt(&session.mode, &participant.role) {
            return Err(store::into_http_error(store::ApiErr::forbidden(
                "PROMPT_NOT_ALLOWED",
                "Prompt sending is not allowed in current mode.",
            )));
        }

        if session.mode == store::SharedSessionMode::PromptWithApproval
            && participant.role != store::SharedSessionRole::Host
        {
            let approval = store::SharedPromptApproval {
                id: uuid::Uuid::new_v4().to_string(),
                shared_session_id: shared_session_id.clone(),
                participant_id: participant.id.clone(),
                prompt: prompt.to_string(),
                status: store::SharedPromptStatus::Pending,
                created_at: Utc::now(),
                resolved_at: None,
                resolved_by_participant_id: None,
                error_message: None,
            };
            shared_store.append_approval(approval.clone());
            shared_store.append_message(store::SharedSessionMessage {
                id: uuid::Uuid::new_v4().to_string(),
                shared_session_id: shared_session_id.clone(),
                participant_id: participant.id.clone(),
                author_user_id: participant.user_id.clone(),
                kind: "prompt".to_string(),
                text: prompt.to_string(),
                created_at: Utc::now(),
                approval_id: Some(approval.id.clone()),
            });
            shared_store.emit_session_event(
                &shared_session_id,
                "prompt_pending_approval",
                json!({
                    "approval": store::approval_to_json(&approval),
                    "participant": store::participant_to_json(&participant, false),
                }),
            );
            (store::SharedPromptStatus::Pending, Some(approval), None)
        } else {
            let approval = store::SharedPromptApproval {
                id: uuid::Uuid::new_v4().to_string(),
                shared_session_id: shared_session_id.clone(),
                participant_id: participant.id.clone(),
                prompt: prompt.to_string(),
                status: store::SharedPromptStatus::Approved,
                created_at: Utc::now(),
                resolved_at: Some(Utc::now()),
                resolved_by_participant_id: Some(participant.id.clone()),
                error_message: None,
            };
            shared_store.append_approval(approval.clone());
            shared_store.emit_session_event(
                &shared_session_id,
                "prompt_approved",
                json!({
                    "approval": store::approval_to_json(&approval),
                    "participant": store::participant_to_json(&participant, false),
                }),
            );
            (
                store::SharedPromptStatus::Approved,
                Some(approval.clone()),
                Some(store::PromptDispatchRequest {
                    shared_session_id: shared_session_id.clone(),
                    host_session_id: session.host_session_id.clone(),
                    approval_id: approval.id.clone(),
                    prompt: approval.prompt.clone(),
                }),
            )
        }
    };

    if let Some(dispatch_request) = dispatch {
        tokio::spawn(store::dispatch_shared_prompt(
            state.clone(),
            dispatch_request,
        ));
    }

    Ok(Json(json!({
        "status": store::to_prompt_status_value(&response_status),
        "approval": response_approval.as_ref().map(store::approval_to_json),
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RespondApprovalRequest {
    participant_id: String,
    participant_token: String,
    action: String,
}

async fn respond_shared_prompt_approval(
    State(state): State<AppState>,
    Path((shared_session_id, approval_id)): Path<(String, String)>,
    Json(body): Json<RespondApprovalRequest>,
) -> store::HandlerResult<Json<Value>> {
    if body.action != "approve" && body.action != "reject" {
        return Err(store::into_http_error(store::ApiErr::bad_request(
            "INVALID_ACTION",
            "action must be approve or reject.",
        )));
    }

    let mut dispatch: Option<store::PromptDispatchRequest> = None;
    let approval: store::SharedPromptApproval;

    {
        let mut shared_store = store::shared_session_store().write().await;
        shared_store.expire_sessions();
        let session = shared_store
            .ensure_active_session(&shared_session_id)
            .map_err(store::into_http_error)?
            .clone();
        let host_participant = shared_store
            .authenticate_participant(
                &shared_session_id,
                &body.participant_id,
                &body.participant_token,
            )
            .map_err(store::into_http_error)?
            .clone();

        if host_participant.role != store::SharedSessionRole::Host {
            return Err(store::into_http_error(store::ApiErr::forbidden(
                "HOST_REQUIRED",
                "Only host can approve or reject prompts.",
            )));
        }

        let approval_snapshot = {
            let approval_entry = shared_store
                .approvals
                .get_mut(&approval_id)
                .ok_or_else(|| {
                    store::into_http_error(store::ApiErr::not_found(
                        "APPROVAL_NOT_FOUND",
                        "Approval request not found.",
                    ))
                })?;
            if approval_entry.shared_session_id != shared_session_id {
                return Err(store::into_http_error(store::ApiErr::not_found(
                    "APPROVAL_NOT_FOUND",
                    "Approval request not found.",
                )));
            }
            if approval_entry.status != store::SharedPromptStatus::Pending {
                return Err(store::into_http_error(store::ApiErr::conflict(
                    "APPROVAL_ALREADY_RESOLVED",
                    "Approval has already been resolved.",
                )));
            }
            approval_entry.resolved_at = Some(Utc::now());
            approval_entry.resolved_by_participant_id = Some(host_participant.id.clone());
            if body.action == "reject" {
                approval_entry.status = store::SharedPromptStatus::Rejected;
            } else {
                approval_entry.status = store::SharedPromptStatus::Approved;
            }
            approval_entry.clone()
        };

        if body.action == "reject" {
            shared_store.emit_session_event(
                &shared_session_id,
                "prompt_rejected",
                json!({
                    "approval": store::approval_to_json(&approval_snapshot),
                    "participant": store::participant_to_json(&host_participant, false),
                }),
            );
        } else {
            shared_store.emit_session_event(
                &shared_session_id,
                "prompt_approved",
                json!({
                    "approval": store::approval_to_json(&approval_snapshot),
                    "participant": store::participant_to_json(&host_participant, false),
                }),
            );
            dispatch = Some(store::PromptDispatchRequest {
                shared_session_id: shared_session_id.clone(),
                host_session_id: session.host_session_id.clone(),
                approval_id: approval_snapshot.id.clone(),
                prompt: approval_snapshot.prompt.clone(),
            });
        }

        approval = approval_snapshot;
    }

    if let Some(dispatch_request) = dispatch {
        tokio::spawn(store::dispatch_shared_prompt(
            state.clone(),
            dispatch_request,
        ));
    }

    Ok(Json(json!({
        "approval": store::approval_to_json(&approval),
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedSessionStreamQuery {
    participant_id: String,
    participant_token: String,
}

async fn shared_session_stream(
    Path(shared_session_id): Path<String>,
    Query(query): Query<SharedSessionStreamQuery>,
) -> store::HandlerResult<Sse<SharedSseStream>> {
    let mut shared_store = store::shared_session_store().write().await;
    shared_store.expire_sessions();
    shared_store
        .authenticate_participant(
            &shared_session_id,
            &query.participant_id,
            &query.participant_token,
        )
        .map_err(store::into_http_error)?;
    let mut rx = shared_store.subscribe(&shared_session_id).ok_or_else(|| {
        store::into_http_error(store::ApiErr::not_found(
            "SESSION_NOT_FOUND",
            "Shared session not found.",
        ))
    })?;
    drop(shared_store);

    let connected = json!({
        "type": "connected",
        "sharedSessionId": shared_session_id,
        "timestamp": Utc::now().to_rfc3339(),
    });
    let stream: SharedSseStream = Box::pin(async_stream::stream! {
        yield Ok(Event::default().data(connected.to_string()));
        let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
        loop {
            tokio::select! {
                msg = rx.recv() => {
                    match msg {
                        Ok(event) => yield Ok(Event::default().data(event.to_string())),
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(broadcast::error::RecvError::Closed) => break,
                    }
                }
                _ = heartbeat.tick() => yield Ok(Event::default().comment("heartbeat")),
            }
        }
    });

    Ok(Sse::new(stream))
}
