use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::{json, Value};

use crate::error::ServerError;
use crate::state::AppState;
use routa_core::acp::AcpSessionRecord;
use routa_core::store::acp_session_store::AcpSessionRow;

#[derive(Clone)]
pub struct SessionApplicationService {
    state: AppState,
}

impl SessionApplicationService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn list_sessions(&self, query: ListSessionsQuery) -> Vec<Value> {
        let in_memory_sessions = self.state.acp_manager.list_sessions().await;
        let db_sessions = self
            .state
            .acp_session_store
            .list(query.workspace_id.as_deref(), query.limit)
            .await
            .unwrap_or_default();

        merge_session_entries(in_memory_sessions, db_sessions, &query)
            .into_iter()
            .map(|entry| entry.to_list_value())
            .collect()
    }

    pub async fn get_session(&self, session_id: &str) -> Result<Value, ServerError> {
        let db_session = self.state.acp_session_store.get(session_id).await?;

        if let Some(session) = self.state.acp_manager.get_session(session_id).await {
            let entry = SessionEntry::from_in_memory(session);
            let entry = match db_session.as_ref() {
                Some(db_session) => entry.merge_db_state(db_session),
                None => entry,
            };
            return Ok(entry.to_detail_value());
        }

        let db_session =
            db_session.ok_or_else(|| ServerError::NotFound("Session not found".to_string()))?;

        Ok(SessionEntry::from_db(db_session).to_detail_value())
    }

    pub async fn get_session_history(
        &self,
        session_id: &str,
        consolidated: bool,
    ) -> Result<Vec<Value>, ServerError> {
        let mut history = self
            .state
            .acp_manager
            .get_session_history(session_id)
            .await
            .unwrap_or_default();

        if history.is_empty() {
            history = self
                .state
                .acp_session_store
                .get_history(session_id)
                .await
                .unwrap_or_default();

            if !history.is_empty() {
                for notification in &history {
                    self.state
                        .acp_manager
                        .push_to_history(session_id, notification.clone())
                        .await;
                }
            }
        }

        if consolidated {
            Ok(consolidate_message_history(history))
        } else {
            Ok(history)
        }
    }

    pub async fn get_session_context(
        &self,
        session_id: &str,
    ) -> Result<SessionContext, ServerError> {
        let in_memory_sessions = self.state.acp_manager.list_sessions().await;
        let db_sessions = self
            .state
            .acp_session_store
            .list(None, Some(500))
            .await
            .unwrap_or_default();

        build_session_context(
            merge_session_entries(
                in_memory_sessions,
                db_sessions,
                &ListSessionsQuery::default(),
            ),
            session_id,
        )
    }
}

#[derive(Debug, Default)]
pub struct ListSessionsQuery {
    pub workspace_id: Option<String>,
    pub parent_session_id: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionContext {
    pub current: Value,
    pub parent: Option<Value>,
    pub children: Vec<Value>,
    pub siblings: Vec<Value>,
    pub recent_in_workspace: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq)]
struct SessionEntry {
    session_id: String,
    name: Option<String>,
    cwd: String,
    branch: Option<String>,
    workspace_id: String,
    routa_agent_id: Option<String>,
    provider: Option<String>,
    role: Option<String>,
    mode_id: Option<String>,
    model: Option<String>,
    specialist_id: Option<String>,
    created_at: Value,
    updated_at: Option<Value>,
    parent_session_id: Option<String>,
    first_prompt_sent: bool,
}

impl SessionEntry {
    fn from_in_memory(session: AcpSessionRecord) -> Self {
        Self {
            session_id: session.session_id,
            name: session.name,
            cwd: session.cwd,
            branch: None,
            workspace_id: session.workspace_id,
            routa_agent_id: session.routa_agent_id,
            provider: session.provider,
            role: session.role,
            mode_id: session.mode_id,
            model: session.model,
            specialist_id: session.specialist_id,
            created_at: Value::String(session.created_at),
            updated_at: None,
            parent_session_id: session.parent_session_id,
            first_prompt_sent: session.first_prompt_sent,
        }
    }

    fn from_db(session: AcpSessionRow) -> Self {
        Self {
            session_id: session.id,
            name: session.name,
            cwd: session.cwd,
            branch: session.branch,
            workspace_id: session.workspace_id,
            routa_agent_id: session.routa_agent_id,
            provider: session.provider,
            role: session.role,
            mode_id: session.mode_id,
            model: None,
            specialist_id: None,
            created_at: Value::Number(session.created_at.into()),
            updated_at: Some(Value::Number(session.updated_at.into())),
            parent_session_id: session.parent_session_id,
            first_prompt_sent: session.first_prompt_sent,
        }
    }

