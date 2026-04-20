//! Docker OpenCode adapter for HTTP/SSE communication with containers.
//!
//! Mirrors the TypeScript `DockerOpenCodeAdapter` in `src/core/acp/docker/docker-opencode-adapter.ts`.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;

/// Docker OpenCode adapter for communicating with containerized agents.
pub struct DockerOpenCodeAdapter {
    base_url: String,
    client: Client,
    alive: Arc<AtomicBool>,
    local_session_id: Arc<tokio::sync::RwLock<Option<String>>>,
    remote_session_id: Arc<tokio::sync::RwLock<Option<String>>>,
    notification_tx: broadcast::Sender<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NewSessionRequest {
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewSessionResponse {
    session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptRequest {
    session_id: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    skill_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    workspace_id: Option<String>,
}

impl DockerOpenCodeAdapter {
    /// Create a new adapter for communicating with a Docker container.
    pub fn new(base_url: &str, notification_tx: broadcast::Sender<serde_json::Value>) -> Self {
        let base_url = base_url.trim_end_matches('/').to_string();

        let client = Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            base_url,
            client,
            alive: Arc::new(AtomicBool::new(false)),
            local_session_id: Arc::new(tokio::sync::RwLock::new(None)),
            remote_session_id: Arc::new(tokio::sync::RwLock::new(None)),
            notification_tx,
        }
    }

    /// Check if the adapter is connected.
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// Connect to the container by performing a health check.
    pub async fn connect(&self) -> Result<(), String> {
        let url = format!("{}/health", self.base_url);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Health check failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Docker OpenCode health check failed: {} {}",
                resp.status().as_u16(),
                resp.status().canonical_reason().unwrap_or("")
            ));
        }

        self.alive.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// Create a new session in the container.
    pub async fn create_session(&self, title: Option<&str>) -> Result<String, String> {
        if !self.is_alive() {
            return Err("DockerOpenCodeAdapter is not connected".to_string());
        }

        let url = format!("{}/session/new", self.base_url);
        let body = NewSessionRequest {
            title: title.unwrap_or("Routa Docker Session").to_string(),
        };

        let resp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Failed to create session: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Failed to create docker OpenCode session: {} {}{}",
                status.as_u16(),
                status.canonical_reason().unwrap_or(""),
                if body.is_empty() {
                    "".to_string()
                } else {
                    format!(": {body}")
                }
            ));
        }

        let response: NewSessionResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse session response: {e}"))?;

        *self.remote_session_id.write().await = Some(response.session_id.clone());

        Ok(response.session_id)
    }

    /// Set the local session ID (Routa's session ID).
    pub async fn set_local_session_id(&self, session_id: &str) {
        *self.local_session_id.write().await = Some(session_id.to_string());
    }

    /// Get the remote session ID.
    pub async fn get_remote_session_id(&self) -> Option<String> {
        self.remote_session_id.read().await.clone()
    }

    /// Cancel the current prompt.
    pub async fn cancel(&self) -> Result<(), String> {
        let remote_sid = self.remote_session_id.read().await.clone();
        if let Some(session_id) = remote_sid {
            let url = format!("{}/session/cancel", self.base_url);
            let _ = self
                .client
                .post(&url)
                .json(&serde_json::json!({ "sessionId": session_id }))
                .send()
                .await;
        }
        Ok(())
    }

    /// Send a prompt to the container and stream the response via SSE.
    pub async fn prompt_stream(
        &self,
        text: &str,
        acp_session_id: Option<&str>,
        skill_content: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<(), String> {
        if !self.is_alive() {
            return Err("Docker OpenCode session is not active".to_string());
        }

        let remote_sid = self.remote_session_id.read().await.clone();
        let remote_session_id = remote_sid.ok_or("No remote session ID")?;

        let local_sid = self.local_session_id.read().await.clone();
        let session_id = acp_session_id
            .map(|s| s.to_string())
            .or(local_sid)
            .unwrap_or(remote_session_id.clone());

        let url = format!("{}/session/prompt", self.base_url);
        let body = PromptRequest {
            session_id: remote_session_id,
            prompt: text.to_string(),
            skill_content: skill_content.map(|s| s.to_string()),
            workspace_id: workspace_id.map(|s| s.to_string()),
        };

        let resp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Docker OpenCode prompt failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Docker OpenCode prompt failed: {} {}",
                resp.status().as_u16(),
                resp.status().canonical_reason().unwrap_or("")
            ));
        }

        // Check if it's an SSE stream
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        if content_type.contains("text/event-stream") {
            // Handle SSE stream
            let bytes = resp
                .bytes()
                .await
                .map_err(|e| format!("Failed to read SSE stream: {e}"))?;
            let text = String::from_utf8_lossy(&bytes);

            self.parse_sse_stream(&text, &session_id).await;
        } else {
            // Handle JSON response
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let content = json
                    .get("content")
                    .and_then(|v| v.as_str())
                    .or_else(|| json.get("message").and_then(|v| v.as_str()))
                    .unwrap_or("");

                if !content.is_empty() {
                    let msg = self.agent_chunk(&session_id, content);
                    let _ = self.notification_tx.send(msg);
                }
            }
        }

        // Send turn_complete
        let complete = self.turn_complete(&session_id);
        let _ = self.notification_tx.send(complete);

        Ok(())
    }

    /// Parse SSE stream and emit notifications.
    async fn parse_sse_stream(&self, text: &str, session_id: &str) {
        for frame in text.split("\n\n") {
            if !frame.starts_with("data:") {
                continue;
            }

            let payload = frame.strip_prefix("data:").unwrap_or("").trim();
            if payload.is_empty() {
                continue;
            }

            if let Some(parsed) = self.parse_stream_payload(payload, session_id) {
                let _ = self.notification_tx.send(parsed);
            }
        }
    }

    /// Parse a single SSE payload and convert to session update.
    fn parse_stream_payload(&self, payload: &str, session_id: &str) -> Option<serde_json::Value> {
        let json: serde_json::Value = serde_json::from_str(payload).ok()?;

        // Extract content from various possible formats
        let content = json
            .get("content")
            .and_then(|v| v.as_str())
            .or_else(|| json.get("message").and_then(|v| v.as_str()))
            .or_else(|| {
                json.get("params")
                    .and_then(|p| p.get("update"))
                    .and_then(|u| u.get("content"))
                    .and_then(|c| c.get("text"))
                    .and_then(|t| t.as_str())
            });

        if let Some(text) = content {
            return Some(self.agent_chunk(session_id, text));
        }

        // Pass through session/update notifications
        if json.get("method").and_then(|m| m.as_str()) == Some("session/update") {
            return Some(json);
        }

        None
    }

    /// Create an agent_chunk notification.
    fn agent_chunk(&self, session_id: &str, text: &str) -> serde_json::Value {
        serde_json::json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": session_id,
                "update": {
                    "sessionUpdate": "agent_chunk",
                    "content": { "type": "text", "text": text }
                }
            }
        })
    }

    /// Create a turn_complete notification.
    fn turn_complete(&self, session_id: &str) -> serde_json::Value {
        serde_json::json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": session_id,
                "update": {
                    "sessionUpdate": "turn_complete",
                    "stopReason": "end_of_turn"
                }
            }
        })
    }
}
