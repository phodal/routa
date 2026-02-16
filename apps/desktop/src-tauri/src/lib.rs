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
        ])
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                let window = _app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
