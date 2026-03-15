use std::collections::HashMap;
use tauri::State;

#[derive(serde::Serialize, Clone)]
pub struct PtySessionInfo {
    pub session_id: String,
    pub command: String,
    pub cwd: String,
}

pub struct PtyState;

impl PtyState {
    pub fn new() -> Self {
        Self
    }
}

fn mobile_pty_error() -> Result<(), String> {
    Err("PTY is not supported on mobile builds".to_string())
}

#[tauri::command]
pub async fn pty_create(
    _state: State<'_, PtyState>,
    _command: Option<String>,
    _args: Option<Vec<String>>,
    _cwd: Option<String>,
    _env: Option<HashMap<String, String>>,
    _rows: Option<u16>,
    _cols: Option<u16>,
) -> Result<String, String> {
    Err("PTY is not supported on mobile builds".to_string())
}

#[tauri::command]
pub async fn pty_write(
    _state: State<'_, PtyState>,
    _session_id: String,
    _data: String,
) -> Result<(), String> {
    mobile_pty_error()
}

#[tauri::command]
pub async fn pty_read(
    _state: State<'_, PtyState>,
    _session_id: String,
) -> Result<Option<String>, String> {
    Err("PTY is not supported on mobile builds".to_string())
}

#[tauri::command]
pub async fn pty_resize(
    _state: State<'_, PtyState>,
    _session_id: String,
    _rows: u16,
    _cols: u16,
) -> Result<(), String> {
    mobile_pty_error()
}

#[tauri::command]
pub async fn pty_kill(_state: State<'_, PtyState>, _session_id: String) -> Result<(), String> {
    mobile_pty_error()
}

#[tauri::command]
pub async fn pty_list(_state: State<'_, PtyState>) -> Result<Vec<PtySessionInfo>, String> {
    Ok(Vec::new())
}
