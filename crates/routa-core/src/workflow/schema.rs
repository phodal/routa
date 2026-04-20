//! YAML schema types for workflow definitions.
//!
//! A workflow YAML defines a multi-step agent pipeline:
//!
//! ```yaml
//! name: "SDLC Flow"
//! description: "End-to-end software development lifecycle"
//! version: "1.0"
//!
//! trigger:
//!   type: manual      # manual | webhook | schedule
//!
//! variables:
//!   model: "GLM-4.7"
//!   base_url: "${ANTHROPIC_BASE_URL}"
//!
//! steps:
//!   - name: "Refine Requirements"
//!     specialist: "issue-refiner"
//!     adapter: "claude-code-sdk"
//!     config:
//!       model: "${model}"
//!     input: "${trigger.payload}"
//!     actions:
//!       - analyze_requirements
//!       - generate_acceptance_criteria
//!     output_key: "refined_requirements"
//!
//!   - name: "Plan Implementation"
//!     specialist: "routa"
//!     adapter: "claude-code-sdk"
//!     config:
//!       model: "${model}"
//!     input: "${steps.Refine Requirements.output}"
//!     output_key: "implementation_plan"
//! ```

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Top-level workflow definition loaded from a YAML file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDefinition {
    /// Workflow name
    pub name: String,

    /// Optional description
    #[serde(default)]
    pub description: Option<String>,

    /// Version string
    #[serde(default = "default_version")]
    pub version: String,

    /// How the workflow is triggered
    #[serde(default)]
    pub trigger: TriggerConfig,

    /// Variable substitution map (supports `${ENV_VAR}` references)
    #[serde(default)]
    pub variables: HashMap<String, String>,

    /// Ordered list of workflow steps
    pub steps: Vec<WorkflowStep>,
}

fn default_version() -> String {
    "1.0".to_string()
}

/// Trigger configuration — how/when the workflow runs.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TriggerConfig {
    /// Trigger type: "manual", "webhook", "schedule"
    #[serde(rename = "type", default = "default_trigger_type")]
    pub trigger_type: String,

    /// For webhook triggers: the event source (e.g., "github")
    #[serde(default)]
    pub source: Option<String>,

    /// For webhook triggers: the event name (e.g., "issues.opened")
    #[serde(default)]
    pub event: Option<String>,

    /// For schedule triggers: cron expression
    #[serde(default)]
    pub cron: Option<String>,
}

fn default_trigger_type() -> String {
    "manual".to_string()
}

/// What to do when a step fails.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OnFailure {
    /// Stop the workflow immediately (default)
    #[default]
    Stop,
    /// Continue to the next step
    Continue,
    /// Retry the step (up to max_retries times)
    Retry,
}

/// A single step in the workflow pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStep {
    /// Step name (unique within the workflow, used for output references)
    pub name: String,

    /// Specialist ID — references a specialist YAML file or built-in specialist
    pub specialist: String,

    /// Adapter type: "claude-code-sdk", "opencode-sdk", "acp"
    #[serde(default = "default_adapter")]
    pub adapter: String,

    /// Adapter-specific configuration (model, temperature, max_turns, etc.)
    #[serde(default)]
    pub config: StepConfig,

    /// Input template — supports variable substitution:
    ///  - `${trigger.payload}` — the original trigger data
    ///  - `${steps.<StepName>.output}` — output from a previous step
    ///  - `${variables.<key>}` — from the variables block
    #[serde(default)]
    pub input: Option<String>,

    /// List of actions/capabilities for the agent to perform
    #[serde(default)]
    pub actions: Vec<StepAction>,

    /// Key to store this step's output under (for downstream reference)
    #[serde(default)]
    pub output_key: Option<String>,

    /// Condition: only run this step if the expression evaluates to true.
    /// Simple format: `${steps.<name>.output}` contains some substring, etc.
    #[serde(default, rename = "if")]
    pub condition: Option<String>,

    /// Parallel group: steps in the same group run concurrently
    #[serde(default)]
    pub parallel_group: Option<String>,

    /// What to do if this step fails
    #[serde(default)]
    pub on_failure: OnFailure,

    /// Maximum retries (only used when on_failure = retry)
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,

    /// Timeout in seconds for this step (default: 300)
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_max_retries() -> u32 {
    2
}

