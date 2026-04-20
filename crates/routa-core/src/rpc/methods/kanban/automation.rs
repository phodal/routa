mod a2a;

use chrono::Utc;

use crate::models::kanban::{KanbanAutomationStep, KanbanBoard, KanbanColumn};
use crate::models::task::{
    build_task_evidence_summary, build_task_invest_validation, build_task_story_readiness, Task,
    TaskEvidenceSummary, TaskInvestValidation, TaskLaneSession, TaskLaneSessionStatus,
    TaskStoryReadiness,
};
use crate::rpc::error::RpcError;
use crate::state::AppState;
use crate::store::acp_session_store::CreateAcpSessionParams;

use self::a2a::{is_a2a_step, trigger_assigned_task_a2a_agent};

#[derive(Debug)]
pub(super) struct AgentTriggerResult {
    pub session_id: String,
    pub transport: String,
    pub external_task_id: Option<String>,
    pub context_id: Option<String>,
}

pub(super) async fn ensure_required_artifacts_present(
    state: &AppState,
    task_id: &str,
    target_column: &KanbanColumn,
) -> Result<(), RpcError> {
    let Some(required_artifacts) = target_column
        .automation
        .as_ref()
        .and_then(|automation| automation.required_artifacts.as_ref())
    else {
        return Ok(());
    };
    if required_artifacts.is_empty() {
        return Ok(());
    }

    let mut missing_artifacts = Vec::new();
    for artifact_name in required_artifacts {
        let artifact_type = crate::models::artifact::ArtifactType::from_str(artifact_name)
            .ok_or_else(|| {
                RpcError::BadRequest(format!(
                    "Invalid required artifact type configured on column {}: {}",
                    target_column.id, artifact_name
                ))
            })?;
        let artifacts = state
            .artifact_store
            .list_by_task_and_type(task_id, &artifact_type)
            .await?;
        if artifacts.is_empty() {
            missing_artifacts.push(artifact_name.clone());
        }
    }

    if missing_artifacts.is_empty() {
        return Ok(());
    }

    Err(RpcError::BadRequest(format!(
        "Cannot move card to \"{}\": missing required artifacts: {}. Please provide these artifacts before moving the card.",
        target_column.name,
        missing_artifacts.join(", ")
    )))
}

pub(super) fn ensure_required_task_fields_present(
    task: &Task,
    target_column: &KanbanColumn,
) -> Result<(), RpcError> {
    let Some(required_task_fields) = target_column
        .automation
        .as_ref()
        .and_then(|automation| automation.required_task_fields.as_ref())
    else {
        return Ok(());
    };
    if required_task_fields.is_empty() {
        return Ok(());
    }

    let readiness = build_task_story_readiness(task, required_task_fields);
    if readiness.ready {
        return Ok(());
    }

    let missing_task_fields = readiness
        .missing
        .iter()
        .map(|field| match field.as_str() {
            "acceptance_criteria" => "acceptance criteria",
            "verification_commands" => "verification commands",
            "test_cases" => "test cases",
            "verification_plan" => "verification plan",
            "dependencies_declared" => "dependency declaration",
            other => other,
        })
        .collect::<Vec<_>>();

    Err(RpcError::BadRequest(format!(
        "Cannot move card to \"{}\": missing required task fields: {}. Please complete this story definition before moving the card.",
        target_column.name,
        missing_task_fields.join(", ")
    )))
}

fn resolve_next_required_artifacts(
    board: Option<&KanbanBoard>,
    current_column_id: Option<&str>,
) -> Vec<String> {
    let current_column_id = current_column_id.unwrap_or("backlog").to_ascii_lowercase();
    let next_column_id = ["backlog", "todo", "dev", "review", "done"]
        .iter()
        .position(|column_id| *column_id == current_column_id)
        .and_then(|index| ["backlog", "todo", "dev", "review", "done"].get(index + 1))
        .copied();
    let Some(next_column_id) = next_column_id else {
        return Vec::new();
    };

    board
        .and_then(|board| {
            board
                .columns
                .iter()
                .find(|column| column.id == next_column_id)
        })
        .and_then(|column| column.automation.as_ref())
        .and_then(|automation| automation.required_artifacts.clone())
        .unwrap_or_default()
}

