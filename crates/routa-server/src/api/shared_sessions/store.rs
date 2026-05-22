use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, OnceLock},
};

use axum::{http::StatusCode, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, RwLock};

use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SharedSessionRole {
    Host,
    Collaborator,
    Viewer,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SharedSessionMode {
    ViewOnly,
    CommentOnly,
    PromptWithApproval,
    PromptDirect,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SharedSessionStatus {
    Active,
    Closed,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SharedPromptStatus {
    Pending,
    Approved,
    Rejected,
    Failed,
}

#[derive(Debug, Clone)]
pub struct SharedSession {
    pub id: String,
    pub workspace_id: String,
    pub host_user_id: String,
    pub host_session_id: String,
    pub mode: SharedSessionMode,
    pub approval_required: bool,
    pub invite_token: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub status: SharedSessionStatus,
}

#[derive(Debug, Clone)]
pub struct SharedSessionParticipant {
    pub id: String,
    pub shared_session_id: String,
    pub user_id: String,
    pub display_name: Option<String>,
    pub role: SharedSessionRole,
    pub access_token: String,
    pub joined_at: DateTime<Utc>,
    pub left_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct SharedSessionMessage {
    pub id: String,
    pub shared_session_id: String,
    pub participant_id: String,
    pub author_user_id: String,
    pub kind: String,
    pub text: String,
    pub created_at: DateTime<Utc>,
    pub approval_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SharedPromptApproval {
    pub id: String,
    pub shared_session_id: String,
    pub participant_id: String,
    pub prompt: String,
    pub status: SharedPromptStatus,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub resolved_by_participant_id: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Default)]
pub struct SharedSessionStore {
    pub sessions: HashMap<String, SharedSession>,
    pub participants: HashMap<String, SharedSessionParticipant>,
    pub participants_by_session: HashMap<String, HashSet<String>>,
    pub approvals: HashMap<String, SharedPromptApproval>,
    pub approvals_by_session: HashMap<String, Vec<String>>,
    pub messages_by_session: HashMap<String, Vec<SharedSessionMessage>>,
    event_channels: HashMap<String, broadcast::Sender<Value>>,
}

impl SharedSessionStore {
    pub fn expire_sessions(&mut self) {
        let now = Utc::now();
        let expired_ids: Vec<String> = self
            .sessions
            .iter()
            .filter_map(|(id, session)| {
                if session.status != SharedSessionStatus::Active {
                    return None;
                }
                let expires_at = session.expires_at?;
                if expires_at <= now {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect();

        for shared_session_id in expired_ids {
            self.finalize_session(&shared_session_id, SharedSessionStatus::Expired);
        }
    }

    pub fn ensure_active_session(&self, shared_session_id: &str) -> Result<&SharedSession, ApiErr> {
        let session = self
            .sessions
            .get(shared_session_id)
            .ok_or_else(|| ApiErr::not_found("SESSION_NOT_FOUND", "Shared session not found."))?;

        if session.status != SharedSessionStatus::Active {
            return Err(ApiErr::conflict(
                "SESSION_INACTIVE",
                format!("Shared session is {:?}.", session.status),
            ));
        }
        Ok(session)
    }

    pub fn authenticate_participant(
        &self,
        shared_session_id: &str,
        participant_id: &str,
        participant_token: &str,
    ) -> Result<&SharedSessionParticipant, ApiErr> {
        let _ = self.ensure_active_session(shared_session_id)?;
        let participant = self
            .participants
            .get(participant_id)
            .ok_or_else(|| ApiErr::not_found("PARTICIPANT_NOT_FOUND", "Participant not found."))?;

        if participant.shared_session_id != shared_session_id {
            return Err(ApiErr::not_found(
                "PARTICIPANT_NOT_FOUND",
                "Participant not found.",
            ));
        }
        if participant.access_token != participant_token {
            return Err(ApiErr::forbidden(
                "INVALID_PARTICIPANT_TOKEN",
                "Participant token is invalid.",
            ));
        }
        if participant.left_at.is_some() {
            return Err(ApiErr::conflict(
                "PARTICIPANT_INACTIVE",
                "Participant has already left.",
            ));
        }
        Ok(participant)
    }

    pub fn insert_participant(&mut self, participant: SharedSessionParticipant) {
        self.participants
            .insert(participant.id.clone(), participant.clone());
        self.participants_by_session
            .entry(participant.shared_session_id.clone())
            .or_default()
            .insert(participant.id.clone());
    }

    pub fn append_approval(&mut self, approval: SharedPromptApproval) {
        self.approvals.insert(approval.id.clone(), approval.clone());
        self.approvals_by_session
            .entry(approval.shared_session_id.clone())
            .or_default()
            .push(approval.id.clone());
    }

    pub fn append_message(&mut self, message: SharedSessionMessage) {
        self.messages_by_session
            .entry(message.shared_session_id.clone())
            .or_default()
            .push(message);
    }

    pub fn list_participants(&self, shared_session_id: &str) -> Vec<SharedSessionParticipant> {
        let mut participants = Vec::new();
        if let Some(ids) = self.participants_by_session.get(shared_session_id) {
            for participant_id in ids {
                if let Some(participant) = self.participants.get(participant_id) {
                    participants.push(participant.clone());
                }
            }
        }
        participants
    }

    pub fn list_approvals(&self, shared_session_id: &str) -> Vec<SharedPromptApproval> {
        let mut approvals = Vec::new();
        if let Some(ids) = self.approvals_by_session.get(shared_session_id) {
            for approval_id in ids {
                if let Some(approval) = self.approvals.get(approval_id) {
                    approvals.push(approval.clone());
                }
            }
        }
        approvals.sort_by_key(|approval| std::cmp::Reverse(approval.created_at));
        approvals
    }

    pub fn list_messages(&self, shared_session_id: &str) -> Vec<SharedSessionMessage> {
        self.messages_by_session
            .get(shared_session_id)
            .cloned()
            .unwrap_or_default()
    }

    pub fn find_active_participant_by_user_id(
        &self,
        shared_session_id: &str,
        user_id: &str,
    ) -> Option<SharedSessionParticipant> {
        let ids = self.participants_by_session.get(shared_session_id)?;
        for participant_id in ids {
            let participant = self.participants.get(participant_id)?;
            if participant.user_id == user_id && participant.left_at.is_none() {
                return Some(participant.clone());
            }
        }
        None
    }

    pub fn finalize_session(&mut self, shared_session_id: &str, status: SharedSessionStatus) {
        let Some(session) = self.sessions.get_mut(shared_session_id) else {
            return;
        };
        if session.status != SharedSessionStatus::Active {
            return;
        }

        session.status = status.clone();
        if let Some(ids) = self.participants_by_session.get(shared_session_id) {
            let now = Utc::now();
            for participant_id in ids {
                if let Some(participant) = self.participants.get_mut(participant_id) {
                    if participant.left_at.is_none() {
                        participant.left_at = Some(now);
                    }
                }
            }
        }

        self.emit_session_event(
            shared_session_id,
            "session_closed",
            json!({ "status": to_status_value(&status) }),
        );
    }

    pub fn subscribe(&mut self, shared_session_id: &str) -> Option<broadcast::Receiver<Value>> {
        if !self.sessions.contains_key(shared_session_id) {
            return None;
        }
        let tx = self
            .event_channels
            .entry(shared_session_id.to_string())
            .or_insert_with(|| broadcast::channel::<Value>(256).0);
        Some(tx.subscribe())
    }

    pub fn emit_session_event(
        &mut self,
        shared_session_id: &str,
        event_type: &str,
        payload: Value,
    ) {
        let tx = self
            .event_channels
            .entry(shared_session_id.to_string())
            .or_insert_with(|| broadcast::channel::<Value>(256).0);
        let event = json!({
            "type": event_type,
            "sharedSessionId": shared_session_id,
            "timestamp": Utc::now().to_rfc3339(),
            "payload": payload,
        });
        let _ = tx.send(event);
    }
}

static SHARED_SESSION_STORE: OnceLock<Arc<RwLock<SharedSessionStore>>> = OnceLock::new();

pub fn shared_session_store() -> &'static Arc<RwLock<SharedSessionStore>> {
    SHARED_SESSION_STORE.get_or_init(|| Arc::new(RwLock::new(SharedSessionStore::default())))
}

#[derive(Debug)]
pub struct ApiErr {
    status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl ApiErr {
    pub fn bad_request(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code,
            message: message.into(),
        }
    }
    pub fn forbidden(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code,
            message: message.into(),
        }
    }
    pub fn not_found(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code,
            message: message.into(),
        }
    }
    pub fn conflict(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            code,
            message: message.into(),
        }
    }
}

pub type HandlerResult<T> = Result<T, (StatusCode, Json<Value>)>;

pub fn into_http_error(err: ApiErr) -> (StatusCode, Json<Value>) {
    (
        err.status,
        Json(json!({
            "error": err.message,
            "code": err.code,
        })),
    )
}

#[derive(Debug, Clone)]
pub struct PromptDispatchRequest {
    pub shared_session_id: String,
    pub host_session_id: String,
    pub approval_id: String,
    pub prompt: String,
}

pub fn spawn_host_notification_forwarder(
    shared_session_id: String,
    mut rx: broadcast::Receiver<Value>,
) {
    tokio::spawn(async move {
        while let Ok(notification) = rx.recv().await {
            let mut store = shared_session_store().write().await;
            store.expire_sessions();
            let Some(session) = store.sessions.get(&shared_session_id) else {
                break;
            };
            if session.status != SharedSessionStatus::Active {
                break;
            }
            store.emit_session_event(
                &shared_session_id,
                "host_session_update",
                json!({ "notification": notification }),
            );
        }
    });
}

pub async fn dispatch_shared_prompt(state: AppState, req: PromptDispatchRequest) {
    {
        let mut store = shared_session_store().write().await;
        store.emit_session_event(
            &req.shared_session_id,
            "prompt_dispatch_started",
            json!({ "approvalId": req.approval_id }),
        );
    }

    let result = state
        .acp_manager
        .prompt(&req.host_session_id, &req.prompt)
        .await
        .map(|_| ());
    let dispatch_error = result.as_ref().err().cloned();

    if result.is_ok() {
        let _ = state
            .acp_session_store
            .set_first_prompt_sent(&req.host_session_id)
            .await;
        if let Some(history) = state
            .acp_manager
            .get_session_history(&req.host_session_id)
            .await
        {
            let _ = state
                .acp_session_store
                .save_history(&req.host_session_id, &history)
                .await;
        }
    }

    let mut store = shared_session_store().write().await;
    if let Some(approval) = store.approvals.get_mut(&req.approval_id) {
        if let Some(err) = &dispatch_error {
            if approval.status == SharedPromptStatus::Approved {
                approval.status = SharedPromptStatus::Failed;
                approval.error_message = Some(err.clone());
            }
        }
    }

    if dispatch_error.is_none() {
        store.emit_session_event(
            &req.shared_session_id,
            "prompt_dispatch_completed",
            json!({ "approvalId": req.approval_id }),
        );
    } else if let Some(err) = dispatch_error {
        store.emit_session_event(
            &req.shared_session_id,
            "prompt_dispatch_failed",
            json!({
                "approvalId": req.approval_id,
                "error": err,
            }),
        );
    }
}

pub fn can_comment(mode: &SharedSessionMode, role: &SharedSessionRole) -> bool {
    if role == &SharedSessionRole::Host {
        return true;
    }
    if role == &SharedSessionRole::Viewer {
        return false;
    }
    mode != &SharedSessionMode::ViewOnly
}

pub fn can_prompt(mode: &SharedSessionMode, role: &SharedSessionRole) -> bool {
    if role == &SharedSessionRole::Viewer {
        return false;
    }
    matches!(
        mode,
        SharedSessionMode::PromptDirect | SharedSessionMode::PromptWithApproval
    ) || role == &SharedSessionRole::Host
}

pub fn to_status_value(status: &SharedSessionStatus) -> &'static str {
    match status {
        SharedSessionStatus::Active => "active",
        SharedSessionStatus::Closed => "closed",
        SharedSessionStatus::Expired => "expired",
    }
}

pub fn to_mode_value(mode: &SharedSessionMode) -> &'static str {
    match mode {
        SharedSessionMode::ViewOnly => "view_only",
        SharedSessionMode::CommentOnly => "comment_only",
        SharedSessionMode::PromptWithApproval => "prompt_with_approval",
        SharedSessionMode::PromptDirect => "prompt_direct",
    }
}

pub fn to_role_value(role: &SharedSessionRole) -> &'static str {
    match role {
        SharedSessionRole::Host => "host",
        SharedSessionRole::Collaborator => "collaborator",
        SharedSessionRole::Viewer => "viewer",
    }
}

