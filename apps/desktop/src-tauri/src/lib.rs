use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Manager, State};
use tokio::sync::RwLock;

// PTY module for interactive terminal support
mod pty;
pub use pty::{pty_create, pty_kill, pty_list, pty_read, pty_resize, pty_write, PtyState};

// System tray module
mod tray;
pub use tray::GitHubRepo;

// Re-export routa_server for external use
pub use routa_server as server;
use routa_server::acp::{
    AcpBinaryManager, AcpInstallationState, AcpPaths, AcpRegistry, DistributionType,
    InstalledAgentInfo,
};
use routa_server::rpc::RpcRouter;
use routa_server::state::AppState;

// ─── Shared RPC State ─────────────────────────────────────────────────────

/// Wrapper around `AppState` that can be lazily initialized.
/// Stored as Tauri managed state so the `rpc_call` command can access
/// the same AppState that the HTTP server uses.
#[derive(Clone)]
pub struct RpcState {
    inner: Arc<RwLock<Option<AppState>>>,
}

impl RpcState {
    fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(None)),
        }
    }

    async fn set(&self, state: AppState) {
        let mut guard = self.inner.write().await;
        *guard = Some(state);
    }

    async fn get(&self) -> Option<AppState> {
        self.inner.read().await.clone()
    }
}

/// JSON-RPC 2.0 call via Tauri IPC — bypasses HTTP entirely.
///
/// The frontend sends a JSON-RPC request object and receives the response
/// directly through the Tauri command channel.
#[tauri::command]
async fn rpc_call(
    state: State<'_, RpcState>,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let app_state = state
        .get()
        .await
        .ok_or_else(|| "Server not initialized yet".to_string())?;

    let router = RpcRouter::new(app_state);
    Ok(router.handle_value(request).await)
}

// ─── Custom Tauri Commands ────────────────────────────────────────────────

/// Custom Tauri commands exposed to the frontend via `invoke`.
/// These bridge the gap between the web frontend and native capabilities.
/// Read an environment variable from the host system.
#[tauri::command]
fn get_env(key: String) -> Option<String> {
    std::env::var(&key).ok()
}

/// Get the current working directory.
#[tauri::command]
fn get_cwd() -> String {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Get the user's home directory.
#[tauri::command]
fn get_home_dir() -> Option<String> {
    dirs::home_dir().map(|p| p.to_string_lossy().to_string())
}

/// Check if a given path is a git repository.
#[tauri::command]
fn is_git_repo(path: String) -> bool {
    let git_dir = std::path::Path::new(&path).join(".git");
    git_dir.exists()
}

/// Log a frontend diagnostic message on the Rust side.
#[tauri::command]
fn log_frontend(level: String, scope: String, message: String) {
    println!("[frontend:{level}][{scope}] {message}");
}

/// Update the system tray menu with the current list of GitHub repos.
///
/// Called by the frontend after it loads (or saves) webhook configurations so
/// that the tray immediately reflects the configured repositories.
#[tauri::command]
fn update_tray_github_repos(app: tauri::AppHandle, repos: Vec<GitHubRepo>) -> Result<(), String> {
    tray::update_tray_repos(&app, &repos).map_err(|e| e.to_string())
}

/// Open an external URL in the user's default browser.
#[tauri::command]
fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("Failed to open URL {url}: {e}"))
}

// ─── ACP Agent Installation State ─────────────────────────────────────────

/// Shared state for ACP agent installation.
pub struct AcpState {
    #[allow(dead_code)]
    paths: AcpPaths,
    installation_state: AcpInstallationState,
    binary_manager: AcpBinaryManager,
    registry_cache: Arc<RwLock<Option<AcpRegistry>>>,
}

impl AcpState {
    fn new() -> Self {
        let paths = AcpPaths::new();
        let installation_state = AcpInstallationState::new(paths.clone());
        let binary_manager = AcpBinaryManager::new(paths.clone());
        Self {
            paths,
            installation_state,
            binary_manager,
            registry_cache: Arc::new(RwLock::new(None)),
        }
    }
}

const ACP_REGISTRY_URL: &str =
    "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

