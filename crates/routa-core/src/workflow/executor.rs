//! Workflow Executor — runs a workflow definition step by step.
//!
//! The executor:
//! 1. Loads specialist definitions
//! 2. Resolves variables and environment references
//! 3. Executes each step sequentially (or in parallel groups)
//! 4. Passes output between steps via template substitution
//! 5. Calls agents via the AcpAgentCaller (HTTP API)

use std::collections::HashMap;

use crate::workflow::agent_caller::{resolve_env_vars, AcpAgentCaller, AgentCallConfig};
use crate::workflow::schema::{OnFailure, StepAction, WorkflowDefinition, WorkflowStep};
use crate::workflow::specialist::{SpecialistDef, SpecialistLoader};

/// Result of executing a single workflow step.
#[derive(Debug, Clone)]
pub struct StepResult {
    pub step_name: String,
    pub output: String,
    pub success: bool,
    pub error: Option<String>,
    pub model: String,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

/// Result of executing the entire workflow.
#[derive(Debug)]
pub struct WorkflowResult {
    pub workflow_name: String,
    pub steps: Vec<StepResult>,
    pub success: bool,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
}

/// The workflow executor engine.
pub struct WorkflowExecutor {
    caller: AcpAgentCaller,
    specialist_loader: SpecialistLoader,
    /// Resolved variables (workflow-level + env)
    variables: HashMap<String, String>,
    /// Step outputs indexed by step name
    step_outputs: HashMap<String, String>,
    /// Trigger payload (if any)
    trigger_payload: Option<String>,
    /// Verbose output mode
    verbose: bool,
}

impl Default for WorkflowExecutor {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkflowExecutor {
    pub fn new() -> Self {
        let mut specialist_loader = SpecialistLoader::new();
        // Load from default directories
        specialist_loader.load_default_dirs();

        // Also load built-in specialists as fallback
        for builtin in SpecialistLoader::builtin_specialists() {
            if specialist_loader.get(&builtin.id).is_none() {
                specialist_loader
                    .specialists
                    .insert(builtin.id.clone(), builtin);
            }
        }

        Self {
            caller: AcpAgentCaller::new(),
            specialist_loader,
            variables: HashMap::new(),
            step_outputs: HashMap::new(),
            trigger_payload: None,
            verbose: false,
        }
    }

    /// Create an executor with a custom specialist directory.
    pub fn with_specialist_dir(specialist_dir: &str) -> Result<Self, String> {
        let mut specialist_loader = SpecialistLoader::new();
        specialist_loader.load_dir(specialist_dir)?;

        // Add built-in specialists as fallback
        for builtin in SpecialistLoader::builtin_specialists() {
            if specialist_loader.get(&builtin.id).is_none() {
                specialist_loader
                    .specialists
                    .insert(builtin.id.clone(), builtin);
            }
        }

        Ok(Self {
            caller: AcpAgentCaller::new(),
            specialist_loader,
            variables: HashMap::new(),
            step_outputs: HashMap::new(),
            trigger_payload: None,
            verbose: false,
        })
    }

    /// Set verbose mode for detailed output.
    pub fn set_verbose(&mut self, verbose: bool) {
        self.verbose = verbose;
    }

    /// Set trigger payload (for webhook-triggered workflows).
    pub fn set_trigger_payload(&mut self, payload: String) {
        self.trigger_payload = Some(payload);
    }

