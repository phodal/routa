//! ACP Agent Caller — invokes agents via HTTP API (Claude Code SDK / OpenCode / GLM).
//!
//! Instead of spawning subprocesses like the existing `AcpProcess`,
//! the workflow engine calls the LLM API directly via HTTP.
//! This is simpler and doesn't require agents to be installed locally.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Configuration for calling an ACP-compatible agent via HTTP API.
#[derive(Debug, Clone)]
pub struct AgentCallConfig {
    /// Adapter type: "claude-code-sdk", "opencode-sdk"
    pub adapter: String,
    /// API base URL
    pub base_url: String,
    /// API key / auth token
    pub api_key: String,
    /// Model ID
    pub model: String,
    /// Maximum conversation turns (default: 1 for single-shot)
    pub max_turns: u32,
    /// Maximum tokens for response (default: 8192)
    pub max_tokens: u32,
    /// Temperature
    pub temperature: Option<f64>,
    /// System prompt
    pub system_prompt: String,
    /// Additional environment variables
    pub env: HashMap<String, String>,
    /// Timeout in seconds
    pub timeout_secs: u64,
}

impl Default for AgentCallConfig {
    fn default() -> Self {
        Self {
            adapter: "claude-code-sdk".to_string(),
            base_url: "https://open.bigmodel.cn/api/anthropic".to_string(),
            api_key: String::new(),
            model: "GLM-4.7".to_string(),
            max_turns: 1,
            max_tokens: 8192,
            temperature: None,
            system_prompt: String::new(),
            env: HashMap::new(),
            timeout_secs: 300,
        }
    }
}

