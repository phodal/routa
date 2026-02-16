pub mod a2a;
pub mod acp_routes;
pub mod agents;
pub mod clone;
pub mod clone_branches;
pub mod clone_progress;
pub mod mcp_routes;
pub mod mcp_server_mgmt;
pub mod mcp_tools;
pub mod notes;
pub mod sessions;
pub mod skills;
pub mod skills_clone;
pub mod skills_upload;
pub mod tasks;
pub mod test_mcp;
pub mod workspaces;

use axum::Router;

use crate::state::AppState;

/// Build the complete API router with all sub-routes.
pub fn api_router() -> Router<AppState> {
    Router::new()
        .nest("/api/agents", agents::router())
        .nest("/api/notes", notes::router())
        .nest("/api/tasks", tasks::router())
        .nest("/api/workspaces", workspaces::router())
        .nest("/api/skills", skills::router())
        .nest("/api/skills/clone", skills_clone::router())
        .nest("/api/skills/upload", skills_upload::router())
        .nest("/api/sessions", sessions::router())
        .nest("/api/acp", acp_routes::router())
        .nest("/api/mcp", mcp_routes::router())
        .nest("/api/mcp/tools", mcp_tools::router())
        .nest("/api/mcp-server", mcp_server_mgmt::router())
        .nest("/api/test-mcp", test_mcp::router())
        .nest("/api/clone", clone::router())
        .nest("/api/clone/progress", clone_progress::router())
        .nest("/api/clone/branches", clone_branches::router())
        .nest("/api/a2a", a2a::router())
}