fn resolve_next_required_task_fields(
    board: Option<&KanbanBoard>,
    current_column_id: Option<&str>,
) -> Vec<String> {
    let current_column_id = current_column_id.unwrap_or("backlog").to_ascii_lowercase();
    let next_column_id = ["backlog", "todo", "dev", "review", "done"]
        .iter()
        .position(|column_id| *column_id == current_column_id)
        .and_then(|index| ["backlog", "todo", "dev", "review", "done"].get(index + 1))
        .copied();
    let Some(next_column_id) = next_column_id else {
        return Vec::new();
    };

    board
        .and_then(|board| {
            board
                .columns
                .iter()
                .find(|column| column.id == next_column_id)
        })
        .and_then(|column| column.automation.as_ref())
        .and_then(|automation| automation.required_task_fields.clone())
        .unwrap_or_default()
}

pub(super) fn maybe_apply_lane_automation_defaults(
    task: &mut Task,
    target_column: Option<&KanbanColumn>,
) {
    let Some(automation) = target_column.and_then(|column| column.automation.as_ref()) else {
        return;
    };
    if !automation.enabled {
        return;
    }

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

pub(super) fn resolve_transition_automation_column<'a>(
    source_column: Option<&'a KanbanColumn>,
    target_column: Option<&'a KanbanColumn>,
) -> Option<&'a KanbanColumn> {
    let source_transition_type = source_column
        .and_then(|column| column.automation.as_ref())
        .and_then(|automation| automation.transition_type.as_deref())
        .unwrap_or("entry");
    if source_column
        .and_then(|column| column.automation.as_ref())
        .is_some_and(|automation| {
            automation.enabled
                && (source_transition_type == "exit" || source_transition_type == "both")
        })
    {
        return source_column;
    }

    let target_transition_type = target_column
        .and_then(|column| column.automation.as_ref())
        .and_then(|automation| automation.transition_type.as_deref())
        .unwrap_or("entry");
    if target_column
        .and_then(|column| column.automation.as_ref())
        .is_some_and(|automation| {
            automation.enabled
                && (target_transition_type == "entry" || target_transition_type == "both")
        })
    {
        return target_column;
    }

    None
}

pub(super) async fn maybe_trigger_lane_automation(
    state: &AppState,
    task: &mut Task,
    target_column: Option<&KanbanColumn>,
) {
    let Some(column) = target_column else {
        return;
    };
    let Some(automation) = column.automation.as_ref() else {
        return;
    };
    if !automation.enabled || task.trigger_session_id.is_some() {
        return;
    }

    let transition_type = automation.transition_type.as_deref().unwrap_or("entry");
    if transition_type != "entry" && transition_type != "both" {
        return;
    }

    match trigger_assigned_task_agent(state, task).await {
        Ok(()) => {
            task.last_sync_error = None;
        }
        Err(error) => {
            task.last_sync_error = Some(error);
        }
    }
}

