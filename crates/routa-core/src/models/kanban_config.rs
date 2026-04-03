use serde::{Deserialize, Serialize};

use super::kanban::KanbanColumnAutomation;

const VALID_STAGES: &[&str] = &["backlog", "todo", "dev", "review", "blocked", "done"];
const VALID_TRANSITION_TYPES: &[&str] = &["entry", "exit", "both"];
const VALID_ARTIFACTS: &[&str] = &["screenshot", "test_results", "code_diff"];
const VALID_REQUIRED_TASK_FIELDS: &[&str] = &[
    "scope",
    "acceptance_criteria",
    "verification_commands",
    "test_cases",
    "verification_plan",
    "dependencies_declared",
];

/// Top-level YAML config for declarative Kanban setup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanConfig {
    pub version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    pub boards: Vec<KanbanBoardConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanBoardConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_default: bool,
    pub columns: Vec<KanbanColumnConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KanbanColumnConfig {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub stage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation: Option<KanbanColumnAutomation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visible: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<String>,
}

fn default_workspace_id() -> String {
    "default".to_string()
}

impl KanbanConfig {
    pub fn from_yaml(yaml: &str) -> Result<Self, String> {
        serde_yaml::from_str(yaml).map_err(|e| format!("Failed to parse YAML: {e}"))
    }

    pub fn from_file(path: &str) -> Result<Self, String> {
        let content =
            std::fs::read_to_string(path).map_err(|e| format!("Failed to read '{path}': {e}"))?;
        Self::from_yaml(&content)
    }

    pub fn to_yaml(&self) -> Result<String, String> {
        serde_yaml::to_string(self).map_err(|e| format!("Failed to serialize YAML: {e}"))
    }

    /// Validate the config. Returns a list of all errors found.
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();

        if self.version != 1 {
            errors.push(format!("unsupported version: {}, expected 1", self.version));
        }

        if self.boards.is_empty() {
            errors.push("boards list is empty".to_string());
        }

