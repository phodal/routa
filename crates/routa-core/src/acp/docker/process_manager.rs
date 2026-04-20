//! Docker process manager for container lifecycle management.
//!
//! Mirrors the TypeScript `DockerProcessManager` in `src/core/acp/docker/process-manager.ts`.

use super::types::{DockerContainerConfig, DockerContainerInfo};
use super::utils::{
    find_available_port, generate_container_name, sanitize_env_for_logging, shell_escape,
    DEFAULT_CONTAINER_PORT, DEFAULT_DOCKER_AGENT_IMAGE, DEFAULT_HEALTH_TIMEOUT_MS,
};
use chrono::{DateTime, Utc};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::process::Command;
use tokio::sync::RwLock;

const CONTAINER_IDLE_TIMEOUT_MS: u64 = 5 * 60 * 1000; // 5 minutes

/// Extended container info for persistent container tracking
#[derive(Debug, Clone)]
struct PersistentContainerInfo {
    info: DockerContainerInfo,
    last_used_at: DateTime<Utc>,
    session_count: usize,
}

/// Docker process manager for container lifecycle management.
pub struct DockerProcessManager {
    containers: Arc<RwLock<HashMap<String, DockerContainerInfo>>>,
    used_ports: Arc<RwLock<HashSet<u16>>>,
    persistent_container: Arc<RwLock<Option<PersistentContainerInfo>>>,
}

impl Default for DockerProcessManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DockerProcessManager {
    /// Create a new DockerProcessManager instance.
    pub fn new() -> Self {
        Self {
            containers: Arc::new(RwLock::new(HashMap::new())),
            used_ports: Arc::new(RwLock::new(HashSet::new())),
            persistent_container: Arc::new(RwLock::new(None)),
        }
    }

    /// List all managed containers.
    pub async fn list_containers(&self) -> Vec<DockerContainerInfo> {
        self.containers.read().await.values().cloned().collect()
    }

    /// Get a container by session ID.
    pub async fn get_container(&self, session_id: &str) -> Option<DockerContainerInfo> {
        self.containers.read().await.get(session_id).cloned()
    }

    /// Acquire a container for a session, reusing the persistent container if healthy.
    /// This is the main entry point for container lifecycle management with reuse support.
    pub async fn acquire_container(
        &self,
        config: DockerContainerConfig,
    ) -> Result<DockerContainerInfo, String> {
        // Hold write lock for entire operation to avoid TOCTOU
        let mut persistent_write = self.persistent_container.write().await;

        if let Some(ref mut p) = *persistent_write {
            if self.is_container_healthy(&p.info).await {
                tracing::info!(
                    "[DockerProcessManager] Reusing persistent container {} for session {} (sessions: {})",
                    p.info.container_name,
                    config.session_id,
                    p.session_count + 1
                );

                p.last_used_at = Utc::now();
                p.session_count += 1;

                // Map this session to the persistent container
                let session_info = DockerContainerInfo {
                    session_id: config.session_id.clone(),
                    ..p.info.clone()
                };
                self.containers
                    .write()
                    .await
                    .insert(config.session_id.clone(), session_info.clone());

                return Ok(session_info);
            }
        }
        drop(persistent_write);

        // No healthy persistent container available, start a new one
        self.start_container(config).await
    }

    /// Check if a container is healthy by querying its health endpoint.
    async fn is_container_healthy(&self, info: &DockerContainerInfo) -> bool {
        let health_url = format!("http://127.0.0.1:{}/health", info.host_port);

        match tokio::time::timeout(Duration::from_secs(3), reqwest::get(&health_url)).await {
            Ok(Ok(response)) => response.status().is_success(),
            _ => false,
        }
    }