fn default_timeout() -> u64 {
    300
}

fn default_adapter() -> String {
    "claude-code-sdk".to_string()
}

/// Configuration for a workflow step's adapter.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StepConfig {
    /// Model to use (e.g., "GLM-4.7", "claude-sonnet-4-20250514")
    #[serde(default)]
    pub model: Option<String>,

    /// Maximum conversation turns
    #[serde(default)]
    pub max_turns: Option<u32>,

    /// Maximum tokens for response
    #[serde(default)]
    pub max_tokens: Option<u32>,

    /// Base URL for the API endpoint
    #[serde(default)]
    pub base_url: Option<String>,

    /// API key override (supports `${ENV_VAR}` references)
    #[serde(default)]
    pub api_key: Option<String>,

    /// Temperature for generation
    #[serde(default)]
    pub temperature: Option<f64>,

    /// System prompt override (if not using specialist's default)
    #[serde(default)]
    pub system_prompt: Option<String>,

    /// Working directory for the agent
    #[serde(default)]
    pub cwd: Option<String>,

    /// Additional environment variables to pass to the agent
    #[serde(default)]
    pub env: HashMap<String, String>,
}

/// An action that a step's agent should perform.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StepAction {
    /// Simple string action name
    Simple(String),
    /// Detailed action with parameters
    Detailed {
        name: String,
        #[serde(default)]
        params: HashMap<String, serde_json::Value>,
    },
}

impl std::fmt::Display for StepAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StepAction::Simple(s) => write!(f, "{s}"),
            StepAction::Detailed { name, .. } => write!(f, "{name}"),
        }
    }
}

impl WorkflowDefinition {
    /// Parse a workflow definition from a YAML string.
    pub fn from_yaml(yaml: &str) -> Result<Self, String> {
        serde_yaml::from_str(yaml).map_err(|e| format!("Failed to parse workflow YAML: {e}"))
    }

    /// Load a workflow definition from a file path.
    pub fn from_file(path: &str) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read workflow file '{path}': {e}"))?;
        Self::from_yaml(&content)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_minimal_workflow() {
        let yaml = r#"
name: "Test Flow"
steps:
  - name: "Step 1"
    specialist: "developer"
    input: "Hello, world!"
"#;
        let wf = WorkflowDefinition::from_yaml(yaml).unwrap();
        assert_eq!(wf.name, "Test Flow");
        assert_eq!(wf.steps.len(), 1);
        assert_eq!(wf.steps[0].specialist, "developer");
        assert_eq!(wf.steps[0].adapter, "claude-code-sdk");
    }

    #[test]
    fn test_parse_full_workflow() {
        let yaml = r#"
name: "SDLC Flow"
description: "End-to-end development"
version: "2.0"
trigger:
  type: webhook
  source: github
  event: issues.opened
variables:
  model: "GLM-4.7"
  base_url: "https://open.bigmodel.cn/api/anthropic"
steps:
  - name: "Refine"
    specialist: "issue-refiner"
    adapter: "claude-code-sdk"
    config:
      model: "${model}"
    input: "${trigger.payload}"
    actions:
      - analyze_requirements
      - generate_acceptance_criteria
    output_key: "refined"
  - name: "Implement"
    specialist: "crafter"
    config:
      model: "GLM-4.7"
    input: "${steps.Refine.output}"
    output_key: "implementation"
    if: "${steps.Refine.output} != ''"
"#;
        let wf = WorkflowDefinition::from_yaml(yaml).unwrap();
        assert_eq!(wf.name, "SDLC Flow");
        assert_eq!(wf.version, "2.0");
        assert_eq!(wf.trigger.trigger_type, "webhook");
        assert_eq!(wf.trigger.source, Some("github".to_string()));
        assert_eq!(wf.variables.get("model").unwrap(), "GLM-4.7");
        assert_eq!(wf.steps.len(), 2);
        assert_eq!(wf.steps[0].actions.len(), 2);
        assert!(wf.steps[1].condition.is_some());
    }
}
