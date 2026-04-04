//! Docker availability detection with caching.
//!
//! Mirrors the TypeScript `DockerDetector` in `src/core/acp/docker/detector.ts`.

use super::types::{DockerPullResult, DockerStatus};
use chrono::Utc;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::sync::{Mutex, Notify, RwLock};

/// Cache TTL in milliseconds (30 seconds).
const CACHE_TTL_MS: u64 = 30_000;

/// Default timeout for Docker commands in milliseconds.
const DEFAULT_TIMEOUT_MS: u64 = 5_000;

/// Docker availability detector with caching.
pub struct DockerDetector {
    cached_status: Arc<RwLock<Option<DockerStatus>>>,
    cached_at: Arc<RwLock<Instant>>,
    in_flight: Arc<Mutex<Option<Arc<Notify>>>>,
}

impl Default for DockerDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl DockerDetector {
    /// Create a new DockerDetector instance.
    pub fn new() -> Self {
        Self {
            cached_status: Arc::new(RwLock::new(None)),
            cached_at: Arc::new(RwLock::new(Instant::now() - Duration::from_secs(3600))),
            in_flight: Arc::new(Mutex::new(None)),
        }
    }

    /// Check Docker availability, using cache if valid.
    pub async fn check_availability(&self, force_refresh: bool) -> DockerStatus {
        self.check_availability_with_runner(force_refresh, |checked_at| async move {
            self.run_docker_info(&checked_at).await
        })
        .await
    }

    async fn check_availability_with_runner<F, Fut>(
        &self,
        force_refresh: bool,
        runner: F,
    ) -> DockerStatus
    where
        F: FnOnce(String) -> Fut,
        Fut: std::future::Future<Output = DockerStatus>,
    {
        loop {
            let now = Instant::now();

            if !force_refresh {
                let cached = self.cached_status.read().await;
                let cached_time = *self.cached_at.read().await;

                if let Some(status) = cached.as_ref() {
                    if now.duration_since(cached_time).as_millis() < CACHE_TTL_MS as u128 {
                        return status.clone();
                    }
                }
            }

            let notify = {
                let mut in_flight = self.in_flight.lock().await;
                if let Some(existing) = in_flight.as_ref() {
                    Some(existing.clone())
                } else {
                    let created = Arc::new(Notify::new());
                    *in_flight = Some(created.clone());
                    None
                }
            };

            if let Some(existing) = notify {
                existing.notified().await;
                continue;
            }

            let checked_at = Utc::now().to_rfc3339();
            let status = runner(checked_at).await;

            *self.cached_status.write().await = Some(status.clone());
            *self.cached_at.write().await = now;

            let notify = {
                let mut in_flight = self.in_flight.lock().await;
                in_flight.take()
            };
            if let Some(notify) = notify {
                notify.notify_waiters();
            }

            return status;
        }
    }

    /// Run `docker info` and parse the result.
    async fn run_docker_info(&self, checked_at: &str) -> DockerStatus {
        let result = tokio::time::timeout(
            Duration::from_millis(DEFAULT_TIMEOUT_MS),
            docker_command()
                .args(["info", "--format", "{{json .}}"])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output(),
        )
        .await;

        match result {
            Ok(Ok(output)) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let (version, api_version) = self.parse_docker_info(&stdout);

                DockerStatus {
                    available: true,
                    daemon_running: true,
                    version,
                    api_version,
                    error: None,
                    checked_at: checked_at.to_string(),
                }
            }
            Ok(Ok(output)) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                DockerStatus {
                    available: false,
                    daemon_running: false,
                    error: Some(stderr.to_string()),
                    checked_at: checked_at.to_string(),
                    ..Default::default()
                }
            }
            Ok(Err(e)) => DockerStatus {
                available: false,
                daemon_running: false,
                error: Some(format!("Failed to run docker: {}", e)),
                checked_at: checked_at.to_string(),
                ..Default::default()
            },
            Err(_) => DockerStatus {
                available: false,
                daemon_running: false,
                error: Some("Docker command timed out".to_string()),
                checked_at: checked_at.to_string(),
                ..Default::default()
            },
        }
    }

    /// Parse Docker info JSON output.
    fn parse_docker_info(&self, stdout: &str) -> (Option<String>, Option<String>) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
            let version = json
                .get("ServerVersion")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let api_version = json
                .get("ClientInfo")
                .and_then(|c| c.get("ApiVersion"))
                .and_then(|v| v.as_str())
                .or_else(|| json.get("APIVersion").and_then(|v| v.as_str()))
                .map(|s| s.to_string());

            (version, api_version)
        } else {
            (None, None)
        }
    }

    /// Check if a Docker image is available locally.
    pub async fn is_image_available(&self, image: &str) -> bool {
        let result = tokio::time::timeout(
            Duration::from_millis(DEFAULT_TIMEOUT_MS),
            docker_command()
                .args(["images", "-q", image])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output(),
        )
        .await;

        match result {
            Ok(Ok(output)) if output.status.success() => {
                !String::from_utf8_lossy(&output.stdout).trim().is_empty()
            }
            _ => false,
        }
    }

    /// Pull a Docker image from the registry.
    pub async fn pull_image(&self, image: &str) -> DockerPullResult {
        // 10 minute timeout for image pull
        let result = tokio::time::timeout(
            Duration::from_secs(10 * 60),
            docker_command()
                .args(["pull", image])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output(),
        )
        .await;

        match result {
            Ok(Ok(output)) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let combined = format!(
                    "{}{}",
                    stdout,
                    if stderr.is_empty() {
                        "".to_string()
                    } else {
                        format!("\n{}", stderr)
                    }
                );

                DockerPullResult {
                    ok: true,
                    image: image.to_string(),
                    output: Some(combined.trim().to_string()),
                    error: None,
                }
            }
            Ok(Ok(output)) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                DockerPullResult {
                    ok: false,
                    image: image.to_string(),
                    output: None,
                    error: Some(stderr.to_string()),
                }
            }
            Ok(Err(e)) => DockerPullResult {
                ok: false,
                image: image.to_string(),
                output: None,
                error: Some(format!("Failed to run docker pull: {}", e)),
            },
            Err(_) => DockerPullResult {
                ok: false,
                image: image.to_string(),
                output: None,
                error: Some("Docker pull timed out".to_string()),
            },
        }
    }
}

fn docker_command() -> Command {
    let mut command = Command::new("docker");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        command.as_std_mut().creation_flags(0x0800_0000);
    }

    command
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn check_availability_coalesces_concurrent_requests() {
        let detector = DockerDetector::new();
        let invocations = Arc::new(AtomicUsize::new(0));

        let first_counter = invocations.clone();
        let second_counter = invocations.clone();

        let first = detector.check_availability_with_runner(false, move |checked_at| {
            let counter = first_counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(50)).await;
                DockerStatus {
                    available: true,
                    daemon_running: true,
                    checked_at,
                    ..Default::default()
                }
            }
        });

        let second = detector.check_availability_with_runner(false, move |checked_at| {
            let counter = second_counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                DockerStatus {
                    available: true,
                    daemon_running: true,
                    checked_at,
                    ..Default::default()
                }
            }
        });

        let (left, right) = tokio::join!(first, second);

        assert!(left.available);
        assert!(right.available);
        assert_eq!(invocations.load(Ordering::SeqCst), 1);
    }
}