    fn merge_db_state(mut self, db: &AcpSessionRow) -> Self {
        if self.name.is_none() {
            self.name = db.name.clone();
        }
        if self.provider.is_none() {
            self.provider = db.provider.clone();
        }
        if self.branch.is_none() {
            self.branch = db.branch.clone();
        }
        if self.role.is_none() {
            self.role = db.role.clone();
        }
        if self.mode_id.is_none() {
            self.mode_id = db.mode_id.clone();
        }
        if self.parent_session_id.is_none() {
            self.parent_session_id = db.parent_session_id.clone();
        }
        if self.routa_agent_id.is_none() {
            self.routa_agent_id = db.routa_agent_id.clone();
        }
        self.first_prompt_sent = self.first_prompt_sent || db.first_prompt_sent;
        self.updated_at = Some(Value::Number(db.updated_at.into()));
        self
    }

    fn timestamp_millis(&self) -> i64 {
        value_to_timestamp_millis(&self.created_at)
    }

    fn is_non_empty(&self) -> bool {
        self.first_prompt_sent
    }

    fn to_list_value(&self) -> Value {
        json!({
            "sessionId": self.session_id,
            "name": self.name,
            "cwd": self.cwd,
            "branch": self.branch,
            "workspaceId": self.workspace_id,
            "routaAgentId": self.routa_agent_id,
            "provider": self.provider,
            "role": self.role,
            "modeId": self.mode_id,
            "model": self.model,
            "specialistId": self.specialist_id,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "firstPromptSent": self.first_prompt_sent,
            "parentSessionId": self.parent_session_id,
        })
    }

    fn to_detail_value(&self) -> Value {
        json!({
            "sessionId": self.session_id,
            "name": self.name,
            "cwd": self.cwd,
            "branch": self.branch,
            "workspaceId": self.workspace_id,
            "routaAgentId": self.routa_agent_id,
            "provider": self.provider,
            "role": self.role,
            "modeId": self.mode_id,
            "model": self.model,
            "specialistId": self.specialist_id,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "parentSessionId": self.parent_session_id,
            "firstPromptSent": self.first_prompt_sent,
        })
    }

    fn to_context_value(&self) -> Value {
        json!({
            "sessionId": self.session_id,
            "name": self.name,
            "cwd": self.cwd,
            "branch": self.branch,
            "workspaceId": self.workspace_id,
            "routaAgentId": self.routa_agent_id,
            "provider": self.provider,
            "role": self.role,
            "modeId": self.mode_id,
            "model": self.model,
            "specialistId": self.specialist_id,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "parentSessionId": self.parent_session_id,
            "firstPromptSent": self.first_prompt_sent,
        })
    }
}

fn merge_session_entries(
    in_memory_sessions: Vec<AcpSessionRecord>,
    db_sessions: Vec<AcpSessionRow>,
    query: &ListSessionsQuery,
) -> Vec<SessionEntry> {
    let db_sessions_by_id: HashMap<String, AcpSessionRow> = db_sessions
        .iter()
        .cloned()
        .map(|session| (session.id.clone(), session))
        .collect();

    let mut sessions: Vec<SessionEntry> = in_memory_sessions
        .into_iter()
        .filter(|session| {
            session_matches_query(
                &session.workspace_id,
                session.parent_session_id.as_deref(),
                query,
            )
        })
        .map(|session| {
            let session_id = session.session_id.clone();
            let entry = SessionEntry::from_in_memory(session);
            match db_sessions_by_id.get(&session_id) {
                Some(db_session) => entry.merge_db_state(db_session),
                None => entry,
            }
        })
        .collect();

    let in_memory_ids: HashSet<String> = sessions
        .iter()
        .map(|session| session.session_id.clone())
        .collect();

    for db_session in db_sessions {
        if in_memory_ids.contains(&db_session.id) {
            continue;
        }
        if !session_matches_query(
            &db_session.workspace_id,
            db_session.parent_session_id.as_deref(),
            query,
        ) {
            continue;
        }
        sessions.push(SessionEntry::from_db(db_session));
    }

    sessions.sort_by_key(|entry| Reverse(entry.timestamp_millis()));
    if let Some(limit) = query.limit {
        sessions.truncate(limit);
    }
    sessions
}

