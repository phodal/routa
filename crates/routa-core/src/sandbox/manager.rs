//! Sandbox manager for Docker-based code execution sandboxes.
//!
//! Manages the lifecycle of sandbox containers: creation, tracking, idle-timeout
//! cleanup, and routing execution requests to the in-sandbox server.
//!
//! Architecture mirrors the Python sandbox manager described in:
//! https://amirmalik.net/2025/03/07/code-sandboxes-for-llm-ai-agents

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use serde_json::Value;
use tokio::process::Command;
use tokio::sync::RwLock;

use crate::acp::docker::find_available_port;

use super::env::parse_env_file;
use super::policy::{ResolvedSandboxPolicy, SandboxEnvMode, SandboxNetworkMode};
use super::types::{
    ExecuteRequest, ResolvedCreateSandboxRequest, SandboxInfo, SANDBOX_CHECK_INTERVAL_SECS,
    SANDBOX_CONTAINER_PORT, SANDBOX_IDLE_TIMEOUT_SECS, SANDBOX_IMAGE, SANDBOX_LABEL,
};

/// Manages Docker-based code execution sandboxes.
///
/// Each sandbox is a Docker container running the in-sandbox FastAPI/Jupyter
/// server. The manager handles container lifecycle and proxies execution
/// requests to the appropriate container.
pub struct SandboxManager {
    /// Maps container ID → `SandboxInfo`.
    sandboxes: Arc<RwLock<HashMap<String, SandboxInfo>>>,
    /// Maps container ID → last activity `Instant` (for idle timeout).
    last_active: Arc<RwLock<HashMap<String, Instant>>>,
    /// Currently allocated host ports (to avoid reuse).
    used_ports: Arc<RwLock<HashSet<u16>>>,
    /// Shared HTTP client for proxying execution requests.
    http_client: reqwest::Client,
}

impl Default for SandboxManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SandboxManager {
    /// Create a new `SandboxManager` and spawn the background idle-cleanup task.
    pub fn new() -> Self {
        let sandboxes = Arc::new(RwLock::new(HashMap::new()));
        let last_active = Arc::new(RwLock::new(HashMap::new()));
        let used_ports = Arc::new(RwLock::new(HashSet::new()));

        let mgr = Self {
            sandboxes,
            last_active,
            used_ports,
            http_client: reqwest::Client::new(),
        };

        // Spawn background task to terminate idle sandboxes.
        mgr.spawn_idle_cleanup();

        mgr
    }

    /// Spawn a Tokio task that periodically terminates idle sandboxes.
    fn spawn_idle_cleanup(&self) {
        let sandboxes = self.sandboxes.clone();
        let last_active = self.last_active.clone();
        let used_ports = self.used_ports.clone();

        tokio::spawn(async move {
            let mut interval =
                tokio::time::interval(Duration::from_secs(SANDBOX_CHECK_INTERVAL_SECS));
            loop {
                interval.tick().await;
                let now = Instant::now();
                let ids: Vec<String> = last_active.read().await.keys().cloned().collect();

                for id in ids {
                    let last = last_active.read().await.get(&id).copied();
                    match last {
                        None => {
                            // Unknown/untracked container — skip
                        }
                        Some(t) if now.duration_since(t).as_secs() < SANDBOX_IDLE_TIMEOUT_SECS => {
                            // Still active
                        }
                        _ => {
                            tracing::info!(
                                "[SandboxManager] Terminating idle sandbox {}",
                                &id[..8.min(id.len())]
                            );
                            // Best-effort stop+remove
                            let _ = stop_container(&id).await;
                            let mut sandboxes = sandboxes.write().await;
                            if let Some(info) = sandboxes.remove(&id) {
                                if let Some(port) = info.port {
                                    used_ports.write().await.remove(&port);
                                }
                            }
                            last_active.write().await.remove(&id);
                        }
                    }
                }
            }
        });
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /// List all tracked sandbox containers.
    pub async fn list_sandboxes(&self) -> Vec<SandboxInfo> {
        self.sandboxes.read().await.values().cloned().collect()
    }

    /// Get a sandbox by container ID (or unique prefix).
    pub async fn get_sandbox(&self, id: &str) -> Option<SandboxInfo> {
        let sandboxes = self.sandboxes.read().await;

        // Exact match first
        if let Some(info) = sandboxes.get(id) {
            return Some(info.clone());
        }

        // Prefix match (Docker short IDs)
        sandboxes
            .values()
            .find(|info| info.id.starts_with(id))
            .cloned()
    }

    /// Create a new sandbox container and return its info.
    pub async fn create_sandbox(
        &self,
        req: ResolvedCreateSandboxRequest,
    ) -> Result<SandboxInfo, String> {
        let lang = req.lang.to_lowercase();
        if lang != "python" {
            return Err("Only Python sandboxes are supported.".to_string());
        }

        // Choose an available host port.
        let host_port = {
            let used = self.used_ports.read().await.clone();
            find_available_port(&used).await?
        };
        self.used_ports.write().await.insert(host_port);

        // Unique container name with timestamp.
        let short_id = &uuid::Uuid::new_v4().to_string()[..8];
        let container_name = format!("routa-sandbox-{short_id}");

        // Build `docker run` command.
        let docker_args =
            build_docker_run_args(&container_name, host_port, &lang, req.policy.as_ref())?;
        let output = Command::new("docker")
            .args(&docker_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to run docker: {e}"))?;

        if !output.status.success() {
            // Reclaim port on failure.
            self.used_ports.write().await.remove(&host_port);
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("docker run failed: {stderr}"));
        }

        let container_id = String::from_utf8_lossy(&output.stdout).trim().to_string();

        let now = Utc::now();
        let info = SandboxInfo {
            id: container_id.clone(),
            name: container_name,
            status: "running".to_string(),
            lang,
            port: Some(host_port),
            effective_policy: req.policy,
            created_at: now,
            last_active_at: now,
        };

        self.sandboxes
            .write()
            .await
            .insert(container_id.clone(), info.clone());
        self.last_active
            .write()
            .await
            .insert(container_id, Instant::now());

        Ok(info)
    }

    /// Execute code inside a sandbox and return a streaming reqwest response.
    ///
    /// The response body is an NDJSON stream of `SandboxOutputEvent` objects
    /// as produced by the in-sandbox FastAPI server.
    pub async fn execute_in_sandbox(
        &self,
        id: &str,
        req: ExecuteRequest,
    ) -> Result<reqwest::Response, String> {
        if req.code.trim().is_empty() {
            return Err("Code cannot be empty.".to_string());
        }

        let info = self
            .get_sandbox(id)
            .await
            .ok_or_else(|| format!("Sandbox not found: {id}"))?;

        let port = info
            .port
            .ok_or_else(|| "Sandbox has no exposed port".to_string())?;

        let sandbox_url = format!("http://127.0.0.1:{port}/execute");

        let response = self
            .http_client
            .post(&sandbox_url)
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("Failed to reach sandbox: {e}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Sandbox execution failed with status {}",
                response.status()
            ));
        }

