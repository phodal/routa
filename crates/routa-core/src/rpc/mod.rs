//! Transport-agnostic JSON-RPC 2.0 layer for Routa.js.
//!
//! This module provides a unified JSON-RPC interface over Routa's core
//! functionality (agents, tasks, notes, workspaces, skills). It is
//! intentionally decoupled from any HTTP framework so it can be reused
//! across different transports:
//!
//! - **HTTP** — via the axum endpoint at `/api/rpc`
//! - **Tauri IPC** — direct invocation in the desktop app
//! - **JS bindgen** — via napi-rs or wasm-bindgen in the future
//!
//! # Example
//!
//! ```ignore
//! use routa_server::rpc::RpcRouter;
//!
//! let router = RpcRouter::new(app_state);
//! let response = router.handle_request(r#"{
//!     "jsonrpc": "2.0",
//!     "id": 1,
//!     "method": "agents.list",
//!     "params": { "workspaceId": "default" }
//! }"#).await;
//! ```

pub mod error;
pub mod methods;
pub mod router;
pub mod types;

pub use error::RpcError;
pub use router::RpcRouter;
pub use types::{JsonRpcRequest, JsonRpcResponse};
