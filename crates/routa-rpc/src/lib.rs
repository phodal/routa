//! Routa RPC — Standalone JSON-RPC 2.0 crate for Routa.js
//!
//! This crate re-exports the transport-agnostic JSON-RPC interface from
//! `routa_server::rpc`. It exists as a standalone crate so that future
//! JS bindgen projects (via napi-rs or wasm-bindgen) can depend on it
//! directly without pulling in the full HTTP server.
//!
//! # Architecture
//!
//! ```text
//! routa-core    (domain: models, stores, state, protocols, RPC)
//!      ↑
//! routa-rpc     (re-export facade — this crate)
//!      ↑
//! routa-napi    (napi-rs bindings for Node.js)  [future]
//! routa-wasm    (wasm-bindgen for browser)      [future]
//! ```
//!
//! # Example — raw JSON string
//!
//! ```ignore
//! use routa_rpc::RpcRouter;
//!
//! let router = RpcRouter::new(app_state);
//! let response = router.handle_request(r#"{
//!     "jsonrpc": "2.0",
//!     "id": 1,
//!     "method": "agents.list",
//!     "params": { "workspaceId": "default" }
//! }"#).await;
//! ```
//!
//! # Example — serde_json::Value (e.g. Tauri IPC)
//!
//! ```ignore
//! use routa_rpc::RpcRouter;
//!
//! let router = RpcRouter::new(app_state);
//! let response = router.handle_value(serde_json::json!({
//!     "jsonrpc": "2.0",
//!     "id": 1,
//!     "method": "tasks.create",
//!     "params": {
//!         "title": "Implement feature X",
//!         "objective": "Add feature X to the codebase"
//!     }
//! })).await;
//! ```
//!
//! # Supported Methods
//!
//! | Domain       | Method               | Description                    |
//! |-------------|----------------------|--------------------------------|
//! | agents      | `agents.list`        | List agents with filters       |
//! | agents      | `agents.get`         | Get agent by id                |
//! | agents      | `agents.create`      | Create a new agent             |
//! | agents      | `agents.delete`      | Delete an agent                |
//! | agents      | `agents.updateStatus`| Update agent status            |
//! | tasks       | `tasks.list`         | List tasks with filters        |
//! | tasks       | `tasks.get`          | Get task by id                 |
//! | tasks       | `tasks.create`       | Create a new task              |
//! | tasks       | `tasks.delete`       | Delete a task                  |
//! | tasks       | `tasks.updateStatus` | Update task status             |
//! | tasks       | `tasks.findReady`    | Find ready tasks               |
//! | notes       | `notes.list`         | List notes with filters        |
//! | notes       | `notes.get`          | Get note by id                 |
//! | notes       | `notes.create`       | Create or update a note        |
//! | notes       | `notes.delete`       | Delete a note                  |
//! | workspaces  | `workspaces.list`    | List all workspaces            |
//! | workspaces  | `workspaces.get`     | Get workspace by id            |
//! | workspaces  | `workspaces.create`  | Create a new workspace         |
//! | workspaces  | `workspaces.delete`  | Delete a workspace             |
//! | skills      | `skills.list`        | List discovered skills         |
//! | skills      | `skills.get`         | Get skill by name              |
//! | skills      | `skills.reload`      | Re-discover skills             |

// Re-export the core RPC types and router from routa-core
pub use routa_core::rpc::error::RpcError;
pub use routa_core::rpc::router::RpcRouter;
pub use routa_core::rpc::types::{
    JsonRpcError, JsonRpcRequest, JsonRpcResponse,
    BAD_REQUEST, INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST,
    METHOD_NOT_FOUND, NOT_FOUND, PARSE_ERROR,
};

// Re-export method param/result types for typed usage
pub mod methods {
    pub use routa_core::rpc::methods::*;
}
