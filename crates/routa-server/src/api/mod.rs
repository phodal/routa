pub mod a2a;
pub mod a2ui;
pub mod acp_docker;
pub mod acp_registry;
pub mod acp_routes;
pub mod ag_ui;
pub mod agents;
pub mod background_tasks;
pub mod clone;
pub mod clone_branches;
pub mod clone_local;
pub mod clone_progress;
pub mod codebases;
pub mod debug;
pub mod files;
pub mod fitness;
pub mod github;
pub mod harness;
pub(crate) mod harness_github_actions;
pub(crate) mod harness_hook_preview_events;
pub(crate) mod harness_instructions_audit;
pub(crate) mod harness_repo_views;
pub mod harness_templates;
pub mod kanban;
pub mod mcp_routes;
pub mod mcp_server_mgmt;
pub mod mcp_servers;
pub mod mcp_tools;
pub mod memory;
pub mod notes;
pub mod polling;
pub mod provider_models;
pub mod providers;
pub(crate) mod repo_context;
pub mod review;
pub mod rpc;
pub mod sandbox;
pub mod schedules;
pub mod sessions;
pub mod shared_sessions;
pub mod skills;
pub mod skills_catalog;
pub mod skills_clone;
pub mod skills_upload;
pub mod specialists;
pub mod tasks;
pub mod tasks_automation;
pub mod tasks_github;
pub mod test_mcp;
pub mod traces;
pub mod webhooks;
pub mod workflows;
pub mod workspaces;
pub mod worktrees;

use axum::Router;

use crate::state::AppState;

/// Build the complete API router with all sub-routes.
pub fn api_router() -> Router<AppState> {
    Router::new()
        .nest("/api/agents", agents::router())
        .nest("/api/notes", notes::router())
        .nest("/api/kanban", kanban::router())
        .nest("/api/tasks", tasks::router())
        .nest("/api/workspaces", workspaces::router())
        .nest("/api", codebases::router())
        .nest("/api/skills", skills::router())
        .nest("/api/skills/catalog", skills_catalog::router())
        .nest("/api/skills/clone", skills_clone::router())
        .nest("/api/skills/upload", skills_upload::router())
        .nest("/api/sessions", sessions::router())
        .nest("/api/shared-sessions", shared_sessions::router())
        .nest("/api/providers", providers::router())
        .nest("/api/providers", provider_models::router())
        .nest("/api/review", review::router())
        .nest("/api/acp", acp_routes::router())
        .nest("/api/acp", acp_registry::router())
        .nest("/api/acp/docker", acp_docker::router())
        .nest("/api/mcp", mcp_routes::router())
        .nest("/api/mcp/tools", mcp_tools::router())
        .nest("/api/mcp-server", mcp_server_mgmt::router())
        .nest("/api/mcp-servers", mcp_servers::router())
        .nest("/api/github", github::router())
        .nest("/api/harness", harness::router())
        .nest("/api/harness/templates", harness_templates::router())
        .nest("/api/webhooks", webhooks::router())
        .nest("/api/background-tasks", background_tasks::router())
        .nest("/api/test-mcp", test_mcp::router())
        .nest("/api/clone", clone::router())
        .nest("/api/clone/local", clone_local::router())
        .nest("/api/clone/progress", clone_progress::router())
        .nest("/api/clone/branches", clone_branches::router())
        .nest("/api/files", files::router())
        .nest("/api/fitness", fitness::router())
        .nest("/api/rpc", rpc::router())
        .nest("/api/a2a", a2a::router())
        .nest("/api/ag-ui", ag_ui::router())
        .nest("/api/a2ui", a2ui::router())
        .nest("/api/traces", traces::router())
        .nest("/api/schedules", schedules::router())
        .nest("/api/sandboxes", sandbox::router())
        .nest("/api/specialists", specialists::router())
        .nest("/api/memory", memory::router())
        .nest("/api/debug", debug::router())
        .nest("/api/polling", polling::router())
        .nest("/api/workflows", workflows::router())
        .nest("/api", worktrees::router())
}
