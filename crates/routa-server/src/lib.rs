//! Routa Server — HTTP adapter for the Routa.js platform.
//!
//! This crate provides the HTTP/REST layer (via axum) on top of `routa-core`.
//! It re-exports all core modules so downstream consumers that only need the
//! server can depend on this single crate.
//!
//! # Architecture
//!
//! ```text
//! routa-core    (domain: models, stores, state, protocols, RPC)
//!      ↑
//! routa-server  (adapter: HTTP/axum, this crate)
//! ```

// ── Re-export everything from routa-core ────────────────────────────────
// This allows API handlers and external consumers to use `crate::models::*`,
// `crate::error::ServerError`, etc. without knowing about the crate split.

pub use routa_core::acp;
pub use routa_core::db;
pub use routa_core::error;
pub use routa_core::events;
pub use routa_core::git;
pub use routa_core::mcp;
pub use routa_core::models;
pub use routa_core::orchestration;
pub use routa_core::rpc;
pub use routa_core::sandbox;
pub use routa_core::shell_env;
pub use routa_core::skills;
pub use routa_core::state;
pub use routa_core::store;
pub use routa_core::tools;

// Also re-export commonly used types at the top level
pub use routa_core::{AppState, AppStateInner, Database, ServerError};

// ── HTTP-specific modules ───────────────────────────────────────────────

pub mod api;
mod application;

// ── Server bootstrap ────────────────────────────────────────────────────

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

/// Configuration for the Routa backend server.
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub db_path: String,
    /// Optional path to static frontend files (Next.js export).
    /// When set, the server serves these files for all non-API routes.
    pub static_dir: Option<String>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 3210,
            db_path: "routa.db".to_string(),
            static_dir: None,
        }
    }
}

/// Create a shared `AppState` from a database path.
///
/// This is useful when you need to share the state between the HTTP server
/// and other consumers (e.g. Tauri IPC commands, JSON-RPC router).
pub async fn create_app_state(db_path: &str) -> Result<state::AppState, String> {
    let db = db::Database::open(db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    let state: state::AppState = Arc::new(state::AppStateInner::new(db));

    // Ensure default workspace exists
    state
        .workspace_store
        .ensure_default()
        .await
        .map_err(|e| format!("Failed to initialize default workspace: {}", e))?;

    // Discover skills
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());
    state.skill_registry.reload(&cwd);

    // Start polling if enabled via environment variables
    api::polling::start_polling_if_enabled();

    Ok(state)
}

fn resolve_static_target(path: &str) -> (String, &'static str) {
    let is_rsc_request = path.ends_with(".txt");

    if path.starts_with("/workspace/") {
        let clean_path = path.trim_end_matches(".txt");
        let segments: Vec<&str> = clean_path
            .trim_start_matches("/workspace/")
            .split('/')
            .filter(|s| !s.is_empty())
            .collect();

        let ext = if is_rsc_request { "txt" } else { "html" };
        let content = if is_rsc_request {
            "text/x-component; charset=utf-8"
        } else {
            "text/html; charset=utf-8"
        };
        let placeholder_with_suffix = |base: &str, suffix: &[&str]| {
            if suffix.is_empty() {
                format!("{}.{}", base, ext)
            } else {
                format!("{}/{}.{}", base, suffix.join("/"), ext)
            }
        };
        let is_next_metadata_segment = |segment: &str| segment.starts_with("__next.");

        if segments.len() >= 3 && segments[1] == "sessions" {
            let suffix = if segments.len() > 3 {
                &segments[3..]
            } else {
                &[][..]
            };
            (
                placeholder_with_suffix(
                    "workspace/__placeholder__/sessions/__placeholder__",
                    suffix,
                ),
                content,
            )
        } else if segments.len() >= 3
            && segments[1] == "team"
            && !is_next_metadata_segment(segments[2])
        {
            let suffix = if segments.len() > 3 {
                &segments[3..]
            } else {
                &[][..]
            };
            (
                placeholder_with_suffix("workspace/__placeholder__/team/__placeholder__", suffix),
                content,
            )
        } else if segments.len() >= 2 && segments[1] == "kanban" {
            let suffix = if segments.len() > 2 {
                &segments[2..]
            } else {
                &[][..]
            };
            (
                placeholder_with_suffix("workspace/__placeholder__/kanban", suffix),
                content,
            )
        } else if segments.len() >= 2 && segments[1] == "team" {
            let suffix = if segments.len() > 2 {
                &segments[2..]
            } else {
                &[][..]
            };
            (
                placeholder_with_suffix("workspace/__placeholder__/team", suffix),
                content,
            )
        } else if segments.len() >= 4 && segments[1] == "codebases" && segments[3] == "reposlide" {
            let suffix = if segments.len() > 4 {
                &segments[4..]
            } else {
                &[][..]
            };
            (
                placeholder_with_suffix(
                    "workspace/__placeholder__/codebases/__placeholder__/reposlide",
                    suffix,
                ),
                content,
            )
        } else if !segments.is_empty() {
            let suffix = if segments.len() > 1 {
                &segments[1..]
            } else {
                &[][..]
            };
            (
                placeholder_with_suffix("workspace/__placeholder__", suffix),
                content,
            )
        } else {
            ("index.html".to_string(), "text/html; charset=utf-8")
        }
    } else {
        let clean_path = path.trim_start_matches('/').trim_end_matches('/');
        if is_rsc_request {
            (
                if clean_path.is_empty() {
                    "index.txt".to_string()
                } else {
                    format!("{}.txt", clean_path)
                },
                "text/x-component; charset=utf-8",
            )
        } else if clean_path.is_empty() {
            ("index.html".to_string(), "text/html; charset=utf-8")
        } else {
            (format!("{}.html", clean_path), "text/html; charset=utf-8")
        }
    }
}

