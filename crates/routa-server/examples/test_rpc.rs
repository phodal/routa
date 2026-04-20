//! Quick integration test for the JSON-RPC endpoint.
//!
//! Usage: cargo run -p routa-server --example test_rpc

use std::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Start the server on a random port
    let config = routa_server::ServerConfig {
        host: "127.0.0.1".to_string(),
        port: 0, // random port
        db_path: ":memory:".to_string(),
        static_dir: None,
    };

    let addr = routa_server::start_server(config).await?;
    println!("Server started on {addr}");

    // Give the server a moment to settle
    tokio::time::sleep(Duration::from_millis(200)).await;

    let client = reqwest::Client::new();
    let base = format!("http://{addr}");

    // Test 1: List methods
    println!("\n=== Test 1: GET /api/rpc/methods ===");
    let res = client.get(format!("{base}/api/rpc/methods")).send().await?;
    let body: serde_json::Value = res.json().await?;
    println!("{}", serde_json::to_string_pretty(&body)?);

    // Test 2: agents.list via JSON-RPC
    println!("\n=== Test 2: agents.list ===");
    let res = client
        .post(format!("{base}/api/rpc"))
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.list",
            "params": { "workspaceId": "default" }
        }))
        .send()
        .await?;
    let body: serde_json::Value = res.json().await?;
    println!("{}", serde_json::to_string_pretty(&body)?);

    // Test 3: agents.create
    println!("\n=== Test 3: agents.create ===");
    let res = client
        .post(format!("{base}/api/rpc"))
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "agents.create",
            "params": {
                "name": "Test Agent",
                "role": "DEVELOPER"
            }
        }))
        .send()
        .await?;
    let body: serde_json::Value = res.json().await?;
    println!("{}", serde_json::to_string_pretty(&body)?);
    let agent_id = body["result"]["agentId"].as_str().unwrap_or("");

    // Test 4: agents.get
    println!("\n=== Test 4: agents.get ===");
    let res = client
        .post(format!("{base}/api/rpc"))
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "agents.get",
            "params": { "id": agent_id }
        }))
        .send()
        .await?;
    let body: serde_json::Value = res.json().await?;
    println!("{}", serde_json::to_string_pretty(&body)?);

    // Test 5: workspaces.list
    println!("\n=== Test 5: workspaces.list ===");
    let res = client
        .post(format!("{base}/api/rpc"))
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "workspaces.list"
        }))
        .send()
        .await?;
    let body: serde_json::Value = res.json().await?;
    println!("{}", serde_json::to_string_pretty(&body)?);

    // Test 6: Method not found
    println!("\n=== Test 6: Method not found ===");
    let res = client
        .post(format!("{base}/api/rpc"))
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "nonexistent.method"
        }))
        .send()
        .await?;
    let body: serde_json::Value = res.json().await?;
    println!("{}", serde_json::to_string_pretty(&body)?);

    // Test 7: tasks.create + tasks.list
    println!("\n=== Test 7: tasks.create ===");
    let res = client
        .post(format!("{base}/api/rpc"))
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tasks.create",
            "params": {
                "title": "Test Task",
                "objective": "Verify JSON-RPC works"
            }
        }))
        .send()
        .await?;
    let body: serde_json::Value = res.json().await?;
    println!("{}", serde_json::to_string_pretty(&body)?);

    println!("\n=== Test 8: tasks.list ===");
    let res = client
        .post(format!("{base}/api/rpc"))
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 7,
            "method": "tasks.list",
            "params": { "workspaceId": "default" }
        }))
        .send()
        .await?;
    let body: serde_json::Value = res.json().await?;
    println!("{}", serde_json::to_string_pretty(&body)?);

    println!("\n=== All tests passed! ===");
    Ok(())
}