/// Fetch the ACP registry from the CDN.
#[tauri::command]
async fn fetch_acp_registry(state: State<'_, AcpState>) -> Result<AcpRegistry, String> {
    // Check cache first
    {
        let cache = state.registry_cache.read().await;
        if let Some(ref registry) = *cache {
            return Ok(registry.clone());
        }
    }

    // Fetch from CDN
    let response = reqwest::get(ACP_REGISTRY_URL)
        .await
        .map_err(|e| format!("Failed to fetch registry: {e}"))?;

    let registry: AcpRegistry = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse registry: {e}"))?;

    // Update cache
    {
        let mut cache = state.registry_cache.write().await;
        *cache = Some(registry.clone());
    }

    Ok(registry)
}

/// Get list of installed agents.
#[tauri::command]
async fn get_installed_agents(
    state: State<'_, AcpState>,
) -> Result<Vec<InstalledAgentInfo>, String> {
    // Load state from disk if not already loaded
    state.installation_state.load().await?;
    Ok(state.installation_state.get_all_installed().await)
}

/// Install an ACP agent locally.
#[tauri::command]
async fn install_acp_agent(
    state: State<'_, AcpState>,
    agent_id: String,
) -> Result<InstalledAgentInfo, String> {
    // Fetch registry to get agent info
    let registry = {
        let cache = state.registry_cache.read().await;
        cache.clone()
    };

    let registry = match registry {
        Some(r) => r,
        None => {
            // Fetch if not cached
            let response = reqwest::get(ACP_REGISTRY_URL)
                .await
                .map_err(|e| format!("Failed to fetch registry: {e}"))?;
            response
                .json::<AcpRegistry>()
                .await
                .map_err(|e| format!("Failed to parse registry: {e}"))?
        }
    };

    let agent = registry
        .agents
        .iter()
        .find(|a| a.id == agent_id)
        .ok_or_else(|| format!("Agent '{agent_id}' not found in registry"))?;

    // Version is now on the agent entry itself
    let version = if agent.version.is_empty() {
        "latest".to_string()
    } else {
        agent.version.clone()
    };

    // Get distribution type using the helper method
    let dist_type = agent
        .dist_type()
        .ok_or_else(|| "Agent has no distribution type".to_string())?;

    match dist_type {
        DistributionType::Npx => {
            // For npx, we just mark it as installed (npx will download on first run)
            let package = agent.get_package();
            state
                .installation_state
                .mark_installed(&agent_id, &version, DistributionType::Npx, None, package)
                .await?;
        }
        DistributionType::Uvx => {
            // For uvx, we just mark it as installed (uvx will download on first run)
            let package = agent.get_package();
            state
                .installation_state
                .mark_installed(&agent_id, &version, DistributionType::Uvx, None, package)
                .await?;
        }
        DistributionType::Binary => {
            // For binary, we need to download and extract
            let platform = AcpPaths::current_platform();
            let binary_info = agent
                .get_binary_info(&platform)
                .ok_or_else(|| format!("No binary available for platform: {platform}"))?;

            let exe_path = state
                .binary_manager
                .install_binary(&agent_id, &version, binary_info)
                .await?;

            state
                .installation_state
                .mark_installed(
                    &agent_id,
                    &version,
                    DistributionType::Binary,
                    Some(exe_path.to_string_lossy().to_string()),
                    None,
                )
                .await?;
        }
    }

    state
        .installation_state
        .get_installed_info(&agent_id)
        .await
        .ok_or_else(|| "Failed to get installed agent info".to_string())
}

/// Uninstall an ACP agent.
#[tauri::command]
async fn uninstall_acp_agent(state: State<'_, AcpState>, agent_id: String) -> Result<(), String> {
    // Get installed info to check if it's a binary
    if let Some(info) = state.installation_state.get_installed_info(&agent_id).await {
        if info.dist_type == DistributionType::Binary {
            // Remove binary files
            state.binary_manager.uninstall(&agent_id).await?;
        }
    }

    // Remove from installation state
    state.installation_state.uninstall(&agent_id).await
}

