use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::models::task::TaskStatus;

/// Transport protocol for Kanban automation
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum KanbanTransport {
    /// Agent Chat Protocol (default)
    Acp,
    /// Agent-to-Agent protocol
    A2a,
}

impl Default for KanbanTransport {
    fn default() -> Self {
        KanbanTransport::Acp
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
            color: Some("violet".to_string()),
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
