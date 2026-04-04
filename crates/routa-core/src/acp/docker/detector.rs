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
    refresh_lock: Arc<Mutex<()>>,
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
            refresh_lock: Arc::new(Mutex::new(())),
        }
    }

    async fn cached_status_if_fresh(&self, now: Instant) -> Option<DockerStatus> {
        let cached = self.cached_status.read().await;
        let cached_time = *self.cached_at.read().await;

        cached.as_ref().and_then(|status| {
            if now.duration_since(cached_time).as_millis() < CACHE_TTL_MS as u128 {
                Some(status.clone())
            } else {
                None
            }
        })
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
        let started_at = Instant::now();

        if !force_refresh {
            if let Some(status) = self.cached_status_if_fresh(started_at).await {
                return status;
            }

            let _refresh_guard = self.refresh_lock.lock().await;
            let refreshed_at = Instant::now();
            if let Some(status) = self.cached_status_if_fresh(refreshed_at).await {
                return status;
            }

            let checked_at = Utc::now().to_rfc3339();
            let status = runner(checked_at).await;

            *self.cached_status.write().await = Some(status.clone());
            *self.cached_at.write().await = refreshed_at;

            return status;
        }

        let checked_at = Utc::now().to_rfc3339();
        let status = runner(checked_at).await;

        *self.cached_status.write().await = Some(status.clone());
        *self.cached_at.write().await = started_at;

        status
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
    command.kill_on_drop(true);

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

        let (left, right) = tokio::time::timeout(Duration::from_secs(1), async {
            tokio::join!(first, second)
        })
        .await
        .expect("concurrent availability checks should complete");

        assert!(left.available);
        assert!(right.available);
        assert_eq!(invocations.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn force_refresh_bypasses_in_flight_probe() {
        let detector = Arc::new(DockerDetector::new());
        let invocations = Arc::new(AtomicUsize::new(0));
        let background_started = Arc::new(Notify::new());
        let background_release = Arc::new(Notify::new());

        let background_detector = detector.clone();
        let background_counter = invocations.clone();
        let background_started_signal = background_started.clone();
        let background_release_signal = background_release.clone();
        let background = tokio::spawn(async move {
            background_detector
                .check_availability_with_runner(false, move |checked_at| {
                    let counter = background_counter.clone();
                    let started = background_started_signal.clone();
                    let release = background_release_signal.clone();
                    async move {
                        counter.fetch_add(1, Ordering::SeqCst);
                        started.notify_waiters();
                        release.notified().await;
                        DockerStatus {
                            available: true,
                            daemon_running: true,
                            checked_at,
                            ..Default::default()
                        }
                    }
                })
                .await
        });

        background_started.notified().await;

        let refresh_detector = detector.clone();
        let refresh_counter = invocations.clone();
        let refresh = tokio::spawn(async move {
            refresh_detector
                .check_availability_with_runner(true, move |checked_at| {
                    let counter = refresh_counter.clone();
                    async move {
                        counter.fetch_add(1, Ordering::SeqCst);
                        DockerStatus {
                            available: true,
                            daemon_running: true,
                            checked_at,
                            ..Default::default()
                        }
                    }
                })
                .await
        });

        let refreshed = tokio::time::timeout(Duration::from_millis(50), refresh)
            .await
            .expect("force refresh should not wait for in-flight background probe")
            .expect("force refresh task should complete");

        assert!(refreshed.available);

        background_release.notify_waiters();
        let background = background.await.expect("background task should complete");

        assert!(background.available);
        assert_eq!(invocations.load(Ordering::SeqCst), 2);
    }
}
