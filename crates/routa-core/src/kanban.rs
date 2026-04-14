use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::error::ServerError;
use crate::models::kanban::{
    column_id_to_task_status, task_status_to_column_id, KanbanAutomationStep, KanbanBoard,
};
use crate::models::task::{Task, TaskLaneSessionStatus, VerificationVerdict};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanCard {
    pub id: String,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    pub status: String,
    pub column_id: String,
    pub position: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    pub labels: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn ensure_task_board_context(
    state: &AppState,
    task: &mut Task,
) -> Result<(), ServerError> {
    if task.board_id.is_none() {
        let default_board = state
            .kanban_store
            .ensure_default_board(&task.workspace_id)
            .await?;
        task.board_id = Some(default_board.id);
    }

    if task.column_id.is_none() {
        task.column_id = Some(task_status_to_column_id(&task.status).to_string());
    }

    Ok(())
}

pub fn sync_task_status_from_column(task: &mut Task) {
    task.status = column_id_to_task_status(task.column_id.as_deref());
}

pub fn sync_task_column_from_status(task: &mut Task) {
    task.column_id = Some(task_status_to_column_id(&task.status).to_string());
}

pub fn set_task_column(task: &mut Task, column_id: impl Into<String>) {
    task.column_id = Some(column_id.into());
    sync_task_status_from_column(task);
}

fn resolve_board_column_id_for_stage(board: &KanbanBoard, stage: &str) -> Option<String> {
    board
        .columns
        .iter()
        .find(|column| column.stage == stage)
        .map(|column| column.id.clone())
}

fn find_review_step_index(task: &Task, steps: &[KanbanAutomationStep]) -> Option<usize> {
    if let Some(current_column_id) = task.column_id.as_deref() {
        if let Some(step_index) = task
            .lane_sessions
            .iter()
            .rev()
            .find(|session| {
                session.column_id.as_deref() == Some(current_column_id)
                    && session.status == TaskLaneSessionStatus::Running
            })
            .and_then(|session| session.step_index)
            .and_then(|index| usize::try_from(index).ok())
            .filter(|index| *index < steps.len())
        {
            return Some(step_index);
        }
    }

    let mut best_match: Option<(usize, i32)> = None;
    for (index, step) in steps.iter().enumerate() {
        let mut score = 0;

        if let (Some(step_id), Some(task_id)) = (
            step.specialist_id.as_deref(),
            task.assigned_specialist_id.as_deref(),
        ) {
            if step_id != task_id {
                continue;
            }
            score += 8;
        }
        if let (Some(step_name), Some(task_name)) = (
            step.specialist_name.as_deref(),
            task.assigned_specialist_name.as_deref(),
        ) {
            if step_name != task_name {
                continue;
            }
            score += 4;
        }
        if let (Some(step_role), Some(task_role)) =
            (step.role.as_deref(), task.assigned_role.as_deref())
        {
            if step_role != task_role {
                continue;
            }
            score += 2;
        }
        if let (Some(step_provider), Some(task_provider)) = (
            step.provider_id.as_deref(),
            task.assigned_provider.as_deref(),
        ) {
            if step_provider != task_provider {
                continue;
            }
            score += 1;
        }

        if score > 0
            && best_match
                .map(|(_, best_score)| score > best_score)
                .unwrap_or(true)
        {
            best_match = Some((index, score));
        }
    }

    best_match
        .map(|(index, _)| index)
        .or_else(|| (steps.len() == 1).then_some(0))
}

pub fn resolve_review_lane_convergence_column(
    task: &Task,
    board: Option<&KanbanBoard>,
) -> Option<String> {
    let verdict = task.verification_verdict.as_ref()?;
    let current_column_id = task.column_id.as_deref()?;
    let is_review_stage = board
        .and_then(|value| {
            value
                .columns
                .iter()
                .find(|column| column.id == current_column_id)
        })
        .map(|column| column.stage == "review")
        .unwrap_or(current_column_id == "review");
    if !is_review_stage {
        return None;
    }

    let has_remaining_steps = board
        .and_then(|value| {
            value
                .columns
                .iter()
                .find(|column| column.id == current_column_id)
        })
        .and_then(|column| column.automation.as_ref())
        .and_then(|automation| automation.steps.as_ref())
        .map(|steps| {
            if steps.is_empty() {
                return false;
            }
            match find_review_step_index(task, steps) {
                Some(step_index) => step_index + 1 < steps.len(),
                None => steps.len() > 1,
            }
        })
        .unwrap_or(false);
    if has_remaining_steps {
        return None;
    }

    match verdict {
        VerificationVerdict::Approved => board
            .and_then(|value| resolve_board_column_id_for_stage(value, "done"))
            .or_else(|| Some("done".to_string())),
        VerificationVerdict::NotApproved => board
            .and_then(|value| resolve_board_column_id_for_stage(value, "dev"))
            .or_else(|| Some("dev".to_string())),
        VerificationVerdict::Blocked => board
            .and_then(|value| resolve_board_column_id_for_stage(value, "blocked"))
            .or_else(|| Some("blocked".to_string())),
    }
}

pub fn task_to_card(task: &Task) -> KanbanCard {
    KanbanCard {
        id: task.id.clone(),
        title: task.title.clone(),
        description: task.objective.clone(),
        comment: task.comment.clone(),
        status: task.status.as_str().to_string(),
        column_id: task
            .column_id
            .clone()
            .unwrap_or_else(|| "backlog".to_string()),
        position: task.position,
        priority: task
            .priority
            .as_ref()
            .map(|priority| priority.as_str().to_string()),
        labels: task.labels.clone(),
        assignee: task.assignee.clone(),
        created_at: task.created_at,
        updated_at: task.updated_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::models::kanban::{
        default_kanban_board, KanbanAutomationStep, KanbanColumnAutomation,
    };
    use crate::models::task::{Task, TaskStatus, VerificationVerdict};
    use crate::state::{AppState, AppStateInner};
    use std::sync::Arc;

    async fn setup_state() -> AppState {
        let db = Database::open_in_memory().expect("in-memory db should open");
        let state: AppState = Arc::new(AppStateInner::new(db));
        state
            .workspace_store
            .ensure_default()
            .await
            .expect("default workspace should exist");
        state
    }

    #[tokio::test]
    async fn ensure_task_board_context_backfills_board_and_column() {
        let state = setup_state().await;
        let mut task = Task::new(
            "task-1".to_string(),
            "Legacy card".to_string(),
            "Repair missing board context".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        task.status = TaskStatus::Pending;
        task.board_id = None;
        task.column_id = None;

        ensure_task_board_context(&state, &mut task)
            .await
            .expect("board context should be filled");

        assert!(task.board_id.is_some());
        assert_eq!(task.column_id.as_deref(), Some("backlog"));
    }

    #[test]
    fn review_lane_convergence_waits_for_final_review_step() {
        let mut board = default_kanban_board("default".to_string());
        let review = board
            .columns
            .iter_mut()
            .find(|column| column.id == "review")
            .expect("review column should exist");
        review.automation = Some(KanbanColumnAutomation {
            enabled: true,
            steps: Some(vec![
                KanbanAutomationStep {
                    id: "qa-frontend".to_string(),
                    role: Some("GATE".to_string()),
                    specialist_id: Some("kanban-qa-frontend".to_string()),
                    specialist_name: Some("QA Frontend".to_string()),
                    ..Default::default()
                },
                KanbanAutomationStep {
                    id: "review-guard".to_string(),
                    role: Some("GATE".to_string()),
                    specialist_id: Some("kanban-review-guard".to_string()),
                    specialist_name: Some("Review Guard".to_string()),
                    ..Default::default()
                },
            ]),
            ..Default::default()
        });

        let mut task = Task::new(
            "task-1".to_string(),
            "Review".to_string(),
            "Review".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        task.column_id = Some("review".to_string());
        task.assigned_specialist_id = Some("kanban-qa-frontend".to_string());
        task.verification_verdict = Some(VerificationVerdict::NotApproved);

        assert_eq!(
            resolve_review_lane_convergence_column(&task, Some(&board)),
            None
        );

        task.assigned_specialist_id = Some("kanban-review-guard".to_string());
        task.assigned_specialist_name = Some("Review Guard".to_string());
        task.verification_verdict = Some(VerificationVerdict::Approved);

        assert_eq!(
            resolve_review_lane_convergence_column(&task, Some(&board)).as_deref(),
            Some("done")
        );
    }
}
