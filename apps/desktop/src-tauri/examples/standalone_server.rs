//! Standalone Rust backend server (without Tauri).
//! Run with: cargo run --example standalone_server

#[tokio::main]
async fn main() {
    // Try to find the static frontend directory
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let static_dir = ["frontend", "../../../out"]
        .iter()
        .map(|p| manifest_dir.join(p))
        .find(|p| p.exists() && p.is_dir())
        .map(|p| p.canonicalize().unwrap_or(p).to_string_lossy().to_string());

    let config = routa_desktop_lib::server::ServerConfig {
        host: "127.0.0.1".to_string(),
        port: 3210,
        db_path: "/tmp/routa-test.db".to_string(),
        static_dir: static_dir.clone(),
    };

    println!("Starting standalone Routa Rust backend on 127.0.0.1:3210...");
    println!("Database: /tmp/routa-test.db");
    if let Some(ref dir) = static_dir {
        println!("Frontend: {}", dir);
    } else {
        println!("Frontend: (none - API only)");
    }
    println!("Press Ctrl+C to stop.\n");

    match routa_desktop_lib::server::start_server(config).await {
        Ok(addr) => {
            println!("Server listening on http://{}", addr);
            println!("\nAvailable endpoints:");
            println!("  GET  /api/health");
            println!("  GET  /api/agents");
            println!("  POST /api/agents");
            println!("  GET  /api/notes");
            println!("  POST /api/notes");
            println!("  GET  /api/tasks");
            println!("  POST /api/tasks");
            println!("  GET  /api/workspaces");
            println!("  GET  /api/skills");
            println!("  GET  /api/sessions");
            println!("  POST /api/acp");
            println!("  GET  /api/notes/events (SSE)");

            // Keep running until Ctrl+C
            tokio::signal::ctrl_c().await.ok();
            println!("\nShutting down...");
        }
        Err(e) => {
            eprintln!("Failed to start server: {}", e);
            std::process::exit(1);
        }
    }
}
