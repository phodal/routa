//! Standalone Rust backend server (without Tauri).
//! Run with: cargo run --example standalone_server

use std::path::PathBuf;

#[tokio::main]
async fn main() {
    // Try to find the static frontend directory
    let static_dir = detect_repo_root()
        .and_then(|repo_root| {
            let out_dir = repo_root.join("out");
            if out_dir.exists() && out_dir.is_dir() {
                Some(canonicalize_path(out_dir))
            } else {
                None
            }
        })
        .or_else(|| {
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let frontend_dir = manifest_dir.join("frontend");
            if frontend_dir.exists() && frontend_dir.is_dir() {
                Some(canonicalize_path(frontend_dir))
            } else {
                None
            }
        })
        .or_else(|| {
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let legacy_out = manifest_dir.join("..").join("..").join("out");
            if legacy_out.exists() && legacy_out.is_dir() {
                Some(canonicalize_path(legacy_out))
            } else {
                None
            }
        });

    let config = routa_server::ServerConfig {
        host: "127.0.0.1".to_string(),
        port: 3210,
        db_path: "/tmp/routa-test.db".to_string(),
        static_dir: static_dir.clone(),
    };

    println!("Starting standalone Routa Rust backend on 127.0.0.1:3210...");
    println!("Database: /tmp/routa-test.db");
    if let Some(ref dir) = static_dir {
        println!("Frontend: {dir}");
    } else {
        println!("Frontend: (none - API only)");
    }
    println!("Press Ctrl+C to stop.\n");

    match routa_server::start_server(config).await {
        Ok(addr) => {
            println!("Server listening on http://{addr}");
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
            eprintln!("Failed to start server: {e}");
            std::process::exit(1);
        }
    }
}

fn detect_repo_root() -> Option<PathBuf> {
    if let Ok(v) = std::env::var("ROUTA_REPO_ROOT") {
        let p = PathBuf::from(v);
        if p.join("package.json").exists() {
            return Some(p);
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidate = manifest_dir;
    for _ in 0..12 {
        if candidate.join("package.json").exists() {
            return Some(candidate);
        }

        if !candidate.pop() {
            break;
        }
    }

    None
}

fn canonicalize_path(path: PathBuf) -> String {
    path.canonicalize()
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}
