use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;

use super::process::NotificationSender;

#[derive(Clone)]
struct ManagedTerminal {
    terminal_id: String,
    session_id: String,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    output: Arc<Mutex<String>>,
    exit_code: Arc<Mutex<Option<i32>>>,
    cols: Arc<Mutex<Option<u16>>>,
    rows: Arc<Mutex<Option<u16>>>,
}

#[derive(Clone, Default)]
pub struct TerminalManager {
    terminals: Arc<Mutex<HashMap<String, ManagedTerminal>>>,
    counter: Arc<Mutex<u64>>,
}

impl TerminalManager {
    pub fn global() -> &'static Self {
        static INSTANCE: OnceLock<TerminalManager> = OnceLock::new();
        INSTANCE.get_or_init(TerminalManager::default)
    }

    pub async fn create(
        &self,
        params: &serde_json::Value,
        session_id: &str,
        notification_tx: &NotificationSender,
    ) -> Result<serde_json::Value, String> {
        let terminal_id = {
            let mut counter = self.counter.lock().await;
            *counter += 1;
            format!(
                "term-{}-{}",
                *counter,
                chrono::Utc::now().timestamp_millis()
            )
        };

        let command = params
            .get("command")
            .and_then(|value| value.as_str())
            .unwrap_or("/bin/bash");
        let args = params
            .get("args")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let cwd = params
            .get("cwd")
            .and_then(|value| value.as_str())
            .unwrap_or(".");
        let cols = params
            .get("cols")
            .and_then(|value| value.as_u64())
            .map(|value| value as u16);
        let rows = params
            .get("rows")
            .and_then(|value| value.as_u64())
            .map(|value| value as u16);

        let mut command_builder = Command::new(command);
        command_builder
            .args(&args)
            .current_dir(cwd)
            .env("PATH", crate::shell_env::full_path())
            .env("TERM", "xterm-256color")
            .env("FORCE_COLOR", "1")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let mut child = command_builder
            .spawn()
            .map_err(|error| format!("Failed to spawn terminal process: {}", error))?;

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let managed = ManagedTerminal {
            terminal_id: terminal_id.clone(),
            session_id: session_id.to_string(),
            child: Arc::new(Mutex::new(child)),
            stdin: Arc::new(Mutex::new(stdin)),
            output: Arc::new(Mutex::new(String::new())),
            exit_code: Arc::new(Mutex::new(None)),
            cols: Arc::new(Mutex::new(cols)),
            rows: Arc::new(Mutex::new(rows)),
        };

        self.terminals
            .lock()
            .await
            .insert(terminal_id.clone(), managed.clone());

        emit_terminal_update(
            notification_tx,
            session_id,
            serde_json::json!({
                "sessionUpdate": "terminal_created",
                "terminalId": terminal_id,
                "command": command,
                "args": args,
            }),
        );

        if let Some(stdout) = stdout {
            spawn_output_forwarder(managed.clone(), stdout, notification_tx.clone());
        }
        if let Some(stderr) = stderr {
            spawn_output_forwarder(managed.clone(), stderr, notification_tx.clone());
        }
        spawn_exit_watcher(managed, notification_tx.clone());

        Ok(serde_json::json!({ "terminalId": terminal_id }))
    }

    pub async fn has_terminal(&self, session_id: &str, terminal_id: &str) -> bool {
        self.terminals
            .lock()
            .await
            .get(terminal_id)
            .map(|terminal| terminal.session_id == session_id)
            .unwrap_or(false)
    }

    pub async fn write(&self, terminal_id: &str, data: &str) -> Result<(), String> {
        let terminal = self
            .terminals
            .lock()
            .await
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| "Terminal not found".to_string())?;
        let mut stdin_guard = terminal.stdin.lock().await;
        let stdin = stdin_guard
            .as_mut()
            .ok_or_else(|| "Terminal is not writable".to_string())?;
        stdin
            .write_all(data.as_bytes())
            .await
            .map_err(|error| format!("Failed to write terminal input: {}", error))?;
        stdin
            .flush()
            .await
            .map_err(|error| format!("Failed to flush terminal input: {}", error))?;
        Ok(())
    }

    pub async fn resize(
        &self,
        terminal_id: &str,
        cols: Option<u16>,
        rows: Option<u16>,
    ) -> Result<(), String> {
        let terminal = self
            .terminals
            .lock()
            .await
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| "Terminal not found".to_string())?;
        if let Some(cols) = cols {
            *terminal.cols.lock().await = Some(cols);
        }
        if let Some(rows) = rows {
            *terminal.rows.lock().await = Some(rows);
        }
        Ok(())
    }

    pub async fn get_output(&self, terminal_id: &str) -> Result<serde_json::Value, String> {
        let terminal = self
            .terminals
            .lock()
            .await
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| "Terminal not found".to_string())?;
        let output = terminal.output.lock().await.clone();
        Ok(serde_json::json!({ "output": output }))
    }

    pub async fn wait_for_exit(&self, terminal_id: &str) -> Result<serde_json::Value, String> {
        let terminal = self
            .terminals
            .lock()
            .await
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| "Terminal not found".to_string())?;
        loop {
            if let Some(code) = *terminal.exit_code.lock().await {
                return Ok(serde_json::json!({ "exitCode": code }));
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }

    pub async fn kill(&self, terminal_id: &str) -> Result<(), String> {
        let terminal = self
            .terminals
            .lock()
            .await
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| "Terminal not found".to_string())?;
        let mut child = terminal.child.lock().await;
        child
            .kill()
            .await
            .map_err(|error| format!("Failed to kill terminal: {}", error))
    }

    pub async fn release(&self, terminal_id: &str) {
        self.terminals.lock().await.remove(terminal_id);
    }
}