pub fn to_prompt_status_value(status: &SharedPromptStatus) -> &'static str {
    match status {
        SharedPromptStatus::Pending => "pending",
        SharedPromptStatus::Approved => "approved",
        SharedPromptStatus::Rejected => "rejected",
        SharedPromptStatus::Failed => "failed",
    }
}

pub fn session_to_json(session: &SharedSession, include_invite_token: bool) -> Value {
    json!({
        "id": session.id,
        "workspaceId": session.workspace_id,
        "hostUserId": session.host_user_id,
        "hostSessionId": session.host_session_id,
        "mode": to_mode_value(&session.mode),
        "approvalRequired": session.approval_required,
        "inviteToken": if include_invite_token {
            Value::String(session.invite_token.clone())
        } else {
            Value::Null
        },
        "createdAt": session.created_at.to_rfc3339(),
        "expiresAt": session.expires_at.map(|v| v.to_rfc3339()),
        "status": to_status_value(&session.status),
    })
}

pub fn participant_to_json(participant: &SharedSessionParticipant, include_token: bool) -> Value {
    json!({
        "id": participant.id,
        "sharedSessionId": participant.shared_session_id,
        "userId": participant.user_id,
        "displayName": participant.display_name,
        "role": to_role_value(&participant.role),
        "joinedAt": participant.joined_at.to_rfc3339(),
        "leftAt": participant.left_at.map(|v| v.to_rfc3339()),
        "accessToken": if include_token {
            Value::String(participant.access_token.clone())
        } else {
            Value::Null
        },
    })
}