pub(super) fn build_task_prompt(
    task: &Task,
    board_id: Option<&str>,
    next_column_id: Option<&str>,
    available_columns: &str,
    story_readiness: Option<&TaskStoryReadiness>,
    invest_validation: Option<&TaskInvestValidation>,
    evidence_summary: Option<&TaskEvidenceSummary>,
) -> String {
    let labels = if task.labels.is_empty() {
        "Labels: none".to_string()
    } else {
        format!("Labels: {}", task.labels.join(", "))
    };
    let lane_id = task.column_id.as_deref().unwrap_or("backlog");
    let lane_guidance = match lane_id {
        "dev" => vec![
            "You are in the `dev` lane. This lane may implement the requested change, but you must keep work scoped to the current card.".to_string(),
            "Use `routa-coordination_update_card` to record concrete progress on this card before or after meaningful implementation steps.".to_string(),
            "When implementation for this lane is complete, use `routa-coordination_move_card` to advance the same card.".to_string(),
        ],
        "todo" => vec![
            "You are in the `todo` lane. This lane does not perform full implementation work.".to_string(),
            "Only clarify the card, update its progress or status, and move the same card forward when the lane is complete.".to_string(),
            "Do not edit files, do not inspect the whole repository, and do not run browser tests or environment diagnostics in this lane.".to_string(),
        ],
        _ => vec![
            format!("You are in the `{lane_id}` lane. Keep work scoped to this card and this lane only."),
        ],
    };
    let story_readiness_section = story_readiness
        .map(|summary| {
            vec![
                "## Story Readiness".to_string(),
                String::new(),
                format!(
                    "Ready for next move: {}",
                    if summary.ready { "yes" } else { "no" }
                ),
                if summary.required_task_fields.is_empty() {
                    "Required fields: none configured".to_string()
                } else {
                    format!(
                        "Required fields: {}",
                        summary.required_task_fields.join(", ")
                    )
                },
                if summary.missing.is_empty() {
                    "Missing fields: none".to_string()
                } else {
                    format!("Missing fields: {}", summary.missing.join(", "))
                },
                format!(
                    "Checks: scope={}, acceptanceCriteria={}, verificationCommands={}, testCases={}, verificationPlan={}, dependenciesDeclared={}",
                    if summary.checks.scope { "present" } else { "missing" },
                    if summary.checks.acceptance_criteria { "present" } else { "missing" },
                    if summary.checks.verification_commands { "present" } else { "missing" },
                    if summary.checks.test_cases { "present" } else { "missing" },
                    if summary.checks.verification_plan { "present" } else { "missing" },
                    if summary.checks.dependencies_declared { "present" } else { "missing" },
                ),
                String::new(),
            ]
        })
        .unwrap_or_default();
    let invest_section = invest_validation
        .map(|summary| {
            let checks = &summary.checks;
            let mut section = vec![
                "## INVEST Snapshot".to_string(),
                String::new(),
                format!("Source: {}", summary.source),
                format!(
                    "Overall: {}",
                    summary.overall_status.as_str().to_uppercase()
                ),
                format!(
                    "Independent: {} — {}",
                    checks.independent.status.as_str().to_uppercase(),
                    checks.independent.reason
                ),
                format!(
                    "Negotiable: {} — {}",
                    checks.negotiable.status.as_str().to_uppercase(),
                    checks.negotiable.reason
                ),
                format!(
                    "Valuable: {} — {}",
                    checks.valuable.status.as_str().to_uppercase(),
                    checks.valuable.reason
                ),
                format!(
                    "Estimable: {} — {}",
                    checks.estimable.status.as_str().to_uppercase(),
                    checks.estimable.reason
                ),
                format!(
                    "Small: {} — {}",
                    checks.small.status.as_str().to_uppercase(),
                    checks.small.reason
                ),
                format!(
                    "Testable: {} — {}",
                    checks.testable.status.as_str().to_uppercase(),
                    checks.testable.reason
                ),
            ];
            if !summary.issues.is_empty() {
                section.push(format!("Issues: {}", summary.issues.join(" | ")));
            }
            section.push(String::new());
            section
        })
        .unwrap_or_default();
    let evidence_bundle_section = evidence_summary
        .map(|summary| {
            vec![
                "## Evidence Bundle".to_string(),
                String::new(),
                format!("Artifacts total: {}", summary.artifact.total),
                format!(
                    "Artifacts by type: {}",
                    summary
                        .artifact
                        .by_type
                        .iter()
                        .map(|(artifact_type, count)| format!("{artifact_type}={count}"))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                format!(
                    "Required artifacts satisfied: {}",
                    if summary.artifact.required_satisfied {
                        "yes"
                    } else {
                        "no"
                    }
                ),
                format!(
                    "Missing required artifacts: {}",
                    if summary.artifact.missing_required.is_empty() {
                        "none".to_string()
                    } else {
                        summary.artifact.missing_required.join(", ")
                    }
                ),
                format!(
                    "Verification verdict: {}",
                    summary
                        .verification
                        .verdict
                        .clone()
                        .unwrap_or_else(|| "none".to_string())
                ),
                format!(
                    "Verification report present: {}",
                    if summary.verification.has_report {
                        "yes"
                    } else {
                        "no"
                    }
                ),
                format!(
                    "Completion summary present: {}",
                    if summary.completion.has_summary {
                        "yes"
                    } else {
                        "no"
                    }
                ),
                format!(
                    "Runs: total={}, latestStatus={}",
                    summary.runs.total, summary.runs.latest_status
                ),
                String::new(),
            ]
        })
        .unwrap_or_default();

    [
        format!("You are assigned to Kanban task: {}", task.title),
        String::new(),
        "## Context".to_string(),
        String::new(),
        "**IMPORTANT**: You are working in Kanban lane automation for exactly one existing card.".to_string(),
        "Only operate on the current card. Do not create a new task, do not switch to a different card, and do not broaden scope.".to_string(),
        "Use the exact MCP tool names exposed by the provider. In OpenCode, prefer `routa-coordination_update_card` and `routa-coordination_move_card`.".to_string(),
        "Do NOT use `gh issue create`, browser automation, Playwright, repo-wide debugging, API exploration, or unrelated codebase research unless the card objective explicitly requires it.".to_string(),
        String::new(),
        "## Task Details".to_string(),
        String::new(),
        format!("**Card ID:** {}", task.id),
        format!(
            "**Priority:** {}",
            task.priority
                .as_ref()
                .map(|value| value.as_str())
                .unwrap_or("medium")
        ),
        board_id
            .map(|value| format!("**Board ID:** {value}"))
            .unwrap_or_else(|| "**Board ID:** unavailable".to_string()),
        format!("**Current Lane:** {lane_id}"),
        next_column_id
            .map(|value| format!("**Next Column ID:** {value}"))
            .unwrap_or_else(|| "**Next Column ID:** unavailable".to_string()),
        labels,
        String::new(),
        "## Objective".to_string(),
        String::new(),
        task.objective.clone(),
        String::new(),
        story_readiness_section.join("\n"),
        invest_section.join("\n"),
        "## Board Columns".to_string(),
        String::new(),
        available_columns.to_string(),
        String::new(),
        evidence_bundle_section.join("\n"),
        "## Lane Guidance".to_string(),
        String::new(),
        lane_guidance.join("\n"),
        String::new(),
        "## Allowed Actions".to_string(),
        String::new(),
        format!(
            "1. Update progress on this card with `routa-coordination_update_card` for card `{}`.",
            task.id
        ),
        format!(
            "2. When the current lane is complete, advance the same card with `routa-coordination_move_card` to column `{}`.",
            next_column_id.unwrap_or("the exact next column id listed above")
        ),
        "3. If you are blocked, update this same card with the blocking reason instead of exploring side quests.".to_string(),
        String::new(),
        "## Instructions".to_string(),
        String::new(),
        "1. Start work for this lane immediately.".to_string(),
        "2. Keep work scoped to this card only.".to_string(),
        "3. Record progress with the exact tool name `routa-coordination_update_card`.".to_string(),
        format!(
            "4. Move the same card forward with the exact tool name `routa-coordination_move_card` and targetColumnId `{}` when this lane is complete.",
            next_column_id.unwrap_or("the exact next column id listed above")
        ),
        "5. Do not guess board ids or column ids. Use the Board ID and Board Columns listed above.".to_string(),
        "6. Treat lane guidance as stricter than the general card objective when they conflict.".to_string(),
        "7. Do not run browser tests or environment diagnostics unless the card explicitly asks for them.".to_string(),
    ]
    .join("\n")
}

pub(super) async fn trigger_assigned_task_agent(
    state: &AppState,
    task: &mut Task,
) -> Result<(), String> {
    let board = load_task_board(state, task).await?;
    let step = resolve_task_automation_step(board.as_ref(), task);
    if is_a2a_step(step.as_ref()) {
        return trigger_assigned_task_a2a_agent(state, task, board.as_ref(), step.as_ref()).await;
    }

    trigger_assigned_task_acp_agent(state, task, board.as_ref(), step.as_ref()).await
}

async fn trigger_assigned_task_acp_agent(
    state: &AppState,
    task: &mut Task,
    board: Option<&KanbanBoard>,
    step: Option<&KanbanAutomationStep>,
) -> Result<(), String> {
    let provider = task
        .assigned_provider
        .clone()
        .unwrap_or_else(|| "opencode".to_string());
    let role = task
        .assigned_role
        .clone()
        .unwrap_or_else(|| "CRAFTER".to_string())
        .to_uppercase();
    let session_id = uuid::Uuid::new_v4().to_string();
    let cwd = resolve_task_session_cwd(state, task).await?;

    state
        .acp_manager
        .create_session(
            session_id.clone(),
            cwd.clone(),
            task.workspace_id.clone(),
            Some(provider.clone()),
            Some(role.clone()),
            None,
            None,
            Some("full".to_string()),
            Some("kanban-planning".to_string()),
        )
        .await
        .map_err(|error| format!("Failed to create ACP session: {error}"))?;

    state
        .acp_session_store
        .create(CreateAcpSessionParams {
            id: &session_id,
            cwd: &cwd,
            branch: None,
            workspace_id: &task.workspace_id,
            provider: Some(provider.as_str()),
            role: Some(role.as_str()),
            custom_command: None,
            custom_args: None,
            parent_session_id: None,
        })
        .await
        .map_err(|error| format!("Failed to persist ACP session: {error}"))?;

    let mut ordered_columns = board.map(|value| value.columns.clone()).unwrap_or_default();
    ordered_columns.sort_by_key(|column| column.position);
    let next_column_id = ordered_columns
        .iter()
        .position(|column| Some(column.id.as_str()) == task.column_id.as_deref())
        .and_then(|index| ordered_columns.get(index + 1))
        .map(|column| column.id.clone());
    let available_columns = if ordered_columns.is_empty() {
        "- unavailable".to_string()
    } else {
        ordered_columns
            .iter()
            .map(|column| {
                format!(
                    "- {} ({}) stage={} position={}",
                    column.id, column.name, column.stage, column.position
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let prompt = build_task_prompt(
        task,
        board
            .map(|value| value.id.as_str())
            .or(task.board_id.as_deref()),
        next_column_id.as_deref(),
        &available_columns,
        Some(&build_task_story_readiness(
            task,
            &resolve_next_required_task_fields(board, task.column_id.as_deref()),
        )),
        Some(&build_task_invest_validation(task)),
        Some(&build_task_evidence_summary(
            task,
            &state
                .artifact_store
                .list_by_task(&task.id)
                .await
                .map_err(|error| format!("Failed to load task artifacts: {error}"))?,
            &resolve_next_required_artifacts(board, task.column_id.as_deref()),
        )),
    );
    let state_clone = state.clone();
    let session_id_clone = session_id.clone();
    let workspace_id = task.workspace_id.clone();
    let provider_clone = provider.clone();
    let cwd_clone = cwd.clone();
    if let Err(error) = state
        .acp_session_store
        .set_first_prompt_sent(&session_id)
        .await
    {
        tracing::error!(
            target: "routa_kanban_prompt",
            session_id = %session_id,
            workspace_id = %task.workspace_id,
            error = %error,
            "kanban lane prompt failed to mark prompt dispatched"
        );
    } else {
        tracing::info!(
            target: "routa_kanban_prompt",
            session_id = %session_id,
            workspace_id = %task.workspace_id,
            provider = %provider,
            "kanban lane prompt marked prompt dispatched"
        );
    }
    tracing::info!(
        target: "routa_kanban_prompt",
        session_id = %session_id_clone,
        workspace_id = %workspace_id,
        provider = %provider_clone,
        cwd = %cwd_clone,
        "kanban lane prompt scheduled"
    );
    tokio::spawn(async move {
        tracing::info!(
            target: "routa_kanban_prompt",
            session_id = %session_id_clone,
            workspace_id = %workspace_id,
            provider = %provider_clone,
            cwd = %cwd_clone,
            "kanban lane prompt start"
        );
        if let Err(error) = state_clone
            .acp_manager
            .prompt(&session_id_clone, &prompt)
            .await
        {
            tracing::error!(
                target: "routa_kanban_prompt",
                session_id = %session_id_clone,
                workspace_id = %workspace_id,
                provider = %provider_clone,
                error = %error,
                "kanban lane prompt failed"
            );
            return;
        }

        tracing::info!(
            target: "routa_kanban_prompt",
            session_id = %session_id_clone,
            workspace_id = %workspace_id,
            provider = %provider_clone,
            "kanban lane prompt success"
        );

        if let Some(history) = state_clone
            .acp_manager
            .get_session_history(&session_id_clone)
            .await
        {
            if let Err(error) = state_clone
                .acp_session_store
                .save_history(&session_id_clone, &history)
                .await
            {
                tracing::error!(
                    target: "routa_kanban_prompt",
                    session_id = %session_id_clone,
                    workspace_id = %workspace_id,
                    error = %error,
                    "kanban lane prompt failed to persist history"
                );
            } else {
                tracing::info!(
                    target: "routa_kanban_prompt",
                    session_id = %session_id_clone,
                    workspace_id = %workspace_id,
                    history_len = history.len(),
                    "kanban lane prompt persisted history"
                );
            }
        }
    });

    apply_trigger_result(
        task,
        board,
        step,
        AgentTriggerResult {
            session_id,
            transport: "acp".to_string(),
            external_task_id: None,
            context_id: None,
        },
    );

    Ok(())
}

async fn resolve_task_session_cwd(state: &AppState, task: &Task) -> Result<String, String> {
    if let Some(worktree_id) = task.worktree_id.as_deref() {
        if let Some(worktree) = state
            .worktree_store
            .get(worktree_id)
            .await
            .map_err(|error| format!("Failed to resolve task worktree: {error}"))?
        {
            if !worktree.worktree_path.trim().is_empty() {
                return Ok(worktree.worktree_path);
            }
        }
    }

    for codebase_id in &task.codebase_ids {
        if let Some(codebase) = state
            .codebase_store
            .get(codebase_id)
            .await
            .map_err(|error| format!("Failed to resolve task codebase: {error}"))?
        {
            if !codebase.repo_path.trim().is_empty() {
                return Ok(codebase.repo_path);
            }
        }
    }

    if let Some(codebase) = state
        .codebase_store
        .get_default(&task.workspace_id)
        .await
        .map_err(|error| format!("Failed to resolve default codebase: {error}"))?
    {
        if !codebase.repo_path.trim().is_empty() {
            return Ok(codebase.repo_path);
        }
    }

    let codebases = state
        .codebase_store
        .list_by_workspace(&task.workspace_id)
        .await
        .map_err(|error| format!("Failed to list workspace codebases: {error}"))?;
    if let Some(codebase) = codebases
        .into_iter()
        .find(|codebase| !codebase.repo_path.trim().is_empty())
    {
        return Ok(codebase.repo_path);
    }

    Ok(std::env::current_dir()
        .ok()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string()))
}

pub(super) fn apply_trigger_result(
    task: &mut Task,
    board: Option<&KanbanBoard>,
    step: Option<&KanbanAutomationStep>,
    result: AgentTriggerResult,
) {
    let now = Utc::now().to_rfc3339();
    for session in &mut task.lane_sessions {
        if session.session_id == result.session_id
            || session.status != TaskLaneSessionStatus::Running
        {
            continue;
        }
        if session.column_id.as_deref() == task.column_id.as_deref() {
            continue;
        }

        session.status = TaskLaneSessionStatus::Completed;
        if session.completed_at.is_none() {
            session.completed_at = Some(now.clone());
        }
    }

    task.trigger_session_id = Some(result.session_id.clone());
    if !task.session_ids.iter().any(|id| id == &result.session_id) {
        task.session_ids.push(result.session_id.clone());
    }

    let column_name = board.and_then(|value| {
        value.columns.iter().find_map(|column| {
            (Some(column.id.as_str()) == task.column_id.as_deref()).then(|| column.name.clone())
        })
    });
    let lane_session = TaskLaneSession {
        session_id: result.session_id.clone(),
        routa_agent_id: None,
        column_id: task.column_id.clone(),
        column_name,
        step_id: step.map(|value| value.id.clone()),
        step_index: None,
        step_name: step
            .and_then(|value| value.specialist_name.clone())
            .or_else(|| task.assigned_specialist_name.clone()),
        provider: task.assigned_provider.clone(),
        role: task.assigned_role.clone(),
        specialist_id: task.assigned_specialist_id.clone(),
        specialist_name: task.assigned_specialist_name.clone(),
        transport: Some(result.transport),
        external_task_id: result.external_task_id,
        context_id: result.context_id,
        attempt: Some(1),
        loop_mode: None,
        completion_requirement: None,
        objective: Some(task.objective.clone()),
        last_activity_at: Some(now.clone()),
        recovered_from_session_id: None,
        recovery_reason: None,
        status: TaskLaneSessionStatus::Running,
        started_at: now,
        completed_at: None,
    };

    if let Some(existing) = task
        .lane_sessions
        .iter_mut()
        .find(|existing| existing.session_id == result.session_id)
    {
        *existing = lane_session;
    } else {
        task.lane_sessions.push(lane_session);
    }
}

pub(super) async fn load_task_board(
    state: &AppState,
    task: &Task,
) -> Result<Option<KanbanBoard>, String> {
    if let Some(board_id) = task.board_id.as_deref() {
        state
            .kanban_store
            .get(board_id)
            .await
            .map_err(|error| format!("Failed to load Kanban board for automation: {error}"))
    } else {
        Ok(None)
    }
}

fn resolve_task_automation_step(
    board: Option<&KanbanBoard>,
    task: &Task,
) -> Option<KanbanAutomationStep> {
    board
        .and_then(|value| {
            value
                .columns
                .iter()
                .find(|column| Some(column.id.as_str()) == task.column_id.as_deref())
        })
        .and_then(|column| column.automation.as_ref())
        .filter(|automation| automation.enabled)
        .and_then(|automation| automation.primary_step())
}

#[cfg(test)]
pub(super) fn absolutize_url(base_url: &str, maybe_relative: &str) -> Result<String, String> {
    a2a::absolutize_url(base_url, maybe_relative)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::models::codebase::Codebase;
    use crate::models::kanban::{KanbanAutomationStep, KanbanBoard, KanbanColumn};
    use crate::models::task::Task;
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
    async fn resolve_task_session_cwd_falls_back_to_first_workspace_codebase() {
        let state = setup_state().await;
        let codebase = Codebase::new(
            "cb-1".to_string(),
            "default".to_string(),
            "/Users/phodal/.routa/repos/phodal--routa".to_string(),
            Some("main".to_string()),
            Some("routa".to_string()),
            false,
            None,
            None,
        );
        state
            .codebase_store
            .save(&codebase)
            .await
            .expect("codebase save should succeed");

        let task = Task::new(
            "task-1".to_string(),
            "Resolve cwd".to_string(),
            "Use the workspace codebase".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );

        let cwd = resolve_task_session_cwd(&state, &task)
            .await
            .expect("cwd resolution should succeed");

        assert_eq!(cwd, "/Users/phodal/.routa/repos/phodal--routa");
    }

    #[test]
    fn apply_trigger_result_completes_running_sessions_from_previous_lanes() {
        let mut task = Task::new(
            "task-2".to_string(),
            "Advance to todo".to_string(),
            "Finish backlog before todo starts".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        task.column_id = Some("todo".to_string());
        task.assigned_role = Some("ROUTA".to_string());
        task.assigned_specialist_name = Some("Todo Orchestrator".to_string());
        task.lane_sessions.push(TaskLaneSession {
            session_id: "session-backlog-1".to_string(),
            routa_agent_id: None,
            column_id: Some("backlog".to_string()),
            column_name: Some("Backlog".to_string()),
            step_id: None,
            step_index: None,
            step_name: Some("Backlog Refiner".to_string()),
            provider: Some("claude".to_string()),
            role: Some("ROUTA".to_string()),
            specialist_id: None,
            specialist_name: Some("Backlog Refiner".to_string()),
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

        let board = KanbanBoard {
            id: "board-2".to_string(),
            workspace_id: "default".to_string(),
            name: "Board".to_string(),
            is_default: true,
            github_token: None,
            columns: vec![KanbanColumn {
                id: "todo".to_string(),
                name: "Todo".to_string(),
                color: None,
                position: 1,
                stage: "todo".to_string(),
                automation: None,
                visible: Some(true),
                width: None,
            }],
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let step = KanbanAutomationStep {
            id: "todo-step".to_string(),
            specialist_name: Some("Todo Orchestrator".to_string()),
            ..Default::default()
        };

        apply_trigger_result(
            &mut task,
            Some(&board),
            Some(&step),
            AgentTriggerResult {
                session_id: "session-todo-1".to_string(),
                transport: "acp".to_string(),
                external_task_id: None,
                context_id: None,
            },
        );

        assert_eq!(task.trigger_session_id.as_deref(), Some("session-todo-1"));
        assert_eq!(task.lane_sessions.len(), 2);
        assert_eq!(
            task.lane_sessions[0].status,
            TaskLaneSessionStatus::Completed
        );
        assert!(task.lane_sessions[0].completed_at.is_some());
        assert_eq!(task.lane_sessions[1].status, TaskLaneSessionStatus::Running);
        assert_eq!(task.lane_sessions[1].column_id.as_deref(), Some("todo"));
    }
}
