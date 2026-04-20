use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::ServerError;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct KanbanDevSessionSupervision {
    pub(super) mode: String,
    pub(super) inactivity_timeout_minutes: u32,
    pub(super) max_recovery_attempts: u32,
    pub(super) completion_requirement: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KanbanQueueCard {
    card_id: String,
    card_title: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KanbanBoardQueueSnapshot {
    board_id: String,
    running_count: usize,
    running_cards: Vec<KanbanQueueCard>,
    queued_count: usize,
    queued_card_ids: Vec<String>,
    queued_cards: Vec<KanbanQueueCard>,
    queued_positions: HashMap<String, usize>,
}

pub(super) fn get_session_concurrency_limit(
    metadata: &HashMap<String, String>,
    board_id: &str,
) -> u32 {
    let key = format!("kanbanSessionConcurrencyLimit:{board_id}");
    metadata
        .get(&key)
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|&value| value >= 1)
        .unwrap_or(1)
}

pub(super) fn get_auto_provider(
    metadata: &HashMap<String, String>,
    board_id: &str,
) -> Option<String> {
    let key = format!("kanbanAutoProvider:{board_id}");
    metadata
        .get(&key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn default_dev_session_supervision() -> KanbanDevSessionSupervision {
    KanbanDevSessionSupervision {
        mode: "watchdog_retry".to_string(),
        inactivity_timeout_minutes: 10,
        max_recovery_attempts: 1,
        completion_requirement: "turn_complete".to_string(),
    }
}

fn dev_supervision_metadata_key(board_id: &str) -> String {
    format!("kanbanDevSessionSupervision:{board_id}")
}

pub(super) fn normalize_dev_session_supervision(
    value: PartialKanbanDevSessionSupervision,
) -> KanbanDevSessionSupervision {
    let defaults = default_dev_session_supervision();
    let mode = match value.mode.as_deref() {
        Some("disabled" | "watchdog_retry" | "ralph_loop") => value.mode.unwrap_or(defaults.mode),
        _ => defaults.mode,
    };
    let inactivity_timeout_minutes = value
        .inactivity_timeout_minutes
        .unwrap_or(defaults.inactivity_timeout_minutes)
        .clamp(1, 120);
    let max_recovery_attempts = value
        .max_recovery_attempts
        .unwrap_or(defaults.max_recovery_attempts)
        .clamp(0, 10);
    let completion_requirement = match value.completion_requirement.as_deref() {
        Some("turn_complete" | "completion_summary" | "verification_report") => value
            .completion_requirement
            .unwrap_or(defaults.completion_requirement),
        _ => defaults.completion_requirement,
    };

    KanbanDevSessionSupervision {
        mode,
        inactivity_timeout_minutes,
        max_recovery_attempts,
        completion_requirement,
    }
}

pub(super) fn get_dev_session_supervision(
    metadata: &HashMap<String, String>,
    board_id: &str,
) -> KanbanDevSessionSupervision {
    let Some(raw) = metadata.get(&dev_supervision_metadata_key(board_id)) else {
        return default_dev_session_supervision();
    };

    serde_json::from_str::<PartialKanbanDevSessionSupervision>(raw)
        .map(normalize_dev_session_supervision)
        .unwrap_or_else(|_| default_dev_session_supervision())
}

pub(super) fn set_dev_session_supervision(
    metadata: &HashMap<String, String>,
    board_id: &str,
    value: PartialKanbanDevSessionSupervision,
) -> HashMap<String, String> {
    let mut next = metadata.clone();
    let normalized = normalize_dev_session_supervision(value);
    next.insert(
        dev_supervision_metadata_key(board_id),
        serde_json::to_string(&normalized).unwrap_or_default(),
    );
    next
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PartialKanbanDevSessionSupervision {
    pub(super) mode: Option<String>,
    pub(super) inactivity_timeout_minutes: Option<u32>,
    pub(super) max_recovery_attempts: Option<u32>,
    pub(super) completion_requirement: Option<String>,
}

async fn build_board_queue_snapshot(
    state: &AppState,
    workspace_id: &str,
    board_id: &str,
) -> Result<KanbanBoardQueueSnapshot, ServerError> {
    let tasks = state.task_store.list_by_workspace(workspace_id).await?;
    let running_cards = tasks
        .into_iter()
        .filter(|task| task.board_id.as_deref() == Some(board_id))
        .filter(super::task_has_running_lane_session)
        .map(|task| KanbanQueueCard {
            card_id: task.id,
            card_title: task.title,
        })
        .collect::<Vec<_>>();

    Ok(KanbanBoardQueueSnapshot {
        board_id: board_id.to_string(),
        running_count: running_cards.len(),
        running_cards,
        queued_count: 0,
        queued_card_ids: Vec::new(),
        queued_cards: Vec::new(),
        queued_positions: HashMap::new(),
    })
}

pub(super) fn sanitize_board_response(board: &mut serde_json::Value) {
    let Some(object) = board.as_object_mut() else {
        return;
    };

    let github_token_configured = object
        .get("githubToken")
        .and_then(|value| value.as_str())
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    object.remove("githubToken");
    object.insert(
        "githubTokenConfigured".to_string(),
        serde_json::json!(github_token_configured),
    );
}

pub(super) async fn add_board_runtime_meta(
    state: &AppState,
    board: &mut serde_json::Value,
    metadata: &HashMap<String, String>,
    workspace_id: &str,
) -> Result<(), ServerError> {
    let Some(object) = board.as_object_mut() else {
        return Ok(());
    };

    let board_id = object
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let queue = build_board_queue_snapshot(state, workspace_id, &board_id).await?;
    object.insert(
        "sessionConcurrencyLimit".to_string(),
        serde_json::json!(get_session_concurrency_limit(metadata, &board_id)),
    );
    object.insert(
        "autoProviderId".to_string(),
        serde_json::to_value(get_auto_provider(metadata, &board_id))
            .unwrap_or(serde_json::Value::Null),
    );
    object.insert(
        "devSessionSupervision".to_string(),
        serde_json::to_value(get_dev_session_supervision(metadata, &board_id))
            .unwrap_or(serde_json::Value::Null),
    );
    object.insert(
        "queue".to_string(),
        serde_json::to_value(queue).unwrap_or(serde_json::Value::Null),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::{
        default_dev_session_supervision, get_dev_session_supervision,
        normalize_dev_session_supervision, sanitize_board_response,
        PartialKanbanDevSessionSupervision,
    };

    #[test]
    fn dev_session_supervision_defaults_when_missing() {
        let metadata = HashMap::new();

        assert_eq!(
            serde_json::to_value(get_dev_session_supervision(&metadata, "board-1")).unwrap(),
            serde_json::to_value(default_dev_session_supervision()).unwrap()
        );
    }

    #[test]
    fn normalize_dev_session_supervision_clamps_invalid_values() {
        let normalized = normalize_dev_session_supervision(PartialKanbanDevSessionSupervision {
            mode: Some("unknown".to_string()),
            inactivity_timeout_minutes: Some(999),
            max_recovery_attempts: Some(999),
            completion_requirement: Some("bogus".to_string()),
        });

        assert_eq!(normalized.mode, "watchdog_retry");
        assert_eq!(normalized.inactivity_timeout_minutes, 120);
        assert_eq!(normalized.max_recovery_attempts, 10);
        assert_eq!(normalized.completion_requirement, "turn_complete");
    }

    #[test]
    fn sanitize_board_response_hides_raw_token_and_exposes_configured_flag() {
        let mut board = serde_json::json!({
            "id": "board-1",
            "githubToken": " github_pat_test ",
        });

        sanitize_board_response(&mut board);

        assert_eq!(board.get("githubToken"), None);
        assert_eq!(board["githubTokenConfigured"], json!(true));
    }
}
