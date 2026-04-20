use chrono::Utc;

use crate::error::ServerError;
use crate::models::kanban::{column_id_to_task_status, task_status_to_column_id};
use crate::models::task::{
    Task, TaskCreationSource, TaskLaneSessionStatus, TaskPriority, TaskStatus,
};
use crate::state::AppState;
use routa_core::kanban::{
    ensure_task_board_context, resolve_review_lane_convergence_column, set_task_column,
    sync_task_column_from_status, sync_task_status_from_column,
};
use routa_core::models::task::VerificationVerdict;

#[derive(Clone)]
pub struct TaskApplicationService {
    state: AppState,
}

impl TaskApplicationService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn create_task(
        &self,
        command: CreateTaskCommand,
    ) -> Result<CreateTaskPlan, ServerError> {
        let CreateTaskCommand {
            title,
            objective,
            workspace_id,
            session_id,
            scope,
            acceptance_criteria,
            verification_commands,
            test_cases,
            dependencies,
            parallel_group,
            board_id,
            column_id,
            position,
            priority,
            labels,
            assignee,
            assigned_provider,
            assigned_role,
            assigned_specialist_id,
            assigned_specialist_name,
            create_github_issue,
            repo_path,
            codebase_ids,
            github_id,
            github_number,
            github_url,
            github_repo,
            github_state,
        } = command;

        let workspace_id = workspace_id.unwrap_or_else(|| "default".to_string());

        let mut task = Task::new(
            uuid::Uuid::new_v4().to_string(),
            title,
            objective,
            workspace_id,
            session_id,
            scope,
            acceptance_criteria,
            verification_commands,
            test_cases,
            dependencies,
            parallel_group,
        );
        if task.creation_source.is_none() && task.session_id.is_some() {
            task.creation_source = Some(TaskCreationSource::Session);
        }
        task.board_id = board_id;
        if let Some(column_id) = column_id {
            set_task_column(&mut task, column_id);
        }
        ensure_task_board_context(&self.state, &mut task).await?;
        sync_task_status_from_column(&mut task);
        task.position = position.unwrap_or(0);
        task.priority = parse_priority(priority)?;
        task.labels = sanitize_labels(labels.unwrap_or_default());
        task.assignee = assignee;
        task.assigned_provider = assigned_provider;
        task.assigned_role = assigned_role;
        task.assigned_specialist_id = assigned_specialist_id;
        task.assigned_specialist_name = assigned_specialist_name;
        task.codebase_ids = codebase_ids.unwrap_or_default();
        task.github_id = github_id;
        task.github_number = github_number;
        task.github_url = github_url;
        task.github_repo = github_repo;
        task.github_state = github_state;
        let entering_dev = task.column_id.as_deref() == Some("dev");

        let column_automation =
            if let (Some(board_id), Some(col_id)) = (&task.board_id, &task.column_id) {
                self.state
                    .kanban_store
                    .get(board_id)
                    .await
                    .ok()
                    .flatten()
                    .and_then(|board| {
                        board
                            .columns
                            .into_iter()
                            .find(|c| &c.id == col_id)
                            .and_then(|col| col.automation)
                            .filter(|automation| automation.enabled)
                    })
            } else {
                None
            };

        if let Some(ref automation) = column_automation {
            let primary_step = automation.primary_step();
            if task.assigned_provider.is_none() {
                task.assigned_provider = primary_step
                    .as_ref()
                    .and_then(|step| step.provider_id.clone())
                    .or_else(|| automation.provider_id.clone());
            }
            if task.assigned_role.is_none() {
                task.assigned_role = primary_step
                    .as_ref()
                    .and_then(|step| step.role.clone())
                    .or_else(|| automation.role.clone());
            }
            if task.assigned_specialist_id.is_none() {
                task.assigned_specialist_id = primary_step
                    .as_ref()
                    .and_then(|step| step.specialist_id.clone())
                    .or_else(|| automation.specialist_id.clone());
            }
            if task.assigned_specialist_name.is_none() {
                task.assigned_specialist_name = primary_step
                    .as_ref()
                    .and_then(|step| step.specialist_name.clone())
                    .or_else(|| automation.specialist_name.clone());
            }
        }

        let should_create_github_issue =
            create_github_issue.unwrap_or(false) && task.github_number.is_none();

        Ok(CreateTaskPlan {
            task,
            create_github_issue: should_create_github_issue,
            should_trigger_agent: entering_dev || column_automation.is_some(),
            entering_dev,
            repo_path,
        })
    }

    pub async fn update_task(
        &self,
        task_id: &str,
        command: UpdateTaskCommand,
    ) -> Result<UpdateTaskPlan, ServerError> {
        let Some(mut task) = self.state.task_store.get(task_id).await? else {
            return Err(ServerError::NotFound(format!("Task {task_id} not found")));
        };

        let existing_column_id = task.column_id.clone();
        let has_status_update = command.status.is_some();
        let has_column_update = command.column_id.is_some();
        let has_assigned_provider_update = command.assigned_provider.is_some();
        let has_assigned_role_update = command.assigned_role.is_some();
        let has_assigned_specialist_update = command.assigned_specialist_id.is_some();
        let retry_trigger = command.retry_trigger.unwrap_or(false);
        let should_sync_github = command.sync_to_github != Some(false);
        let repo_path = command.repo_path.clone();

        if let Some(value) = command.title {
            task.title = value;
        }
        if let Some(value) = command.objective {
            task.objective = value;
        }
        if let Some(value) = command.scope {
            task.scope = Some(value);
        }
        if let Some(value) = command.acceptance_criteria {
            task.acceptance_criteria = Some(value);
        }
        if let Some(value) = command.verification_commands {
            task.verification_commands = Some(value);
        }
        if let Some(value) = command.test_cases {
            task.test_cases = Some(value);
        }
        if let Some(value) = command.assigned_to {
            task.assigned_to = Some(value);
        }
        if let Some(value) = command.status {
            task.status = TaskStatus::from_str(&value)
                .ok_or_else(|| ServerError::BadRequest(format!("Invalid status: {value}")))?;
        }
        if command.board_id.is_some() {
            task.board_id = command.board_id;
        }
        if command.column_id.is_some() {
            task.column_id = command.column_id;
        }
        if let Some(value) = command.position {
            task.position = value;
        }
        if let Some(value) = command.priority {
            task.priority =
                Some(TaskPriority::from_str(&value).ok_or_else(|| {
                    ServerError::BadRequest(format!("Invalid priority: {value}"))
                })?);
        }
        if let Some(value) = command.labels {
            task.labels = sanitize_labels(value);
        }
        if command.assignee.is_some() {
            task.assignee = command.assignee;
        }
        if command.assigned_provider.is_some() {
            task.assigned_provider = command.assigned_provider;
        }
        if command.assigned_role.is_some() {
            task.assigned_role = command.assigned_role;
        }
        if command.assigned_specialist_id.is_some() {
            task.assigned_specialist_id = command.assigned_specialist_id;
        }
        if command.assigned_specialist_name.is_some() {
            task.assigned_specialist_name = command.assigned_specialist_name;
        }
        if command.trigger_session_id.is_some() {
            task.trigger_session_id = command.trigger_session_id;
        }
        if command.github_id.is_some() {
            task.github_id = command.github_id;
        }
        if command.github_number.is_some() {
            task.github_number = command.github_number;
        }
        if command.github_url.is_some() {
            task.github_url = command.github_url;
        }
        if command.github_repo.is_some() {
            task.github_repo = command.github_repo;
        }
        if command.github_state.is_some() {
            task.github_state = command.github_state;
        }
        if command.last_sync_error.is_some() {
            task.last_sync_error = command.last_sync_error;
        }
        if let Some(value) = command.dependencies {
            task.dependencies = value;
        }
        if command.parallel_group.is_some() {
            task.parallel_group = command.parallel_group;
        }
        if command.completion_summary.is_some() {
            task.completion_summary = command.completion_summary;
        }
        if let Some(value) = command.verification_verdict {
            task.verification_verdict =
                Some(VerificationVerdict::from_str(&value).ok_or_else(|| {
                    ServerError::BadRequest(format!("Invalid verification verdict: {value}"))
                })?);
        }
        if command.verification_report.is_some() {
            task.verification_report = command.verification_report;
        }
        if let Some(ids) = command.codebase_ids {
            task.codebase_ids = ids;
        }
        if let Some(wt) = command.worktree_id {
            task.worktree_id = wt;
        }

        if retry_trigger {
            task.trigger_session_id = None;
            task.last_sync_error = None;
        }

        if has_column_update && has_status_update {
            let expected_status = column_id_to_task_status(task.column_id.as_deref());
            let expected_column_id = task_status_to_column_id(&task.status);
            if expected_status != task.status
                || task.column_id.as_deref() != Some(expected_column_id)
            {
                return Err(ServerError::BadRequest(
                    "columnId and status must describe the same workflow state".to_string(),
                ));
            }
        }

        if has_column_update && !has_status_update {
            sync_task_status_from_column(&mut task);
        }
        if has_status_update && !has_column_update {
            sync_task_column_from_status(&mut task);
        }
        ensure_task_board_context(&self.state, &mut task).await?;
        let board = if let Some(board_id) = &task.board_id {
            self.state.kanban_store.get(board_id).await?
        } else {
            None
        };
        if !has_status_update && !has_column_update {
            if let Some(column_id) = resolve_review_lane_convergence_column(&task, board.as_ref()) {
                if task.column_id.as_deref() != Some(column_id.as_str()) {
                    task.column_id = Some(column_id);
                    sync_task_status_from_column(&mut task);
                }
            }
        }

        if task.column_id != existing_column_id {
            let next_column_id = task.column_id.clone();
            complete_running_lane_sessions_for_handoff(&mut task, next_column_id.as_deref());
            task.trigger_session_id = None;
            task.last_sync_error = None;
        }

        let entering_dev = task.column_id.as_deref() == Some("dev")
            && existing_column_id.as_deref() != Some("dev");
        let assigned_while_in_dev = task.column_id.as_deref() == Some("dev")
            && task.trigger_session_id.is_none()
            && (has_assigned_provider_update
                || has_assigned_specialist_update
                || has_assigned_role_update);

        // Check if entering a column with automation enabled
        let entering_new_column =
            has_column_update && task.column_id.as_deref() != existing_column_id.as_deref();
        let column_automation = if entering_new_column {
            if let (Some(board_id), Some(col_id)) = (&task.board_id, &task.column_id) {
                self.state
                    .kanban_store
                    .get(board_id)
                    .await
                    .ok()
                    .flatten()
                    .and_then(|board| {
                        board
                            .columns
                            .into_iter()
                            .find(|c| &c.id == col_id)
                            .and_then(|col| col.automation)
                            .filter(|a| a.enabled)
                    })
            } else {
                None
            }
        } else {
            None
        };

        // Apply automation provider/role if column automation is configured
        if let Some(ref automation) = column_automation {
            let primary_step = automation.primary_step();
            if task.assigned_provider.is_none() {
                task.assigned_provider = primary_step
                    .as_ref()
                    .and_then(|step| step.provider_id.clone())
                    .or_else(|| automation.provider_id.clone());
            }
            if task.assigned_role.is_none() {
                task.assigned_role = primary_step
                    .as_ref()
                    .and_then(|step| step.role.clone())
                    .or_else(|| automation.role.clone());
            }
            if task.assigned_specialist_id.is_none() {
                task.assigned_specialist_id = primary_step
                    .as_ref()
                    .and_then(|step| step.specialist_id.clone())
                    .or_else(|| automation.specialist_id.clone());
            }
            if task.assigned_specialist_name.is_none() {
                task.assigned_specialist_name = primary_step
                    .as_ref()
                    .and_then(|step| step.specialist_name.clone())
                    .or_else(|| automation.specialist_name.clone());
            }
        }

        let entering_automated_column = entering_dev || column_automation.is_some();
        let should_trigger_agent =
            entering_automated_column || assigned_while_in_dev || retry_trigger;

        task.updated_at = Utc::now();

        Ok(UpdateTaskPlan {
            task,
            should_sync_github,
            should_trigger_agent,
            entering_dev,
            repo_path,
        })
    }
}