/// Check if an agent has an update available.
#[tauri::command]
async fn check_agent_update(state: State<'_, AcpState>, agent_id: String) -> Result<bool, String> {
    let registry = {
        let cache = state.registry_cache.read().await;
        cache.clone()
    };

    let registry = match registry {
        Some(r) => r,
        None => return Ok(false),
    };

    let agent = match registry.agents.iter().find(|a| a.id == agent_id) {
        Some(a) => a,
        None => return Ok(false),
    };

    // Version is now on the agent entry itself
    let latest_version = if agent.version.is_empty() {
        "latest"
    } else {
        &agent.version
    };

    Ok(state
        .installation_state
        .has_update(&agent_id, latest_version)
        .await)
}

fn detect_repo_root() -> Option<PathBuf> {
    if let Ok(v) = std::env::var("ROUTA_REPO_ROOT") {
        let p = PathBuf::from(v);
        if p.join("package.json").exists() {
            return Some(p);
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidate = manifest_dir;
    for _ in 0..12 {
        if candidate.join("package.json").exists() {
            return Some(candidate);
        }

        if !candidate.pop() {
            break;
        }
    }

    None
}

fn wait_for_port(host: &str, port: u16, timeout_secs: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    while Instant::now() < deadline {
        if TcpStream::connect((host, port)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

fn pipe_child_logs(prefix: &'static str, child: &mut Child) {
    if let Some(stdout) = child.stdout.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                println!("[{prefix}][stdout] {line}");
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                eprintln!("[{prefix}][stderr] {line}");
            }
        });
    }
}

fn env_or_default(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn api_port() -> u16 {
    std::env::var("ROUTA_DESKTOP_API_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(3210)
}

pub(crate) const DEFAULT_WORKSPACE_ID: &str = "default";
pub(crate) const DESKTOP_LAST_WORKSPACE_ID_STORAGE_KEY: &str = "routa.desktop.last-workspace-id";

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub(crate) fn desktop_workspace_navigation_js(_port: u16, route_suffix: &str) -> String {
    format!(
        r#"
            (function() {{
                const match = window.location.pathname.match(/\/workspace\/([^\/]+)/);
                const query = (() => {{
                    try {{
                        const params = new URLSearchParams(window.location.search);
                        const raw = params.get('workspaceId') || params.get('workspace') || '';
                        return /^[A-Za-z0-9_-]+$/.test(raw) ? raw : '';
                    }} catch {{
                        return '';
                    }}
                }})();
                const persisted = (() => {{
                    try {{
                        const value = (window.localStorage.getItem('{DESKTOP_LAST_WORKSPACE_ID_STORAGE_KEY}') || '').trim();
                        return /^[A-Za-z0-9_-]+$/.test(value) ? value : '';
                    }} catch {{
                        return '';
                    }}
                }})();
                const workspaceId = match ? match[1] : (query || persisted || '{DEFAULT_WORKSPACE_ID}');
                window.location.href = `${{window.location.origin}}/workspace/${{workspaceId}}{route_suffix}`;
            }})();
        "#,
    )
}

#[cfg(target_os = "macos")]
fn configure_macos_menu_bar_mode(app: &tauri::AppHandle) {
    if std::env::var("ROUTA_DESKTOP_MENU_BAR_MODE").as_deref() != Ok("1") {
        return;
    }
    if let Err(error) = app.set_activation_policy(tauri::ActivationPolicy::Accessory) {
        eprintln!("[macos] Failed to set activation policy to Accessory: {error}");
    }
    if let Err(error) = app.set_dock_visibility(false) {
        eprintln!("[macos] Failed to hide Dock icon: {error}");
    }
}

#[cfg(not(target_os = "macos"))]
fn configure_macos_menu_bar_mode(_app: &tauri::AppHandle) {}

fn resolve_dual_origin_navigation_js(api_url: &str) -> String {
    format!(
        r#"
            (function() {{
                try {{
                    const params = new URLSearchParams(window.location.search);
                    const hasBackendHint = !!(
                        params.get("backend") ||
                        localStorage.getItem("routa.backendBaseUrl")
                    );

                    if (params.get("runtime") === "tauri" && hasBackendHint) {{
                        return;
                    }}
                }} catch {{
                    // If URL/search API is unavailable, fall back to existing navigation.
                }}

                window.location.replace("{api_url}");
            }})();
        "#
    )
}

fn render_startup_error_html(api_url: &str, db_path: &str, error: &str) -> String {
    let escaped_api_url = escape_html(api_url);
    let escaped_db_path = escape_html(db_path);
    let escaped_error = escape_html(error);

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Routa Desktop Startup Error</title>
    <style>
      :root {{
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }}
      body {{
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #0f172a;
        color: #e2e8f0;
        padding: 24px;
      }}
      .panel {{
        width: min(760px, 100%);
        background: rgba(15, 23, 42, 0.94);
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 18px;
        padding: 28px;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.45);
      }}
      h1 {{
        margin: 0 0 12px;
        font-size: 28px;
        line-height: 1.2;
      }}
      p {{
        margin: 0 0 16px;
        color: #cbd5e1;
        line-height: 1.6;
      }}
      dl {{
        margin: 20px 0 0;
        display: grid;
        gap: 14px;
      }}
      dt {{
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #94a3b8;
        margin-bottom: 6px;
      }}
      dd {{
        margin: 0;
      }}
      code {{
        display: block;
        white-space: pre-wrap;
        word-break: break-word;
        border-radius: 12px;
        padding: 12px 14px;
        background: rgba(15, 23, 42, 0.72);
        color: #f8fafc;
        border: 1px solid rgba(148, 163, 184, 0.18);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
        line-height: 1.5;
      }}
      button {{
        margin-top: 22px;
        border: 0;
        border-radius: 10px;
        padding: 10px 14px;
        background: #2563eb;
        color: white;
        font-weight: 600;
        cursor: pointer;
      }}
    </style>
  </head>
  <body>
    <main class="panel">
      <h1>Routa Desktop could not start its backend</h1>
      <p>
        The desktop window was not connected to a fresh Rust backend. This usually means another
        process is already using the desktop port, or startup failed before the app could safely
        switch to the local HTTP server.
      </p>
      <dl>
        <div>
          <dt>API URL</dt>
          <dd><code>{escaped_api_url}</code></dd>
        </div>
        <div>
          <dt>Database Path</dt>
          <dd><code>{escaped_db_path}</code></dd>
        </div>
        <div>
          <dt>Error</dt>
          <dd><code>{escaped_error}</code></dd>
        </div>
      </dl>
      <button type="button" onclick="window.location.reload()">Reload</button>
    </main>
  </body>
</html>"#
    )
}

fn show_startup_error(window: &tauri::WebviewWindow, api_url: &str, db_path: &str, error: &str) {
    let html = render_startup_error_html(api_url, db_path, error);
    let serialized_html = serde_json::to_string(&html)
        .unwrap_or_else(|_| "\"<h1>Routa Desktop startup failed</h1>\"".to_string());
    let js = format!("document.open(); document.write({serialized_html}); document.close();");
    let _ = window.eval(js);
}

fn start_local_next_server(host: &str, port: u16) -> Result<Child, String> {
    let repo_root = detect_repo_root().ok_or_else(|| {
        "Unable to detect repository root for desktop local API server".to_string()
    })?;

    println!(
        "[desktop-server] Starting local Next API server from {}",
        repo_root.to_string_lossy()
    );

    let mut child = Command::new("npm")
        .arg("run")
        .arg("start:desktop:server")
        .current_dir(repo_root)
        .env("HOSTNAME", host)
        .env("PORT", port.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn desktop API server: {e}"))?;

    pipe_child_logs("desktop-server", &mut child);
    Ok(child)
}

fn start_embedded_next_server(
    app: &tauri::AppHandle,
    host: &str,
    port: u16,
) -> Result<Child, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve Tauri resource dir: {e}"))?;
    let server_root = resource_dir.join("bundled").join("desktop-server");
    let server_js = server_root.join("server.js");
    if !server_js.exists() {
        return Err(format!(
            "Embedded desktop server not found at {}",
            server_js.to_string_lossy()
        ));
    }

    let db_path = std::env::var("ROUTA_DB_PATH").unwrap_or_else(|_| {
        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| dirs::home_dir().unwrap_or_default().join(".routa"));
        std::fs::create_dir_all(&data_dir).ok();
        data_dir.join("routa.db").to_string_lossy().to_string()
    });

    let node_bin = env_or_default("ROUTA_NODE_BIN", "node");
    println!(
        "[desktop-server] Starting embedded server: {} {}",
        node_bin,
        server_js.to_string_lossy()
    );
    println!("[desktop-server] Database path: {db_path}");

    let mut child = Command::new(node_bin)
        .arg("server.js")
        .current_dir(&server_root)
        .env("HOSTNAME", host)
        .env("PORT", port.to_string())
        .env("ROUTA_DESKTOP_SERVER_BUILD", "1")
        .env("ROUTA_DB_DRIVER", "sqlite")
        .env("ROUTA_DB_PATH", &db_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to spawn embedded desktop API server. Install Node.js or set ROUTA_NODE_BIN. {e}"
            )
        })?;

    pipe_child_logs("desktop-server", &mut child);
    Ok(child)
}