fn emit_terminal_update(
    notification_tx: &NotificationSender,
    session_id: &str,
    update: serde_json::Value,
) {
    let _ = notification_tx.send(serde_json::json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": update,
        }
    }));
}

fn spawn_output_forwarder<R>(
    terminal: ManagedTerminal,
    mut reader: R,
    notification_tx: NotificationSender,
) where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer).await {
                Ok(0) => break,
                Ok(size) => {
                    let data = String::from_utf8_lossy(&buffer[..size]).to_string();
                    terminal.output.lock().await.push_str(&data);
                    emit_terminal_update(
                        &notification_tx,
                        &terminal.session_id,
                        serde_json::json!({
                            "sessionUpdate": "terminal_output",
                            "terminalId": terminal.terminal_id,
                            "data": data,
                        }),
                    );
                }
                Err(_) => break,
            }
        }
    });
}

fn spawn_exit_watcher(terminal: ManagedTerminal, notification_tx: NotificationSender) {
    tokio::spawn(async move {
        let code = loop {
            let maybe_status = {
                let mut child = terminal.child.lock().await;
                child.try_wait().ok().flatten()
            };
            if let Some(status) = maybe_status {
                break status.code().unwrap_or(0);
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        };
        *terminal.exit_code.lock().await = Some(code);
        emit_terminal_update(
            &notification_tx,
            &terminal.session_id,
            serde_json::json!({
                "sessionUpdate": "terminal_exited",
                "terminalId": terminal.terminal_id,
                "exitCode": code,
            }),
        );
    });
}

#[cfg(test)]
mod tests {
    use super::TerminalManager;
    use tokio::sync::broadcast;

    #[cfg(not(windows))]
    #[tokio::test]
    async fn create_write_and_read_terminal_output() {
        let manager = TerminalManager::default();
        let (tx, _rx) = broadcast::channel(32);

        let created = manager
            .create(
                &serde_json::json!({
                    "command": "/bin/cat",
                    "args": [],
                    "cwd": "/tmp"
                }),
                "session-1",
                &tx,
            )
            .await
            .expect("create terminal");
        let terminal_id = created["terminalId"]
            .as_str()
            .expect("terminal id")
            .to_string();

        assert!(manager.has_terminal("session-1", &terminal_id).await);

        manager
            .write(&terminal_id, "hello from terminal\n")
            .await
            .expect("write terminal");

        let mut saw_output = false;
        for _ in 0..20 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            let output = manager.get_output(&terminal_id).await.expect("get output");
            if output["output"]
                .as_str()
                .expect("output string")
                .contains("hello from terminal")
            {
                saw_output = true;
                break;
            }
        }
        assert!(saw_output, "terminal output should contain echoed input");

        manager.kill(&terminal_id).await.expect("kill terminal");
        manager.release(&terminal_id).await;
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn resize_tracks_terminal_without_failing() {
        let manager = TerminalManager::default();
        let (tx, _rx) = broadcast::channel(32);

        let created = manager
            .create(
                &serde_json::json!({
                    "command": "/bin/cat",
                    "args": [],
                    "cwd": "/tmp",
                    "cols": 80,
                    "rows": 24
                }),
                "session-2",
                &tx,
            )
            .await
            .expect("create terminal");
        let terminal_id = created["terminalId"]
            .as_str()
            .expect("terminal id")
            .to_string();

        manager
            .resize(&terminal_id, Some(120), Some(40))
            .await
            .expect("resize terminal");

        manager.kill(&terminal_id).await.expect("kill terminal");
        manager.release(&terminal_id).await;
    }
}