#[derive(Debug)]
pub struct CreateTaskCommand {
    pub title: String,
    pub objective: String,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    pub scope: Option<String>,
    pub acceptance_criteria: Option<Vec<String>>,
    pub verification_commands: Option<Vec<String>>,
    pub test_cases: Option<Vec<String>>,
    pub dependencies: Option<Vec<String>>,
    pub parallel_group: Option<String>,
    pub board_id: Option<String>,
    pub column_id: Option<String>,
    pub position: Option<i64>,
    pub priority: Option<String>,
    pub labels: Option<Vec<String>>,
    pub assignee: Option<String>,
    pub assigned_provider: Option<String>,
    pub assigned_role: Option<String>,
    pub assigned_specialist_id: Option<String>,
    pub assigned_specialist_name: Option<String>,
    pub create_github_issue: Option<bool>,
    pub repo_path: Option<String>,
    pub codebase_ids: Option<Vec<String>>,
    pub github_id: Option<String>,
    pub github_number: Option<i64>,
    pub github_url: Option<String>,
    pub github_repo: Option<String>,
    pub github_state: Option<String>,
}

#[derive(Debug, Default)]
pub struct UpdateTaskCommand {
    pub title: Option<String>,
    pub objective: Option<String>,
    pub scope: Option<String>,
    pub acceptance_criteria: Option<Vec<String>>,
    pub verification_commands: Option<Vec<String>>,
    pub test_cases: Option<Vec<String>>,
    pub assigned_to: Option<String>,
    pub status: Option<String>,
    pub board_id: Option<String>,
    pub column_id: Option<String>,
    pub position: Option<i64>,
    pub priority: Option<String>,
    pub labels: Option<Vec<String>>,
    pub assignee: Option<String>,
    pub assigned_provider: Option<String>,
    pub assigned_role: Option<String>,
    pub assigned_specialist_id: Option<String>,
    pub assigned_specialist_name: Option<String>,
    pub trigger_session_id: Option<String>,
    pub github_id: Option<String>,
    pub github_number: Option<i64>,
    pub github_url: Option<String>,
    pub github_repo: Option<String>,
    pub github_state: Option<String>,
    pub last_sync_error: Option<String>,
    pub dependencies: Option<Vec<String>>,
    pub parallel_group: Option<String>,
    pub completion_summary: Option<String>,
    pub verification_verdict: Option<String>,
    pub verification_report: Option<String>,
    pub sync_to_github: Option<bool>,
    pub retry_trigger: Option<bool>,
    pub repo_path: Option<String>,
    pub codebase_ids: Option<Vec<String>>,
    pub worktree_id: Option<Option<String>>, // null clears, string sets
}

