use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;

// Re-export routa_server for external use
pub use routa_server as server;

/// Custom Tauri commands exposed to the frontend via `invoke`.
/// These bridge the gap between the web frontend and native capabilities.

/// Read an environment variable from the host system.
#[tauri::command]
fn get_env(key: String) -> Option<String> {
    std::env::var(&key).ok()
}

/// Get the current working directory.
#[tauri::command]
fn get_cwd() -> String {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Get the user's home directory.
#[tauri::command]
fn get_home_dir() -> Option<String> {
    dirs::home_dir().map(|p| p.to_string_lossy().to_string())
}

/// Check if a given path is a git repository.
#[tauri::command]
fn is_git_repo(path: String) -> bool {
    let git_dir = std::path::Path::new(&path).join(".git");
    git_dir.exists()
}

/// Log a frontend diagnostic message on the Rust side.
#[tauri::command]
fn log_frontend(level: String, scope: String, message: String) {
    println!("[frontend:{}][{}] {}", level, scope, message);
}

fn detect_repo_root() -> Option<PathBuf> {
    if let Ok(v) = std::env::var("ROUTA_REPO_ROOT") {
        let p = PathBuf::from(v);
        if p.join("package.json").exists() {
            return Some(p);
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidate = manifest_dir.join("../../..");
    if candidate.join("package.json").exists() {
        return Some(candidate);
    }

    None
}

fn wait_for_port(host: &str, port: u16, timeout_secs: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    while Instant::now() < deadline {
        if TcpStream::connect((host, port)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

fn pipe_child_logs(prefix: &'static str, child: &mut Child) {
    if let Some(stdout) = child.stdout.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                println!("[{}][stdout] {}", prefix, line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                eprintln!("[{}][stderr] {}", prefix, line);
            }
        });
    }
}

fn env_or_default(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn api_port() -> u16 {
    std::env::var("ROUTA_DESKTOP_API_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(3210)
}

fn start_local_next_server(host: &str, port: u16) -> Result<Child, String> {
    let repo_root = detect_repo_root().ok_or_else(|| {
        "Unable to detect repository root for desktop local API server".to_string()
    })?;

    println!(
        "[desktop-server] Starting local Next API server from {}",
        repo_root.to_string_lossy()
    );

    let mut child = Command::new("npm")
        .arg("run")
        .arg("start:desktop:server")
        .current_dir(repo_root)
        .env("HOSTNAME", host)
        .env("PORT", port.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn desktop API server: {}", e))?;

    pipe_child_logs("desktop-server", &mut child);
    Ok(child)
}

fn start_embedded_next_server(
    app: &tauri::AppHandle,
    host: &str,
    port: u16,
) -> Result<Child, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve Tauri resource dir: {}", e))?;
    let server_root = resource_dir.join("bundled").join("desktop-server");
    let server_js = server_root.join("server.js");
    if !server_js.exists() {
        return Err(format!(
            "Embedded desktop server not found at {}",
            server_js.to_string_lossy()
        ));
    }

    let db_path = std::env::var("ROUTA_DB_PATH").unwrap_or_else(|_| {
        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| dirs::home_dir().unwrap_or_default().join(".routa"));
        std::fs::create_dir_all(&data_dir).ok();
        data_dir
            .join("routa.db")
            .to_string_lossy()
            .to_string()
    });

    let node_bin = env_or_default("ROUTA_NODE_BIN", "node");
    println!(
        "[desktop-server] Starting embedded server: {} {}",
        node_bin,
        server_js.to_string_lossy()
    );
    println!("[desktop-server] Database path: {}", db_path);

    let mut child = Command::new(node_bin)
        .arg("server.js")
        .current_dir(&server_root)
        .env("HOSTNAME", host)
        .env("PORT", port.to_string())
        .env("ROUTA_DESKTOP_SERVER_BUILD", "1")
        .env("ROUTA_DB_DRIVER", "sqlite")
        .env("ROUTA_DB_PATH", &db_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to spawn embedded desktop API server. Install Node.js or set ROUTA_NODE_BIN. {}",
                e
            )
        })?;

    pipe_child_logs("desktop-server", &mut child);
    Ok(child)
}

/// Resolve the SQLite database path for the desktop app.
fn resolve_db_path(app: &tauri::AppHandle) -> String {
    std::env::var("ROUTA_DB_PATH").unwrap_or_else(|_| {
        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| dirs::home_dir().unwrap_or_default().join(".routa"));
        std::fs::create_dir_all(&data_dir).ok();
        data_dir
            .join("routa.db")
            .to_string_lossy()
            .to_string()
    })
}

/// Resolve the static frontend directory for the Rust server.
/// In production, looks for the `frontend` resource bundled by Tauri.
/// In development, uses the `out/` directory from the repo root.
fn resolve_static_dir(app: &tauri::AppHandle) -> Option<String> {
    // 1. Check for Tauri bundled resource
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_frontend = resource_dir.join("frontend");
        if bundled_frontend.exists() && bundled_frontend.is_dir() {
            println!(
                "[rust-server] Using bundled frontend: {}",
                bundled_frontend.to_string_lossy()
            );
            return Some(bundled_frontend.to_string_lossy().to_string());
        }
    }

    // 2. Fall back to repo `out/` directory (development)
    if let Some(repo_root) = detect_repo_root() {
        let out_dir = repo_root.join("out");
        if out_dir.exists() && out_dir.is_dir() {
            println!(
                "[rust-server] Using dev frontend: {}",
                out_dir.to_string_lossy()
            );
            return Some(out_dir.to_string_lossy().to_string());
        }
    }

    // 3. Check CARGO_MANIFEST_DIR/frontend (used in production builds)
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let frontend_dir = manifest_dir.join("frontend");
    if frontend_dir.exists() && frontend_dir.is_dir() {
        let canonical = frontend_dir.canonicalize().unwrap_or(frontend_dir);
        println!(
            "[rust-server] Using local frontend/: {}",
            canonical.to_string_lossy()
        );
        return Some(canonical.to_string_lossy().to_string());
    }

    // 4. Check repo out/ directory (for cargo test / dev builds)
    let out_dir = manifest_dir.join("..").join("..").join("..").join("out");
    if out_dir.exists() && out_dir.is_dir() {
        let canonical = out_dir.canonicalize().unwrap_or(out_dir);
        println!(
            "[rust-server] Using out/ frontend: {}",
            canonical.to_string_lossy()
        );
        return Some(canonical.to_string_lossy().to_string());
    }

    println!("[rust-server] No static frontend directory found");
    None
}

