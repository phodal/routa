//! JSON-RPC method implementations, organized by domain.
//!
//! Each sub-module exposes typed param/result structs and an async `handle`
//! function that takes `AppState` + params and returns a `serde_json::Value`.

pub mod agents;
pub mod notes;
pub mod skills;
pub mod tasks;
pub mod workspaces;