/// Start the embedded Rust backend server.
///
/// Returns the actual address the server is listening on.
pub async fn start_server(config: ServerConfig) -> Result<SocketAddr, String> {
    // Initialize tracing (ignore if already initialized)
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "routa_core=info,routa_server=info,tower_http=info".into()),
        )
        .try_init();

    // Resolve and set the full shell PATH early so all child processes
    // (agent CLIs, git, etc.) can be found even when launched from Finder.
    let full_path = shell_env::full_path();
    std::env::set_var("PATH", full_path);

    tracing::info!(
        "Starting Routa backend server on {}:{}",
        config.host,
        config.port
    );

    std::env::set_var(
        "ROUTA_SERVER_URL",
        format!("http://{}:{}", config.host, config.port),
    );

    let state = create_app_state(&config.db_path).await?;

    start_server_with_state(config, state).await
}

/// Start the HTTP server with a pre-built `AppState`.
///
/// This variant is useful when you want to share the state with other
/// consumers (e.g. a Tauri IPC command that routes JSON-RPC calls directly).
pub async fn start_server_with_state(
    config: ServerConfig,
    state: state::AppState,
) -> Result<SocketAddr, String> {
    std::env::set_var(
        "ROUTA_SERVER_URL",
        format!("http://{}:{}", config.host, config.port),
    );

    // Build router
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let mut app = Router::new()
        .merge(api::api_router())
        .route("/api/health", axum::routing::get(health_check))
        .layer(cors.clone())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Serve static frontend files if configured
    if let Some(ref static_dir) = config.static_dir {
        let static_path = std::path::Path::new(static_dir);
        if static_path.exists() && static_path.is_dir() {
            tracing::info!("Serving static frontend from: {}", static_dir);

            // For Next.js static export with dynamic routes, we need custom fallback logic.
            // Next.js generates placeholder files for dynamic routes:
            // - workspace/__placeholder__.html (for /workspace/[workspaceId])
            // - workspace/__placeholder__/kanban.html (for /workspace/[workspaceId]/kanban)
            // - workspace/__placeholder__/sessions/__placeholder__.html
            //   (for /workspace/[workspaceId]/sessions/[sessionId])
            //
            // Additionally, Next.js client navigation requests .txt RSC payload files:
            // - workspace/default/kanban.txt → workspace/__placeholder__/kanban.txt
            // - workspace/default/sessions/abc123.txt
            //   → workspace/__placeholder__/sessions/__placeholder__.txt
            //
            // We match the URL pattern and serve the corresponding placeholder file.
            let static_dir_clone = static_dir.clone();
            let fallback_service =
                tower::service_fn(move |req: axum::http::Request<axum::body::Body>| {
                    let static_dir = static_dir_clone.clone();
                    async move {
                        let path = req.uri().path();
                        let is_rsc_request = path.ends_with(".txt");
                        let (target_file, content_type) = resolve_static_target(path);

                        let file_path = std::path::Path::new(&static_dir).join(&target_file);
                        tracing::debug!(
                            "SPA fallback: {} -> {} (rsc={})",
                            path,
                            file_path.to_string_lossy(),
                            is_rsc_request
                        );

                        let workspace_segments: Vec<&str> = path
                            .trim_start_matches("/workspace/")
                            .trim_end_matches(".txt")
                            .split('/')
                            .filter(|segment| !segment.is_empty())
                            .collect();
                        let should_rewrite_workspace_placeholder = path.starts_with("/workspace/")
                            && !workspace_segments.is_empty()
                            && workspace_segments
                                .get(1)
                                .map(|segment| *segment != "sessions")
                                .unwrap_or(true);
                        let actual_workspace_id = workspace_segments
                            .first()
                            .copied()
                            .unwrap_or("__placeholder__");

                        let response = match tokio::fs::read(&file_path).await {
                            Ok(contents) => {
                                let body = if should_rewrite_workspace_placeholder {
                                    let rewritten = String::from_utf8_lossy(&contents)
                                        .replace("__placeholder__", actual_workspace_id);
                                    axum::body::Body::from(rewritten)
                                } else {
                                    axum::body::Body::from(contents)
                                };

                                axum::http::Response::builder()
                                    .status(axum::http::StatusCode::OK)
                                    .header("content-type", content_type)
                                    .body(body)
                                    .unwrap()
                            }
                            Err(_) => {
                                // If the specific file doesn't exist, fall back to index.html
                                let index_path =
                                    std::path::Path::new(&static_dir).join("index.html");
                                match tokio::fs::read(&index_path).await {
                                    Ok(contents) => axum::http::Response::builder()
                                        .status(axum::http::StatusCode::OK)
                                        .header("content-type", "text/html; charset=utf-8")
                                        .body(axum::body::Body::from(contents))
                                        .unwrap(),
                                    Err(_) => axum::http::Response::builder()
                                        .status(axum::http::StatusCode::NOT_FOUND)
                                        .body(axum::body::Body::from("Not found"))
                                        .unwrap(),
                                }
                            }
                        };
                        Ok::<_, std::convert::Infallible>(response)
                    }
                });

            let serve_dir =
                tower_http::services::ServeDir::new(static_dir).fallback(fallback_service);
            app = app.fallback_service(serve_dir);
        } else {
            tracing::warn!(
                "Static directory not found: {}. Frontend won't be served.",
                static_dir
            );
        }
    }

    // Bind and serve
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .map_err(|e| format!("Invalid address: {}", e))?;

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind to {}: {}", addr, e))?;

    let local_addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?;

    tracing::info!("Routa backend server listening on {}", local_addr);

    // Spawn the server in a background task
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!("Server error: {}", e);
        }
    });

    Ok(local_addr)
}