/// Response from an agent call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResponse {
    /// The agent's text response
    pub content: String,
    /// Model used
    pub model: String,
    /// Usage statistics
    pub usage: Option<UsageInfo>,
    /// Whether the call succeeded
    pub success: bool,
    /// Error message if failed
    pub error: Option<String>,
    /// Raw response for debugging
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageInfo {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

/// Calls an ACP agent via HTTP API.
pub struct AcpAgentCaller {
    client: reqwest::Client,
}

impl Default for AcpAgentCaller {
    fn default() -> Self {
        Self::new()
    }
}

impl AcpAgentCaller {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(300)) // 5 min timeout
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    /// Call an agent with the given configuration and user prompt.
    pub async fn call(
        &self,
        config: &AgentCallConfig,
        user_prompt: &str,
    ) -> Result<AgentResponse, String> {
        match config.adapter.as_str() {
            "claude-code-sdk" | "anthropic" => {
                self.call_anthropic_compatible(config, user_prompt).await
            }
            "opencode-sdk" | "opencode" => self.call_opencode(config, user_prompt).await,
            "mock" => Ok(self.call_mock(config, user_prompt)),
            other => Err(format!("Unknown adapter type: '{other}'")),
        }
    }

    fn call_mock(&self, config: &AgentCallConfig, user_prompt: &str) -> AgentResponse {
        let body = if user_prompt.contains("You are a scoped security specialist.") {
            Self::mock_security_specialist_response(user_prompt)
        } else if user_prompt.contains("You are running a tool-driven security review.") {
            "## Security Review\n\nNo material security issues found.\n".to_string()
        } else if user_prompt
            .contains("You are acting as the Context Gathering sub-agent for PR review")
        {
            "Context gathered from diff and repository snippets.".to_string()
        } else if user_prompt
            .contains("You are acting as the Diff Analysis sub-agent for PR review")
            || user_prompt
                .contains("You are acting as the Finding Validation sub-agent for PR review")
        {
            "{}".to_string()
        } else {
            "ok".to_string()
        };

        AgentResponse {
            content: body.clone(),
            model: config.model.clone(),
            usage: Some(UsageInfo {
                input_tokens: Some(32),
                output_tokens: Some(body.len() as u64),
            }),
            success: true,
            error: None,
            raw: None,
        }
    }

    fn mock_security_specialist_response(prompt: &str) -> String {
        let specialist_id = Self::mock_dispatch_specialist_id(prompt);
        if specialist_id == Some("security-authentication-reviewer") {
            return r#"{\n  \"specialist_id\": \"security-authentication-reviewer\",\n  \"category\": \"authentication\",\n  \"findings\": [\n    {\n      \"title\": \"Missing authentication for privileged route\",\n      \"severity\": \"HIGH\",\n      \"root_cause\": \"privileged endpoint lacks auth\",\n      \"affected_locations\": [\"app.js\"],\n      \"attack_path\": \"Unauthenticated route handler reads protected data\",\n      \"why_it_matters\": \"Any caller can access protected functionality\",\n      \"guardrails_present\": [\"No auth checks observed\"],\n      \"recommended_fix\": \"Add robust auth checks and enforce role checks\",\n      \"related_variants\": [\"role header spoofing\"],\n      \"confidence\": \"MEDIUM\"\n    }\n  ]\n}"#.to_string();
        }

        if specialist_id == Some("security-command-injection-reviewer") {
            return r#"{\n  \"specialist_id\": \"security-command-injection-reviewer\",\n  \"category\": \"command-injection\",\n  \"findings\": [\n    {\n      \"title\": \"Command injection via shell execution\",\n      \"severity\": \"CRITICAL\",\n      \"root_cause\": \"untrusted input reaches cp.exec\",\n      \"affected_locations\": [\"app.js\"],\n      \"attack_path\": \"Request parameter -> command interpolation -> cp.exec\",\n      \"why_it_matters\": \"Remote code execution under process privileges\",\n      \"guardrails_present\": [\"No input validation\"],\n      \"recommended_fix\": \"Use allowlist command builder or avoid shell\",\n      \"related_variants\": [\"special chars\"],\n      \"confidence\": \"HIGH\"\n    }\n  ]\n}"#.to_string();
        }

        if specialist_id == Some("security-ssrf-reviewer") {
            return r#"{\n  \"specialist_id\": \"security-ssrf-reviewer\",\n  \"category\": \"ssrf\",\n  \"findings\": [\n    {\n      \"title\": \"Potential SSRF in webhook callback path\",\n      \"severity\": \"MEDIUM\",\n      \"root_cause\": \"user controlled URL is requested without allowlist\",\n      \"affected_locations\": [\"app.js\"],\n      \"attack_path\": \"Untrusted URL reaches outbound fetch helper\",\n      \"why_it_matters\": \"Internal metadata and services may become reachable\",\n      \"guardrails_present\": [\"No network allowlist observed\"],\n      \"recommended_fix\": \"Validate outbound URLs with allowlist and deny private CIDR ranges\",\n      \"related_variants\": [\"open redirect chain\"],\n      \"confidence\": \"MEDIUM\"\n    }\n  ]\n}"#.to_string();
        }

        "{\"specialist_id\":\"mock\",\"findings\":[]}".to_string()
    }

    fn mock_dispatch_specialist_id(prompt: &str) -> Option<&'static str> {
        let start = prompt.find('{')?;
        let end = prompt.rfind('}')?;
        let payload = &prompt[start..=end];
        let top_level = serde_json::from_str::<serde_json::Value>(payload).ok()?;
        top_level.get("specialist_id")?;
        let specialist_id = top_level.get("specialist_id")?.as_str()?;

        if specialist_id == "security-authentication-reviewer" {
            return Some("security-authentication-reviewer");
        }
        if specialist_id == "security-command-injection-reviewer" {
            return Some("security-command-injection-reviewer");
        }
        if specialist_id == "security-ssrf-reviewer" {
            return Some("security-ssrf-reviewer");
        }

        None
    }

    /// Call the Anthropic-compatible Messages API (also used by GLM/BigModel).
    ///
    /// POST {base_url}/v1/messages
    /// Headers:
    ///   x-api-key: {api_key}
    ///   anthropic-version: 2023-06-01
    ///   content-type: application/json
    async fn call_anthropic_compatible(
        &self,
        config: &AgentCallConfig,
        user_prompt: &str,
    ) -> Result<AgentResponse, String> {
        let url = format!("{}/v1/messages", config.base_url.trim_end_matches('/'));

        let mut body = serde_json::json!({
            "model": config.model,
            "max_tokens": config.max_tokens,
            "messages": [
                {
                    "role": "user",
                    "content": user_prompt
                }
            ]
        });

        // Add system prompt if provided
        if !config.system_prompt.is_empty() {
            body["system"] = serde_json::Value::String(config.system_prompt.clone());
        }

        // Add temperature if specified
        if let Some(temp) = config.temperature {
            body["temperature"] = serde_json::Value::Number(
                serde_json::Number::from_f64(temp).unwrap_or_else(|| serde_json::Number::from(0)),
            );
        }

        tracing::info!(
            "[AgentCaller] Calling Anthropic API: {} (model: {})",
            url,
            config.model
        );

        let response = self
            .client
            .post(&url)
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {e}"))?;

        let status = response.status();
        let response_text = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response body: {e}"))?;

        if !status.is_success() {
            return Ok(AgentResponse {
                content: String::new(),
                model: config.model.clone(),
                usage: None,
                success: false,
                error: Some(format!("API returned {status}: {response_text}")),
                raw: serde_json::from_str(&response_text).ok(),
            });
        }

        let json: serde_json::Value = serde_json::from_str(&response_text)
            .map_err(|e| format!("Failed to parse response JSON: {e}"))?;

        // Extract content from Anthropic response format
        let content = json
            .get("content")
            .and_then(|c| c.as_array())
            .and_then(|arr| {
                arr.iter()
                    .filter_map(|block| {
                        if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                            block
                                .get("text")
                                .and_then(|t| t.as_str())
                                .map(|s| s.to_string())
                        } else {
                            None
                        }
                    })
                    .reduce(|a, b| format!("{a}\n{b}"))
            })
            .unwrap_or_default();

        let usage = json.get("usage").map(|u| UsageInfo {
            input_tokens: u.get("input_tokens").and_then(|v| v.as_u64()),
            output_tokens: u.get("output_tokens").and_then(|v| v.as_u64()),
        });

        let model = json
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or(&config.model)
            .to_string();

        Ok(AgentResponse {
            content,
            model,
            usage,
            success: true,
            error: None,
            raw: Some(json),
        })
    }

    /// Call the OpenCode SDK API (BigModel coding endpoint).
    ///
    /// POST {base_url}/chat/completions
    /// Headers:
    ///   Authorization: Bearer {api_key}
    ///   content-type: application/json
    async fn call_opencode(
        &self,
        config: &AgentCallConfig,
        user_prompt: &str,
    ) -> Result<AgentResponse, String> {
        let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));

        let mut messages = vec![];

        if !config.system_prompt.is_empty() {
            messages.push(serde_json::json!({
                "role": "system",
                "content": config.system_prompt
            }));
        }

        messages.push(serde_json::json!({
            "role": "user",
            "content": user_prompt
        }));

        let mut body = serde_json::json!({
            "model": config.model,
            "messages": messages
        });

        if let Some(temp) = config.temperature {
            body["temperature"] = serde_json::Value::Number(
                serde_json::Number::from_f64(temp).unwrap_or_else(|| serde_json::Number::from(0)),
            );
        }

        tracing::info!(
            "[AgentCaller] Calling OpenCode API: {} (model: {})",
            url,
            config.model
        );

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {e}"))?;

        let status = response.status();
        let response_text = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response body: {e}"))?;

        if !status.is_success() {
            return Ok(AgentResponse {
                content: String::new(),
                model: config.model.clone(),
                usage: None,
                success: false,
                error: Some(format!("API returned {status}: {response_text}")),
                raw: serde_json::from_str(&response_text).ok(),
            });
        }

        let json: serde_json::Value = serde_json::from_str(&response_text)
            .map_err(|e| format!("Failed to parse response JSON: {e}"))?;

        // Extract content from OpenAI-compatible response format
        let content = json
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|msg| msg.get("content"))
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();

        let usage = json.get("usage").map(|u| UsageInfo {
            input_tokens: u
                .get("prompt_tokens")
                .or_else(|| u.get("input_tokens"))
                .and_then(|v| v.as_u64()),
            output_tokens: u
                .get("completion_tokens")
                .or_else(|| u.get("output_tokens"))
                .and_then(|v| v.as_u64()),
        });

        let model = json
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or(&config.model)
            .to_string();

        Ok(AgentResponse {
            content,
            model,
            usage,
            success: true,
            error: None,
            raw: Some(json),
        })
    }
}

