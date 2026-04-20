//! `routa rpc` — Raw JSON-RPC invocation.

use routa_core::rpc::RpcRouter;
use routa_core::state::AppState;

use super::print_json;

pub async fn call(state: &AppState, method: &str, params_str: &str) -> Result<(), String> {
    let params: serde_json::Value =
        serde_json::from_str(params_str).map_err(|e| format!("Invalid JSON params: {e}"))?;

    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }))
        .await;

    print_json(&response);
    Ok(())
}