    /// Start a Docker container for an agent session.
    pub async fn start_container(
        &self,
        config: DockerContainerConfig,
    ) -> Result<DockerContainerInfo, String> {
        let container_port = config.container_port.unwrap_or(DEFAULT_CONTAINER_PORT);
        let used_ports = self.used_ports.read().await.clone();
        let host_port = find_available_port(&used_ports).await?;
        let container_name = generate_container_name(&config.session_id);

        let mut labels = HashMap::new();
        labels.insert("routa.managed".to_string(), "true".to_string());
        labels.insert("routa.session".to_string(), config.session_id.clone());
        if let Some(extra_labels) = &config.labels {
            labels.extend(extra_labels.clone());
        }

        let sanitized_env = sanitize_env_for_logging(config.env.as_ref());

        // Build docker run command
        let mut run_parts = vec![
            "docker".to_string(),
            "run".to_string(),
            "-d".to_string(),
            "--rm".to_string(),
            format!("--name={}", container_name),
            format!("-p={}:{}", host_port, container_port),
            // Resource limits to prevent runaway processes
            "--memory=2g".to_string(),
            "--cpus=2".to_string(),
            "--pids-limit=100".to_string(),
            "--add-host=host.docker.internal:host-gateway".to_string(),
            "-w=/workspace".to_string(),
            format!("-v={}:/workspace", shell_escape(&config.workspace_path)),
        ];

        // Mount SSH keys if available
        if let Some(home) = dirs::home_dir() {
            let ssh_dir = home.join(".ssh");
            if ssh_dir.exists() {
                run_parts.push(format!(
                    "-v={}:/root/.ssh:ro",
                    shell_escape(&ssh_dir.to_string_lossy())
                ));
            }

            let gitconfig = home.join(".gitconfig");
            if gitconfig.exists() {
                run_parts.push(format!(
                    "-v={}:/root/.gitconfig:ro",
                    shell_escape(&gitconfig.to_string_lossy())
                ));
            }
        }

        // Set Routa MCP URL
        let routa_port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
        run_parts.push(format!(
            "-e=ROUTA_MCP_URL=http://host.docker.internal:{routa_port}/api/mcp"
        ));

        // Forward provider API keys
        Self::forward_env_vars(&mut run_parts);

        // Add labels
        for (key, value) in &labels {
            run_parts.push(format!("--label={key}={value}"));
        }

        // Add additional volumes
        if let Some(volumes) = &config.additional_volumes {
            for vol in volumes {
                run_parts.push(format!(
                    "-v={}:{}",
                    shell_escape(&vol.host_path),
                    shell_escape(&vol.container_path)
                ));
            }
        }

        // Add environment variables
        if let Some(env) = &config.env {
            for (key, value) in env {
                run_parts.push(format!("-e={}={}", key, shell_escape(value)));
            }
        }

        // Mount auth.json if provided
        if let Some(auth_json) = &config.auth_json {
            if !auth_json.trim().is_empty() {
                if let Some(temp_file) = self.write_auth_json(&config.session_id, auth_json).await?
                {
                    run_parts.push(format!(
                        "-v={}:/root/.local/share/opencode/auth.json:ro",
                        shell_escape(&temp_file.to_string_lossy())
                    ));
                }
            }
        }

        // Add image
        let image = if config.image.is_empty() {
            DEFAULT_DOCKER_AGENT_IMAGE.to_string()
        } else {
            config.image.clone()
        };
        run_parts.push(image.clone());

        // Execute docker run
        let output = self.run_docker_command(&run_parts).await?;
        let container_id = output.trim().to_string();

        let info = DockerContainerInfo {
            session_id: config.session_id.clone(),
            container_id,
            container_name: container_name.clone(),
            host_port,
            container_port,
            image,
            workspace_path: config.workspace_path,
            created_at: Utc::now(),
        };

        self.containers
            .write()
            .await
            .insert(config.session_id.clone(), info.clone());
        self.used_ports.write().await.insert(host_port);

        // Set as persistent container for reuse
        *self.persistent_container.write().await = Some(PersistentContainerInfo {
            info: info.clone(),
            last_used_at: Utc::now(),
            session_count: 1,
        });

        tracing::info!(
            "[DockerProcessManager] Started container {} on port {} (image: {}, env: {:?}, reusable: true)",
            container_name,
            host_port,
            info.image,
            sanitized_env
        );

        Ok(info)
    }