/// Resolve environment variable references in a string.
/// Supports `${ENV_VAR}` and `${ENV_VAR:-default}` syntax.
pub fn resolve_env_vars(input: &str) -> String {
    let re = regex::Regex::new(r"\$\{([^}]+)\}").unwrap();
    re.replace_all(input, |caps: &regex::Captures| {
        let var_expr = &caps[1];
        // Support default value syntax: ${VAR:-default}
        if let Some(idx) = var_expr.find(":-") {
            let var_name = &var_expr[..idx];
            let default_val = &var_expr[idx + 2..];
            std::env::var(var_name).unwrap_or_else(|_| default_val.to_string())
        } else {
            std::env::var(var_expr).unwrap_or_else(|_| format!("${{{var_expr}}}"))
        }
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_env_vars() {
        std::env::set_var("TEST_WORKFLOW_VAR", "hello");
        assert_eq!(resolve_env_vars("${TEST_WORKFLOW_VAR}"), "hello");
        assert_eq!(
            resolve_env_vars("prefix-${TEST_WORKFLOW_VAR}-suffix"),
            "prefix-hello-suffix"
        );
        assert_eq!(resolve_env_vars("${NONEXISTENT_VAR:-fallback}"), "fallback");
        std::env::remove_var("TEST_WORKFLOW_VAR");
    }

    #[test]
    fn test_mock_dispatch_specialist_id_from_scoped_prompt() {
        let prompt = [
            "You are a scoped security specialist.",
            r#"{"specialist_id":"security-authentication-reviewer","categories":[],"candidates":[]}"#,
        ]
        .join("\n\n");

        let specialist_id = AcpAgentCaller::mock_dispatch_specialist_id(&prompt);
        assert_eq!(specialist_id, Some("security-authentication-reviewer"));
    }

    #[test]
    fn test_mock_dispatch_specialist_id_ignores_payload_text() {
        let prompt = [
            "You are running a tool-driven security review.",
            r#"{"repo_path":"/repo","changed_files":["resources/specialists/locales/en/review/security-authentication-reviewer.yaml"],"diff":"@@ -1,3 +1,3 @@\n+You are a scoped security specialist.","heuristic_candidates":[]}"#,
        ]
        .join("\n\n");

        let specialist_id = AcpAgentCaller::mock_dispatch_specialist_id(&prompt);
        assert_eq!(specialist_id, None);
    }
}
