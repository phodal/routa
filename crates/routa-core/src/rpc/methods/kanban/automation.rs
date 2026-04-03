use chrono::Utc;
use reqwest::header::{HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::events::{AgentEvent, AgentEventType};
use crate::models::kanban::{KanbanAutomationStep, KanbanBoard, KanbanColumn, KanbanTransport};
use crate::models::task::{
    build_task_evidence_summary, build_task_invest_validation, build_task_story_readiness, Task,
    TaskEvidenceSummary, TaskInvestValidation, TaskLaneSession, TaskLaneSessionStatus,
    TaskStoryReadiness,
};
use crate::rpc::error::RpcError;
use crate::state::AppState;
use crate::store::acp_session_store::CreateAcpSessionParams;

const A2A_POLL_INTERVAL: Duration = Duration::from_secs(1);
const A2A_MAX_WAIT: Duration = Duration::from_secs(300);
const A2A_AUTH_CONFIGS_ENV: &str = "ROUTA_A2A_AUTH_CONFIGS";

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
            .map(|value| format!("**Board ID:** {}", value))
            .unwrap_or_else(|| "**Board ID:** unavailable".to_string()),
        format!("**Current Lane:** {}", lane_id),
        next_column_id
            .map(|value| format!("**Next Column ID:** {}", value))
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

async fn trigger_assigned_task_agent(state: &AppState, task: &mut Task) -> Result<(), String> {
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
    let cwd = resolve_task_session_cwd(state, &task.workspace_id).await?;

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
        .map_err(|error| format!("Failed to create ACP session: {}", error))?;

    state
        .acp_session_store
        .create(CreateAcpSessionParams {
            id: &session_id,
            cwd: &cwd,
            branch: None,
            workspace_id: &task.workspace_id,
            provider: Some(provider.as_str()),
            role: Some(role.as_str()),
            parent_session_id: None,
        })
        .await
        .map_err(|error| format!("Failed to persist ACP session: {}", error))?;

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
                .map_err(|error| format!("Failed to load task artifacts: {}", error))?,
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

async fn resolve_task_session_cwd(state: &AppState, workspace_id: &str) -> Result<String, String> {
    if let Some(codebase) = state
        .codebase_store
        .get_default(workspace_id)
        .await
        .map_err(|error| format!("Failed to resolve default codebase: {}", error))?
    {
        if !codebase.repo_path.trim().is_empty() {
            return Ok(codebase.repo_path);
        }
    }

    let codebases = state
        .codebase_store
        .list_by_workspace(workspace_id)
        .await
        .map_err(|error| format!("Failed to list workspace codebases: {}", error))?;
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

async fn trigger_assigned_task_a2a_agent(
    state: &AppState,
    task: &mut Task,
    board: Option<&KanbanBoard>,
    step: Option<&KanbanAutomationStep>,
) -> Result<(), String> {
    let step = step.ok_or_else(|| "A2A automation requires a resolved column step".to_string())?;
    let agent_card_url = step
        .agent_card_url
        .as_deref()
        .ok_or_else(|| "A2A automation requires agentCardUrl".to_string())?;
    let auth_headers = resolve_a2a_auth_headers(step.auth_config_id.as_deref())?;

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
                .map_err(|error| format!("Failed to load task artifacts: {}", error))?,
            &resolve_next_required_artifacts(board, task.column_id.as_deref()),
        )),
    );

    let client = reqwest::Client::new();
    let rpc_endpoint =
        resolve_a2a_rpc_endpoint(&client, agent_card_url, auth_headers.as_ref()).await?;
    let request_id = uuid::Uuid::new_v4().to_string();
    let message_id = uuid::Uuid::new_v4().to_string();
    let response = apply_a2a_auth_headers(
        client
            .post(&rpc_endpoint)
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json")
            .json(&json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "SendMessage",
                "params": {
                    "message": {
                        "messageId": message_id,
                        "role": "user",
                        "parts": [{ "text": prompt }]
                    },
                    "metadata": {
                        "workspaceId": task.workspace_id,
                        "taskId": task.id,
                        "boardId": task.board_id,
                        "columnId": task.column_id,
                        "stepId": step.id,
                        "skillId": step.skill_id,
                        "authConfigId": step.auth_config_id,
                        "role": task.assigned_role,
                    }
                }
            })),
        auth_headers.as_ref(),
    )?
    .send()
    .await
    .map_err(|error| format!("Failed to send A2A request: {}", error))?;

    if !response.status().is_success() {
        return Err(format!(
            "A2A request failed with HTTP {}",
            response.status().as_u16()
        ));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to decode A2A response: {}", error))?;
    if let Some(error) = payload.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown A2A error");
        return Err(format!("A2A JSON-RPC error: {}", message));
    }

    let task_result = payload
        .get("result")
        .and_then(|value| value.get("task"))
        .ok_or_else(|| "A2A response missing result.task".to_string())?;
    let external_task_id = task_result
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "A2A response missing task.id".to_string())?
        .to_string();
    let context_id = task_result
        .get("contextId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let session_id = format!("a2a-{}", uuid::Uuid::new_v4());

    apply_trigger_result(
        task,
        board,
        Some(step),
        AgentTriggerResult {
            session_id: session_id.clone(),
            transport: "a2a".to_string(),
            external_task_id: Some(external_task_id.clone()),
            context_id,
        },
    );

    let state_clone = state.clone();
    let task_id = task.id.clone();
    let workspace_id = task.workspace_id.clone();
    tokio::spawn(async move {
        monitor_a2a_task_completion(
            &state_clone,
            &workspace_id,
            &task_id,
            &session_id,
            &rpc_endpoint,
            &external_task_id,
            auth_headers,
        )
        .await;
    });

    Ok(())
}

