use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::models::task::TaskStatus;

/// Transport protocol for Kanban automation
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum KanbanTransport {
    /// Agent Chat Protocol (default)
    #[default]
    Acp,
    /// Agent-to-Agent protocol
    A2a,
}

/// Automation configuration for a Kanban column.
/// When a card is moved to this column, the automation can trigger an agent session.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KanbanAutomationStep {
    pub id: String,
    /// Transport protocol for this automation step
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<KanbanTransport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialist_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialist_name: Option<String>,
    /// A2A-specific: URL of the agent card to invoke
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_card_url: Option<String>,
    /// A2A-specific: Skill ID to invoke on the agent
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_id: Option<String>,
    /// A2A-specific: Auth configuration ID for the request
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_config_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KanbanColumnAutomation {
    /// Whether automation is enabled for this column
    #[serde(default)]
    pub enabled: bool,
    /// Ordered automation steps to run within the same lane
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<KanbanAutomationStep>>,
    /// Provider ID to use for the automation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    /// Role for the agent (CRAFTER, ROUTA, GATE, DEVELOPER)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// Specialist ID to use
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialist_id: Option<String>,
    /// Specialist name (for display)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialist_name: Option<String>,
    /// When to trigger: entry, exit, or both
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transition_type: Option<String>,
    /// Required artifacts before advancing
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_artifacts: Option<Vec<String>>,
    /// Required task fields before advancing
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_task_fields: Option<Vec<String>>,
    /// Automatically advance card on session success
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_advance_on_success: Option<bool>,
}

