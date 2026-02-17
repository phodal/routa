//! Transport-agnostic JSON-RPC 2.0 dispatcher.
//!
//! `RpcRouter` takes an `AppState` and dispatches incoming JSON-RPC requests
//! to the appropriate method handler. It is intentionally free of any HTTP
//! or framework dependency so it can be used from:
//!
//! - An axum handler (HTTP)
//! - A Tauri command (IPC)
//! - A napi-rs / wasm-bindgen function (JS bindgen)
//! - Stdio (CLI)

use crate::state::AppState;

use super::error::RpcError;
use super::methods;
use super::types::*;

/// Transport-agnostic JSON-RPC router.
///
/// # Usage
///
/// ```ignore
/// let router = RpcRouter::new(app_state);
///
/// // From raw JSON string:
/// let response_json = router.handle_request(raw_json_str).await;
///
/// // From a parsed request:
/// let response = router.dispatch(request).await;
/// ```
#[derive(Clone)]
pub struct RpcRouter {
    state: AppState,
}

impl RpcRouter {
    /// Create a new router backed by the given application state.
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    /// Handle a raw JSON string. Parses the request, dispatches it, and returns
    /// the serialized JSON response string.
    pub async fn handle_request(&self, raw: &str) -> String {
        // Try to parse as a batch request first
        if let Ok(batch) = serde_json::from_str::<Vec<JsonRpcRequest>>(raw) {
            let mut responses = Vec::with_capacity(batch.len());
            for req in batch {
                responses.push(self.dispatch(req).await);
            }
            return serde_json::to_string(&responses).unwrap_or_else(|_| {
                r#"{"jsonrpc":"2.0","error":{"code":-32603,"message":"Failed to serialize response"},"id":null}"#.into()
            });
        }

        // Parse as single request
        let request: JsonRpcRequest = match serde_json::from_str(raw) {
            Ok(req) => req,
            Err(e) => {
                return serde_json::to_string(&JsonRpcResponse::error(
                    None,
                    PARSE_ERROR,
                    format!("Parse error: {}", e),
                ))
                .unwrap_or_default();
            }
        };

        let response = self.dispatch(request).await;
        serde_json::to_string(&response).unwrap_or_else(|_| {
            r#"{"jsonrpc":"2.0","error":{"code":-32603,"message":"Failed to serialize response"},"id":null}"#.into()
        })
    }

    /// Handle a pre-parsed `serde_json::Value`. Useful for transports that
    /// already do their own parsing (e.g. Tauri IPC, axum JSON extraction).
    pub async fn handle_value(&self, value: serde_json::Value) -> serde_json::Value {
        let request: JsonRpcRequest = match serde_json::from_value(value) {
            Ok(req) => req,
            Err(e) => {
                return serde_json::to_value(JsonRpcResponse::error(
                    None,
                    PARSE_ERROR,
                    format!("Invalid request: {}", e),
                ))
                .unwrap_or_default();
            }
        };

        let response = self.dispatch(request).await;
        serde_json::to_value(response).unwrap_or_default()
    }

    /// Dispatch a parsed JSON-RPC request to the correct method handler.
    pub async fn dispatch(&self, req: JsonRpcRequest) -> JsonRpcResponse {
        // Validate JSON-RPC version
        if req.jsonrpc != "2.0" {
            return JsonRpcResponse::error(
                req.id,
                INVALID_REQUEST,
                "Invalid JSON-RPC version, expected \"2.0\"",
            );
        }

        let id = req.id.clone();
        let params = req
            .params
            .unwrap_or(serde_json::Value::Object(Default::default()));

        match self.route(&req.method, params).await {
            Ok(result) => JsonRpcResponse::success(id, result),
            Err(err) => err.to_response(id),
        }
    }

    /// Route a method call to the correct handler and return the result as JSON.
    async fn route(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        match method {
            // ----- Agents -----
            "agents.list" => {
                let p = parse_params(params)?;
                let r = methods::agents::list(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "agents.get" => {
                let p = parse_params(params)?;
                let r = methods::agents::get(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "agents.create" => {
                let p = parse_params(params)?;
                let r = methods::agents::create(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "agents.delete" => {
                let p = parse_params(params)?;
                let r = methods::agents::delete(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "agents.updateStatus" => {
                let p = parse_params(params)?;
                let r = methods::agents::update_status(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }

            // ----- Tasks -----
            "tasks.list" => {
                let p = parse_params(params)?;
                let r = methods::tasks::list(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "tasks.get" => {
                let p = parse_params(params)?;
                let r = methods::tasks::get(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "tasks.create" => {
                let p = parse_params(params)?;
                let r = methods::tasks::create(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "tasks.delete" => {
                let p = parse_params(params)?;
                let r = methods::tasks::delete(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "tasks.updateStatus" => {
                let p = parse_params(params)?;
                let r = methods::tasks::update_status(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "tasks.findReady" => {
                let p = parse_params(params)?;
                let r = methods::tasks::find_ready(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }

            // ----- Notes -----
            "notes.list" => {
                let p = parse_params(params)?;
                let r = methods::notes::list(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "notes.get" => {
                let p = parse_params(params)?;
                let r = methods::notes::get(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "notes.create" => {
                let p = parse_params(params)?;
                let r = methods::notes::create(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "notes.delete" => {
                let p = parse_params(params)?;
                let r = methods::notes::delete(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }

            // ----- Workspaces -----
            "workspaces.list" => {
                let r = methods::workspaces::list(&self.state).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "workspaces.get" => {
                let p = parse_params(params)?;
                let r = methods::workspaces::get(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "workspaces.create" => {
                let p = parse_params(params)?;
                let r = methods::workspaces::create(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "workspaces.delete" => {
                let p = parse_params(params)?;
                let r = methods::workspaces::delete(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }

            // ----- Skills -----
            "skills.list" => {
                let r = methods::skills::list(&self.state).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "skills.get" => {
                let p = parse_params(params)?;
                let r = methods::skills::get(&self.state, p).await?;
                Ok(serde_json::to_value(r).unwrap())
            }
            "skills.reload" => {
                let r = methods::skills::reload(&self.state).await?;
                Ok(serde_json::to_value(r).unwrap())
            }

            // ----- Unknown method -----
            _ => Err(RpcError::MethodNotFound(format!(
                "Method not found: {}",
                method
            ))),
        }
    }

    /// Return a list of all supported RPC method names.
    /// Useful for introspection / discovery endpoints.
    pub fn method_list(&self) -> Vec<&'static str> {
        vec![
            "agents.list",
            "agents.get",
            "agents.create",
            "agents.delete",
            "agents.updateStatus",
            "tasks.list",
            "tasks.get",
            "tasks.create",
            "tasks.delete",
            "tasks.updateStatus",
            "tasks.findReady",
            "notes.list",
            "notes.get",
            "notes.create",
            "notes.delete",
            "workspaces.list",
            "workspaces.get",
            "workspaces.create",
            "workspaces.delete",
            "skills.list",
            "skills.get",
            "skills.reload",
        ]
    }
}

/// Helper: deserialize `serde_json::Value` into a typed params struct.
fn parse_params<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> Result<T, RpcError> {
    serde_json::from_value(value)
        .map_err(|e| RpcError::InvalidParams(format!("Invalid params: {}", e)))
}