/// Resolve the SQLite database path for the desktop app.
fn resolve_db_path(app: &tauri::AppHandle) -> String {
    std::env::var("ROUTA_DB_PATH").unwrap_or_else(|_| {
        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| dirs::home_dir().unwrap_or_default().join(".routa"));
        std::fs::create_dir_all(&data_dir).ok();
        data_dir.join("routa.db").to_string_lossy().to_string()
    })
}

/// Resolve the static frontend directory for the Rust server.
/// In production, looks for the `frontend` resource bundled by Tauri.
/// In development, uses the `out/` directory from the repo root.
fn resolve_static_dir(app: &tauri::AppHandle) -> Option<String> {
    // 1. Check for Tauri bundled resource
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_frontend = resource_dir.join("frontend");
        if bundled_frontend.exists() && bundled_frontend.is_dir() {
            println!(
                "[rust-server] Using bundled frontend: {}",
                bundled_frontend.to_string_lossy()
            );
            return Some(bundled_frontend.to_string_lossy().to_string());
        }
    }

    // 2. Fall back to repo `out/` directory (development)
    if let Some(repo_root) = detect_repo_root() {
        let out_dir = repo_root.join("out");
        if out_dir.exists() && out_dir.is_dir() {
            println!(
                "[rust-server] Using dev frontend: {}",
                out_dir.to_string_lossy()
            );
            return Some(out_dir.to_string_lossy().to_string());
        }
    }

    // 3. Check CARGO_MANIFEST_DIR/frontend (used in production builds)
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let frontend_dir = manifest_dir.join("frontend");
    if frontend_dir.exists() && frontend_dir.is_dir() {
        let canonical = frontend_dir.canonicalize().unwrap_or(frontend_dir);
        println!(
            "[rust-server] Using local frontend/: {}",
            canonical.to_string_lossy()
        );
        return Some(canonical.to_string_lossy().to_string());
    }

    // 4. Check repo root `out/` directory (for cargo test / dev builds)
    if let Some(repo_root) = detect_repo_root() {
        let out_dir = repo_root.join("out");
        if out_dir.exists() && out_dir.is_dir() {
            let canonical = out_dir.canonicalize().unwrap_or(out_dir);
            println!(
                "[rust-server] Using repo root out/ frontend: {}",
                canonical.to_string_lossy()
            );
            return Some(canonical.to_string_lossy().to_string());
        }
    }

    // 5. Check old manifest relative `out` path as a fallback for unusual layouts.
    let legacy_out = manifest_dir.join("..").join("..").join("out");
    if legacy_out.exists() && legacy_out.is_dir() {
        let canonical = legacy_out.canonicalize().unwrap_or(legacy_out);
        println!(
            "[rust-server] Using legacy out/ frontend: {}",
            canonical.to_string_lossy()
        );
        return Some(canonical.to_string_lossy().to_string());
    }

    println!("[rust-server] No static frontend directory found");
    None
}