    /// Execute a workflow definition.
    pub async fn execute(
        &mut self,
        workflow: &WorkflowDefinition,
    ) -> Result<WorkflowResult, String> {
        println!("╔══════════════════════════════════════════════════════════╗");
        println!("║  Routa Workflow Engine                                  ║");
        println!("╠══════════════════════════════════════════════════════════╣");
        println!("║  Workflow : {:<42} ║", truncate(&workflow.name, 42));
        println!("║  Steps    : {:<42} ║", workflow.steps.len());
        println!("║  Trigger  : {:<42} ║", workflow.trigger.trigger_type);
        println!("╚══════════════════════════════════════════════════════════╝");
        println!();

        // Resolve workflow-level variables (expand env vars)
        self.variables.clear();
        self.step_outputs.clear();
        for (key, val) in &workflow.variables {
            self.variables.insert(key.clone(), resolve_env_vars(val));
        }

        let mut results: Vec<StepResult> = Vec::new();
        let mut all_success = true;

        for (i, step) in workflow.steps.iter().enumerate() {
            println!(
                "── Step {}/{}: {} ──",
                i + 1,
                workflow.steps.len(),
                step.name
            );

            // Check condition
            if let Some(ref cond) = step.condition {
                let resolved = self.resolve_template(cond);
                if resolved.is_empty() || resolved == "false" {
                    println!("   ⏭  Skipped (condition not met)");
                    println!();
                    results.push(StepResult {
                        step_name: step.name.clone(),
                        output: String::new(),
                        success: true,
                        error: Some("Skipped: condition not met".to_string()),
                        model: String::new(),
                        input_tokens: None,
                        output_tokens: None,
                    });
                    continue;
                }
            }

            // Execute the step with retry support
            let max_attempts = if step.on_failure == OnFailure::Retry {
                step.max_retries + 1
            } else {
                1
            };

            let mut attempt = 0;
            let mut last_error: Option<String> = None;
            let mut step_result: Option<StepResult> = None;

            while attempt < max_attempts {
                attempt += 1;
                if attempt > 1 {
                    println!("   🔄 Retry attempt {attempt}/{max_attempts}");
                }

                match self.execute_step(step).await {
                    Ok(result) => {
                        if result.success {
                            println!("   ✅ Success (model: {})", result.model);
                            if let (Some(inp), Some(out)) =
                                (result.input_tokens, result.output_tokens)
                            {
                                println!("   📊 Tokens: {inp} in / {out} out");
                            }

                            // Store output for downstream steps
                            if let Some(ref key) = step.output_key {
                                self.step_outputs.insert(key.clone(), result.output.clone());
                            }
                            self.step_outputs
                                .insert(step.name.clone(), result.output.clone());

                            if self.verbose {
                                println!("   📝 Output preview: {}", truncate(&result.output, 200));
                            }

                            step_result = Some(result);
                            break;
                        } else {
                            // Step returned but was not successful
                            last_error = result.error.clone();
                            if attempt < max_attempts {
                                println!(
                                    "   ⚠️  Failed: {} (will retry)",
                                    last_error.as_deref().unwrap_or("unknown")
                                );
                            } else {
                                step_result = Some(result);
                            }
                        }
                    }
                    Err(e) => {
                        last_error = Some(e.clone());
                        if attempt < max_attempts {
                            println!("   ⚠️  Error: {e} (will retry)");
                            // Brief delay before retry
                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        }
                    }
                }
            }

            // Handle the final result
            let final_result = step_result.unwrap_or_else(|| StepResult {
                step_name: step.name.clone(),
                output: String::new(),
                success: false,
                error: last_error.clone(),
                model: String::new(),
                input_tokens: None,
                output_tokens: None,
            });

            if !final_result.success {
                println!(
                    "   ❌ Failed: {}",
                    final_result.error.as_deref().unwrap_or("unknown")
                );
                all_success = false;

                // Handle failure strategy
                match step.on_failure {
                    OnFailure::Stop => {
                        println!("   🛑 Stopping workflow (on_failure: stop)");
                        results.push(final_result);
                        println!();
                        break;
                    }
                    OnFailure::Continue => {
                        println!("   ⏩ Continuing to next step (on_failure: continue)");
                    }
                    OnFailure::Retry => {
                        // Already exhausted retries
                        println!("   🛑 Stopping workflow (retries exhausted)");
                        results.push(final_result);
                        println!();
                        break;
                    }
                }
            }

            results.push(final_result);
            println!();
        }

        // Summary
        let total_input: u64 = results.iter().filter_map(|r| r.input_tokens).sum();
        let total_output: u64 = results.iter().filter_map(|r| r.output_tokens).sum();

        println!("═══════════════════════════════════════════════════════════");
        println!("  Workflow Complete: {}", workflow.name);
        println!(
            "  Status: {}",
            if all_success {
                "✅ SUCCESS"
            } else {
                "❌ FAILED"
            }
        );
        println!(
            "  Steps: {}/{} succeeded",
            results.iter().filter(|r| r.success).count(),
            results.len()
        );
        if total_input > 0 || total_output > 0 {
            println!("  Total tokens: {total_input} in / {total_output} out");
        }
        println!("═══════════════════════════════════════════════════════════");

        Ok(WorkflowResult {
            workflow_name: workflow.name.clone(),
            steps: results,
            success: all_success,
            total_input_tokens: total_input,
            total_output_tokens: total_output,
        })
    }