pub fn message_to_json(message: &SharedSessionMessage) -> Value {
    json!({
        "id": message.id,
        "sharedSessionId": message.shared_session_id,
        "participantId": message.participant_id,
        "authorUserId": message.author_user_id,
        "kind": message.kind,
        "text": message.text,
        "createdAt": message.created_at.to_rfc3339(),
        "approvalId": message.approval_id,
    })
}

pub fn approval_to_json(approval: &SharedPromptApproval) -> Value {
    json!({
        "id": approval.id,
        "sharedSessionId": approval.shared_session_id,
        "participantId": approval.participant_id,
        "prompt": approval.prompt,
        "status": to_prompt_status_value(&approval.status),
        "createdAt": approval.created_at.to_rfc3339(),
        "resolvedAt": approval.resolved_at.map(|v| v.to_rfc3339()),
        "resolvedByParticipantId": approval.resolved_by_participant_id,
        "errorMessage": approval.error_message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_matrix_is_correct() {
        assert!(!can_comment(
            &SharedSessionMode::ViewOnly,
            &SharedSessionRole::Collaborator
        ));
        assert!(can_comment(
            &SharedSessionMode::CommentOnly,
            &SharedSessionRole::Collaborator
        ));
        assert!(!can_prompt(
            &SharedSessionMode::CommentOnly,
            &SharedSessionRole::Collaborator
        ));
        assert!(can_prompt(
            &SharedSessionMode::PromptWithApproval,
            &SharedSessionRole::Collaborator
        ));
    }

    #[test]
    fn expire_session_marks_status_and_emits_close_event() {
        let mut store = SharedSessionStore::default();
        let shared_session_id = "s1".to_string();
        store.sessions.insert(
            shared_session_id.clone(),
            SharedSession {
                id: shared_session_id.clone(),
                workspace_id: "default".to_string(),
                host_user_id: "host".to_string(),
                host_session_id: "acp-1".to_string(),
                mode: SharedSessionMode::PromptWithApproval,
                approval_required: true,
                invite_token: "token".to_string(),
                created_at: Utc::now(),
                expires_at: Some(Utc::now() - chrono::Duration::minutes(1)),
                status: SharedSessionStatus::Active,
            },
        );

        let mut rx = store.subscribe(&shared_session_id).expect("receiver");
        store.expire_sessions();

        let session = store
            .sessions
            .get(&shared_session_id)
            .expect("session exists");
        assert_eq!(session.status, SharedSessionStatus::Expired);
        let evt = rx.try_recv().expect("event exists");
        assert_eq!(evt["type"].as_str(), Some("session_closed"));
    }

    #[test]
    fn auth_rejects_wrong_participant_token() {
        let mut store = SharedSessionStore::default();
        let session = SharedSession {
            id: "s1".to_string(),
            workspace_id: "default".to_string(),
            host_user_id: "host".to_string(),
            host_session_id: "host-sid".to_string(),
            mode: SharedSessionMode::PromptWithApproval,
            approval_required: true,
            invite_token: "invite".to_string(),
            created_at: Utc::now(),
            expires_at: None,
            status: SharedSessionStatus::Active,
        };
        store.sessions.insert(session.id.clone(), session);
        store.insert_participant(SharedSessionParticipant {
            id: "p1".to_string(),
            shared_session_id: "s1".to_string(),
            user_id: "guest".to_string(),
            display_name: None,
            role: SharedSessionRole::Collaborator,
            access_token: "good-token".to_string(),
            joined_at: Utc::now(),
            left_at: None,
        });

        let err = store
            .authenticate_participant("s1", "p1", "bad-token")
            .expect_err("should fail");
        assert_eq!(err.code, "INVALID_PARTICIPANT_TOKEN");
        assert_eq!(err.status, StatusCode::FORBIDDEN);
    }
}