/// Start the embedded Rust backend server (replaces Node.js).
///
/// Creates a shared `AppState` that is used by both the HTTP server and
/// the `rpc_call` Tauri command, enabling direct JSON-RPC calls without HTTP.
fn start_rust_server(
    app: &tauri::AppHandle,
    host: &str,
    port: u16,
) -> Result<std::net::SocketAddr, String> {
    let db_path = resolve_db_path(app);
    let static_dir = resolve_static_dir(app);
    if let Ok(resource_dir) = app.path().resource_dir() {
        std::env::set_var(
            "ROUTA_SPECIALISTS_RESOURCE_DIR",
            resource_dir.to_string_lossy().to_string(),
        );
    }
    let host = host.to_string();

    println!("[rust-server] Starting embedded Rust backend server");
    println!("[rust-server] Database path: {db_path}");
    println!(
        "[rust-server] Static dir: {}",
        static_dir.as_deref().unwrap_or("(none)")
    );
    println!("[rust-server] Listening on {host}:{port}");

    let rpc_state: RpcState = app.state::<RpcState>().inner().clone();

    let config = server::ServerConfig {
        host,
        port,
        db_path,
        static_dir,
    };

    // Block startup until the backend is definitely ready so we don't
    // redirect the webview to a stale process that merely happens to own 3210.
    let app_state = tauri::async_runtime::block_on(server::create_app_state(&config.db_path))
        .map_err(|e| format!("Failed to create app state: {e}"))?;

    tauri::async_runtime::block_on(rpc_state.set(app_state.clone()));
    println!("[rust-server] AppState shared with JSON-RPC handler");

    let addr = tauri::async_runtime::block_on(server::start_server_with_state(config, app_state))
        .map_err(|e| format!("Failed to start server: {e}"))?;
    println!("[rust-server] Server started on {addr}");

    Ok(addr)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AcpState::new())
        .manage(RpcState::new())
        .manage(PtyState::new())
        .invoke_handler(tauri::generate_handler![
            get_env,
            get_cwd,
            get_home_dir,
            is_git_repo,
            log_frontend,
            open_external_url,
            rpc_call,
            fetch_acp_registry,
            get_installed_agents,
            install_acp_agent,
            uninstall_acp_agent,
            check_agent_update,
            // PTY commands for interactive terminal support
            pty_create,
            pty_write,
            pty_read,
            pty_resize,
            pty_kill,
            pty_list,
            // Tray command so the frontend can push webhook configs
            update_tray_github_repos,
        ])
        .setup(|app| {
            // ─── Build Application Menu ─────────────────────────────────────
            let app_handle = app.handle();

            // Create menu items
            let install_agents = MenuItem::with_id(
                app_handle,
                "install_agents",
                "Install Agents...",
                true,
                Some("CmdOrCtrl+Shift+I"),
            )?;

            let mcp_tools = MenuItem::with_id(
                app_handle,
                "mcp_tools",
                "MCP Tools",
                true,
                Some("CmdOrCtrl+Shift+M"),
            )?;

            let reload = MenuItem::with_id(
                app_handle,
                "reload",
                "Reload",
                true,
                Some("CmdOrCtrl+R"),
            )?;

            let quit = MenuItem::with_id(
                app_handle,
                "quit",
                "Quit",
                true,
                Some("CmdOrCtrl+Q"),
            )?;

            // View menu items
            let toggle_devtools = MenuItem::with_id(
                app_handle,
                "toggle_devtools",
                "Toggle Developer Tools",
                true,
                Some("CmdOrCtrl+Option+I"),
            )?;

            let toggle_tool_mode = MenuItem::with_id(
                app_handle,
                "toggle_tool_mode",
                "Toggle Tool Mode (Essential/Full)",
                true,
                Some("CmdOrCtrl+Shift+T"),
            )?;

            // Navigation menu items
            let nav_dashboard = MenuItem::with_id(
                app_handle,
                "nav_dashboard",
                "Dashboard",
                true,
                Some("CmdOrCtrl+1"),
            )?;

            let nav_kanban = MenuItem::with_id(
                app_handle,
                "nav_kanban",
                "Kanban Board",
                true,
                Some("CmdOrCtrl+2"),
            )?;

            let nav_traces = MenuItem::with_id(
                app_handle,
                "nav_traces",
                "Agent Traces",
                true,
                Some("CmdOrCtrl+3"),
            )?;

            let nav_settings = MenuItem::with_id(
                app_handle,
                "nav_settings",
                "Settings",
                true,
                Some("CmdOrCtrl+,"),
            )?;

            // Build Tools submenu
            let tools_submenu = Submenu::with_items(
                app_handle,
                "Tools",
                true,
                &[&install_agents, &mcp_tools],
            )?;

            // Build File submenu
            let file_submenu = Submenu::with_items(
                app_handle,
                "File",
                true,
                &[&reload, &quit],
            )?;

            // Build View submenu
            let view_submenu = Submenu::with_items(
                app_handle,
                "View",
                true,
                &[&toggle_devtools, &toggle_tool_mode],
            )?;

            // Build Navigate submenu
            let navigate_submenu = Submenu::with_items(
                app_handle,
                "Navigate",
                true,
                &[&nav_dashboard, &nav_kanban, &nav_traces, &nav_settings],
            )?;

            // Build main menu
            let menu = Menu::with_items(app_handle, &[&file_submenu, &view_submenu, &navigate_submenu, &tools_submenu])?;

            // Set the menu on the main window
            if let Some(window) = app.get_webview_window("main") {
                window.set_menu(menu)?;
            }

            // ─── Handle Menu Events ─────────────────────────────────────────
            app.on_menu_event(move |app_handle, event| {
                match event.id().as_ref() {
                    "install_agents" => {
                        // Navigate to the agent installation page
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let js = "window.location.href = `${window.location.origin}/settings/agents`;";
                            let _ = window.eval(js);
                            println!("[menu] Navigating to Install Agents");
                        }
                    }
                    "mcp_tools" => {
                        // Navigate to MCP tools page
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let js = "window.location.href = `${window.location.origin}/mcp-tools`;";
                            let _ = window.eval(js);
                            println!("[menu] Navigating to MCP Tools");
                        }
                    }
                    "reload" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.eval("window.location.reload();");
                        }
                    }
                    "quit" => {
                        std::process::exit(0);
                    }
                    "toggle_devtools" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            if window.is_devtools_open() {
                                window.close_devtools();
                            } else {
                                window.open_devtools();
                            }
                        }
                    }
                    "toggle_tool_mode" => {
                        // Toggle between essential and full tool mode
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let js = r#"
                                (async () => {
                                    const resolveApiBase = () => {
                                        try {
                                            const params = new URLSearchParams(window.location.search);
                                            const backend = (params.get("backend") || localStorage.getItem("routa.backendBaseUrl") || "").trim();
                                            if (backend) return backend;
                                            if (window.location.protocol === "tauri:") return "http://127.0.0.1:3210";
                                        } catch {}
                                        return "";
                                    };

                                    const apiBase = resolveApiBase();
                                    const apiPath = (path) => `${apiBase || ""}${path}`;

                                    try {
                                        // Get current mode
                                        const res = await fetch(apiPath('/api/mcp/tools'));
                                        const data = await res.json();
                                        const currentMode = data?.globalMode || 'essential';
                                        const newMode = currentMode === 'essential' ? 'full' : 'essential';

                                        // Update mode
                                        await fetch(apiPath('/api/mcp/tools'), {
                                            method: 'PATCH',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ mode: newMode })
                                        });

                                        console.log(`[menu] Tool mode toggled to: ${newMode}`);

                                        // Reload page to reflect changes
                                        window.location.reload();
                                    } catch (err) {
                                        console.error('[menu] Failed to toggle tool mode:', err);
                                    }
                                })();
                            "#;
                            let _ = window.eval(js);
                            println!("[menu] Toggling tool mode");
                        }
                    }
                    "nav_dashboard" => {
                        // Navigate to workspace dashboard
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let port = api_port();
                            let js = desktop_workspace_navigation_js(port, "");
                            let _ = window.eval(js);
                            println!("[menu] Navigating to Dashboard");
                        }
                    }
                    "nav_kanban" => {
                        // Navigate to Kanban board
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let port = api_port();
                            let js = desktop_workspace_navigation_js(port, "/kanban");
                            let _ = window.eval(js);
                            println!("[menu] Navigating to Kanban");
                        }
                    }
                    "nav_traces" => {
                        // Navigate to Agent Traces
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let js = "window.location.href = `${window.location.origin}/traces`;";
                            let _ = window.eval(js);
                            println!("[menu] Navigating to Traces");
                        }
                    }
                    "nav_settings" => {
                        // Navigate to Settings
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let js = "window.location.href = `${window.location.origin}/settings`;";
                            let _ = window.eval(js);
                            println!("[menu] Navigating to Settings");
                        }
                    }
                    _ => {}
                }
            });
            // ─── System Tray ────────────────────────────────────────────────
            // Initialise with an empty repo list; the frontend calls
            // `update_tray_github_repos` after loading webhook configs.
            if let Err(e) = tray::setup_tray(app.handle(), &[]) {
                eprintln!("[tray] Failed to set up system tray: {e}");
            } else {
                configure_macos_menu_bar_mode(app.handle());
            }

            // Only auto-open devtools in debug builds; use View menu in release builds
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

            // Configurable API mode:
            // - rust (default): start embedded Rust server (no Node.js needed).
            // - embedded: start packaged standalone Next server (legacy Node.js mode).
            // - external: connect to existing server at ROUTA_DESKTOP_API_URL.
            // - off: use embedded static UI only.
            let api_mode = env_or_default("ROUTA_DESKTOP_API_MODE", "rust");
            let api_host = env_or_default("ROUTA_DESKTOP_API_HOST", "127.0.0.1");
            let port = api_port();
            let api_url = std::env::var("ROUTA_DESKTOP_API_URL")
                .unwrap_or_else(|_| format!("http://{api_host}:{port}"));

            match api_mode.as_str() {
                "off" => {
                    println!("[desktop-server] API mode is off, using embedded static UI only");
                }
                "rust" => {
                    // Start embedded Rust server that serves both API and static frontend.
                    // The Rust server handles SPA routing by returning the correct HTML
                    // for dynamic routes like /workspace/[id]/sessions/[sessionId].
                    //
                    // We navigate the WebView to the HTTP server URL because:
                    // 1. Tauri's built-in protocol doesn't support SPA fallback for dynamic routes
                    // 2. The Rust server can serve the correct placeholder HTML for each route
                    // 3. The `remote` capability allows IPC access from http://127.0.0.1:*
                    match start_rust_server(app.handle(), &api_host, port) {
                        Ok(_) => {
                            if let Some(window) = app.get_webview_window("main") {
                                let js = resolve_dual_origin_navigation_js(&api_url);
                                let _ = window.eval(js);
                                println!("[rust-server] Webview navigated to {api_url}");
                            }
                        }
                        Err(e) => {
                            eprintln!("[rust-server] {e}");
                            if let Some(window) = app.get_webview_window("main") {
                                let db_path = resolve_db_path(app.handle());
                                show_startup_error(&window, &api_url, &db_path, &e);
                            }
                        }
                    }
                }
                "embedded" => {
                    // Legacy: start Node.js server
                    let mut ready = wait_for_port(&api_host, port, 1);
                    if !ready {
                        match start_embedded_next_server(app.handle(), &api_host, port) {
                            Ok(_child) => {}
                            Err(err) => {
                                eprintln!("[desktop-server] {err}");
                                match start_local_next_server(&api_host, port) {
                                    Ok(_child) => {}
                                    Err(dev_err) => {
                                        eprintln!("[desktop-server] {dev_err}");
                                    }
                                }
                            }
                        }
                        ready = wait_for_port(&api_host, port, 25);
                    } else {
                        println!(
                            "[desktop-server] Reusing existing local server on {api_url}"
                        );
                    }

                    if ready {
                        if let Some(window) = app.get_webview_window("main") {
                            let js = resolve_dual_origin_navigation_js(&api_url);
                            let _ = window.eval(js);
                            println!("[desktop-server] Webview navigated to {api_url}");
                        }
                    } else {
                        eprintln!(
                            "[desktop-server] Timed out waiting for {api_url}. Falling back to embedded static UI."
                        );
                    }
                }
                "external" => {
                    if wait_for_port(&api_host, port, 5) {
                        if let Some(window) = app.get_webview_window("main") {
                            let js = resolve_dual_origin_navigation_js(&api_url);
                            let _ = window.eval(js);
                            println!(
                                "[desktop-server] Webview navigated to external {api_url}"
                            );
                        }
                    } else {
                        eprintln!(
                            "[desktop-server] External server not reachable at {api_url}"
                        );
                    }
                }
                _ => {
                    eprintln!(
                        "[desktop-server] Unknown API mode '{api_mode}', falling back to static UI"
                    );
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