    /// Execute a single workflow step.
    async fn execute_step(&self, step: &WorkflowStep) -> Result<StepResult, String> {
        // 1. Resolve the specialist
        let specialist = self.resolve_specialist(&step.specialist)?;

        // 2. Build the agent call config
        let config = self.build_call_config(step, &specialist)?;

        // 3. Build the user prompt
        let user_prompt = self.build_user_prompt(step, &specialist)?;

        if self.verbose {
            println!("   🔧 Adapter: {}", config.adapter);
            println!("   🤖 Model: {}", config.model);
            println!("   📥 Prompt length: {} chars", user_prompt.len());
        }

        // 4. Call the agent
        let response = self.caller.call(&config, &user_prompt).await?;

        Ok(StepResult {
            step_name: step.name.clone(),
            output: response.content.clone(),
            success: response.success,
            error: response.error,
            model: response.model,
            input_tokens: response.usage.as_ref().and_then(|u| u.input_tokens),
            output_tokens: response.usage.as_ref().and_then(|u| u.output_tokens),
        })
    }

    /// Resolve a specialist by ID (from loader or builtins).
    fn resolve_specialist(&self, id: &str) -> Result<SpecialistDef, String> {
        if let Some(spec) = self.specialist_loader.get(id) {
            return Ok(spec.clone());
        }

        // Check builtins
        for builtin in SpecialistLoader::builtin_specialists() {
            if builtin.id == id {
                return Ok(builtin);
            }
        }

        Err(format!(
            "Unknown specialist '{}'. Available: {:?}",
            id,
            self.specialist_loader.all().keys().collect::<Vec<_>>()
        ))
    }

    /// Build the agent call configuration from step config + specialist defaults.
    fn build_call_config(
        &self,
        step: &WorkflowStep,
        specialist: &SpecialistDef,
    ) -> Result<AgentCallConfig, String> {
        // Determine adapter
        let adapter = if step.adapter != "claude-code-sdk" {
            step.adapter.clone()
        } else {
            specialist
                .default_adapter
                .clone()
                .unwrap_or_else(|| "claude-code-sdk".to_string())
        };

        // Determine base URL from config, env, or defaults
        let base_url = step
            .config
            .base_url
            .as_ref()
            .map(|u| self.resolve_template(u))
            .or_else(|| self.variables.get("base_url").cloned())
            .unwrap_or_else(|| match adapter.as_str() {
                "opencode-sdk" | "opencode" => std::env::var("OPENCODE_BASE_URL")
                    .unwrap_or_else(|_| "https://open.bigmodel.cn/api/coding/paas/v4".to_string()),
                _ => std::env::var("ANTHROPIC_BASE_URL")
                    .unwrap_or_else(|_| "https://api.anthropic.com".to_string()),
            });

        // Determine API key from config, env
        let api_key = step
            .config
            .api_key
            .as_ref()
            .map(|k| self.resolve_template(k))
            .unwrap_or_else(|| {
                std::env::var("ANTHROPIC_AUTH_TOKEN")
                    .or_else(|_| std::env::var("ANTHROPIC_API_KEY"))
                    .unwrap_or_default()
            });

        if api_key.is_empty() {
            return Err(
                "No API key found. Set ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY env var, \
                 or specify api_key in the step config."
                    .to_string(),
            );
        }

        // Determine model — resolve template variables
        let model = step
            .config
            .model
            .as_ref()
            .map(|m| self.resolve_template(m))
            .or_else(|| self.variables.get("model").cloned())
            .or_else(|| specialist.default_model.clone())
            .unwrap_or_else(|| {
                std::env::var("ANTHROPIC_MODEL").unwrap_or_else(|_| "glm-5.1".to_string())
            });

        // System prompt: step override > specialist default
        let system_prompt = step
            .config
            .system_prompt
            .clone()
            .unwrap_or_else(|| specialist.system_prompt.clone());

        Ok(AgentCallConfig {
            adapter,
            base_url,
            api_key,
            model,
            max_turns: step.config.max_turns.unwrap_or(1),
            max_tokens: step.config.max_tokens.unwrap_or(8192),
            temperature: step.config.temperature,
            system_prompt,
            env: step.config.env.clone(),
            timeout_secs: step.timeout_secs,
        })
    }

