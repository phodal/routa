use std::sync::{Arc, Mutex};

use axum::{extract::State, Json};
use routa_core::db::Database;
use routa_core::state::AppStateInner;
use serde_json::json;

use super::{acp_rpc, AcpResponse};

fn json_response_value(response: AcpResponse) -> serde_json::Value {
    match response {
        AcpResponse::Json(Json(value)) => value,
        AcpResponse::Sse(_) => panic!("expected JSON response"),
    }
}

static ENV_LOCK: Mutex<()> = Mutex::new(());

#[tokio::test]
async fn session_new_hosted_workspace_providers_bind_credentials() {
    let _guard = ENV_LOCK.lock().expect("env lock");
    let sentinel = "SENTINEL_ENV_KEY_DO_NOT_LEAK";
    let previous = [
        "STANDARDCOMPUTE_API_KEY",
        "UBERLLM_API_KEY",
        "WORKSPACE_AGENT_PROVIDER",
        "WORKSPACE_AGENT_MODEL",
        "STANDARDCOMPUTE_API_BASE",
        "UBERLLM_API_BASE",
    ]
    .map(|key| (key, std::env::var(key).ok()));
    std::env::set_var("STANDARDCOMPUTE_API_KEY", sentinel);
    std::env::set_var("UBERLLM_API_KEY", sentinel);
    std::env::set_var("WORKSPACE_AGENT_PROVIDER", "standardcompute");
    std::env::remove_var("WORKSPACE_AGENT_MODEL");
    std::env::remove_var("STANDARDCOMPUTE_API_BASE");
    std::env::remove_var("UBERLLM_API_BASE");

    let db = Database::open_in_memory().expect("db should open");
    let state = Arc::new(AppStateInner::new(db));
    state
        .workspace_store
        .ensure_default()
        .await
        .expect("default workspace should exist");
    let cwd = tempfile::tempdir().expect("cwd");
    let cwd_path = cwd.path().display().to_string();

    let spoof = acp_rpc(
        State(state.clone()),
        Json(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "session/new",
            "params": {
                "workspaceId": "default",
                "cwd": cwd_path,
                "provider": "workspace",
                "baseUrl": "https://api.stdcmpt.com.evil.com/v1",
                "model": "standardcompute"
            }
        })),
    )
    .await
    .expect("spoof request");
    let spoof_value = json_response_value(spoof);
    assert!(spoof_value["error"]["message"]
        .as_str()
        .unwrap_or_default()
        .contains("untrusted base URL"));
    assert!(!spoof_value.to_string().contains(sentinel));

    let connected = acp_rpc(
        State(state.clone()),
        Json(json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "session/new",
            "params": {
                "workspaceId": "default",
                "cwd": cwd_path,
                "provider": "workspace",
                "baseUrl": "https://api.stdcmpt.com/v1"
            }
        })),
    )
    .await
    .expect("standardcompute request");
    let connected_value = json_response_value(connected);
    assert!(connected_value["result"]["sessionId"].is_string());
    assert_eq!(connected_value["result"]["provider"], json!("workspace"));
    assert!(!connected_value.to_string().contains(sentinel));

    let missing_model = acp_rpc(
        State(state.clone()),
        Json(json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "session/new",
            "params": {
                "workspaceId": "default",
                "cwd": cwd_path,
                "provider": "workspace",
                "baseUrl": "https://api.uberllm.dev/v1"
            }
        })),
    )
    .await
    .expect("uberllm request");
    let missing_model_value = json_response_value(missing_model);
    assert!(missing_model_value["error"]["message"]
        .as_str()
        .unwrap_or_default()
        .contains("explicit model"));
    assert!(!missing_model_value.to_string().contains(sentinel));

    let explicit = acp_rpc(
        State(state),
        Json(json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "session/new",
            "params": {
                "workspaceId": "default",
                "cwd": cwd_path,
                "provider": "workspace",
                "baseUrl": "https://proxy.example/v1",
                "apiKey": "caller-supplied-key",
                "model": "deepseek/deepseek-v4-flash"
            }
        })),
    )
    .await
    .expect("explicit key request");
    let explicit_value = json_response_value(explicit);
    assert!(explicit_value["result"]["sessionId"].is_string());
    assert!(!explicit_value.to_string().contains(sentinel));
    assert!(!explicit_value.to_string().contains("caller-supplied-key"));

    for (key, value) in previous {
        match value {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
    }
}