/// Start the embedded Rust backend server (replaces Node.js).
fn start_rust_server(app: &tauri::AppHandle, host: &str, port: u16) -> Result<(), String> {
    let db_path = resolve_db_path(app);
    let static_dir = resolve_static_dir(app);
    let host = host.to_string();

    println!("[rust-server] Starting embedded Rust backend server");
    println!("[rust-server] Database path: {}", db_path);
    println!(
        "[rust-server] Static dir: {}",
        static_dir.as_deref().unwrap_or("(none)")
    );
    println!("[rust-server] Listening on {}:{}", host, port);

    let config = server::ServerConfig {
        host,
        port,
        db_path,
        static_dir,
    };

    // Start the server in the Tauri async runtime
    tauri::async_runtime::spawn(async move {
        match server::start_server(config).await {
            Ok(addr) => {
                println!("[rust-server] Server started on {}", addr);
            }
            Err(e) => {
                eprintln!("[rust-server] Failed to start server: {}", e);
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
            get_env,
            get_cwd,
            get_home_dir,
            is_git_repo,
            log_frontend,
        ])
        .setup(|app| {
            // Always open devtools (in both debug and release builds)
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

            // Configurable API mode:
            // - rust (default): start embedded Rust server (no Node.js needed).
            // - embedded: start packaged standalone Next server (legacy Node.js mode).
            // - external: connect to existing server at ROUTA_DESKTOP_API_URL.
            // - off: use embedded static UI only.
            let api_mode = env_or_default("ROUTA_DESKTOP_API_MODE", "rust");
            let api_host = env_or_default("ROUTA_DESKTOP_API_HOST", "127.0.0.1");
            let port = api_port();
            let api_url = std::env::var("ROUTA_DESKTOP_API_URL")
                .unwrap_or_else(|_| format!("http://{}:{}", api_host, port));

            match api_mode.as_str() {
                "off" => {
                    println!("[desktop-server] API mode is off, using embedded static UI only");
                }
                "rust" => {
                    // New: Start embedded Rust server (no Node.js dependency!)
                    match start_rust_server(&app.handle(), &api_host, port) {
                        Ok(()) => {
                            // Wait for the Rust server to become ready
                            if wait_for_port(&api_host, port, 5) {
                                if let Some(window) = app.get_webview_window("main") {
                                    let js =
                                        format!("window.location.replace('{}');", api_url);
                                    let _ = window.eval(&js);
                                    println!(
                                        "[rust-server] Webview navigated to {}",
                                        api_url
                                    );
                                }
                            } else {
                                eprintln!(
                                    "[rust-server] Timed out waiting for server. Falling back to static UI."
                                );
                            }
                        }
                        Err(e) => {
                            eprintln!("[rust-server] {}", e);
                        }
                    }
                }
                "embedded" => {
                    // Legacy: start Node.js server
                    let mut ready = wait_for_port(&api_host, port, 1);
                    if !ready {
                        match start_embedded_next_server(&app.handle(), &api_host, port) {
                            Ok(_child) => {}
                            Err(err) => {
                                eprintln!("[desktop-server] {}", err);
                                match start_local_next_server(&api_host, port) {
                                    Ok(_child) => {}
                                    Err(dev_err) => {
                                        eprintln!("[desktop-server] {}", dev_err);
                                    }
                                }
                            }
                        }
                        ready = wait_for_port(&api_host, port, 25);
                    } else {
                        println!(
                            "[desktop-server] Reusing existing local server on {}",
                            api_url
                        );
                    }

                    if ready {
                        if let Some(window) = app.get_webview_window("main") {
                            let js = format!("window.location.replace('{}');", api_url);
                            let _ = window.eval(&js);
                            println!("[desktop-server] Webview navigated to {}", api_url);
                        }
                    } else {
                        eprintln!(
                            "[desktop-server] Timed out waiting for {}. Falling back to embedded static UI.",
                            api_url
                        );
                    }
                }
                "external" => {
                    if wait_for_port(&api_host, port, 5) {
                        if let Some(window) = app.get_webview_window("main") {
                            let js = format!("window.location.replace('{}');", api_url);
                            let _ = window.eval(&js);
                            println!(
                                "[desktop-server] Webview navigated to external {}",
                                api_url
                            );
                        }
                    } else {
                        eprintln!(
                            "[desktop-server] External server not reachable at {}",
                            api_url
                        );
                    }
                }
                _ => {
                    eprintln!(
                        "[desktop-server] Unknown API mode '{}', falling back to static UI",
                        api_mode
                    );
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