impl KanbanColumnAutomation {
    pub fn primary_step(&self) -> Option<KanbanAutomationStep> {
        if !self.enabled {
            return None;
        }

        if let Some(step) = self.steps.as_ref().and_then(|steps| {
            steps.iter().find(|step| {
                matches!(step.transport, Some(KanbanTransport::A2a))
                    || step.provider_id.is_some()
                    || step.role.is_some()
                    || step.specialist_id.is_some()
                    || step.specialist_name.is_some()
                    || step.agent_card_url.is_some()
                    || step.skill_id.is_some()
                    || step.auth_config_id.is_some()
            })
        }) {
            return Some(step.clone());
        }

        Some(KanbanAutomationStep {
            id: "step-1".to_string(),
            transport: None, // defaults to Acp
            provider_id: self.provider_id.clone(),
            role: self.role.clone(),
            specialist_id: self.specialist_id.clone(),
            specialist_name: self.specialist_name.clone(),
            agent_card_url: None,
            skill_id: None,
            auth_config_id: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{KanbanAutomationStep, KanbanColumnAutomation, KanbanTransport};

    #[test]
    fn primary_step_keeps_a2a_only_steps() {
        let automation = KanbanColumnAutomation {
            enabled: true,
            steps: Some(vec![KanbanAutomationStep {
                id: "step-a2a".to_string(),
                transport: Some(KanbanTransport::A2a),
                provider_id: None,
                role: None,
                specialist_id: None,
                specialist_name: None,
                agent_card_url: Some("https://example.com/agent-card.json".to_string()),
                skill_id: Some("skill-1".to_string()),
                auth_config_id: Some("auth-1".to_string()),
            }]),
            ..Default::default()
        };

        let step = automation
            .primary_step()
            .expect("a2a step should be preserved");
        assert_eq!(step.id, "step-a2a");
        assert_eq!(step.transport, Some(KanbanTransport::A2a));
        assert_eq!(
            step.agent_card_url.as_deref(),
            Some("https://example.com/agent-card.json")
        );
        assert_eq!(step.skill_id.as_deref(), Some("skill-1"));
        assert_eq!(step.auth_config_id.as_deref(), Some("auth-1"));
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KanbanColumn {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub position: i64,
    pub stage: String,
    /// Whether the column is visible on the board
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visible: Option<bool>,
    /// Column visual width configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<String>,
    /// Automation configuration for this column
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation: Option<KanbanColumnAutomation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanBoard {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub is_default: bool,
    pub columns: Vec<KanbanColumn>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub fn default_kanban_columns() -> Vec<KanbanColumn> {
    vec![
        KanbanColumn {
            id: "backlog".to_string(),
            name: "Backlog".to_string(),
            color: Some("slate".to_string()),
            position: 0,
            stage: "backlog".to_string(),
            automation: None,
            visible: Some(true),
            width: None,
        },
        KanbanColumn {
            id: "todo".to_string(),
            name: "Todo".to_string(),
            color: Some("sky".to_string()),
            position: 1,
            stage: "todo".to_string(),
            automation: None,
            visible: Some(true),
            width: None,
        },
        KanbanColumn {
            id: "dev".to_string(),
            name: "Dev".to_string(),
            color: Some("amber".to_string()),
            position: 2,
            stage: "dev".to_string(),
            automation: None,
            visible: Some(true),
            width: None,
        },
        KanbanColumn {
            id: "review".to_string(),
            name: "Review".to_string(),
            color: Some("slate".to_string()),
            position: 3,
            stage: "review".to_string(),
            automation: None,
            visible: Some(true),
            width: None,
        },
        KanbanColumn {
            id: "done".to_string(),
            name: "Done".to_string(),
            color: Some("emerald".to_string()),
            position: 4,
            stage: "done".to_string(),
            automation: None,
            visible: Some(true),
            width: None,
        },
        KanbanColumn {
            id: "blocked".to_string(),
            name: "Blocked".to_string(),
            color: Some("rose".to_string()),
            position: 5,
            stage: "blocked".to_string(),
            automation: None,
            visible: Some(true),
            width: None,
        },
    ]
}

fn normalize_kanban_automation_step_ids(
    mut steps: Vec<KanbanAutomationStep>,
) -> Vec<KanbanAutomationStep> {
    for (index, step) in steps.iter_mut().enumerate() {
        if step.id.trim().is_empty() {
            step.id = format!("step-{}", index + 1);
        }
    }

    steps
        .into_iter()
        .filter(|step| {
            matches!(step.transport, Some(KanbanTransport::A2a))
                || step.provider_id.is_some()
                || step.role.is_some()
                || step.specialist_id.is_some()
                || step.specialist_name.is_some()
                || step.agent_card_url.is_some()
                || step.skill_id.is_some()
                || step.auth_config_id.is_some()
        })
        .collect()
}

fn normalize_kanban_automation(mut automation: KanbanColumnAutomation) -> KanbanColumnAutomation {
    let mut steps =
        normalize_kanban_automation_step_ids(automation.steps.clone().unwrap_or_default());
    if automation.enabled && steps.is_empty() {
        steps = vec![KanbanAutomationStep {
            id: "step-1".to_string(),
            transport: None,
            provider_id: automation.provider_id.clone(),
            role: automation.role.clone(),
            specialist_id: automation.specialist_id.clone(),
            specialist_name: automation.specialist_name.clone(),
            agent_card_url: None,
            skill_id: None,
            auth_config_id: None,
        }];
    }
    if steps.is_empty() {
        return automation;
    }

    automation.steps = Some(steps.clone());
    let primary = steps[0].clone();
    automation.provider_id = primary.provider_id;
    automation.role = primary.role;
    automation.specialist_id = primary.specialist_id;
    automation.specialist_name = primary.specialist_name;
    automation
}

fn automation_steps(automation: &KanbanColumnAutomation) -> Vec<KanbanAutomationStep> {
    normalize_kanban_automation_step_ids(automation.steps.clone().unwrap_or_default())
}

fn legacy_specialist_ids_for_stage(stage: &str) -> &'static [&'static str] {
    match stage {
        "backlog" => &["issue-enricher", "kanban-workflow", "kanban-agent"],
        "todo" => &["routa", "developer", "kanban-workflow"],
        "dev" => &["pr-reviewer", "developer", "claude-code", "kanban-workflow"],
        "review" => &[
            "desk-check",
            "gate",
            "pr-reviewer",
            "kanban-workflow",
            "kanban-review-guard",
        ],
        "blocked" => &["claude-code", "developer", "routa", "kanban-workflow"],
        "done" => &["gate", "verifier", "claude-code", "kanban-workflow"],
        _ => &[],
    }
}

fn recommended_step(id: &str, role: &str, specialist_name: &str) -> KanbanAutomationStep {
    KanbanAutomationStep {
        id: id.to_string(),
        transport: None,
        provider_id: None,
        role: Some(role.to_string()),
        specialist_id: Some(format!("kanban-{id}")),
        specialist_name: Some(specialist_name.to_string()),
        agent_card_url: None,
        skill_id: None,
        auth_config_id: None,
    }
}

fn build_recommended_automation(
    steps: Vec<KanbanAutomationStep>,
    auto_advance_on_success: bool,
) -> KanbanColumnAutomation {
    normalize_kanban_automation(KanbanColumnAutomation {
        enabled: true,
        steps: Some(steps),
        transition_type: Some("entry".to_string()),
        auto_advance_on_success: Some(auto_advance_on_success),
        required_artifacts: None,
        required_task_fields: None,
        provider_id: None,
        role: None,
        specialist_id: None,
        specialist_name: None,
    })
}

fn recommended_automation_for_stage(stage: &str) -> Option<KanbanColumnAutomation> {
    match stage {
        "backlog" => Some(build_recommended_automation(
            vec![recommended_step(
                "backlog-refiner",
                "CRAFTER",
                "Backlog Refiner",
            )],
            true,
        )),
        "todo" => Some(build_recommended_automation(
            vec![recommended_step(
                "todo-orchestrator",
                "CRAFTER",
                "Todo Orchestrator",
            )],
            false,
        )),
        "dev" => Some(build_recommended_automation(
            vec![recommended_step("dev-executor", "CRAFTER", "Dev Crafter")],
            false,
        )),
        "review" => Some(build_recommended_automation(
            vec![
                recommended_step("qa-frontend", "GATE", "QA Frontend"),
                recommended_step("review-guard", "GATE", "Review Guard"),
            ],
            false,
        ))
        .map(|mut automation| {
            automation.required_artifacts =
                Some(vec!["screenshot".to_string(), "test_results".to_string()]);
            automation
        }),
        "blocked" => Some(build_recommended_automation(
            vec![recommended_step(
                "blocked-resolver",
                "CRAFTER",
                "Blocked Resolver",
            )],
            false,
        )),
        "done" => Some(build_recommended_automation(
            vec![recommended_step("done-reporter", "GATE", "Done Reporter")],
            false,
        )),
        _ => None,
    }
}

fn default_column_position_for_stage(stage: &str) -> usize {
    match stage {
        "backlog" => 0,
        "todo" => 1,
        "dev" => 2,
        "review" => 3,
        "done" => 4,
        "blocked" => 5,
        _ => 99,
    }
}

pub fn normalize_default_kanban_column_positions(columns: Vec<KanbanColumn>) -> Vec<KanbanColumn> {
    let mut normalized = columns;
    normalized.sort_by(|left, right| {
        let left_index = default_column_position_for_stage(&left.id);
        let right_index = default_column_position_for_stage(&right.id);
        left_index
            .cmp(&right_index)
            .then(left.position.cmp(&right.position))
    });

    normalized
        .into_iter()
        .enumerate()
        .map(|(index, mut column)| {
            column.position = index as i64;
            column
        })
        .collect()
}

pub fn apply_recommended_automation_to_columns(columns: Vec<KanbanColumn>) -> Vec<KanbanColumn> {
    let columns = columns
        .into_iter()
        .map(|mut column| {
            if let Some(recommended) = recommended_automation_for_stage(&column.stage) {
                let normalized_recommended = normalize_kanban_automation(recommended);
                let recommended_primary = get_primary_step(&normalized_recommended);
                let recommended_steps = automation_steps(&normalized_recommended);
                let recommended_specialist_ids: Vec<&str> = recommended_steps
                    .iter()
                    .filter_map(|step| step.specialist_id.as_deref())
                    .collect();
                let recommended_specialist_names: Vec<&str> = recommended_steps
                    .iter()
                    .filter_map(|step| step.specialist_name.as_deref())
                    .collect();
                let recommended_primary_provider_id =
                    recommended_primary.as_ref().and_then(|step| step.provider_id.clone());
                let recommended_primary_role = recommended_primary
                    .as_ref()
                    .and_then(|step| step.role.clone());
                let recommended_primary_specialist_id =
                    recommended_primary.as_ref().and_then(|step| step.specialist_id.clone());
                let recommended_primary_specialist_name =
                    recommended_primary.as_ref().and_then(|step| step.specialist_name.clone());

                let with_default = if let Some(automation) = column.automation.clone() {
                    let current = normalize_kanban_automation(automation);
                    let current_steps = automation_steps(&current);
                    let legacy_specialists = legacy_specialist_ids_for_stage(&column.stage);
                    let has_custom_steps = current_steps.iter().any(|step| {
                        if let Some(id) = step.specialist_id.as_deref() {
                            !legacy_specialists.contains(&id)
                                && !recommended_specialist_ids.iter().any(|specialist_id| specialist_id == &id)
                        } else if let Some(name) = step.specialist_name.as_deref() {
                            !recommended_specialist_names
                                .iter()
                                .any(|recommended_name| recommended_name == &name)
                        } else {
                            false
                        }
                    });

                    let should_migrate_legacy_specialist = current
                        .specialist_id
                        .as_deref()
                        .is_some_and(|specialist_id| legacy_specialists.contains(&specialist_id));

                    let should_migrate_recommended_specialist = current
                        .specialist_id
                        .as_deref()
                        .is_some_and(|specialist_id| {
                            Some(specialist_id) == recommended_primary_specialist_id.as_deref()
                        })
                        || current.specialist_id.is_none()
                        && current
                            .specialist_name
                            .as_deref()
                            .is_some_and(|specialist_name| {
                                Some(specialist_name) == recommended_primary_specialist_name.as_deref()
                            });

                    let should_refresh_artifact_policy = (should_migrate_legacy_specialist
                        || should_migrate_recommended_specialist)
                        && matches!(current.required_artifacts.as_deref(), Some([artifact]) if artifact == "screenshot");

                    if has_custom_steps
                        || ((current.specialist_id.is_some() || current.specialist_name.is_some())
                            && !should_migrate_legacy_specialist
                            && !should_migrate_recommended_specialist)
                    {
                        current
                    } else {
                        let merged_steps = recommended_steps
                            .into_iter()
                            .enumerate()
                            .map(|(index, recommended_step)| {
                                let current_step = current_steps.get(index);

                                KanbanAutomationStep {
                                    id: recommended_step.id,
                                    transport: current_step.and_then(|step| step.transport.clone()),
                                    provider_id: current_step
                                        .and_then(|step| step.provider_id.clone())
                                        .or_else(|| recommended_step.provider_id.clone()),
                                    role: current_step
                                        .and_then(|step| step.role.clone())
                                        .or_else(|| recommended_step.role.clone()),
                                    specialist_id: current_step
                                        .and_then(|step| step.specialist_id.clone())
                                        .or_else(|| recommended_step.specialist_id.clone()),
                                    specialist_name: current_step
                                        .and_then(|step| step.specialist_name.clone())
                                        .or_else(|| recommended_step.specialist_name.clone()),
                                    agent_card_url: current_step
                                        .and_then(|step| step.agent_card_url.clone())
                                        .or_else(|| recommended_step.agent_card_url.clone()),
                                    skill_id: current_step
                                        .and_then(|step| step.skill_id.clone())
                                        .or_else(|| recommended_step.skill_id.clone()),
                                    auth_config_id: current_step
                                        .and_then(|step| step.auth_config_id.clone())
                                        .or_else(|| recommended_step.auth_config_id.clone()),
                                }
                            })
                            .collect();

                        let merged = KanbanColumnAutomation {
                            enabled: current.enabled,
                            steps: Some(merged_steps),
                            provider_id: current.provider_id.or(recommended_primary_provider_id),
                            role: current.role.or(recommended_primary_role),
                            specialist_id: recommended_primary_specialist_id,
                            specialist_name: recommended_primary_specialist_name,
                            transition_type: current
                                .transition_type
                                .or(normalized_recommended.transition_type),
                            required_artifacts: if should_refresh_artifact_policy {
                                normalized_recommended.required_artifacts.clone()
                            } else {
                                current
                                    .required_artifacts
                                    .or(normalized_recommended.required_artifacts.clone())
                            },
                            required_task_fields: current.required_task_fields,
                            auto_advance_on_success: normalized_recommended.auto_advance_on_success,
                        };

                        normalize_kanban_automation(merged)
                    }
                } else {
                    normalized_recommended
                };

                column.automation = Some(with_default);
            }

            column
        })
        .collect();

    normalize_default_kanban_column_positions(columns)
}

pub fn apply_new_board_story_readiness_defaults(columns: Vec<KanbanColumn>) -> Vec<KanbanColumn> {
    columns
        .into_iter()
        .map(|mut column| {
            if column.stage == "dev" {
                if let Some(automation) = column.automation.as_mut() {
                    automation.required_task_fields = Some(vec![
                        "scope".to_string(),
                        "acceptance_criteria".to_string(),
                        "verification_plan".to_string(),
                    ]);
                }
            }
            column
        })
        .collect()
}

fn get_primary_step(automation: &KanbanColumnAutomation) -> Option<KanbanAutomationStep> {
    automation_steps(automation).into_iter().next()
}

pub fn default_kanban_board(workspace_id: String) -> KanbanBoard {
    let now = Utc::now();

    KanbanBoard {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id,
        name: "Board".to_string(),
        is_default: true,
        columns: default_kanban_columns(),
        created_at: now,
        updated_at: now,
    }
}

pub fn column_id_to_task_status(column_id: Option<&str>) -> TaskStatus {
    match column_id.unwrap_or("backlog").to_ascii_lowercase().as_str() {
        "dev" => TaskStatus::InProgress,
        "review" => TaskStatus::ReviewRequired,
        "blocked" => TaskStatus::Blocked,
        "done" => TaskStatus::Completed,
        _ => TaskStatus::Pending,
    }
}

pub fn task_status_to_column_id(status: &TaskStatus) -> &'static str {
    match status {
        TaskStatus::InProgress => "dev",
        TaskStatus::ReviewRequired => "review",
        TaskStatus::Blocked => "blocked",
        TaskStatus::Completed => "done",
        _ => "backlog",
    }
}
