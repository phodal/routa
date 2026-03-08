use chrono::Utc;
use rusqlite::OptionalExtension;

use crate::db::Database;
use crate::error::ServerError;
use crate::models::task::{Task, TaskPriority, TaskStatus, VerificationVerdict};

#[derive(Clone)]
pub struct TaskStore {
    db: Database,
}

impl TaskStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub async fn save(&self, task: &Task) -> Result<(), ServerError> {
        let t = task.clone();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "INSERT INTO tasks (id, title, objective, scope, acceptance_criteria, verification_commands,
                                         assigned_to, status, board_id, column_id, position, priority, labels, assignee,
                                         assigned_provider, assigned_role, assigned_specialist_id, assigned_specialist_name,
                                         trigger_session_id, github_id, github_number, github_url, github_repo, github_state,
                                         github_synced_at, last_sync_error, dependencies, parallel_group, workspace_id, session_id,
                                         completion_summary, verification_verdict, verification_report, version, created_at, updated_at)
                                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                                         ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, 1,
                                         ?34, ?35)
                     ON CONFLICT(id) DO UPDATE SET
                       title = excluded.title,
                       objective = excluded.objective,
                       scope = excluded.scope,
                       acceptance_criteria = excluded.acceptance_criteria,
                       verification_commands = excluded.verification_commands,
                       assigned_to = excluded.assigned_to,
                       status = excluded.status,
                                             board_id = excluded.board_id,
                                             column_id = excluded.column_id,
                                             position = excluded.position,
                                             priority = excluded.priority,
                                             labels = excluded.labels,
                                             assignee = excluded.assignee,
                                             assigned_provider = excluded.assigned_provider,
                                             assigned_role = excluded.assigned_role,
                                             assigned_specialist_id = excluded.assigned_specialist_id,
                                             assigned_specialist_name = excluded.assigned_specialist_name,
                                             trigger_session_id = excluded.trigger_session_id,
                                             github_id = excluded.github_id,
                                             github_number = excluded.github_number,
                                             github_url = excluded.github_url,
                                             github_repo = excluded.github_repo,
                                             github_state = excluded.github_state,
                                             github_synced_at = excluded.github_synced_at,
                                             last_sync_error = excluded.last_sync_error,
                       dependencies = excluded.dependencies,
                       parallel_group = excluded.parallel_group,
                                             workspace_id = excluded.workspace_id,
                       session_id = excluded.session_id,
                       completion_summary = excluded.completion_summary,
                       verification_verdict = excluded.verification_verdict,
                       verification_report = excluded.verification_report,
                       updated_at = excluded.updated_at",
                    rusqlite::params![
                        t.id,
                        t.title,
                        t.objective,
                        t.scope,
                        t.acceptance_criteria.map(|v| serde_json::to_string(&v).unwrap_or_default()),
                        t.verification_commands.map(|v| serde_json::to_string(&v).unwrap_or_default()),
                        t.assigned_to,
                        t.status.as_str(),
                        t.board_id,
                        t.column_id,
                        t.position,
                        t.priority.as_ref().map(|v| v.as_str()),
                        serde_json::to_string(&t.labels).unwrap_or_default(),
                        t.assignee,
                        t.assigned_provider,
                        t.assigned_role,
                        t.assigned_specialist_id,
                        t.assigned_specialist_name,
                        t.trigger_session_id,
                        t.github_id,
                        t.github_number,
                        t.github_url,
                        t.github_repo,
                        t.github_state,
                        t.github_synced_at.map(|v| v.timestamp_millis()),
                        t.last_sync_error,
                        serde_json::to_string(&t.dependencies).unwrap_or_default(),
                        t.parallel_group,
                        t.workspace_id,
                        t.session_id,
                        t.completion_summary,
                        t.verification_verdict.as_ref().map(|v| v.as_str()),
                        t.verification_report,
                        t.created_at.timestamp_millis(),
                        t.updated_at.timestamp_millis(),
                    ],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn get(&self, task_id: &str) -> Result<Option<Task>, ServerError> {
        let id = task_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, title, objective, scope, acceptance_criteria, verification_commands,
                     assigned_to, status, board_id, column_id, position, priority, labels, assignee,
                     assigned_provider, assigned_role, assigned_specialist_id, assigned_specialist_name,
                     trigger_session_id, github_id, github_number, github_url, github_repo, github_state,
                     github_synced_at, last_sync_error, dependencies, parallel_group, workspace_id, session_id,
                     completion_summary, verification_verdict, verification_report, created_at, updated_at
                     FROM tasks WHERE id = ?1",
                )?;
                stmt.query_row(rusqlite::params![id], |row| Ok(row_to_task(row)))
                    .optional()
            })
            .await
    }

    pub async fn list_by_workspace(&self, workspace_id: &str) -> Result<Vec<Task>, ServerError> {
        let ws_id = workspace_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, title, objective, scope, acceptance_criteria, verification_commands,
                     assigned_to, status, board_id, column_id, position, priority, labels, assignee,
                     assigned_provider, assigned_role, assigned_specialist_id, assigned_specialist_name,
                     trigger_session_id, github_id, github_number, github_url, github_repo, github_state,
                     github_synced_at, last_sync_error, dependencies, parallel_group, workspace_id, session_id,
                     completion_summary, verification_verdict, verification_report, created_at, updated_at
                     FROM tasks WHERE workspace_id = ?1 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![ws_id], |row| Ok(row_to_task(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn list_by_session(&self, session_id: &str) -> Result<Vec<Task>, ServerError> {
        let sid = session_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, title, objective, scope, acceptance_criteria, verification_commands,
                     assigned_to, status, board_id, column_id, position, priority, labels, assignee,
                     assigned_provider, assigned_role, assigned_specialist_id, assigned_specialist_name,
                     trigger_session_id, github_id, github_number, github_url, github_repo, github_state,
                     github_synced_at, last_sync_error, dependencies, parallel_group, workspace_id, session_id,
                     completion_summary, verification_verdict, verification_report, created_at, updated_at
                     FROM tasks WHERE session_id = ?1 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![sid], |row| Ok(row_to_task(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn list_by_status(
        &self,
        workspace_id: &str,
        status: &TaskStatus,
    ) -> Result<Vec<Task>, ServerError> {
        let ws_id = workspace_id.to_string();
        let status_str = status.as_str().to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, title, objective, scope, acceptance_criteria, verification_commands,
                     assigned_to, status, board_id, column_id, position, priority, labels, assignee,
                     assigned_provider, assigned_role, assigned_specialist_id, assigned_specialist_name,
                     trigger_session_id, github_id, github_number, github_url, github_repo, github_state,
                     github_synced_at, last_sync_error, dependencies, parallel_group, workspace_id, session_id,
                     completion_summary, verification_verdict, verification_report, created_at, updated_at
                     FROM tasks WHERE workspace_id = ?1 AND status = ?2 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![ws_id, status_str], |row| {
                        Ok(row_to_task(row))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn list_by_assignee(&self, agent_id: &str) -> Result<Vec<Task>, ServerError> {
        let aid = agent_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, title, objective, scope, acceptance_criteria, verification_commands,
                     assigned_to, status, board_id, column_id, position, priority, labels, assignee,
                     assigned_provider, assigned_role, assigned_specialist_id, assigned_specialist_name,
                     trigger_session_id, github_id, github_number, github_url, github_repo, github_state,
                     github_synced_at, last_sync_error, dependencies, parallel_group, workspace_id, session_id,
                     completion_summary, verification_verdict, verification_report, created_at, updated_at
                     FROM tasks WHERE assigned_to = ?1 ORDER BY created_at DESC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![aid], |row| Ok(row_to_task(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn find_ready_tasks(&self, workspace_id: &str) -> Result<Vec<Task>, ServerError> {
        let all_tasks = self.list_by_workspace(workspace_id).await?;
        let completed_ids: std::collections::HashSet<String> = all_tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Completed)
            .map(|t| t.id.clone())
            .collect();

        Ok(all_tasks
            .into_iter()
            .filter(|t| {
                t.status == TaskStatus::Pending
                    && t.dependencies.iter().all(|dep| completed_ids.contains(dep))
            })
            .collect())
    }

    pub async fn update_status(
        &self,
        task_id: &str,
        status: &TaskStatus,
    ) -> Result<(), ServerError> {
        let id = task_id.to_string();
        let status_str = status.as_str().to_string();
        let now = Utc::now().timestamp_millis();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "UPDATE tasks SET status = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![status_str, now, id],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn delete(&self, task_id: &str) -> Result<(), ServerError> {
        let id = task_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                conn.execute("DELETE FROM tasks WHERE id = ?1", rusqlite::params![id])?;
                Ok(())
            })
            .await
    }
}

use rusqlite::Row;

fn row_to_task(row: &Row<'_>) -> Task {
    let created_ms: i64 = row.get(33).unwrap_or(0);
    let updated_ms: i64 = row.get(34).unwrap_or(0);

    let acceptance_criteria: Option<Vec<String>> = row
        .get::<_, Option<String>>(4)
        .unwrap_or(None)
        .and_then(|s| serde_json::from_str(&s).ok());
    let verification_commands: Option<Vec<String>> = row
        .get::<_, Option<String>>(5)
        .unwrap_or(None)
        .and_then(|s| serde_json::from_str(&s).ok());
    let labels: Vec<String> = row
        .get::<_, String>(12)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let dependencies: Vec<String> = row
        .get::<_, String>(26)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    Task {
        id: row.get(0).unwrap_or_default(),
        title: row.get(1).unwrap_or_default(),
        objective: row.get(2).unwrap_or_default(),
        scope: row.get(3).unwrap_or(None),
        acceptance_criteria,
        verification_commands,
        assigned_to: row.get(6).unwrap_or(None),
        status: TaskStatus::from_str(&row.get::<_, String>(7).unwrap_or_default())
            .unwrap_or(TaskStatus::Pending),
        board_id: row.get(8).unwrap_or(None),
        column_id: row.get(9).unwrap_or(None),
        position: row.get(10).unwrap_or(0),
        priority: row
            .get::<_, Option<String>>(11)
            .unwrap_or(None)
            .and_then(|s| TaskPriority::from_str(&s)),
        labels,
        assignee: row.get(13).unwrap_or(None),
        assigned_provider: row.get(14).unwrap_or(None),
        assigned_role: row.get(15).unwrap_or(None),
        assigned_specialist_id: row.get(16).unwrap_or(None),
        assigned_specialist_name: row.get(17).unwrap_or(None),
        trigger_session_id: row.get(18).unwrap_or(None),
        github_id: row.get(19).unwrap_or(None),
        github_number: row.get(20).unwrap_or(None),
        github_url: row.get(21).unwrap_or(None),
        github_repo: row.get(22).unwrap_or(None),
        github_state: row.get(23).unwrap_or(None),
        github_synced_at: row
            .get::<_, Option<i64>>(24)
            .unwrap_or(None)
            .and_then(chrono::DateTime::from_timestamp_millis),
        last_sync_error: row.get(25).unwrap_or(None),
        dependencies,
        parallel_group: row.get(27).unwrap_or(None),
        workspace_id: row.get(28).unwrap_or_default(),
        session_id: row.get(29).unwrap_or(None),
        completion_summary: row.get(30).unwrap_or(None),
        verification_verdict: row
            .get::<_, Option<String>>(31)
            .unwrap_or(None)
            .and_then(|s| VerificationVerdict::from_str(&s)),
        verification_report: row.get(32).unwrap_or(None),
        created_at: chrono::DateTime::from_timestamp_millis(created_ms)
            .unwrap_or_else(|| Utc::now()),
        updated_at: chrono::DateTime::from_timestamp_millis(updated_ms)
            .unwrap_or_else(|| Utc::now()),
    }
}