    /// Wait for a container to become healthy.
    pub async fn wait_for_healthy(
        &self,
        session_id: &str,
        timeout_ms: Option<u64>,
    ) -> Result<(), String> {
        let info = self
            .get_container(session_id)
            .await
            .ok_or_else(|| format!("No managed Docker container for session {session_id}"))?;

        let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_HEALTH_TIMEOUT_MS));
        let health_url = format!("http://127.0.0.1:{}/health", info.host_port);
        let start = std::time::Instant::now();

        tracing::info!(
            "[DockerProcessManager] Starting container {} on port {}...",
            info.container_name,
            info.host_port
        );

        while start.elapsed() < timeout {
            match reqwest::get(&health_url).await {
                Ok(resp) if resp.status().is_success() => {
                    tracing::info!("[DockerProcessManager] Container is healthy ✓");
                    return Ok(());
                }
                _ => {
                    // Transient failure, retry
                }
            }

            tokio::time::sleep(Duration::from_secs(1)).await;
        }

        let logs = self.get_container_logs(&info.container_name).await;
        Err(format!(
            "Docker container health check timeout after {}ms for {}. Health endpoint: {}. Logs:\n{}",
            timeout.as_millis(),
            info.container_name,
            health_url,
            logs
        ))
    }

    /// Stop and remove a container by session ID.
    pub async fn stop_container(&self, session_id: &str) -> Result<(), String> {
        let info = match self.containers.read().await.get(session_id).cloned() {
            Some(info) => info,
            None => return Ok(()),
        };

        // Remove session mapping
        self.containers.write().await.remove(session_id);

        // If this is the persistent container, don't stop it immediately
        // Instead, schedule idle timeout for potential reuse
        let persistent = self.persistent_container.read().await;
        if let Some(ref persistent_info) = *persistent {
            if info.container_name == persistent_info.info.container_name {
                drop(persistent);
                tracing::info!(
                    "[DockerProcessManager] Session {} ended, keeping persistent container {} alive for reuse (idle timeout: {}s)",
                    session_id,
                    info.container_name,
                    CONTAINER_IDLE_TIMEOUT_MS / 1000
                );
                // Note: In Rust, we don't implement the idle timeout mechanism here
                // as it would require spawning background tasks. The container will
                // be reused by subsequent sessions or stopped when stop_all is called.
                return Ok(());
            }
        }
        drop(persistent);

        // Non-persistent container, stop it immediately
        // Try graceful stop first
        let _ = self
            .run_docker_command(&["docker", "stop", "-t", "10", &info.container_name])
            .await;

        // Force kill if needed
        let _ = self
            .run_docker_command(&["docker", "kill", &info.container_name])
            .await;

        // Force remove
        let _ = self
            .run_docker_command(&["docker", "rm", "-f", &info.container_name])
            .await;

        self.used_ports.write().await.remove(&info.host_port);

        Ok(())
    }

    /// Stop the persistent container and clean up resources.
    async fn stop_persistent_container(&self) -> Result<(), String> {
        let mut persistent = self.persistent_container.write().await;
        if let Some(persistent_info) = persistent.take() {
            let container_name = &persistent_info.info.container_name;

            // Try graceful stop first
            let _ = self
                .run_docker_command(&["docker", "stop", "-t", "10", container_name])
                .await;

            // Force kill if needed
            let _ = self
                .run_docker_command(&["docker", "kill", container_name])
                .await;

            // Force remove
            let _ = self
                .run_docker_command(&["docker", "rm", "-f", container_name])
                .await;

            self.used_ports
                .write()
                .await
                .remove(&persistent_info.info.host_port);

            tracing::info!(
                "[DockerProcessManager] Stopped persistent container {}",
                container_name
            );
        }
        Ok(())
    }

    /// Stop all managed containers.
    pub async fn stop_all(&self) -> Result<(), String> {
        let session_ids: Vec<String> = self.containers.read().await.keys().cloned().collect();

        for session_id in session_ids {
            let _ = self.stop_container(&session_id).await;
        }

        // Also stop the persistent container
        let _ = self.stop_persistent_container().await;

        self.containers.write().await.clear();
        self.used_ports.write().await.clear();

        Ok(())
    }

    /// Run a docker command and return stdout.
    async fn run_docker_command(&self, args: &[impl AsRef<str>]) -> Result<String, String> {
        let args: Vec<&str> = args.iter().map(|s| s.as_ref()).collect();
        if args.is_empty() {
            return Err("Empty command".to_string());
        }

        let result = tokio::time::timeout(
            Duration::from_secs(30),
            #[allow(clippy::needless_borrows_for_generic_args)]
            Command::new(&args[0])
                .args(&args[1..])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output(),
        )
        .await;

        match result {
            Ok(Ok(output)) if output.status.success() => {
                Ok(String::from_utf8_lossy(&output.stdout).to_string())
            }
            Ok(Ok(output)) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("Docker command failed: {stderr}"))
            }
            Ok(Err(e)) => Err(format!("Failed to run docker: {e}")),
            Err(_) => Err("Docker command timed out".to_string()),
        }
    }

    /// Get container logs.
    async fn get_container_logs(&self, container_name: &str) -> String {
        match self
            .run_docker_command(&["docker", "logs", "--tail", "200", container_name])
            .await
        {
            Ok(logs) => logs,
            Err(e) => format!("Failed to read logs: {e}"),
        }
    }

    /// Forward environment variables from host to container.
    fn forward_env_vars(run_parts: &mut Vec<String>) {
        let provider_keys = [
            "GITHUB_TOKEN",
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "OPENAI_API_KEY",
            "OPENAI_API_BASE",
            "OPENAI_BASE_URL",
            "GEMINI_API_KEY",
            "OPENROUTER_API_KEY",
            "XAI_API_KEY",
            "AZURE_OPENAI_API_KEY",
            "AZURE_OPENAI_ENDPOINT",
        ];

        for key in provider_keys {
            if let Ok(value) = std::env::var(key) {
                run_parts.push(format!("-e={}={}", key, shell_escape(&value)));
            }
        }
    }

    /// Write auth.json to a temporary file.
    async fn write_auth_json(
        &self,
        session_id: &str,
        auth_json: &str,
    ) -> Result<Option<PathBuf>, String> {
        let temp_dir = std::env::temp_dir().join("routa-opencode-auth");
        tokio::fs::create_dir_all(&temp_dir)
            .await
            .map_err(|e| format!("Failed to create temp directory: {e}"))?;

        let temp_file = temp_dir.join(format!("auth-{session_id}.json"));
        tokio::fs::write(&temp_file, auth_json)
            .await
            .map_err(|e| format!("Failed to write auth.json: {e}"))?;

        tracing::info!(
            "[DockerProcessManager] Mounted auth.json from {:?}",
            temp_file
        );

        Ok(Some(temp_file))
    }
}