#[cfg(test)]
mod tests {
    use super::resolve_static_target;

    #[test]
    fn resolves_workspace_overview_placeholder() {
        let (target, content_type) = resolve_static_target("/workspace/default");
        assert_eq!(target, "workspace/__placeholder__.html");
        assert_eq!(content_type, "text/html; charset=utf-8");
    }

    #[test]
    fn resolves_workspace_kanban_placeholder() {
        let (target, content_type) = resolve_static_target("/workspace/default/kanban");
        assert_eq!(target, "workspace/__placeholder__/kanban.html");
        assert_eq!(content_type, "text/html; charset=utf-8");
    }

    #[test]
    fn resolves_workspace_team_placeholder() {
        let (target, content_type) = resolve_static_target("/workspace/default/team");
        assert_eq!(target, "workspace/__placeholder__/team.html");
        assert_eq!(content_type, "text/html; charset=utf-8");
    }

    #[test]
    fn resolves_workspace_team_root_tree_placeholder() {
        let (target, content_type) =
            resolve_static_target("/workspace/default/team/__next._tree.txt");
        assert_eq!(target, "workspace/__placeholder__/team/__next._tree.txt");
        assert_eq!(content_type, "text/x-component; charset=utf-8");
    }

    #[test]
    fn resolves_workspace_team_run_placeholder() {
        let (target, content_type) = resolve_static_target("/workspace/default/team/session-123");
        assert_eq!(
            target,
            "workspace/__placeholder__/team/__placeholder__.html"
        );
        assert_eq!(content_type, "text/html; charset=utf-8");
    }

    #[test]
    fn resolves_workspace_team_run_tree_placeholder() {
        let (target, content_type) =
            resolve_static_target("/workspace/default/team/session-123/__next._tree.txt");
        assert_eq!(
            target,
            "workspace/__placeholder__/team/__placeholder__/__next._tree.txt"
        );
        assert_eq!(content_type, "text/x-component; charset=utf-8");
    }

    #[test]
    fn resolves_workspace_session_placeholder() {
        let (target, content_type) =
            resolve_static_target("/workspace/default/sessions/session-123");
        assert_eq!(
            target,
            "workspace/__placeholder__/sessions/__placeholder__.html"
        );
        assert_eq!(content_type, "text/html; charset=utf-8");
    }

    #[test]
    fn resolves_workspace_team_rsc_placeholder() {
        let (target, content_type) =
            resolve_static_target("/workspace/default/team/session-123.txt");
        assert_eq!(target, "workspace/__placeholder__/team/__placeholder__.txt");
        assert_eq!(content_type, "text/x-component; charset=utf-8");
    }

    #[test]
    fn resolves_workspace_reposlide_placeholder() {
        let (target, content_type) =
            resolve_static_target("/workspace/ws-1/codebases/cb-1/reposlide");
        assert_eq!(
            target,
            "workspace/__placeholder__/codebases/__placeholder__/reposlide.html"
        );
        assert_eq!(content_type, "text/html; charset=utf-8");
    }
}

async fn health_check() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "server": "routa-server",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