        // Update last_active timestamp.
        self.last_active
            .write()
            .await
            .insert(id.to_string(), Instant::now());
        if let Some(stored) = self.sandboxes.write().await.get_mut(&info.id) {
            stored.last_active_at = Utc::now();
        }

        Ok(response)
    }

    /// Stop and remove a sandbox container.
    pub async fn delete_sandbox(&self, id: &str) -> Result<(), String> {
        let info = self
            .get_sandbox(id)
            .await
            .ok_or_else(|| format!("Sandbox not found: {id}"))?;

        stop_container(&info.id).await?;

        let mut sandboxes = self.sandboxes.write().await;
        sandboxes.remove(&info.id);
        if let Some(port) = info.port {
            self.used_ports.write().await.remove(&port);
        }
        self.last_active.write().await.remove(&info.id);

        Ok(())
    }

    /// Replace an existing sandbox with a newly created sandbox using a mutated policy.
    pub async fn recreate_sandbox(
        &self,
        id: &str,
        req: ResolvedCreateSandboxRequest,
    ) -> Result<SandboxInfo, String> {
        self.get_sandbox(id)
            .await
            .ok_or_else(|| format!("Sandbox not found: {id}"))?;

        let next = self.create_sandbox(req).await?;
        if let Err(err) = self.delete_sandbox(id).await {
            let _ = self.delete_sandbox(&next.id).await;
            return Err(format!("Failed to replace sandbox: {err}"));
        }

        Ok(next)
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Stop and remove a Docker container by ID.
async fn stop_container(container_id: &str) -> Result<(), String> {
    // Stop
    let stop = Command::new("docker")
        .args(["stop", container_id])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
        .map_err(|e| format!("docker stop failed: {e}"))?;

    if !stop.status.success() {
        tracing::warn!(
            "[SandboxManager] docker stop {} failed (container may already be gone)",
            &container_id[..8.min(container_id.len())]
        );
    }

    // Remove (the --rm flag in `docker run` also handles this, but be explicit)
    let _ = Command::new("docker")
        .args(["rm", "-f", container_id])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await;

    Ok(())
}

fn build_docker_run_args(
    container_name: &str,
    host_port: u16,
    lang: &str,
    policy: Option<&ResolvedSandboxPolicy>,
) -> Result<Vec<String>, String> {
    let mut args = vec![
        "run".to_string(),
        "-d".to_string(),
        "--rm".to_string(),
        format!("--name={}", container_name),
        format!("-p={}:{}", host_port, SANDBOX_CONTAINER_PORT),
        format!("--label={}=1", SANDBOX_LABEL),
        format!("--label={}.lang={}", SANDBOX_LABEL, lang),
        "--memory=512m".to_string(),
        "--cpus=1".to_string(),
        "--pids-limit=64".to_string(),
    ];

    if let Some(policy) = policy {
        if let Some(workspace_id) = &policy.workspace_id {
            args.push(format!(
                "--label={SANDBOX_LABEL}.workspace_id={workspace_id}"
            ));
        }
        if let Some(codebase_id) = &policy.codebase_id {
            args.push(format!("--label={SANDBOX_LABEL}.codebase_id={codebase_id}"));
        }
        args.push(format!(
            "--label={}.network_mode={}",
            SANDBOX_LABEL,
            match policy.network_mode {
                SandboxNetworkMode::Bridge => "bridge",
                SandboxNetworkMode::None => "none",
            }
        ));

        for mount in &policy.mounts {
            args.push("-v".to_string());
            args.push(format!(
                "{}:{}:{}",
                mount.host_path,
                mount.container_path,
                mount.access.docker_suffix()
            ));
        }

        args.push("-w".to_string());
        args.push(policy.container_workdir.clone());

        for (key, value) in collect_policy_env(policy)? {
            args.push("-e".to_string());
            args.push(format!("{key}={value}"));
        }

        args.push("--network".to_string());
        args.push(
            match policy.network_mode {
                SandboxNetworkMode::Bridge => "bridge",
                SandboxNetworkMode::None => "none",
            }
            .to_string(),
        );
    } else {
        args.push("--network=bridge".to_string());
    }

    args.push(SANDBOX_IMAGE.to_string());
    Ok(args)
}

fn collect_policy_env(policy: &ResolvedSandboxPolicy) -> Result<Vec<(String, String)>, String> {
    let mut env_pairs = BTreeMap::new();

    for env_file in &policy.env_files {
        for (key, value) in parse_env_file(Path::new(&env_file.path))? {
            env_pairs.insert(key, value);
        }
    }

    let passthrough = match policy.env_mode {
        SandboxEnvMode::Sanitized => policy
            .env_allowlist
            .iter()
            .filter_map(|key| std::env::var(key).ok().map(|value| (key.clone(), value)))
            .collect::<Vec<_>>(),
        SandboxEnvMode::Inherit => std::env::vars().collect::<Vec<_>>(),
    };

    for (key, value) in passthrough {
        env_pairs.insert(key, value);
    }

    Ok(env_pairs.into_iter().collect())
}

/// Parse container port from `docker inspect` JSON output.
#[allow(dead_code)]
async fn get_container_port(container_id: &str, container_port: u16) -> Option<u16> {
    let output = Command::new("docker")
        .args([
            "inspect",
            "--format",
            "{{json .NetworkSettings.Ports}}",
            container_id,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let ports: Value = serde_json::from_str(stdout.trim()).ok()?;
    let key = format!("{container_port}/tcp");
    let mappings = ports.get(&key)?.as_array()?;
    let host_port = mappings.first()?.get("HostPort")?.as_str()?;
    host_port.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{
        ResolvedSandboxEnvFile, ResolvedSandboxPolicy, SandboxEnvFileSource, SandboxEnvMode,
        SandboxMount, SandboxMountAccess, SandboxNetworkMode,
    };

    #[test]
    fn sandbox_manager_creates_default() {
        // SandboxManager::new() spawns a Tokio task internally, so we need a runtime.
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let _mgr = SandboxManager::new();
            // Default state has no sandboxes.
        });
    }

    #[tokio::test]
    async fn list_sandboxes_empty_by_default() {
        let mgr = SandboxManager::new();
        let list = mgr.list_sandboxes().await;
        assert!(list.is_empty());
    }

    #[tokio::test]
    async fn get_sandbox_returns_none_for_unknown_id() {
        let mgr = SandboxManager::new();
        assert!(mgr.get_sandbox("nonexistent-id").await.is_none());
    }

    #[tokio::test]
    async fn create_sandbox_rejects_unsupported_lang() {
        let mgr = SandboxManager::new();
        let err = mgr
            .create_sandbox(ResolvedCreateSandboxRequest {
                lang: "ruby".to_string(),
                policy: None,
            })
            .await
            .unwrap_err();
        assert!(err.contains("Only Python"));
    }

    #[tokio::test]
    async fn execute_rejects_empty_code() {
        let mgr = SandboxManager::new();
        // Inject a fake sandbox so we get past the lookup.
        {
            let now = Utc::now();
            let info = SandboxInfo {
                id: "fake-id".to_string(),
                name: "routa-sandbox-fake".to_string(),
                status: "running".to_string(),
                lang: "python".to_string(),
                port: Some(19999),
                effective_policy: None,
                created_at: now,
                last_active_at: now,
            };
            mgr.sandboxes
                .write()
                .await
                .insert("fake-id".to_string(), info);
        }
        let err = mgr
            .execute_in_sandbox(
                "fake-id",
                ExecuteRequest {
                    code: "   ".to_string(),
                },
            )
            .await
            .unwrap_err();
        assert!(err.contains("empty"));
    }

    #[tokio::test]
    async fn delete_sandbox_returns_err_for_unknown() {
        let mgr = SandboxManager::new();
        assert!(mgr.delete_sandbox("nonexistent").await.is_err());
    }

    #[test]
    fn docker_args_include_policy_mounts_and_workdir() {
        let policy = ResolvedSandboxPolicy {
            workspace_id: Some("ws-1".to_string()),
            codebase_id: Some("cb-1".to_string()),
            scope_root: "/repo".to_string(),
            host_workdir: "/repo/src".to_string(),
            container_workdir: "/workspace/src".to_string(),
            read_only_paths: vec![],
            read_write_paths: vec!["/repo/src".to_string()],
            network_mode: SandboxNetworkMode::None,
            env_mode: SandboxEnvMode::Sanitized,
            env_files: vec![],
            env_allowlist: vec![],
            mounts: vec![
                SandboxMount {
                    host_path: "/repo".to_string(),
                    container_path: "/workspace".to_string(),
                    access: SandboxMountAccess::ReadOnly,
                    reason: Some("scopeRoot".to_string()),
                },
                SandboxMount {
                    host_path: "/repo/src".to_string(),
                    container_path: "/workspace/src".to_string(),
                    access: SandboxMountAccess::ReadWrite,
                    reason: Some("scopeOverride".to_string()),
                },
            ],
            capabilities: vec![],
            linked_worktrees: vec![],
            workspace_config: None,
            notes: vec![],
        };

        let args = build_docker_run_args("sandbox-name", 12345, "python", Some(&policy))
            .expect("docker args should build");
        assert!(args.iter().any(|arg| arg == "--network"));
        assert!(args.iter().any(|arg| arg == "none"));
        assert!(args.iter().any(|arg| arg == "/workspace/src"));
        assert!(args
            .iter()
            .any(|arg| arg == "/repo:/workspace:ro" || arg == "/repo/src:/workspace/src:rw"));
    }

    #[test]
    fn collect_policy_env_layers_env_files_before_host_env() {
        let dir = tempfile::tempdir().expect("tempdir should exist");
        let base_env = dir.path().join(".env.base");
        let request_env = dir.path().join(".env.request");
        std::fs::write(&base_env, "SHARED=base\nBASE_ONLY=1\n").expect("base env should exist");
        std::fs::write(&request_env, "SHARED=request\nREQUEST_ONLY=1\n")
            .expect("request env should exist");
        std::env::set_var("SHARED", "host");
        std::env::set_var("HOST_ONLY", "1");

        let policy = ResolvedSandboxPolicy {
            workspace_id: None,
            codebase_id: None,
            scope_root: dir.path().to_string_lossy().to_string(),
            host_workdir: dir.path().to_string_lossy().to_string(),
            container_workdir: "/workspace".to_string(),
            read_only_paths: vec![],
            read_write_paths: vec![],
            network_mode: SandboxNetworkMode::None,
            env_mode: SandboxEnvMode::Sanitized,
            env_files: vec![
                ResolvedSandboxEnvFile {
                    path: base_env.to_string_lossy().to_string(),
                    source: SandboxEnvFileSource::WorkspaceConfig,
                    keys: vec!["BASE_ONLY".to_string(), "SHARED".to_string()],
                },
                ResolvedSandboxEnvFile {
                    path: request_env.to_string_lossy().to_string(),
                    source: SandboxEnvFileSource::Request,
                    keys: vec!["REQUEST_ONLY".to_string(), "SHARED".to_string()],
                },
            ],
            env_allowlist: vec!["HOST_ONLY".to_string(), "SHARED".to_string()],
            mounts: vec![],
            capabilities: vec![],
            linked_worktrees: vec![],
            workspace_config: None,
            notes: vec![],
        };

        let env_pairs = collect_policy_env(&policy).expect("env layering should succeed");
        let env_map = env_pairs.into_iter().collect::<BTreeMap<_, _>>();
        assert_eq!(env_map.get("BASE_ONLY").map(String::as_str), Some("1"));
        assert_eq!(env_map.get("REQUEST_ONLY").map(String::as_str), Some("1"));
        assert_eq!(env_map.get("HOST_ONLY").map(String::as_str), Some("1"));
        assert_eq!(env_map.get("SHARED").map(String::as_str), Some("host"));

        std::env::remove_var("SHARED");
        std::env::remove_var("HOST_ONLY");
    }
}