pub(super) fn apply_trigger_result(
    task: &mut Task,
    board: Option<&KanbanBoard>,
    step: Option<&KanbanAutomationStep>,
    result: AgentTriggerResult,
) {
    task.trigger_session_id = Some(result.session_id.clone());
    if !task.session_ids.iter().any(|id| id == &result.session_id) {
        task.session_ids.push(result.session_id.clone());
    }

    let column_name = board.and_then(|value| {
        value.columns.iter().find_map(|column| {
            (Some(column.id.as_str()) == task.column_id.as_deref()).then(|| column.name.clone())
        })
    });
    let now = Utc::now().to_rfc3339();
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

async fn load_task_board(state: &AppState, task: &Task) -> Result<Option<KanbanBoard>, String> {
    if let Some(board_id) = task.board_id.as_deref() {
        state
            .kanban_store
            .get(board_id)
            .await
            .map_err(|error| format!("Failed to load Kanban board for automation: {}", error))
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

fn is_a2a_step(step: Option<&KanbanAutomationStep>) -> bool {
    step.is_some_and(|value| {
        matches!(value.transport, Some(KanbanTransport::A2a)) || value.agent_card_url.is_some()
    })
}

#[derive(Debug)]
struct A2ATaskTerminalUpdate {
    status: TaskLaneSessionStatus,
    completed_at: String,
    last_activity_at: String,
    context_id: Option<String>,
    error: Option<String>,
}

async fn monitor_a2a_task_completion(
    state: &AppState,
    workspace_id: &str,
    task_id: &str,
    session_id: &str,
    rpc_endpoint: &str,
    external_task_id: &str,
    auth_headers: Option<HashMap<String, String>>,
) {
    let client = reqwest::Client::new();
    let terminal = match wait_for_a2a_completion(
        &client,
        rpc_endpoint,
        external_task_id,
        auth_headers.as_ref(),
    )
    .await
    {
        Ok(terminal) => terminal,
        Err(error) => {
            let now = Utc::now().to_rfc3339();
            let status = if error.contains("did not complete within") {
                TaskLaneSessionStatus::TimedOut
            } else {
                TaskLaneSessionStatus::Failed
            };
            A2ATaskTerminalUpdate {
                status,
                completed_at: now.clone(),
                last_activity_at: now,
                context_id: None,
                error: Some(error),
            }
        }
    };

    if let Err(error) =
        reconcile_a2a_lane_session(state, task_id, session_id, external_task_id, terminal).await
    {
        tracing::warn!(
            target: "routa_a2a",
            workspace_id = %workspace_id,
            task_id = %task_id,
            session_id = %session_id,
            external_task_id = %external_task_id,
            error = %error,
            "failed to persist A2A terminal state"
        );
        return;
    }

    emit_kanban_workspace_event(state, workspace_id, task_id).await;
}

async fn wait_for_a2a_completion(
    client: &reqwest::Client,
    rpc_endpoint: &str,
    task_id: &str,
    auth_headers: Option<&HashMap<String, String>>,
) -> Result<A2ATaskTerminalUpdate, String> {
    let started_at = Instant::now();

    loop {
        let terminal = get_a2a_task_update(client, rpc_endpoint, task_id, auth_headers).await?;
        if let Some(terminal) = terminal {
            return Ok(terminal);
        }
        if started_at.elapsed() >= A2A_MAX_WAIT {
            return Err(format!(
                "A2A task {task_id} did not complete within {}ms",
                A2A_MAX_WAIT.as_millis()
            ));
        }
        tokio::time::sleep(A2A_POLL_INTERVAL).await;
    }
}

async fn get_a2a_task_update(
    client: &reqwest::Client,
    rpc_endpoint: &str,
    task_id: &str,
    auth_headers: Option<&HashMap<String, String>>,
) -> Result<Option<A2ATaskTerminalUpdate>, String> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let response = apply_a2a_auth_headers(
        client
            .post(rpc_endpoint)
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json")
            .json(&json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "GetTask",
                "params": { "id": task_id }
            })),
        auth_headers,
    )?
    .send()
    .await
    .map_err(|error| format!("Failed to poll A2A task: {}", error))?;

    if !response.status().is_success() {
        return Err(format!(
            "A2A GetTask failed with HTTP {}",
            response.status().as_u16()
        ));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to decode A2A task payload: {}", error))?;
    if let Some(error) = payload.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown A2A error");
        return Err(format!("A2A JSON-RPC error: {}", message));
    }

    let task = payload
        .get("result")
        .and_then(|value| value.get("task"))
        .ok_or_else(|| "A2A response missing result.task".to_string())?;
    let state = task
        .get("status")
        .and_then(|value| value.get("state"))
        .and_then(Value::as_str)
        .ok_or_else(|| "A2A task missing status.state".to_string())?;
    if !is_terminal_a2a_state(state) {
        return Ok(None);
    }

    let timestamp = task
        .get("status")
        .and_then(|value| value.get("timestamp"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let context_id = task
        .get("contextId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let error = if state == "completed" {
        None
    } else {
        Some(
            extract_a2a_status_message(task)
                .unwrap_or_else(|| format!("A2A task ended in state: {state}")),
        )
    };

    Ok(Some(A2ATaskTerminalUpdate {
        status: map_a2a_terminal_status(state),
        completed_at: timestamp.clone(),
        last_activity_at: timestamp,
        context_id,
        error,
    }))
}

fn extract_a2a_status_message(task: &Value) -> Option<String> {
    let parts = task
        .get("status")
        .and_then(|value| value.get("message"))
        .and_then(|value| value.get("parts"))
        .and_then(Value::as_array)?;
    let text = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    (!text.is_empty()).then_some(text)
}

fn is_terminal_a2a_state(state: &str) -> bool {
    matches!(
        state,
        "completed" | "failed" | "canceled" | "rejected" | "auth-required"
    )
}

fn map_a2a_terminal_status(state: &str) -> TaskLaneSessionStatus {
    match state {
        "completed" => TaskLaneSessionStatus::Completed,
        _ => TaskLaneSessionStatus::Failed,
    }
}

async fn reconcile_a2a_lane_session(
    state: &AppState,
    task_id: &str,
    session_id: &str,
    external_task_id: &str,
    terminal: A2ATaskTerminalUpdate,
) -> Result<(), String> {
    let mut task = wait_for_task_persistence(state, task_id, session_id).await?;
    let lane_session = task
        .lane_sessions
        .iter_mut()
        .find(|session| session.session_id == session_id)
        .ok_or_else(|| format!("Task {task_id} missing lane session {session_id}"))?;

    lane_session.status = terminal.status;
    lane_session.completed_at = Some(terminal.completed_at.clone());
    lane_session.last_activity_at = Some(terminal.last_activity_at.clone());
    if lane_session.external_task_id.is_none() {
        lane_session.external_task_id = Some(external_task_id.to_string());
    }
    if terminal.context_id.is_some() {
        lane_session.context_id = terminal.context_id.clone();
    }

    if task.trigger_session_id.as_deref() == Some(session_id) {
        task.trigger_session_id = None;
    }
    task.last_sync_error = terminal.error;
    task.updated_at = Utc::now();

    state
        .task_store
        .save(&task)
        .await
        .map_err(|error| format!("Failed to save A2A task reconciliation: {}", error))
}

async fn wait_for_task_persistence(
    state: &AppState,
    task_id: &str,
    session_id: &str,
) -> Result<Task, String> {
    for _ in 0..20 {
        if let Some(task) = state
            .task_store
            .get(task_id)
            .await
            .map_err(|error| format!("Failed to load task {task_id}: {}", error))?
        {
            if task
                .lane_sessions
                .iter()
                .any(|session| session.session_id == session_id)
            {
                return Ok(task);
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    Err(format!(
        "Task {task_id} did not persist lane session {session_id} before A2A reconciliation"
    ))
}

async fn emit_kanban_workspace_event(state: &AppState, workspace_id: &str, task_id: &str) {
    state
        .event_bus
        .emit(AgentEvent {
            event_type: AgentEventType::WorkspaceUpdated,
            agent_id: "kanban-a2a".to_string(),
            workspace_id: workspace_id.to_string(),
            data: serde_json::json!({
                "scope": "kanban",
                "entity": "task",
                "action": "updated",
                "resourceId": task_id,
                "source": "system",
            }),
            timestamp: Utc::now(),
        })
        .await;
}

fn resolve_a2a_auth_headers(
    auth_config_id: Option<&str>,
) -> Result<Option<HashMap<String, String>>, String> {
    let Some(auth_config_id) = auth_config_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let raw = std::env::var(A2A_AUTH_CONFIGS_ENV).unwrap_or_default();
    if raw.trim().is_empty() {
        return Err(format!(
            "A2A auth config \"{}\" was not found in {}.",
            auth_config_id, A2A_AUTH_CONFIGS_ENV
        ));
    }

    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|error| format!("Invalid {} JSON: {}", A2A_AUTH_CONFIGS_ENV, error))?;
    let config = parsed.get(auth_config_id).ok_or_else(|| {
        format!(
            "A2A auth config \"{}\" was not found in {}.",
            auth_config_id, A2A_AUTH_CONFIGS_ENV
        )
    })?;
    let headers = config.get("headers").unwrap_or(config);
    let headers_obj = headers.as_object().ok_or_else(|| {
        format!(
            "{}.{} must be a header map or contain a string header map in \"headers\".",
            A2A_AUTH_CONFIGS_ENV, auth_config_id
        )
    })?;

    let mut resolved = HashMap::new();
    for (name, value) in headers_obj {
        let value = value.as_str().ok_or_else(|| {
            format!(
                "{}.{} header {} must be a string.",
                A2A_AUTH_CONFIGS_ENV, auth_config_id, name
            )
        })?;
        resolved.insert(name.clone(), value.to_string());
    }

    Ok(Some(resolved))
}

fn apply_a2a_auth_headers(
    mut request: reqwest::RequestBuilder,
    auth_headers: Option<&HashMap<String, String>>,
) -> Result<reqwest::RequestBuilder, String> {
    if let Some(auth_headers) = auth_headers {
        for (name, value) in auth_headers {
            let header_name = HeaderName::try_from(name.as_str())
                .map_err(|error| format!("Invalid A2A auth header name {}: {}", name, error))?;
            let header_value = HeaderValue::from_str(value).map_err(|error| {
                format!(
                    "Invalid A2A auth header value for {}: {}",
                    header_name.as_str(),
                    error
                )
            })?;
            request = request.header(header_name, header_value);
        }
    }

    Ok(request)
}

async fn resolve_a2a_rpc_endpoint(
    client: &reqwest::Client,
    url: &str,
    auth_headers: Option<&HashMap<String, String>>,
) -> Result<String, String> {
    if url.ends_with(".json") || url.ends_with("/agent-card") || url.ends_with("/card") {
        let response = apply_a2a_auth_headers(client.get(url), auth_headers)?
            .send()
            .await
            .map_err(|error| format!("Failed to fetch A2A agent card: {}", error))?;
        if !response.status().is_success() {
            return Err(format!(
                "A2A agent card fetch failed with HTTP {}",
                response.status().as_u16()
            ));
        }
        let card: Value = response
            .json()
            .await
            .map_err(|error| format!("Failed to decode A2A agent card: {}", error))?;
        let rpc_url = card
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| "A2A agent card missing url".to_string())?;
        absolutize_url(url, rpc_url)
    } else {
        Ok(url.to_string())
    }
}

pub(super) fn absolutize_url(base_url: &str, maybe_relative: &str) -> Result<String, String> {
    if maybe_relative.starts_with("http://") || maybe_relative.starts_with("https://") {
        return Ok(maybe_relative.to_string());
    }

    let base = reqwest::Url::parse(base_url)
        .map_err(|error| format!("Invalid base A2A URL {}: {}", base_url, error))?;
    base.join(maybe_relative)
        .map(|url| url.to_string())
        .map_err(|error| format!("Invalid relative A2A URL {}: {}", maybe_relative, error))
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

        let cwd = resolve_task_session_cwd(&state, "default")
            .await
            .expect("cwd resolution should succeed");

        assert_eq!(cwd, "/Users/phodal/.routa/repos/phodal--routa");
    }

    #[tokio::test]
    async fn reconcile_a2a_lane_session_marks_terminal_state() {
        let state = setup_state().await;
        let mut task = Task::new(
            "task-1".to_string(),
            "A2A completion".to_string(),
            "Track remote completion".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        task.board_id = Some("board-1".to_string());
        task.column_id = Some("todo".to_string());
        task.assigned_role = Some("CRAFTER".to_string());
        task.assigned_specialist_name = Some("Todo Remote Worker".to_string());

        let board = KanbanBoard {
            id: "board-1".to_string(),
            workspace_id: "default".to_string(),
            name: "Board".to_string(),
            is_default: true,
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
            id: "todo-a2a".to_string(),
            specialist_name: Some("Todo Remote Worker".to_string()),
            ..Default::default()
        };

        apply_trigger_result(
            &mut task,
            Some(&board),
            Some(&step),
            AgentTriggerResult {
                session_id: "a2a-session-1".to_string(),
                transport: "a2a".to_string(),
                external_task_id: Some("remote-task-1".to_string()),
                context_id: Some("ctx-1".to_string()),
            },
        );
        state
            .task_store
            .save(&task)
            .await
            .expect("task save should succeed");

        reconcile_a2a_lane_session(
            &state,
            &task.id,
            "a2a-session-1",
            "remote-task-1",
            A2ATaskTerminalUpdate {
                status: TaskLaneSessionStatus::Completed,
                completed_at: "2026-03-21T00:00:05Z".to_string(),
                last_activity_at: "2026-03-21T00:00:05Z".to_string(),
                context_id: Some("ctx-1".to_string()),
                error: None,
            },
        )
        .await
        .expect("reconciliation should succeed");

        let updated = state
            .task_store
            .get(&task.id)
            .await
            .expect("task lookup should succeed")
            .expect("task should exist");
        assert_eq!(updated.trigger_session_id, None);
        assert_eq!(updated.last_sync_error, None);
        assert_eq!(updated.lane_sessions.len(), 1);
        let lane_session = &updated.lane_sessions[0];
        assert_eq!(lane_session.status, TaskLaneSessionStatus::Completed);
        assert_eq!(
            lane_session.completed_at.as_deref(),
            Some("2026-03-21T00:00:05Z")
        );
        assert_eq!(lane_session.context_id.as_deref(), Some("ctx-1"));
    }
}
