//! `routa server` — Start the Routa HTTP backend server.

pub async fn run(
    host: String,
    port: u16,
    db_path: String,
    static_dir: Option<String>,
) -> Result<(), String> {
    // Resolve full shell PATH so child processes can be found
    let full_path = routa_core::shell_env::full_path();
    std::env::set_var("PATH", full_path);

    let config = routa_server::ServerConfig {
        host: host.clone(),
        port,
        db_path,
        static_dir,
    };

    println!("Starting Routa server on {host}:{port}...");

    let addr = routa_server::start_server(config).await?;
    println!("Routa server listening on http://{addr}");

    // Keep the process running until interrupted
    tokio::signal::ctrl_c()
        .await
        .map_err(|e| format!("Failed to listen for Ctrl+C: {e}"))?;

    println!("\nShutting down...");
    Ok(())
}
