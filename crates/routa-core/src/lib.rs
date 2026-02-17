//! Routa Core — Transport-agnostic domain logic for the Routa.js platform.
//!
//! This crate contains the core business logic, data models, stores, and
//! protocol integrations. It has **no HTTP framework dependency** by default,
//! making it suitable for use in:
//!
//! - HTTP servers (via `routa-server`)
//! - Tauri desktop apps (direct IPC)
//! - CLI tools
//! - JS bindgen (via napi-rs or wasm-bindgen)
//!
//! # Feature Flags
//!
//! - `axum` — Enables `IntoResponse` impl on `ServerError` for use in axum handlers.

pub mod acp;
pub mod db;
pub mod error;
pub mod events;
pub mod git;
pub mod mcp;
pub mod models;
pub mod orchestration;
pub mod rpc;
pub mod shell_env;
pub mod skills;
pub mod state;
pub mod store;
pub mod tools;

// Convenience re-exports
pub use db::Database;
pub use error::ServerError;
pub use state::{AppState, AppStateInner};