#[derive(Debug)]
pub struct CreateTaskPlan {
    pub task: Task,
    pub create_github_issue: bool,
    pub should_trigger_agent: bool,
    pub entering_dev: bool,
    pub repo_path: Option<String>,
}

#[derive(Debug)]
pub struct UpdateTaskPlan {
    pub task: Task,
    pub should_sync_github: bool,
    pub should_trigger_agent: bool,
    pub entering_dev: bool,
    pub repo_path: Option<String>,
}

fn parse_priority(priority: Option<String>) -> Result<Option<TaskPriority>, ServerError> {
    match priority {
        Some(value) => Ok(Some(TaskPriority::from_str(&value).ok_or_else(|| {
            ServerError::BadRequest(format!("Invalid priority: {value}"))
        })?)),
        None => Ok(None),
    }
}

fn sanitize_labels(labels: Vec<String>) -> Vec<String> {
    let mut sanitized = Vec::new();
    for label in labels {
        let trimmed = label.trim();
        if !trimmed.is_empty() && !sanitized.iter().any(|item| item == trimmed) {
            sanitized.push(trimmed.to_string());
        }
    }
    sanitized
}

fn complete_running_lane_sessions_for_handoff(task: &mut Task, next_column_id: Option<&str>) {
    let now = Utc::now().to_rfc3339();

    for session in &mut task.lane_sessions {
        if session.status != TaskLaneSessionStatus::Running {
            continue;
        }
        if session.column_id.as_deref() == next_column_id {
            continue;
        }

        session.status = TaskLaneSessionStatus::Completed;
        if session.completed_at.is_none() {
            session.completed_at = Some(now.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use chrono::Utc;

    use super::{CreateTaskCommand, TaskApplicationService, UpdateTaskCommand};
    use crate::create_app_state;
    use crate::models::task::{
        Task, TaskCreationSource, TaskLaneSessionStatus, TaskStatus, VerificationVerdict,
    };

    fn random_db_path() -> PathBuf {
        std::env::temp_dir().join(format!("routa-task-service-{}.db", uuid::Uuid::new_v4()))
    }

    async fn setup_service() -> (TaskApplicationService, PathBuf) {
        let db_path = random_db_path();
        let state = create_app_state(db_path.to_string_lossy().as_ref())
            .await
            .expect("create app state");
        (TaskApplicationService::new(state), db_path)
    }

    async fn seed_task(service: &TaskApplicationService, column_id: Option<&str>) -> Task {
        let plan = service
            .create_task(CreateTaskCommand {
                title: "Seed task".to_string(),
                objective: "Seed objective".to_string(),
                workspace_id: Some("default".to_string()),
                session_id: None,
                scope: None,
                acceptance_criteria: None,
                verification_commands: None,
                test_cases: None,
                dependencies: None,
                parallel_group: None,
                board_id: None,
                column_id: column_id.map(str::to_string),
                position: None,
                priority: None,
                labels: None,
                assignee: None,
                assigned_provider: None,
                assigned_role: None,
                assigned_specialist_id: None,
                assigned_specialist_name: None,
                create_github_issue: None,
                repo_path: None,
                codebase_ids: None,
                github_id: None,
                github_number: None,
                github_url: None,
                github_repo: None,
                github_state: None,
            })
            .await
            .expect("build seed task");
        service
            .state
            .task_store
            .save(&plan.task)
            .await
            .expect("persist seed task");
        plan.task
    }

    #[tokio::test]
    async fn create_task_applies_defaults_and_normalizes_labels() {
        let (service, db_path) = setup_service().await;

        let plan = service
            .create_task(CreateTaskCommand {
                title: "Task service".to_string(),
                objective: "Verify defaults".to_string(),
                workspace_id: None,
                session_id: None,
                scope: None,
                acceptance_criteria: None,
                verification_commands: None,
                test_cases: None,
                dependencies: None,
                parallel_group: None,
                board_id: None,
                column_id: Some("review".to_string()),
                position: None,
                priority: Some("high".to_string()),
                labels: Some(vec![
                    " bug ".to_string(),
                    "bug".to_string(),
                    "".to_string(),
                    "backend".to_string(),
                ]),
                assignee: None,
                assigned_provider: None,
                assigned_role: None,
                assigned_specialist_id: None,
                assigned_specialist_name: None,
                create_github_issue: Some(true),
                repo_path: Some("/tmp/repo".to_string()),
                codebase_ids: None,
                github_id: None,
                github_number: None,
                github_url: None,
                github_repo: None,
                github_state: None,
            })
            .await
            .expect("create task plan");

        assert_eq!(plan.task.workspace_id, "default");
        assert!(plan.task.board_id.is_some());
        assert_eq!(plan.task.column_id.as_deref(), Some("review"));
        assert_eq!(plan.task.status, TaskStatus::ReviewRequired);
        assert_eq!(
            plan.task.labels,
            vec!["bug".to_string(), "backend".to_string()]
        );
        assert_eq!(
            plan.task.priority.as_ref().map(|value| value.as_str()),
            Some("high")
        );
        assert!(plan.create_github_issue);
        assert_eq!(plan.repo_path.as_deref(), Some("/tmp/repo"));

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn create_task_rejects_invalid_priority() {
        let (service, db_path) = setup_service().await;

        let error = service
            .create_task(CreateTaskCommand {
                title: "Task service".to_string(),
                objective: "Verify priority validation".to_string(),
                workspace_id: None,
                session_id: None,
                scope: None,
                acceptance_criteria: None,
                verification_commands: None,
                test_cases: None,
                dependencies: None,
                parallel_group: None,
                board_id: None,
                column_id: None,
                position: None,
                priority: Some("impossible".to_string()),
                labels: None,
                assignee: None,
                assigned_provider: None,
                assigned_role: None,
                assigned_specialist_id: None,
                assigned_specialist_name: None,
                create_github_issue: None,
                repo_path: None,
                codebase_ids: None,
                github_id: None,
                github_number: None,
                github_url: None,
                github_repo: None,
                github_state: None,
            })
            .await
            .expect_err("invalid priority should fail");

        assert!(error.to_string().contains("Invalid priority"));
        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn create_task_marks_session_created_tasks() {
        let (service, db_path) = setup_service().await;

        let plan = service
            .create_task(CreateTaskCommand {
                title: "Session task".to_string(),
                objective: "Verify session creation source".to_string(),
                workspace_id: None,
                session_id: Some("session-123".to_string()),
                scope: None,
                acceptance_criteria: None,
                verification_commands: None,
                test_cases: None,
                dependencies: None,
                parallel_group: None,
                board_id: None,
                column_id: None,
                position: None,
                priority: None,
                labels: None,
                assignee: None,
                assigned_provider: None,
                assigned_role: None,
                assigned_specialist_id: None,
                assigned_specialist_name: None,
                create_github_issue: None,
                repo_path: None,
                codebase_ids: None,
                github_id: None,
                github_number: None,
                github_url: None,
                github_repo: None,
                github_state: None,
            })
            .await
            .expect("create task plan");

        assert_eq!(plan.task.creation_source, Some(TaskCreationSource::Session));
        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn update_task_rejects_mismatched_column_and_status() {
        let (service, db_path) = setup_service().await;
        let task = seed_task(&service, Some("backlog")).await;

        let error = service
            .update_task(
                &task.id,
                UpdateTaskCommand {
                    column_id: Some("done".to_string()),
                    status: Some("IN_PROGRESS".to_string()),
                    ..UpdateTaskCommand::default()
                },
            )
            .await
            .expect_err("mismatched workflow state should fail");

        assert!(error.to_string().contains("columnId and status"));
        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn update_task_derives_column_and_retry_trigger_flags() {
        let (service, db_path) = setup_service().await;
        let mut task = seed_task(&service, Some("backlog")).await;
        task.trigger_session_id = Some("session-1".to_string());
        task.last_sync_error = Some("old error".to_string());
        task.lane_sessions
            .push(routa_core::models::task::TaskLaneSession {
                session_id: "session-1".to_string(),
                routa_agent_id: None,
                column_id: Some("backlog".to_string()),
                column_name: Some("Backlog".to_string()),
                step_id: None,
                step_index: None,
                step_name: None,
                provider: Some("codex".to_string()),
                role: Some("ROUTA".to_string()),
                specialist_id: None,
                specialist_name: None,
                transport: Some("acp".to_string()),
                external_task_id: None,
                context_id: None,
                attempt: Some(1),
                loop_mode: None,
                completion_requirement: None,
                objective: Some(task.objective.clone()),
                last_activity_at: None,
                recovered_from_session_id: None,
                recovery_reason: None,
                status: TaskLaneSessionStatus::Running,
                started_at: Utc::now().to_rfc3339(),
                completed_at: None,
            });
        service
            .state
            .task_store
            .save(&task)
            .await
            .expect("persist updated seed task");

        let plan = service
            .update_task(
                &task.id,
                UpdateTaskCommand {
                    status: Some("IN_PROGRESS".to_string()),
                    retry_trigger: Some(true),
                    sync_to_github: Some(false),
                    ..UpdateTaskCommand::default()
                },
            )
            .await
            .expect("update task plan");

        assert_eq!(plan.task.column_id.as_deref(), Some("dev"));
        assert_eq!(plan.task.status, TaskStatus::InProgress);
        assert_eq!(plan.task.trigger_session_id, None);
        assert_eq!(plan.task.last_sync_error, None);
        assert_eq!(
            plan.task.lane_sessions[0].status,
            TaskLaneSessionStatus::Completed
        );
        assert!(plan.task.lane_sessions[0].completed_at.is_some());
        assert!(plan.should_trigger_agent);
        assert!(!plan.should_sync_github);

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn update_task_clears_worktree_when_request_explicitly_sets_null() {
        let (service, db_path) = setup_service().await;
        let mut task = seed_task(&service, Some("dev")).await;
        task.worktree_id = Some("worktree-stale".to_string());
        service
            .state
            .task_store
            .save(&task)
            .await
            .expect("persist updated seed task");

        let plan = service
            .update_task(
                &task.id,
                UpdateTaskCommand {
                    worktree_id: Some(None),
                    ..UpdateTaskCommand::default()
                },
            )
            .await
            .expect("update task plan");

        assert_eq!(plan.task.worktree_id, None);

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn update_task_retriggers_when_entering_new_automated_column() {
        let (service, db_path) = setup_service().await;
        let mut task = seed_task(&service, Some("todo")).await;
        task.trigger_session_id = Some("session-todo".to_string());
        task.lane_sessions
            .push(routa_core::models::task::TaskLaneSession {
                session_id: "session-todo".to_string(),
                routa_agent_id: None,
                column_id: Some("todo".to_string()),
                column_name: Some("Todo".to_string()),
                step_id: None,
                step_index: None,
                step_name: None,
                provider: Some("opencode".to_string()),
                role: Some("CRAFTER".to_string()),
                specialist_id: None,
                specialist_name: None,
                transport: Some("acp".to_string()),
                external_task_id: None,
                context_id: None,
                attempt: Some(1),
                loop_mode: None,
                completion_requirement: None,
                objective: Some(task.objective.clone()),
                last_activity_at: None,
                recovered_from_session_id: None,
                recovery_reason: None,
                status: TaskLaneSessionStatus::Running,
                started_at: Utc::now().to_rfc3339(),
                completed_at: None,
            });
        service
            .state
            .task_store
            .save(&task)
            .await
            .expect("persist updated seed task");

        let board_id = task
            .board_id
            .clone()
            .expect("seed task should belong to a board");
        let mut board = service
            .state
            .kanban_store
            .get(&board_id)
            .await
            .expect("board load should succeed")
            .expect("board should exist");
        let dev = board
            .columns
            .iter_mut()
            .find(|column| column.id == "dev")
            .expect("dev column should exist");
        dev.automation = Some(routa_core::models::kanban::KanbanColumnAutomation {
            enabled: true,
            provider_id: Some("opencode".to_string()),
            role: Some("CRAFTER".to_string()),
            transition_type: Some("entry".to_string()),
            ..Default::default()
        });
        service
            .state
            .kanban_store
            .update(&board)
            .await
            .expect("board update should succeed");

        let plan = service
            .update_task(
                &task.id,
                UpdateTaskCommand {
                    column_id: Some("dev".to_string()),
                    ..UpdateTaskCommand::default()
                },
            )
            .await
            .expect("update task plan");

        assert_eq!(plan.task.column_id.as_deref(), Some("dev"));
        assert_eq!(plan.task.trigger_session_id, None);
        assert_eq!(
            plan.task.lane_sessions[0].status,
            TaskLaneSessionStatus::Completed
        );
        assert!(plan.task.lane_sessions[0].completed_at.is_some());
        assert!(plan.should_trigger_agent);

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn update_task_backfills_board_context_for_legacy_card_moves() {
        let (service, db_path) = setup_service().await;
        let mut task = seed_task(&service, Some("backlog")).await;
        task.board_id = None;
        service
            .state
            .task_store
            .save(&task)
            .await
            .expect("persist legacy task without board");

        let default_board = service
            .state
            .kanban_store
            .ensure_default_board("default")
            .await
            .expect("default board should exist");
        let mut board = service
            .state
            .kanban_store
            .get(&default_board.id)
            .await
            .expect("board load should succeed")
            .expect("board should exist");
        let todo = board
            .columns
            .iter_mut()
            .find(|column| column.id == "todo")
            .expect("todo column should exist");
        todo.automation = Some(routa_core::models::kanban::KanbanColumnAutomation {
            enabled: true,
            transition_type: Some("entry".to_string()),
            steps: Some(vec![routa_core::models::kanban::KanbanAutomationStep {
                id: "todo-a2a".to_string(),
                transport: Some(routa_core::models::kanban::KanbanTransport::A2a),
                role: Some("CRAFTER".to_string()),
                specialist_id: Some("kanban-todo-orchestrator".to_string()),
                specialist_name: Some("Todo Orchestrator".to_string()),
                ..Default::default()
            }]),
            ..Default::default()
        });
        service
            .state
            .kanban_store
            .update(&board)
            .await
            .expect("board update should succeed");

        let plan = service
            .update_task(
                &task.id,
                UpdateTaskCommand {
                    column_id: Some("todo".to_string()),
                    ..UpdateTaskCommand::default()
                },
            )
            .await
            .expect("update task plan");

        assert_eq!(
            plan.task.board_id.as_deref(),
            Some(default_board.id.as_str())
        );
        assert_eq!(plan.task.column_id.as_deref(), Some("todo"));
        assert!(plan.should_trigger_agent);

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn update_task_converges_final_review_verdict_into_done() {
        let (service, db_path) = setup_service().await;
        let mut task = seed_task(&service, Some("review")).await;
        task.status = TaskStatus::ReviewRequired;
        task.assigned_specialist_id = Some("kanban-review-guard".to_string());
        task.assigned_specialist_name = Some("Review Guard".to_string());
        service
            .state
            .task_store
            .save(&task)
            .await
            .expect("persist review task");

        let plan = service
            .update_task(
                &task.id,
                UpdateTaskCommand {
                    verification_verdict: Some("APPROVED".to_string()),
                    verification_report: Some("Checks passed".to_string()),
                    ..UpdateTaskCommand::default()
                },
            )
            .await
            .expect("update task plan");

        assert_eq!(plan.task.column_id.as_deref(), Some("done"));
        assert_eq!(plan.task.status, TaskStatus::Completed);
        assert_eq!(
            plan.task.verification_verdict,
            Some(VerificationVerdict::Approved)
        );

        let _ = fs::remove_file(db_path);
    }

    #[tokio::test]
    async fn update_task_keeps_review_lane_when_follow_up_step_is_pending() {
        let (service, db_path) = setup_service().await;
        let mut task = seed_task(&service, Some("review")).await;
        task.status = TaskStatus::ReviewRequired;
        task.assigned_specialist_id = Some("kanban-qa-frontend".to_string());
        task.assigned_specialist_name = Some("QA Frontend".to_string());
        service
            .state
            .task_store
            .save(&task)
            .await
            .expect("persist review task");

        let plan = service
            .update_task(
                &task.id,
                UpdateTaskCommand {
                    verification_verdict: Some("NOT_APPROVED".to_string()),
                    verification_report: Some("Needs fixes".to_string()),
                    ..UpdateTaskCommand::default()
                },
            )
            .await
            .expect("update task plan");

        assert_eq!(plan.task.column_id.as_deref(), Some("review"));
        assert_eq!(plan.task.status, TaskStatus::ReviewRequired);

        let _ = fs::remove_file(db_path);
    }
}