fn session_matches_query(
    workspace_id: &str,
    parent_session_id: Option<&str>,
    query: &ListSessionsQuery,
) -> bool {
    if let Some(ref expected_workspace) = query.workspace_id {
        if workspace_id != expected_workspace {
            return false;
        }
    }
    if let Some(ref expected_parent) = query.parent_session_id {
        if parent_session_id != Some(expected_parent.as_str()) {
            return false;
        }
    }
    true
}

fn build_session_context(
    all_sessions: Vec<SessionEntry>,
    session_id: &str,
) -> Result<SessionContext, ServerError> {
    let current = all_sessions
        .iter()
        .find(|session| session.session_id == session_id)
        .cloned()
        .ok_or_else(|| ServerError::NotFound("Session not found".to_string()))?;

    let parent = current.parent_session_id.as_ref().and_then(|parent_id| {
        all_sessions
            .iter()
            .find(|session| session.session_id == *parent_id)
            .map(SessionEntry::to_context_value)
    });

    let children: Vec<Value> = all_sessions
        .iter()
        .filter(|session| {
            session.parent_session_id.as_deref() == Some(session_id) && session.is_non_empty()
        })
        .map(SessionEntry::to_context_value)
        .collect();

    let siblings: Vec<Value> = match current.parent_session_id.as_ref() {
        Some(parent_id) => all_sessions
            .iter()
            .filter(|session| {
                session.parent_session_id.as_deref() == Some(parent_id.as_str())
                    && session.session_id != session_id
                    && session.is_non_empty()
            })
            .map(SessionEntry::to_context_value)
            .collect(),
        None => Vec::new(),
    };

    let mut excluded_ids: HashSet<String> = HashSet::from([session_id.to_string()]);
    if let Some(parent_id) = current.parent_session_id.as_ref() {
        excluded_ids.insert(parent_id.clone());
    }
    excluded_ids.extend(children.iter().filter_map(session_id_from_value));
    excluded_ids.extend(siblings.iter().filter_map(session_id_from_value));

    let mut recent_in_workspace: Vec<SessionEntry> = all_sessions
        .into_iter()
        .filter(|session| {
            session.workspace_id == current.workspace_id
                && !excluded_ids.contains(&session.session_id)
                && session.is_non_empty()
        })
        .collect();
    recent_in_workspace.sort_by_key(|entry| Reverse(entry.timestamp_millis()));
    recent_in_workspace.truncate(5);

    Ok(SessionContext {
        current: current.to_context_value(),
        parent,
        children,
        siblings,
        recent_in_workspace: recent_in_workspace
            .into_iter()
            .map(|session| session.to_context_value())
            .collect(),
    })
}