        let mut seen_board_ids = std::collections::HashSet::new();
        for (bi, board) in self.boards.iter().enumerate() {
            let prefix = format!("boards[{}]", bi);

            if board.id.trim().is_empty() {
                errors.push(format!("{prefix}.id is blank"));
            } else if !seen_board_ids.insert(&board.id) {
                errors.push(format!("{prefix}.id '{}' is duplicated", board.id));
            }

            if board.name.trim().is_empty() {
                errors.push(format!("{prefix}.name is blank"));
            }

            if board.columns.is_empty() {
                errors.push(format!("{prefix}.columns is empty"));
            }

            let mut seen_col_ids = std::collections::HashSet::new();
            for (ci, col) in board.columns.iter().enumerate() {
                let col_prefix = format!("{prefix}.columns[{ci}]");

                if col.id.trim().is_empty() {
                    errors.push(format!("{col_prefix}.id is blank"));
                } else if !seen_col_ids.insert(&col.id) {
                    errors.push(format!("{col_prefix}.id '{}' is duplicated", col.id));
                }

                if col.name.trim().is_empty() {
                    errors.push(format!("{col_prefix}.name is blank"));
                }

                if !VALID_STAGES.contains(&col.stage.as_str()) {
                    errors.push(format!(
                        "{col_prefix}.stage '{}' is invalid, expected one of: {}",
                        col.stage,
                        VALID_STAGES.join(", ")
                    ));
                }

                if let Some(auto) = &col.automation {
                    let auto_prefix = format!("{col_prefix}.automation");
                    if let Some(tt) = &auto.transition_type {
                        if !VALID_TRANSITION_TYPES.contains(&tt.as_str()) {
                            errors.push(format!(
                                "{auto_prefix}.transitionType '{}' is invalid, expected one of: {}",
                                tt,
                                VALID_TRANSITION_TYPES.join(", ")
                            ));
                        }
                    }
                    if let Some(artifacts) = &auto.required_artifacts {
                        for art in artifacts {
                            if !VALID_ARTIFACTS.contains(&art.as_str()) {
                                errors.push(format!(
                                    "{auto_prefix}.requiredArtifacts contains invalid value '{}', expected one of: {}",
                                    art,
                                    VALID_ARTIFACTS.join(", ")
                                ));
                            }
                        }
                    }
                    if let Some(required_task_fields) = &auto.required_task_fields {
                        for field in required_task_fields {
                            if !VALID_REQUIRED_TASK_FIELDS.contains(&field.as_str()) {
                                errors.push(format!(
                                    "{auto_prefix}.requiredTaskFields contains invalid value '{}', expected one of: {}",
                                    field,
                                    VALID_REQUIRED_TASK_FIELDS.join(", ")
                                ));
                            }
                        }
                    }
                }
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_minimal_config() {
        let yaml = r#"
version: 1
workspaceId: default
boards:
  - id: main
    name: Main Board
    columns:
      - id: backlog
        name: Backlog
        stage: backlog
"#;
        let config = KanbanConfig::from_yaml(yaml).unwrap();
        assert_eq!(config.version, 1);
        assert_eq!(config.boards.len(), 1);
        assert_eq!(config.boards[0].columns.len(), 1);
        assert!(config.validate().is_ok());
    }

    #[test]
    fn parse_full_config_with_automation() {
        let yaml = r#"
version: 1
name: project-kanban
workspaceId: ws-1
boards:
  - id: core
    name: Core Board
    isDefault: true
    columns:
      - id: backlog
        name: Backlog
        color: slate
        stage: backlog
      - id: dev
        name: Dev
        color: amber
        stage: dev
        automation:
          enabled: true
          providerId: routa-native
          role: CRAFTER
          transitionType: entry
          requiredArtifacts:
            - test_results
            - code_diff
          requiredTaskFields:
            - scope
            - verification_plan
          autoAdvanceOnSuccess: false
"#;
        let config = KanbanConfig::from_yaml(yaml).unwrap();
        assert_eq!(config.boards[0].columns.len(), 2);
        let auto = config.boards[0].columns[1].automation.as_ref().unwrap();
        assert!(auto.enabled);
        assert_eq!(auto.provider_id.as_deref(), Some("routa-native"));
        assert_eq!(auto.required_artifacts.as_ref().unwrap().len(), 2);
        assert_eq!(auto.required_task_fields.as_ref().unwrap().len(), 2);
        assert!(config.validate().is_ok());
    }

    #[test]
    fn validate_rejects_invalid_stage() {
        let yaml = r#"
version: 1
boards:
  - id: b1
    name: Board
    columns:
      - id: c1
        name: Col
        stage: invalid_stage
"#;
        let config = KanbanConfig::from_yaml(yaml).unwrap();
        let errs = config.validate().unwrap_err();
        assert!(errs
            .iter()
            .any(|e| e.contains("stage 'invalid_stage' is invalid")));
    }

    #[test]
    fn validate_rejects_duplicate_board_ids() {
        let yaml = r#"
version: 1
boards:
  - id: same
    name: Board A
    columns:
      - id: c1
        name: Col
        stage: backlog
  - id: same
    name: Board B
    columns:
      - id: c1
        name: Col
        stage: backlog
"#;
        let config = KanbanConfig::from_yaml(yaml).unwrap();
        let errs = config.validate().unwrap_err();
        assert!(errs.iter().any(|e| e.contains("'same' is duplicated")));
    }

    #[test]
    fn validate_rejects_duplicate_column_ids() {
        let yaml = r#"
version: 1
boards:
  - id: b1
    name: Board
    columns:
      - id: dup
        name: Col A
        stage: backlog
      - id: dup
        name: Col B
        stage: todo
"#;
        let config = KanbanConfig::from_yaml(yaml).unwrap();
        let errs = config.validate().unwrap_err();
        assert!(errs.iter().any(|e| e.contains("'dup' is duplicated")));
    }

    #[test]
    fn validate_rejects_invalid_transition_type() {
        let yaml = r#"
version: 1
boards:
  - id: b1
    name: Board
    columns:
      - id: c1
        name: Col
        stage: dev
        automation:
          enabled: true
          transitionType: invalid
"#;
        let config = KanbanConfig::from_yaml(yaml).unwrap();
        let errs = config.validate().unwrap_err();
        assert!(errs
            .iter()
            .any(|e| e.contains("transitionType 'invalid' is invalid")));
    }

    #[test]
    fn validate_rejects_invalid_artifacts() {
        let yaml = r#"
version: 1
boards:
  - id: b1
    name: Board
    columns:
      - id: c1
        name: Col
        stage: dev
        automation:
          enabled: true
          requiredArtifacts:
            - bad_artifact
"#;
        let config = KanbanConfig::from_yaml(yaml).unwrap();
        let errs = config.validate().unwrap_err();
        assert!(errs.iter().any(|e| e.contains("'bad_artifact'")));
    }

    #[test]
    fn validate_rejects_invalid_required_task_fields() {
        let yaml = r#"
version: 1
boards:
  - id: b1
    name: Board
    columns:
      - id: c1
        name: Col
        stage: dev
        automation:
          enabled: true
          requiredTaskFields:
            - bad_field
"#;
        let config = KanbanConfig::from_yaml(yaml).unwrap();
        let errs = config.validate().unwrap_err();
        assert!(errs.iter().any(|e| e.contains("'bad_field'")));
    }

    #[test]
    fn roundtrip_yaml() {
        let yaml = r#"
version: 1
name: roundtrip-test
workspaceId: default
boards:
  - id: core
    name: Core Board
    isDefault: true
    columns:
      - id: backlog
        name: Backlog
        color: slate
        stage: backlog
      - id: dev
        name: Dev
        color: amber
        stage: dev
        automation:
          enabled: true
          transitionType: entry
          requiredArtifacts:
            - test_results
"#;
        let config = KanbanConfig::from_yaml(yaml).unwrap();
        assert!(config.validate().is_ok());

        let serialized = config.to_yaml().unwrap();
        let reparsed = KanbanConfig::from_yaml(&serialized).unwrap();
        assert!(reparsed.validate().is_ok());

        assert_eq!(config.boards.len(), reparsed.boards.len());
        assert_eq!(config.boards[0].id, reparsed.boards[0].id);
        assert_eq!(config.boards[0].columns, reparsed.boards[0].columns);
    }
}