    /// Build the user prompt for a step, resolving template variables.
    fn build_user_prompt(
        &self,
        step: &WorkflowStep,
        specialist: &SpecialistDef,
    ) -> Result<String, String> {
        let mut prompt = String::new();

        // Add input template if provided
        if let Some(ref input) = step.input {
            prompt.push_str(&self.resolve_template(input));
        }

        // Add actions as instructions
        if !step.actions.is_empty() {
            if !prompt.is_empty() {
                prompt.push_str("\n\n");
            }
            prompt.push_str("## Actions Required\n\n");
            for action in &step.actions {
                match action {
                    StepAction::Simple(name) => {
                        prompt.push_str(&format!("- {name}\n"));
                    }
                    StepAction::Detailed { name, params } => {
                        prompt.push_str(&format!("- {name} (params: {params:?})\n"));
                    }
                }
            }
        }

        // Add role reminder if specialist has one
        if let Some(ref reminder) = specialist.role_reminder {
            if !prompt.is_empty() {
                prompt.push_str("\n\n");
            }
            prompt.push_str(&format!("**Reminder:** {reminder}"));
        }

        if prompt.is_empty() {
            prompt = format!(
                "Execute your role as {} ({}). Analyze the context and provide actionable output.",
                specialist.name, specialist.role
            );
        }

        Ok(prompt)
    }

    /// Resolve template variables in a string.
    ///
    /// Supported patterns:
    /// - `${trigger.payload}` — the trigger payload
    /// - `${steps.<StepName>.output}` — output from a previous step
    /// - `${variables.<key>}` or `${<key>}` — from the variables block
    /// - `${ENV_VAR}` — from environment
    fn resolve_template(&self, template: &str) -> String {
        let mut result = template.to_string();

        // Replace ${trigger.payload}
        if let Some(ref payload) = self.trigger_payload {
            result = result.replace("${trigger.payload}", payload);
        }

        // Replace ${steps.<StepName>.output}
        let step_re = regex::Regex::new(r"\$\{steps\.([^.]+)\.output\}").unwrap();
        result = step_re
            .replace_all(&result, |caps: &regex::Captures| {
                let step_name = &caps[1];
                self.step_outputs
                    .get(step_name)
                    .cloned()
                    .unwrap_or_else(|| format!("${{steps.{step_name}.output}}"))
            })
            .to_string();

        // Replace ${variables.<key>}
        let var_re = regex::Regex::new(r"\$\{variables\.([^}]+)\}").unwrap();
        result = var_re
            .replace_all(&result, |caps: &regex::Captures| {
                let key = &caps[1];
                self.variables
                    .get(key)
                    .cloned()
                    .unwrap_or_else(|| format!("${{variables.{key}}}"))
            })
            .to_string();

        // Replace remaining ${...} with workflow variables then env vars
        let generic_re = regex::Regex::new(r"\$\{([^}]+)\}").unwrap();
        result = generic_re
            .replace_all(&result, |caps: &regex::Captures| {
                let key = &caps[1];
                self.variables
                    .get(key)
                    .cloned()
                    .or_else(|| self.step_outputs.get(key).cloned())
                    .or_else(|| std::env::var(key).ok())
                    .unwrap_or_else(|| format!("${{{key}}}"))
            })
            .to_string();

        result
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max.saturating_sub(3)).collect();
        format!("{truncated}...")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_template_steps() {
        let mut executor = WorkflowExecutor::new();
        executor
            .step_outputs
            .insert("Refine".to_string(), "refined output".to_string());
        executor
            .variables
            .insert("model".to_string(), "glm-5.1".to_string());
        executor.trigger_payload = Some("issue body".to_string());

        assert_eq!(
            executor.resolve_template("Previous: ${steps.Refine.output}"),
            "Previous: refined output"
        );
        assert_eq!(
            executor.resolve_template("Model: ${variables.model}"),
            "Model: glm-5.1"
        );
        assert_eq!(
            executor.resolve_template("Payload: ${trigger.payload}"),
            "Payload: issue body"
        );
        assert_eq!(
            executor.resolve_template("Model: ${model}"),
            "Model: glm-5.1"
        );
    }
}