fn session_id_from_value(value: &Value) -> Option<String> {
    value
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn value_to_timestamp_millis(value: &Value) -> i64 {
    value
        .as_i64()
        .or_else(|| {
            value.as_str().and_then(|raw| {
                chrono::DateTime::parse_from_rfc3339(raw)
                    .ok()
                    .map(|timestamp| timestamp.timestamp_millis())
            })
        })
        .unwrap_or(0)
}

pub fn consolidate_message_history(notifications: Vec<Value>) -> Vec<Value> {
    if notifications.is_empty() {
        return Vec::new();
    }

    let mut result = Vec::new();
    let mut current_chunks = Vec::new();
    let mut current_session_id: Option<String> = None;

    let flush_chunks =
        |result: &mut Vec<Value>, chunks: &mut Vec<String>, session_id: &Option<String>| {
            if !chunks.is_empty() {
                if let Some(session_id) = session_id {
                    result.push(json!({
                        "sessionId": session_id,
                        "update": {
                            "sessionUpdate": "agent_message",
                            "content": { "type": "text", "text": chunks.join("") }
                        }
                    }));
                }
                chunks.clear();
            }
        };

    for notification in notifications {
        let session_id = notification
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let session_update = notification
            .get("update")
            .and_then(|update| update.get("sessionUpdate"))
            .and_then(Value::as_str);

        if session_update == Some("agent_message_chunk") {
            let text = notification
                .get("update")
                .and_then(|update| update.get("content"))
                .and_then(|content| content.get("text"))
                .and_then(Value::as_str);
            if let Some(text) = text {
                if current_session_id != session_id {
                    flush_chunks(&mut result, &mut current_chunks, &current_session_id);
                    current_session_id = session_id;
                }
                current_chunks.push(text.to_string());
            }
            continue;
        }

        flush_chunks(&mut result, &mut current_chunks, &current_session_id);
        current_session_id = session_id;
        result.push(notification);
    }

    flush_chunks(&mut result, &mut current_chunks, &current_session_id);
    result
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::{
        build_session_context, consolidate_message_history, merge_session_entries,
        ListSessionsQuery, SessionApplicationService,
    };
    use crate::create_app_state;
    use routa_core::acp::AcpSessionRecord;
    use routa_core::store::acp_session_store::{AcpSessionRow, CreateAcpSessionParams};
    use serde_json::{json, Value};

    fn random_db_path() -> PathBuf {
        std::env::temp_dir().join(format!("routa-session-service-{}.db", uuid::Uuid::new_v4()))
    }

    fn in_memory_session(
        session_id: &str,
        workspace_id: &str,
        created_at: &str,
        parent_session_id: Option<&str>,
    ) -> AcpSessionRecord {
        AcpSessionRecord {
            session_id: session_id.to_string(),
            name: Some(format!("mem-{session_id}")),
            cwd: "/tmp".to_string(),
            workspace_id: workspace_id.to_string(),
            routa_agent_id: Some(format!("agent-{session_id}")),
            provider: Some("claude".to_string()),
            role: Some("CRAFTER".to_string()),
            mode_id: Some("default".to_string()),
            model: Some("sonnet".to_string()),
            created_at: created_at.to_string(),
            first_prompt_sent: false,
            parent_session_id: parent_session_id.map(str::to_string),
            specialist_id: None,
            specialist_system_prompt: None,
        }
    }

    fn db_session(
        session_id: &str,
        workspace_id: &str,
        created_at: i64,
        parent_session_id: Option<&str>,
        first_prompt_sent: bool,
    ) -> AcpSessionRow {
        AcpSessionRow {
            id: session_id.to_string(),
            name: Some(format!("db-{session_id}")),
            cwd: "/tmp".to_string(),
            branch: Some("main".to_string()),
            workspace_id: workspace_id.to_string(),
            routa_agent_id: Some(format!("agent-{session_id}")),
            provider: Some("codex".to_string()),
            role: Some("CRAFTER".to_string()),
            mode_id: Some("default".to_string()),
            custom_command: None,
            custom_args: Vec::new(),
            first_prompt_sent,
            message_history: Vec::new(),
            created_at,
            updated_at: created_at,
            parent_session_id: parent_session_id.map(str::to_string),
        }
    }

    async fn setup_service() -> (SessionApplicationService, PathBuf) {
        let db_path = random_db_path();
        let state = create_app_state(db_path.to_string_lossy().as_ref())
            .await
            .expect("create app state");
        (SessionApplicationService::new(state), db_path)
    }

    #[test]
    fn merge_session_entries_prefers_in_memory_and_applies_filters() {
        let sessions = merge_session_entries(
            vec![
                in_memory_session("session-1", "ws-1", "2026-03-19T10:00:00Z", None),
                in_memory_session(
                    "session-2",
                    "ws-1",
                    "2026-03-19T11:00:00Z",
                    Some("parent-1"),
                ),
            ],
            vec![
                db_session("session-1", "ws-1", 5, None, true),
                db_session("session-3", "ws-2", 6, None, true),
                db_session("session-4", "ws-1", 7, Some("parent-1"), true),
            ],
            &ListSessionsQuery {
                workspace_id: Some("ws-1".to_string()),
                parent_session_id: Some("parent-1".to_string()),
                limit: None,
            },
        );

        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].session_id, "session-2");
        assert_eq!(sessions[1].session_id, "session-4");
    }

    #[test]
    fn merge_session_entries_enriches_in_memory_with_db_state() {
        let sessions = merge_session_entries(
            vec![in_memory_session(
                "session-1",
                "ws-1",
                "2026-03-19T10:00:00Z",
                None,
            )],
            vec![db_session("session-1", "ws-1", 5, None, true)],
            &ListSessionsQuery::default(),
        );

        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].first_prompt_sent);
        assert_eq!(sessions[0].updated_at, Some(Value::Number(5.into())));
    }

    #[test]
    fn merge_session_entries_keeps_live_prompt_state_when_db_lags() {
        let mut live = in_memory_session("session-1", "ws-1", "2026-03-19T10:00:00Z", None);
        live.first_prompt_sent = true;

        let sessions = merge_session_entries(
            vec![live],
            vec![db_session("session-1", "ws-1", 5, None, false)],
            &ListSessionsQuery::default(),
        );

        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].first_prompt_sent);
    }

    #[test]
    fn build_session_context_excludes_empty_relatives_and_limits_recent() {
        let context = build_session_context(
            merge_session_entries(
                vec![
                    in_memory_session("current", "ws-1", "2026-03-19T10:00:00Z", Some("parent")),
                    in_memory_session("sibling", "ws-1", "2026-03-19T09:00:00Z", Some("parent")),
                ],
                vec![
                    db_session("current", "ws-1", 11, Some("parent"), true),
                    db_session("sibling", "ws-1", 4, Some("parent"), true),
                    db_session("parent", "ws-1", 1, None, true),
                    db_session("child", "ws-1", 2, Some("current"), true),
                    db_session("empty-child", "ws-1", 3, Some("current"), false),
                    db_session("recent-1", "ws-1", 10, None, true),
                    db_session("recent-2", "ws-1", 9, None, true),
                    db_session("recent-3", "ws-1", 8, None, true),
                    db_session("recent-4", "ws-1", 7, None, true),
                    db_session("recent-5", "ws-1", 6, None, true),
                    db_session("recent-6", "ws-1", 5, None, true),
                ],
                &ListSessionsQuery::default(),
            ),
            "current",
        )
        .expect("build context");

        assert_eq!(context.children.len(), 1);
        assert_eq!(context.siblings.len(), 1);
        assert_eq!(context.recent_in_workspace.len(), 5);
        assert_eq!(context.children[0]["sessionId"].as_str(), Some("child"));
        assert_eq!(
            context.recent_in_workspace[0]["sessionId"].as_str(),
            Some("recent-1")
        );
    }

    #[tokio::test]
    async fn get_session_history_falls_back_to_db_and_caches_in_memory() {
        let (service, db_path) = setup_service().await;
        let session_id = "db-history-session";
        let history = vec![json!({
            "sessionId": session_id,
            "update": { "sessionUpdate": "agent_message_chunk", "content": { "text": "hello" } }
        })];

        service
            .state
            .acp_session_store
            .create(CreateAcpSessionParams {
                id: session_id,
                cwd: "/tmp",
                branch: Some("main"),
                workspace_id: "default",
                provider: Some("claude"),
                role: Some("CRAFTER"),
                custom_command: None,
                custom_args: None,
                parent_session_id: None,
            })
            .await
            .expect("create session");
        service
            .state
            .acp_session_store
            .save_history(session_id, &history)
            .await
            .expect("save history");

        let loaded = service
            .get_session_history(session_id, false)
            .await
            .expect("load history");

        assert_eq!(loaded, history);
        let cached = service
            .state
            .acp_manager
            .get_session_history(session_id)
            .await
            .expect("cached history");
        assert_eq!(cached, history);

        let _ = fs::remove_file(db_path);
    }

    #[test]
    fn consolidate_message_history_merges_chunks_for_same_session() {
        let notifications = vec![
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"Hel"}}}),
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"lo"}}}),
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_done","content": {"text":"!"}}}),
        ];

        let merged = consolidate_message_history(notifications);

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0]["sessionId"].as_str(), Some("s1"));
        assert_eq!(
            merged[0]["update"]["sessionUpdate"].as_str(),
            Some("agent_message")
        );
        assert_eq!(
            merged[0]["update"]["content"]["text"].as_str(),
            Some("Hello")
        );
    }

    #[test]
    fn consolidate_message_history_handles_session_switches() {
        let notifications = vec![
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"A"}}}),
            json!({"sessionId":"s2","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"B"}}}),
            json!({"sessionId":"s1","update": {"sessionUpdate":"agent_message_chunk","content": {"text":"C"}}}),
        ];

        let merged = consolidate_message_history(notifications);

        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0]["update"]["content"]["text"].as_str(), Some("A"));
        assert_eq!(merged[1]["update"]["content"]["text"].as_str(), Some("B"));
        assert_eq!(merged[2]["update"]["content"]["text"].as_str(), Some("C"));
    }

    #[test]
    fn list_sessions_serializes_expected_shape() {
        let sessions = merge_session_entries(
            vec![in_memory_session(
                "session-1",
                "ws-1",
                "2026-03-19T10:00:00Z",
                None,
            )],
            Vec::new(),
            &ListSessionsQuery::default(),
        );

        let value = sessions[0].to_list_value();
        assert_eq!(value["sessionId"].as_str(), Some("session-1"));
        assert_eq!(value["workspaceId"].as_str(), Some("ws-1"));
        assert_eq!(value["model"].as_str(), Some("sonnet"));
        assert_eq!(
            value["createdAt"],
            Value::String("2026-03-19T10:00:00Z".to_string())
        );
        assert_eq!(value["firstPromptSent"], Value::Bool(false));
    }
}
