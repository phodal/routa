//! GitHub Polling API endpoints
//!
//! Provides a polling-based alternative to webhooks for local development.
//! Uses system notifications to alert users of new events.
//!
//! Endpoints:
//! - GET  /api/polling/config - Get current polling configuration
//! - POST /api/polling/config - Update polling configuration
//! - GET  /api/polling/check  - Get polling status
//! - POST /api/polling/check  - Manually trigger a poll check

use axum::{extract::State, routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::error::ServerError;
use crate::state::AppState;

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollingConfig {
    pub enabled: bool,
    pub interval_seconds: u32,
    pub last_event_ids: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_checked_at: Option<String>,
    pub is_running: bool,
}

impl Default for PollingConfig {
    fn default() -> Self {
        // Initialize from environment variables
        let enabled = std::env::var("GITHUB_POLLING_ENABLED")
            .unwrap_or_else(|_| "false".to_string())
            .parse()
            .unwrap_or(false);

        let interval_seconds = std::env::var("GITHUB_POLLING_INTERVAL")
            .unwrap_or_else(|_| "30".to_string())
            .parse()
            .unwrap_or(30)
            .max(10); // Minimum 10 seconds

        Self {
            enabled,
            interval_seconds,
            last_event_ids: HashMap::new(),
            last_checked_at: None,
            is_running: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub actor: GitHubActor,
    pub repo: GitHubRepo,
    pub payload: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubActor {
    pub login: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRepo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollResult {
    pub repo: String,
    pub events_found: u32,
    pub events_processed: u32,
    pub events_skipped: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_last_event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollSummary {
    pub repos_checked: u32,
    pub total_events_found: u32,
    pub total_events_processed: u32,
    pub total_events_skipped: u32,
}

// ─── Global State ────────────────────────────────────────────────────────────

lazy_static::lazy_static! {
    static ref POLLING_CONFIG: Mutex<PollingConfig> = Mutex::new(PollingConfig::default());
    static ref POLLING_HANDLE: Mutex<Option<Arc<tokio::task::JoinHandle<()>>>> = Mutex::new(None);
}

// ─── Background Polling Task ─────────────────────────────────────────────────

/// Start the background polling task if enabled
pub fn start_polling_if_enabled() {
    let config = POLLING_CONFIG.lock().unwrap().clone();
    if config.enabled {
        tracing::info!(
            "[Polling] Auto-starting from env: interval={}s",
            config.interval_seconds
        );
        start_polling_task();
    }
}

fn start_polling_task() {
    let mut handle_guard = POLLING_HANDLE.lock().unwrap();

    // Don't start if already running
    if handle_guard.is_some() {
        return;
    }

    let handle = tokio::spawn(async {
        loop {
            let interval = {
                let config = POLLING_CONFIG.lock().unwrap();
                if !config.enabled {
                    break;
                }
                config.interval_seconds
            };

            tokio::time::sleep(Duration::from_secs(interval as u64)).await;

            // Perform polling check
            if let Err(e) = poll_all_repos().await {
                tracing::error!("[Polling] Error during poll: {}", e);
            }
        }
        tracing::info!("[Polling] Background task stopped");
    });

    *handle_guard = Some(Arc::new(handle));
}

fn stop_polling_task() {
    let mut handle_guard = POLLING_HANDLE.lock().unwrap();
    if let Some(handle) = handle_guard.take() {
        handle.abort();
        tracing::info!("[Polling] Background task aborted");
    }
}

async fn poll_all_repos() -> Result<Vec<PollResult>, String> {
    // In a full implementation, we would:
    // 1. Fetch webhook configs from database
    // 2. Poll each repo's GitHub Events API
    // 3. Process events and create background tasks
    // 4. Send notifications for new events
    //
    // For now, return empty results
    let results: Vec<PollResult> = vec![];

    let checked_at = chrono::Utc::now().to_rfc3339();
    {
        let mut config = POLLING_CONFIG.lock().unwrap();
        config.last_checked_at = Some(checked_at);
    }

    Ok(results)
}

// ─── Router ──────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/config", get(get_config).post(update_config))
        .route("/check", get(get_status).post(check_now))
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async fn get_config() -> Result<Json<serde_json::Value>, ServerError> {
    let config = POLLING_CONFIG.lock().unwrap().clone();

    Ok(Json(serde_json::json!({
        "ok": true,
        "config": config,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateConfigRequest {
    enabled: Option<bool>,
    interval_seconds: Option<u32>,
}

async fn update_config(
    Json(body): Json<UpdateConfigRequest>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let mut config = POLLING_CONFIG.lock().unwrap();

    if let Some(enabled) = body.enabled {
        config.enabled = enabled;
        config.is_running = enabled;

        // Drop the lock before starting/stopping task
        drop(config);

        if enabled {
            start_polling_task();
            send_notification(
                "Routa Polling Enabled",
                "GitHub event polling is now active",
            );
        } else {
            stop_polling_task();
            send_notification(
                "Routa Polling Disabled",
                "GitHub event polling has been stopped",
            );
        }

        // Re-acquire lock
        config = POLLING_CONFIG.lock().unwrap();
    }

    if let Some(interval) = body.interval_seconds {
        if interval >= 10 {
            config.interval_seconds = interval;

            // Restart polling task if running
            if config.enabled {
                drop(config);
                stop_polling_task();
                start_polling_task();
                config = POLLING_CONFIG.lock().unwrap();
            }
        }
    }

    let config_clone = config.clone();
    drop(config);

    Ok(Json(serde_json::json!({
        "ok": true,
        "config": config_clone,
    })))
}

async fn get_status() -> Result<Json<serde_json::Value>, ServerError> {
    let config = POLLING_CONFIG.lock().unwrap();

    Ok(Json(serde_json::json!({
        "ok": true,
        "isRunning": config.is_running,
        "lastCheckedAt": config.last_checked_at,
        "intervalSeconds": config.interval_seconds,
        "enabled": config.enabled,
    })))
}

async fn check_now(State(_state): State<AppState>) -> Result<Json<serde_json::Value>, ServerError> {
    let results = poll_all_repos()
        .await
        .map_err(|e| ServerError::Internal(format!("Polling failed: {e}")))?;

    let summary = PollSummary {
        repos_checked: results.len() as u32,
        total_events_found: results.iter().map(|r| r.events_found).sum(),
        total_events_processed: results.iter().map(|r| r.events_processed).sum(),
        total_events_skipped: results.iter().map(|r| r.events_skipped).sum(),
    };

    // Send notification that check completed
    send_notification(
        "Routa Poll Check",
        &format!(
            "Checked {} repos, {} events found",
            summary.repos_checked, summary.total_events_found
        ),
    );

    let checked_at = POLLING_CONFIG
        .lock()
        .unwrap()
        .last_checked_at
        .clone()
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    tracing::info!(
        "[Polling] Check completed: {} repos, {} events",
        summary.repos_checked,
        summary.total_events_found
    );

    Ok(Json(serde_json::json!({
        "ok": true,
        "checkedAt": checked_at,
        "summary": summary,
        "results": results,
    })))
}

// ─── System Notifications ────────────────────────────────────────────────────

/// Send a system notification using the platform's native notification API.
///
/// On macOS, this uses the Notification Center.
/// On Windows, this uses the Windows notification system.
/// On Linux, this uses libnotify (if available).
fn send_notification(title: &str, body: &str) {
    #[cfg(target_os = "macos")]
    {
        use notify_rust::Notification;
        let _ = Notification::new()
            .summary(title)
            .body(body)
            .appname("Routa")
            .sound_name("default")
            .show();
    }

    #[cfg(target_os = "windows")]
    {
        use notify_rust::Notification;
        let _ = Notification::new()
            .summary(title)
            .body(body)
            .appname("Routa")
            .show();
    }

    #[cfg(target_os = "linux")]
    {
        use notify_rust::Notification;
        let _ = Notification::new()
            .summary(title)
            .body(body)
            .appname("Routa")
            .show();
    }

    // Log the notification for debugging
    tracing::debug!("[Notification] {}: {}", title, body);
}
