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
            // - workspace/__placeholder__/sessions/__placeholder__.html (for /workspace/[workspaceId]/sessions/[sessionId])
            //
            // Additionally, Next.js client navigation requests .txt RSC payload files:
            // - workspace/default/sessions/abc123.txt → workspace/__placeholder__/sessions/__placeholder__.txt
            // - workspace/default/kanban.txt → workspace/__placeholder__/kanban.txt
            //
            // We match the URL pattern and serve the corresponding placeholder file.
            let static_dir_clone = static_dir.clone();
            let fallback_service =
                tower::service_fn(move |req: axum::http::Request<axum::body::Body>| {
                    let static_dir = static_dir_clone.clone();
                    async move {
                        let path = req.uri().path();

                        // Check if this is a .txt RSC payload request
                        let is_rsc_request = path.ends_with(".txt");

                        // Determine which file to serve based on the route pattern.
                        let (target_file, content_type) = if path.starts_with("/workspace/") {
                            // Strip .txt extension if present to analyze the path
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

                            if segments.len() >= 3 && segments[1] == "sessions" {
                                // /workspace/{workspaceId}/sessions/{sessionId}[.txt]
                                (
                                    format!(
                                        "workspace/__placeholder__/sessions/__placeholder__.{}",
                                        ext
                                    ),
                                    content,
                                )
                            } else if segments.len() == 2 && segments[1] == "kanban" {
                                // /workspace/{workspaceId}/kanban[.txt]
                                (
                                    format!("workspace/__placeholder__/kanban.{}", ext),
                                    content,
                                )
                            } else if !segments.is_empty() {
                                // /workspace/{workspaceId}[.txt]
                                (format!("workspace/__placeholder__.{}", ext), content)
                            } else {
                                ("index.html".to_string(), "text/html; charset=utf-8")
                            }
                        } else {
                            ("index.html".to_string(), "text/html; charset=utf-8")
                        };

                        let file_path = std::path::Path::new(&static_dir).join(&target_file);
                        tracing::debug!(
                            "SPA fallback: {} -> {} (rsc={})",
                            path,
                            file_path.to_string_lossy(),
                            is_rsc_request
                        );

                        let response = match tokio::fs::read(&file_path).await {
                            Ok(contents) => axum::http::Response::builder()
                                .status(axum::http::StatusCode::OK)
                                .header("content-type", content_type)
                                .body(axum::body::Body::from(contents))
                                .unwrap(),
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

async fn health_check() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "server": "routa-server",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
