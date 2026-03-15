//! CLI command implementations.
//!
//! Each submodule corresponds to a top-level CLI command and reuses
//! the routa-core domain logic through `AppState`.

pub mod acp;
pub mod acp_serve;
pub mod agent;
pub mod chat;
pub mod delegate;
pub mod prompt;
pub mod rpc;
pub mod scan;
pub mod server;
pub mod skill;
pub mod task;
pub mod tui;
pub mod workflow;
pub mod workspace;

use routa_core::state::AppState;
use std::sync::Arc;

/// Initialize a shared `AppState` from the given SQLite database path.
///
/// This mirrors `routa_server::create_app_state` but avoids pulling in
/// the full HTTP server dependency for non-server commands.
pub async fn init_state(db_path: &str) -> AppState {
    let db = routa_core::Database::open(db_path).unwrap_or_else(|e| {
        eprintln!("Failed to open database '{}': {}", db_path, e);
        std::process::exit(1);
    });

    let state: AppState = Arc::new(routa_core::AppStateInner::new(db));

    // Ensure the default workspace exists
    if let Err(e) = state.workspace_store.ensure_default().await {
        eprintln!("Failed to initialize default workspace: {}", e);
        std::process::exit(1);
    }

    // Discover skills from cwd
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());
    state.skill_registry.reload(&cwd);

    state
}

/// Pretty-print a JSON value to stdout.
pub fn print_json(value: &serde_json::Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
    );
}
